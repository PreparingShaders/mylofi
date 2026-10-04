import json
import base64
import logging
import re
import time
from typing import Awaitable, Callable, Optional, Dict, Any, List
import httpx

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

# Every single upstream call is bounded. Without a hard timeout a hanging
# worker keeps the background task (and the frontend poll loop) alive
# indefinitely, which is exactly the failure mode this module must not have.
MODEL_REQUEST_TIMEOUT = 20.0
MODEL_CONNECT_TIMEOUT = 10.0

# The user comment is context, not an instruction: it is flattened to a single
# line and capped so a long note cannot crowd out the rest of the prompt.
MAX_USER_NOTES_CHARS = 400

# The custom persona instruction is the user writing their own prompt. The cap
# matches the API's max_length, so what the profile accepts is what reaches the
# model: the text is flattened to one line (a multi-line block invites the model
# to answer with a list instead of the JSON the contract requires) and can never
# crowd out the rules below.
MAX_PERSONA_TEXT_CHARS = 1000

# ai_verdict is a short verdict on the dish, not a spreadsheet: the prompt asks
# for exactly 5-7 connected sentences and _sanitize_verdict enforces the upper
# bound, because a chatty model drifting to 12 sentences is a wall of text on a
# meal card while a terse one is still a usable answer. The lower bound is a
# prompt rule only - padding a verdict the model already wrote well is worse
# than a slightly short one.
VERDICT_MIN_SENTENCES = 5
VERDICT_MAX_SENTENCES = 7

# Emoji, pictographs, dingbats, flags, skin-tone modifiers, variation selectors
# and the zero-width joiner that glues emoji sequences together. Every one of
# them is stripped from ai_verdict before it is stored, so the model is told the
# rule and the answer is checked regardless of whether it listened.
EMOJI_PATTERN = re.compile(
    "["
    "\u2600-\u26ff"  # misc symbols
    "\u2700-\u27bf"  # dingbats
    "\u2b00-\u2bff"  # misc symbols and arrows
    "\U0001f000-\U0001faff"  # mahjong, cards, emoticons, transport, pictographs
    "\u200d"  # zero width joiner
    "\u20e3"  # combining enclosing keycap
    "\ufe0e\ufe0f"  # variation selectors
    "]+"
)

# A sentence ends at . ! ? or the ellipsis, followed by whitespace. Abbreviations
# and decimals ("т. е.", "12.5") split a bit early, which only ever makes the
# count slightly generous - harmless for a clamp that only ever cuts.
SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[.!?…])\s+")

# The voice the verdict is written in. Only the wording of ai_verdict and the
# comments around the numbers change - the JSON contract, the length and
# formatting rules below stay fixed, so a persona can never talk the model out
# of returning a parsable answer or into emojis, digits or a bullet list.
PERSONA_PROMPTS = {
    "kind": (
        "Ты — добрый нутрициолог. Говори тепло и поддерживающе, без нравоучений: "
        "сначала что получилось хорошо, потом что можно улучшить, и всегда с конкретным действием."
    ),
    "strict": (
        "Ты — строгий нутрициолог-тренер. Говори коротко, по делу и без уступок: называй "
        "ошибки прямо, требуй конкретных действий и не смягчай оценку легендами о пользе."
    ),
    "sarcastic": (
        "Ты — нутрициолог в духе Джарвиса: спокойный, умный, с сухим английским юмором "
        "и иронией, которая звучит фоном, а не фокусом. Ирония направлена на блюдо, "
        "состав и привычки, а не на человека: никаких насмешек над пользователем, "
        "никакого сарказма в его адрес и никакой снисходительности. Текст всё равно "
        "остаётся точной профессиональной оценкой: ирония слышна фоном, а выводы "
        "по блюду - серьёзно."
    ),
    "custom": (
        "Ты — нутрициолог. Стиль общения пользователь задаёт сам, и он указан сразу после этого предложения. "
        "Следуй ему в формулировках ai_verdict, не меняя при этом факты, цифры и JSON-формат ответа."
    ),
}

# Used when the profile carries no persona (an old row, or a value the app no
# longer knows). The warm default is what an unset column should read as.
DEFAULT_PERSONA = "kind"

# WORKER_URL often carries a trailing slash from the env file.
WORKER_BASE_URL = (settings.WORKER_URL or "").rstrip("/")

UNIFIED_MODEL_CASCADE = [
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "qwen/qwen3.8-27b:free",
    "dots-studio/dots-3-note-preview:free",
    "nvidia/nemotron-3.5-content-safety:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
]


def _sanitize_user_notes(notes: Optional[str]) -> str:
    """Flatten the user comment into a single bounded prompt line."""
    if not notes:
        return ""
    cleaned = re.sub(r"\s+", " ", str(notes)).strip()
    if not cleaned:
        return ""
    if len(cleaned) > MAX_USER_NOTES_CHARS:
        cleaned = cleaned[:MAX_USER_NOTES_CHARS].rstrip() + "..."
    return cleaned


def format_amount(value: Any) -> str:
    """Format a target/consumed figure for the prompt.

    None (the profile has no such number yet) becomes "?", but a real zero is
    printed as 0: `or '?'` used to swallow it and the model read "0 ккал" as
    missing context.
    """
    if value is None:
        return "?"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "?"
    return f"{number:g}"


# How the stored goal key reads inside a prompt. Shared by the dish verdict and
# the daily recap so the same profile never describes itself two different ways.
GOAL_LABELS = {
    "lose": "дефицит калорий (похудение)",
    "maintain": "поддержание веса",
    "gain": "профицит калорий (набор массы)",
    "deficit": "дефицит калорий (похудение)",
    "surplus": "профицит калорий (набор массы)",
}


def describe_goal(user_goal: Optional[str]) -> str:
    """Prompt wording for a stored goal key, falling back to 'not set'."""
    return GOAL_LABELS.get(user_goal or "", "не определена")


def normalize_persona(persona: Optional[str]) -> str:
    """The persona key to use, falling back to the default for unusable input.

    Anything the app does not know about - a persona retired from the enum, a
    typo, an empty column - resolves to the default rather than raising: a
    missing tone must never cost the user their nutrition analysis.
    """
    key = str(persona or "").strip().lower()
    return key if key in PERSONA_PROMPTS else DEFAULT_PERSONA


def sanitize_persona_text(text: Optional[str]) -> str:
    """Flatten the user's own persona wording into a bounded prompt block."""
    if not text:
        return ""
    cleaned = re.sub(r"\s+", " ", str(text)).strip()
    if not cleaned:
        return ""
    if len(cleaned) > MAX_PERSONA_TEXT_CHARS:
        cleaned = cleaned[:MAX_PERSONA_TEXT_CHARS].rstrip() + "..."
    return cleaned


def build_prompt(
    user_goal: Optional[str] = None,
    targets: Optional[Dict[str, Any]] = None,
    current_balance: Optional[Dict[str, Any]] = None,
    user_notes: Optional[str] = None,
    persona: Optional[str] = None,
    persona_custom_text: Optional[str] = None,
) -> str:
    goal_text = describe_goal(user_goal)

    t_cal = targets.get("target_calories") if targets else None
    t_pro = targets.get("target_protein_g") if targets else None
    t_fat = targets.get("target_fat_g") if targets else None
    t_carb = targets.get("target_carbs_g") if targets else None

    b_cal = current_balance.get("calories") if current_balance else None
    b_pro = current_balance.get("protein_g") if current_balance else None
    b_fat = current_balance.get("fat_g") if current_balance else None
    b_carb = current_balance.get("carbs_g") if current_balance else None

    target_line = (
        f"Цель пользователя: {goal_text}. "
        f"Дневные нормы: {format_amount(t_cal)} ккал, белки {format_amount(t_pro)} г, "
        f"жиры {format_amount(t_fat)} г, углеводы {format_amount(t_carb)} г. "
        if t_cal or t_pro or t_fat or t_carb
        else "Дневные нормы пользователя не заданы (знак '?' означает, что нормы нет): оценивай блюдо без сравнения с нормами. "
    )
    balance_line = (
        f"Уже потреблено сегодня до этого приёма пищи: {format_amount(b_cal)} ккал, белки {format_amount(b_pro)} г, "
        f"жиры {format_amount(b_fat)} г, углеводы {format_amount(b_carb)} г. "
        if b_cal is not None or b_pro is not None or b_fat is not None or b_carb is not None
        else ""
    )

    # The comment is what the model cannot see: the portion the user knows, the
    # hidden oil or sugar, the dish eaten at a restaurant. It outranks a vague
    # guess from the photo but never overrides what is visible.
    user_notes_text = _sanitize_user_notes(user_notes)
    notes_line = (
        f'Комментарий пользователя к блюду: "{user_notes_text}". '
        "Используй его при оценке порции и состава, приоритетно перед догадками по фото. "
        if user_notes_text
        else ""
    )

    # The persona is a tone of voice, not a task: it is stated once, up front, and
    # the rules below keep every one of them (the JSON contract, the verdict
    # length, the no-emoji and no-digits rules) binding regardless of voice.
    persona_key = normalize_persona(persona)
    persona_text = sanitize_persona_text(persona_custom_text)
    persona_line = (
        f"Персонализация: {PERSONA_PROMPTS[persona_key]}"
        + (
            f' Пользовательский стиль: "{persona_text}". '
            if persona_key == "custom" and persona_text
            else ""
        )
        + " Персона влияет только на тон формулировок ai_verdict: длина, отсутствие эмодзи, "
        "запрет на повторение цифр макросов и все правила оценки выше действуют в полном объёме."
    )

    return f"""Ты — нутрициолог. Проанализируй фото еды с учётом цели и текущего баланса пользователя и верни СТРОГО валидный JSON с полями:
{{
  "dish_name": "название блюда на русском",
  "calories": 350.0,
  "protein_g": 12.0,
  "fat_g": 6.0,
  "carbs_g": 58.0,
  "fiber_g": 5.0,
  "sugar_g": 10.0,
  "sodium_mg": 120.0,
  "tags": ["каша", "завтрак", "ягоды"],
  "quality_score": 8.5,
  "quality_metrics": [
    {{"label": "Белок", "score": 8.0}},
    {{"label": "Клетчатка", "score": 7.5}},
    {{"label": "Обработка", "score": 6.5}}
  ],
  "ai_verdict": "Оценка нутрициолога РОВНО из 5-7 связанных предложений: без эмодзи и без повторения цифр макросов."
}}
Все числовые значения — float. quality_score от 1.0 до 10.0. quality_metrics — массив из 3-5 объектов с полями label (строка) и score (float 0-10). ai_verdict — связный текст РОВНО из 5-7 предложений, без воды и без эмодзи. Никаких пояснений, только JSON.

Правила оценки блюда и вердикта (обязательно):
1. ДЛИНА: в ai_verdict РОВНО {VERDICT_MIN_SENTENCES}-{VERDICT_MAX_SENTENCES} предложений, связанных в один связный текст. Меньше {VERDICT_MIN_SENTENCES} или больше {VERDICT_MAX_SENTENCES} - нарушение. Каждое предложение несуще: не добивай объём дежурными фразами и не повторяй мысль дважды.
2. НОЛЬ ЭМОДЗИ: ни одного эмодзи, смайлика, иконки или символического значка из наборов эмодзи - ни в ai_verdict, ни в dish_name, ни в tags, ни в label у quality_metrics. Только обычные буквы, пробелы и знаки препинания.
3. НОЛЬ ЦИФР МАКРОСОВ В ТЕКСТЕ: в ai_verdict не пиши калории, граммы белков, жиров, углеводов, проценты и остаток по нормам ("превышение на 240 ккал", "белок больше нормы на 18 г" - запрещено). Цифры живут только в числовых полях JSON, а пользователь уже видит их в бейджах на карточке. Дневные нормы из контекста нужны тебе как внутренний расчёт, чтобы понимать, где блюдо стоит относительно цели, а не чтобы пересказывать их вслух.
4. О ЧЁМ ГОВОРИТЬ: качество и состав ингредиентов, сытость блюда, баланс БЖУ внутри блюда, соответствие цели пользователя, в чём риск (сахар, соль, переработка, недостаток овощей) и одно конкретное действие, что изменить.
5. ПРЕВЫШЕНИЕ НОРМ: сначала посчитай итог дня (уже потреблённое + твоя оценка блюда) против дневных норм - это внутренний расчёт. Если что-то вышло выше нормы, назови это прямо и конкретно, указав именно показатель ("превышено по калориям", "жиры выше нормы"), но без цифр. Запрещено приуменьшать: "чуть выше нормы", "близко к норме", "в пределах нормы", "совсем немного превышает" - такие формулировки противоречат расчёту и обманывают пользователя. Если всё в пределах нормы - скажи это прямо, не называя остаток цифрами. Если норм нет ('?') - оценивай блюдо само по себе, без сравнения.
6. БЕЛОК - ВСЕГДА ПЛЮС: превышение белка никогда не подаётся как ошибка, избыток, перебор или замечание. Белок выше нормы - это польза для мышц и для сытости, и модель обязана это отметить и похвалить.
7. ПЕРСОНА - ТОЛЬКО ТОН: любая персона задаёт только тон формулировок. Длина, отсутствие эмодзи, запрет на цифры макросов, честность по превышениям и похвала белка действуют при любой персона.

{persona_line}

Контекст:
{target_line}{balance_line}{notes_line}"""


def _strip_markdown_json(text: str) -> str:
    """Remove markdown code fences from LLM response."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    return text.strip()


def _extract_json_object(text: str) -> Optional[str]:
    """Pull the outermost {...} block out of a chatty model answer.

    Free models like to wrap the JSON in a sentence of prose, or to fence it
    somewhere the fence stripper above cannot reach ("Here is the JSON: {...}").
    Returns None when there is no balanced-looking object to try.
    """
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    return text[start:end + 1]


def _parse_llm_json(text: str) -> Dict[str, Any]:
    """Parse JSON from LLM response, handling markdown wrappers."""
    cleaned = _strip_markdown_json(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        candidate = _extract_json_object(cleaned)
        if candidate is not None:
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                pass
        logger.error(f"Failed to parse JSON from LLM, raw: {text[:500]}")
        raise


def count_sentences(text: str) -> int:
    """How many sentences a verdict actually reads as."""
    stripped = re.sub(r"\s+", " ", text or "").strip()
    if not stripped:
        return 0
    return len(SENTENCE_SPLIT_PATTERN.split(stripped))


def strip_emojis(text: str) -> str:
    """Drop every emoji and its glue, then repair the spacing it leaves."""
    cleaned = EMOJI_PATTERN.sub("", text)
    # An emoji between words leaves a doubled or trailing space, and between two
    # words it can leave nothing at all; both read as a typo on the card.
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.!?;:])", r"\1", cleaned)
    return cleaned.strip()


def clamp_sentences(text: str, max_sentences: int = VERDICT_MAX_SENTENCES) -> str:
    """Keep the first `max_sentences` sentences, cutting only on a sentence end.

    Every kept segment ends in sentence punctuation by construction: a split only
    happens after . ! ? or the ellipsis, so the last segment can be unterminated
    but is never one of the ones kept.
    """
    sentences = SENTENCE_SPLIT_PATTERN.split(text.strip())
    if len(sentences) <= max_sentences:
        return text.strip()
    kept = [s for s in sentences[:max_sentences] if s.strip()]
    logger.info(
        f"[AI Vision] ai_verdict clipped to {len(kept)} sentences "
        f"(model wrote {len(sentences)})"
    )
    return " ".join(kept).strip()


def _sanitize_verdict(verdict: str) -> str:
    """Apply the verdict rules the model is asked for but cannot be trusted with.

    The prompt asks for 5-7 emoji-free sentences; this enforces the two rules a
    user would actually notice being broken - an emoji on a meal card and a
    verdict that runs on for a dozen sentences. It never adds content: a verdict
    that came back too short is left short rather than padded with filler.
    """
    cleaned = strip_emojis(re.sub(r"\s+", " ", verdict).strip())
    if count_sentences(cleaned) > VERDICT_MAX_SENTENCES:
        cleaned = clamp_sentences(cleaned)
    if count_sentences(cleaned) < VERDICT_MIN_SENTENCES:
        logger.info(
            f"[AI Vision] ai_verdict is shorter than {VERDICT_MIN_SENTENCES} sentences: "
            f"{count_sentences(cleaned)}"
        )
    return cleaned


def _is_gemini_model(model_name: str) -> bool:
    return model_name.startswith("gemini-")


async def _call_gemini(model_name: str, base64_img: str, client: httpx.AsyncClient, prompt: str) -> Dict[str, Any]:
    url = f"{WORKER_BASE_URL}/v1beta/models/{model_name}:generateContent?key={settings.GEMINI_API_KEY}"
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "image/jpeg", "data": base64_img}}
            ]
        }]
    }
    response = await client.post(url, json=payload, timeout=MODEL_REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Empty candidates from Gemini")
    text = candidates[0]["content"]["parts"][0]["text"]
    return _parse_llm_json(text)


async def _call_openrouter(model_name: str, base64_img: str, client: httpx.AsyncClient, prompt: str) -> Dict[str, Any]:
    url = f"{WORKER_BASE_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.OPEN_ROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_name,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_img}"}}
            ]
        }]
    }
    response = await client.post(url, headers=headers, json=payload, timeout=MODEL_REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        raise ValueError("Empty choices from OpenRouter")
    text = choices[0]["message"]["content"]
    return _parse_llm_json(text)


# Text-only twins of the two calls above. Same endpoints, same credentials, same
# parsing - the only difference is that there is no image part in the payload, so
# the daily summary can reuse this cascade instead of growing a second list of
# models, timeouts and fallbacks next to the vision one.
async def _call_gemini_text(model_name: str, client: httpx.AsyncClient, prompt: str) -> Dict[str, Any]:
    url = f"{WORKER_BASE_URL}/v1beta/models/{model_name}:generateContent?key={settings.GEMINI_API_KEY}"
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    response = await client.post(url, json=payload, timeout=MODEL_REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Empty candidates from Gemini")
    text = candidates[0]["content"]["parts"][0]["text"]
    return _parse_llm_json(text)


async def _call_openrouter_text(model_name: str, client: httpx.AsyncClient, prompt: str) -> Dict[str, Any]:
    url = f"{WORKER_BASE_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.OPEN_ROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"model": model_name, "messages": [{"role": "user", "content": prompt}]}
    response = await client.post(url, headers=headers, json=payload, timeout=MODEL_REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        raise ValueError("Empty choices from OpenRouter")
    text = choices[0]["message"]["content"]
    return _parse_llm_json(text)


REQUIRED_FIELDS = [
    "dish_name", "calories", "protein_g", "fat_g", "carbs_g",
    "fiber_g", "sugar_g", "sodium_mg", "tags", "quality_score",
    "quality_metrics", "ai_verdict",
]


def normalise_score(raw: Any, low: float = 1.0, high: float = 10.0) -> float:
    """Put a model score on the 1-10 scale the UI prints.

    Models answer either 1.0-10.0 or the same judgement written as 0.0-1.0; a
    value below 1.0 can only be the second form (1.0 itself is a valid, if
    terrible, score on the first), so it is scaled up. Everything is then clamped
    so the badge can never read "0.8/10" or "85/10".
    """
    score = float(raw)
    if 0.0 < score < 1.0:
        score *= 10.0
    return max(low, min(high, score))


def _validate_analysis(result: Dict[str, Any]) -> Dict[str, Any]:
    """Check the model answer is a usable nutrition payload and normalise ranges.

    Raising here keeps a malformed answer inside the cascade: the caller treats
    it like any other model failure and moves on to the next model.
    """
    if not isinstance(result, dict):
        raise ValueError(f"Response must be a JSON object, got {type(result).__name__}")

    for field in REQUIRED_FIELDS:
        if field not in result:
            raise ValueError(f"Missing required field: {field}")

    result["quality_score"] = normalise_score(result["quality_score"])

    qm = result.get("quality_metrics", [])
    if not isinstance(qm, list):
        raise ValueError("quality_metrics must be a list")
    for item in qm:
        if not isinstance(item, dict) or "label" not in item or "score" not in item:
            raise ValueError("Each quality_metric must have label and score")
        item["score"] = normalise_score(item["score"], low=0.0)

    if not isinstance(result.get("ai_verdict"), str) or not result["ai_verdict"].strip():
        raise ValueError("ai_verdict must be a non-empty string")

    # Sanitising here rather than in the caller keeps the rule on the one path
    # every answer travels: the cascade can hand back the payload from any
    # model in the list, and all of them are prompted, none of them are obeyed.
    sanitized = _sanitize_verdict(result["ai_verdict"])
    if not sanitized.strip():
        raise ValueError("ai_verdict is empty after removing emoji")
    result["ai_verdict"] = sanitized

    return result


async def _run_cascade(
    call_model: Callable[[str, httpx.AsyncClient], Awaitable[Dict[str, Any]]],
    validate: Callable[[Dict[str, Any]], Dict[str, Any]],
    log_prefix: str = "[AI Vision]",
) -> Dict[str, Any]:
    """Walk UNIFIED_MODEL_CASCADE until one model returns a usable payload.

    `call_model` performs the request for a single model and `validate` checks
    and normalises its answer. A `validate` that raises is treated like any other
    model failure: the cascade moves on to the next model, so one chatty free
    model cannot cost the user their analysis.

    Credential checks, the hard per-call timeouts and the error classification
    live here so the vision and the text-only callers fail the same way and log
    under the same prefix.
    """
    last_error: Optional[BaseException] = None
    skipped: List[str] = []
    attempted = 0

    timeout = httpx.Timeout(
        MODEL_REQUEST_TIMEOUT,
        connect=MODEL_CONNECT_TIMEOUT,
    )
    limits = httpx.Limits(max_connections=1, max_keepalive_connections=1)

    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        for model_name in UNIFIED_MODEL_CASCADE:
            is_gemini = _is_gemini_model(model_name)
            required_key = settings.GEMINI_API_KEY if is_gemini else settings.OPEN_ROUTER_API_KEY
            if not required_key:
                skipped.append(model_name)
                logger.warning(
                    f"{log_prefix} Skipping {model_name}: "
                    f"{'GEMINI_API_KEY' if is_gemini else 'OPEN_ROUTER_API_KEY'} not set"
                )
                continue

            attempted += 1
            started = time.perf_counter()
            try:
                logger.info(
                    f"{log_prefix} Trying model {model_name} "
                    f"(attempt {attempted}/{len(UNIFIED_MODEL_CASCADE)})"
                )
                result = validate(await call_model(model_name, client))
                elapsed = time.perf_counter() - started
                logger.info(f"{log_prefix} Success with {model_name} in {elapsed:.1f}s")
                return result

            except httpx.HTTPStatusError as e:
                last_error = e
                status = e.response.status_code
                elapsed = time.perf_counter() - started
                logger.warning(
                    f"{log_prefix} {model_name} failed after {elapsed:.1f}s "
                    f"with HTTP {status}: {e.response.text[:200]}"
                )
                if status in (401, 403):
                    logger.error(
                        f"{log_prefix} {model_name} rejected credentials "
                        f"({'GEMINI_API_KEY' if is_gemini else 'OPEN_ROUTER_API_KEY'} is invalid)"
                    )
                continue
            except (httpx.TimeoutException, httpx.RequestError) as e:
                last_error = e
                elapsed = time.perf_counter() - started
                logger.warning(
                    f"{log_prefix} {model_name} request failed after {elapsed:.1f}s "
                    f"(timeout={MODEL_REQUEST_TIMEOUT}s): {type(e).__name__}: {e}"
                )
                continue
            except (ValueError, KeyError, TypeError, IndexError, json.JSONDecodeError) as e:
                last_error = e
                elapsed = time.perf_counter() - started
                logger.warning(
                    f"{log_prefix} {model_name} returned an unusable response after {elapsed:.1f}s: {e}"
                )
                continue
            except Exception as e:
                last_error = e
                elapsed = time.perf_counter() - started
                logger.exception(
                    f"{log_prefix} Unexpected error from {model_name} after {elapsed:.1f}s"
                )
                continue

    detail = f"{type(last_error).__name__}: {last_error}" if last_error else "no error captured"
    if attempted == 0:
        skipped_detail = ", ".join(skipped) or "cascade is empty"
        raise RuntimeError(
            f"No model was attempted: every model in the cascade was skipped ({skipped_detail}). "
            "Check GEMINI_API_KEY / OPEN_ROUTER_API_KEY and WORKER_URL."
        )
    raise RuntimeError(
        f"All {attempted} attempted models failed. Last error -> {detail}"
    )


async def run_text_cascade(
    prompt: str,
    validate: Callable[[Dict[str, Any]], Dict[str, Any]],
    log_prefix: str = "[AI Summary]",
) -> Dict[str, Any]:
    """Run the same cascade as the photo analysis, without an image.

    Text-only tasks (the daily recap) reuse the vision model list rather than
    keeping their own: one place decides which models exist, which key each of
    them needs and how long it may take.

    Raises RuntimeError only once every model has failed, exactly like
    `analyze_meal_photo`.
    """
    if not settings.WORKER_URL:
        raise ValueError("WORKER_URL not configured")

    def call_model(model_name: str, client: httpx.AsyncClient) -> Awaitable[Dict[str, Any]]:
        if _is_gemini_model(model_name):
            return _call_gemini_text(model_name, client, prompt)
        return _call_openrouter_text(model_name, client, prompt)

    return await _run_cascade(call_model, validate, log_prefix)


async def analyze_meal_photo(
    base64_img: str,
    user_goal: Optional[str] = None,
    targets: Optional[Dict[str, Any]] = None,
    current_balance: Optional[Dict[str, Any]] = None,
    user_notes: Optional[str] = None,
    persona: Optional[str] = None,
    persona_custom_text: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Analyze meal photo using cascading model fallback.
    Returns parsed nutrition data with quality_score, quality_metrics and ai_verdict.

    `user_notes` is the comment the user typed when adding the meal: context the
    photo cannot carry (portion, hidden oil, what the dish actually was).
    `persona` / `persona_custom_text` set the voice of ai_verdict; an unknown
    persona falls back to the default one instead of failing the analysis.

    Raises RuntimeError only once every model in the cascade has failed, so the
    caller always gets either a valid payload or an actionable error.
    """
    if not settings.WORKER_URL:
        raise ValueError("WORKER_URL not configured")

    prompt = build_prompt(
        user_goal,
        targets,
        current_balance,
        user_notes,
        persona,
        persona_custom_text,
    )

    def call_model(model_name: str, client: httpx.AsyncClient) -> Awaitable[Dict[str, Any]]:
        if _is_gemini_model(model_name):
            return _call_gemini(model_name, base64_img, client, prompt)
        return _call_openrouter(model_name, base64_img, client, prompt)

    result = await _run_cascade(call_model, _validate_analysis, "[AI Vision]")
    logger.info(f"[AI Vision] Analysis answered: {result['dish_name']}")
    return result