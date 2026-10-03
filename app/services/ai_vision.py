import json
import base64
import logging
import re
import time
from typing import Optional, Dict, Any, List
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

# The voice the verdict is written in. Only the wording of ai_verdict and the
# comments around the numbers change - the JSON contract, the figures and the
# "name the overrun" rules below stay fixed, so a persona can never talk the
# model out of returning a parsable answer.
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
        "Ты — саркастичный нутрициолог с чувством юмора. Шути коротко и уместно, "
        "не превращая оценку в насмешку над человеком: цифры и предупреждения всё равно точны и прямолинейны."
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


def _fmt_amount(value: Any) -> str:
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


def normalize_persona(persona: Optional[str]) -> str:
    """The persona key to use, falling back to the default for unusable input.

    Anything the app does not know about - a persona retired from the enum, a
    typo, an empty column - resolves to the default rather than raising: a
    missing tone must never cost the user their nutrition analysis.
    """
    key = str(persona or "").strip().lower()
    return key if key in PERSONA_PROMPTS else DEFAULT_PERSONA


def _sanitize_persona_text(text: Optional[str]) -> str:
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
    goal_map = {
        "lose": "дефицит калорий (похудение)",
        "maintain": "поддержание веса",
        "gain": "профицит калорий (набор массы)",
        "deficit": "дефицит калорий (похудение)",
        "surplus": "профицит калорий (набор массы)",
    }
    goal_text = goal_map.get(user_goal, "не определена")

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
        f"Дневные нормы: {_fmt_amount(t_cal)} ккал, белки {_fmt_amount(t_pro)} г, "
        f"жиры {_fmt_amount(t_fat)} г, углеводы {_fmt_amount(t_carb)} г. "
        if t_cal or t_pro or t_fat or t_carb
        else "Дневные нормы пользователя не заданы (знак '?' означает, что нормы нет): оценивай блюдо без сравнения с нормами. "
    )
    balance_line = (
        f"Уже потреблено сегодня до этого приёма пищи: {_fmt_amount(b_cal)} ккал, белки {_fmt_amount(b_pro)} г, "
        f"жиры {_fmt_amount(b_fat)} г, углеводы {_fmt_amount(b_carb)} г. "
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
    # the rules below keep every one of them (the JSON contract, the figures, the
    # wording of an overrun) binding regardless of which voice is used.
    persona_key = normalize_persona(persona)
    persona_text = _sanitize_persona_text(persona_custom_text)
    persona_line = (
        f"Персонализация: {PERSONA_PROMPTS[persona_key]}"
        + (
            f' Пользовательский стиль: "{persona_text}". '
            if persona_key == "custom" and persona_text
            else ""
        )
        + " Персона влияет только на тон формулировок ai_verdict: цифры, оценки и JSON-формат "
        "остаются точными, и правила оценки баланса ниже действуют в полном объёме."
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
  "ai_verdict": "Краткая оценка нутрициолога (1-2 предложения) с учётом цели и текущего баланса пользователя."
}}
Все числовые значения — float. quality_score от 1.0 до 10.0. quality_metrics — массив из 3-5 объектов с полями label (строка) и score (float 0-10). ai_verdict — развёрнутая оценка (2-4 предложения) с учётом контекста пользователя и его комментария, без воды. Никаких пояснений, только JSON.

Правила оценки баланса (обязательно):
- Сначала посчитай итог дня: уже потреблённое (см. контекст) + твоя оценка этого блюда, и сравни с дневными нормами.
- Если итог по любому показателю БОЛЬШЕ нормы - это превышение. Назови его прямо и конкретно: "превышение на 240 ккал" / "белок больше нормы на 18 г". Обязательно используй слова "превышено" или "выше нормы".
- Запрещено писать про превышение как про почти норму: "близко к норме", "чуть выше панели", "в пределах нормы", "совсем немного превышает" - такие формулировки противоречат цифрам и обманывают пользователя.
- Если всё в пределах нормы - скажи это прямо и назови остаток. Если норм нет ('?') - оценивай блюдо само по себе, без сравнения.

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


def _parse_llm_json(text: str) -> Dict[str, Any]:
    """Parse JSON from LLM response, handling markdown wrappers."""
    cleaned = _strip_markdown_json(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from LLM: {e}, raw: {text[:500]}")
        raise


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


REQUIRED_FIELDS = [
    "dish_name", "calories", "protein_g", "fat_g", "carbs_g",
    "fiber_g", "sugar_g", "sodium_mg", "tags", "quality_score",
    "quality_metrics", "ai_verdict",
]


def _normalise_score(raw: Any, low: float = 1.0, high: float = 10.0) -> float:
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

    result["quality_score"] = _normalise_score(result["quality_score"])

    qm = result.get("quality_metrics", [])
    if not isinstance(qm, list):
        raise ValueError("quality_metrics must be a list")
    for item in qm:
        if not isinstance(item, dict) or "label" not in item or "score" not in item:
            raise ValueError("Each quality_metric must have label and score")
        item["score"] = _normalise_score(item["score"], low=0.0)

    if not isinstance(result.get("ai_verdict"), str) or not result["ai_verdict"].strip():
        raise ValueError("ai_verdict must be a non-empty string")

    return result


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
                    f"[AI Vision] Skipping {model_name}: "
                    f"{'GEMINI_API_KEY' if is_gemini else 'OPEN_ROUTER_API_KEY'} not set"
                )
                continue

            attempted += 1
            started = time.perf_counter()
            try:
                logger.info(
                    f"[AI Vision] Trying model {model_name} "
                    f"(attempt {attempted}/{len(UNIFIED_MODEL_CASCADE)})"
                )
                if is_gemini:
                    raw = await _call_gemini(model_name, base64_img, client, prompt)
                else:
                    raw = await _call_openrouter(model_name, base64_img, client, prompt)

                result = _validate_analysis(raw)
                elapsed = time.perf_counter() - started
                logger.info(f"[AI Vision] Success with {model_name} in {elapsed:.1f}s: {result['dish_name']}")
                return result

            except httpx.HTTPStatusError as e:
                last_error = e
                status = e.response.status_code
                elapsed = time.perf_counter() - started
                logger.warning(
                    f"[AI Vision] {model_name} failed after {elapsed:.1f}s "
                    f"with HTTP {status}: {e.response.text[:200]}"
                )
                if status in (401, 403):
                    logger.error(
                        f"[AI Vision] {model_name} rejected credentials "
                        f"({'GEMINI_API_KEY' if is_gemini else 'OPEN_ROUTER_API_KEY'} is invalid)"
                    )
                continue
            except (httpx.TimeoutException, httpx.RequestError) as e:
                last_error = e
                elapsed = time.perf_counter() - started
                logger.warning(
                    f"[AI Vision] {model_name} request failed after {elapsed:.1f}s "
                    f"(timeout={MODEL_REQUEST_TIMEOUT}s): {type(e).__name__}: {e}"
                )
                continue
            except (ValueError, KeyError, TypeError, IndexError, json.JSONDecodeError) as e:
                last_error = e
                elapsed = time.perf_counter() - started
                logger.warning(
                    f"[AI Vision] {model_name} returned an unusable response after {elapsed:.1f}s: {e}"
                )
                continue
            except Exception as e:
                last_error = e
                elapsed = time.perf_counter() - started
                logger.exception(
                    f"[AI Vision] Unexpected error from {model_name} after {elapsed:.1f}s"
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