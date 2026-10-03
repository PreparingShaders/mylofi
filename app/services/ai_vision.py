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

PROMPT = """Ты — нутрициолог. Проанализируй фото еды и верни СТРОГО валидный JSON с полями:
{
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
    {"label": "Белок", "score": 8.0},
    {"label": "Клетчатка", "score": 7.5},
    {"label": "Обработка", "score": 6.5}
  ]
}
Все числовые значения — float. quality_score от 1.0 до 10.0. quality_metrics — массив из 3-5 объектов с полями label (строка) и score (float 0-10). Никаких пояснений, только JSON."""


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


async def _call_gemini(model_name: str, base64_img: str, client: httpx.AsyncClient) -> Dict[str, Any]:
    url = f"{WORKER_BASE_URL}/v1beta/models/{model_name}:generateContent?key={settings.GEMINI_API_KEY}"
    payload = {
        "contents": [{
            "parts": [
                {"text": PROMPT},
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


async def _call_openrouter(model_name: str, base64_img: str, client: httpx.AsyncClient) -> Dict[str, Any]:
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
                {"type": "text", "text": PROMPT},
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
    "fiber_g", "sugar_g", "sodium_mg", "tags", "quality_score", "quality_metrics",
]


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

    quality_score = float(result["quality_score"])
    if not (1.0 <= quality_score <= 10.0):
        quality_score = max(1.0, min(10.0, quality_score))
        result["quality_score"] = quality_score

    qm = result.get("quality_metrics", [])
    if not isinstance(qm, list):
        raise ValueError("quality_metrics must be a list")
    for item in qm:
        if not isinstance(item, dict) or "label" not in item or "score" not in item:
            raise ValueError("Each quality_metric must have label and score")
        score = float(item["score"])
        item["score"] = max(0.0, min(10.0, score))

    return result


async def analyze_meal_photo(base64_img: str) -> Dict[str, Any]:
    """
    Analyze meal photo using cascading model fallback.
    Returns parsed nutrition data with quality_score and quality_metrics.

    Raises RuntimeError only once every model in the cascade has failed, so the
    caller always gets either a valid payload or an actionable error.
    """
    if not settings.WORKER_URL:
        raise ValueError("WORKER_URL not configured")

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
                    raw = await _call_gemini(model_name, base64_img, client)
                else:
                    raw = await _call_openrouter(model_name, base64_img, client)

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
                    # Bad credentials will not fix themselves mid-cascade.
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
                # An unexpected shape must not abort the remaining cascade.
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