"""Daily AI recap of a user's nutrition day.

The meal verdict answers "what was this dish"; this answers "what was this day
like". Same nutritionist, same persona, same model cascade (`run_text_cascade`)
- only the input changes: no photo, the whole day's meals instead.

The recap is generated once per calendar day and stored in `daily_summaries`, so
opening the screen twice costs one model call in total and a recap that was
already written can be re-read while the upstream is down. Generation is bounded
as a whole (`DAILY_SUMMARY_TASK_TIMEOUT`) and never raises out of the read path:
a missing recap degrades to an empty card instead of taking the nutrition page
down with it.
"""

import asyncio
import logging
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DailySummary, Meal, MealStatus, User
from app.services.ai_vision import (
    PERSONA_PROMPTS,
    clamp_sentences,
    count_sentences,
    describe_goal,
    format_amount,
    normalise_score,
    normalize_persona,
    run_text_cascade,
    sanitize_persona_text,
    strip_emojis,
)
from app.services.nutrition import as_utc, day_bounds_utc, local_day_of, utcnow

logger = logging.getLogger(__name__)

# A recap is read, not studied: 3-6 sentences is one glance on the phone. The
# upper bound is enforced by a clamp (a model that drifts into an essay is cut on
# a sentence end); the lower one is a prompt rule only, because padding a recap
# the model already wrote well is worse than a slightly short one.
SUMMARY_MIN_SENTENCES = 3
SUMMARY_MAX_SENTENCES = 6

# Wall-clock budget for one recap. `run_text_cascade` bounds every individual
# model call; this bounds the cascade as a whole so the request that triggered an
# on-demand generation always gets an answer.
DAILY_SUMMARY_TASK_TIMEOUT = 60.0

# A day with a huge number of logged meals must not push the per-meal lines out
# of the prompt: the totals are passed separately and carry the picture, so the
# most recent meals are the ones worth spelling out.
MAX_MEALS_IN_PROMPT = 20

# Upper bound for the batch pass, so one run can never fan out into hundreds of
# model calls.
MAX_USERS_PER_BATCH = 50

REQUIRED_FIELDS = ["summary_text", "overall_score"]

MONTH_LABELS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

# Reasons the card shows instead of a recap. They travel with the payload rather
# than living in the UI copy so the wording sits next to the rule that produced it.
REASON_NO_MEALS = "Нет данных за день"
REASON_DAY_NOT_FINISHED = "Итог дня появится завтра"
REASON_FAILED = "Не удалось составить итог дня"


def day_label(target_date: date) -> str:
    """Readable date for the prompt: "4 окт 2026"."""
    return f"{target_date.day} {MONTH_LABELS[target_date.month - 1]} {target_date.year}"


async def load_day_meals(
    db: AsyncSession,
    user_id: int,
    target_date: date,
    tz_offset_minutes: int = 0,
) -> List[Meal]:
    """Analysed meals of one local day, oldest first.

    Only COMPLETED rows: a pending or failed meal carries no macros, and a recap
    that counted it would describe a day the user cannot see on screen.
    """
    start_dt, end_dt = day_bounds_utc(target_date, target_date, tz_offset_minutes)
    result = await db.execute(
        select(Meal)
        .where(
            Meal.user_id == user_id,
            Meal.eaten_at >= start_dt,
            Meal.eaten_at <= end_dt,
            Meal.status == MealStatus.COMPLETED,
        )
        .order_by(Meal.eaten_at.asc())
    )
    return list(result.scalars().all())


def summarise_day(meals: List[Meal]) -> Dict[str, Any]:
    """Day totals the prompt reasons about, plus the meal count for context."""
    return {
        "meals_count": len(meals),
        "calories": sum(m.calories or 0 for m in meals),
        "protein_g": sum(m.protein_g or 0 for m in meals),
        "fat_g": sum(m.fat_g or 0 for m in meals),
        "carbs_g": sum(m.carbs_g or 0 for m in meals),
        "fiber_g": sum(m.fiber_g or 0 for m in meals),
        "sugar_g": sum(m.sugar_g or 0 for m in meals),
        "sodium_mg": sum(m.sodium_mg or 0 for m in meals),
    }


def _meal_line(meal: Meal, tz_offset_minutes: int) -> str:
    """One prompt line per dish.

    The name is the model's own wording or the user's own edit, so it is
    flattened to a single line and capped rather than trusted to stay tidy
    inside a prompt. The time is read in the user's own clock, because "a heavy
    dinner" only means something next to the hour it was eaten at.
    """
    name = " ".join(str(meal.dish_name or "Блюдо без названия").split())[:80]
    time_label = ""
    if meal.eaten_at is not None:
        # Same conversion as `local_day_of`: the offset counts minutes behind UTC,
        # so the device's clock reading is the instant minus that offset.
        local = as_utc(meal.eaten_at) - timedelta(minutes=tz_offset_minutes)
        time_label = local.strftime("%H:%M")
    prefix = f"{time_label}: " if time_label else ""
    return (
        f"- {prefix}{name}: {format_amount(meal.calories)} ккал, "
        f"белки {format_amount(meal.protein_g)} г, жиры {format_amount(meal.fat_g)} г, "
        f"углеводы {format_amount(meal.carbs_g)} г"
    )


def build_daily_summary_prompt(
    target_date: date,
    totals: Dict[str, Any],
    meals: List[Meal],
    tz_offset_minutes: int = 0,
    user_goal: Optional[str] = None,
    targets: Optional[Dict[str, Any]] = None,
    persona: Optional[str] = None,
    persona_custom_text: Optional[str] = None,
) -> str:
    """Prompt for one day's recap, in the user's own nutritionist voice.

    The persona is a tone of voice, not a task: it is stated once and the rules
    below (the JSON contract, the length, the no-emoji rule) stay binding
    regardless of voice, exactly as they do for the dish verdict.
    """
    t_cal = targets.get("target_calories") if targets else None
    t_pro = targets.get("target_protein_g") if targets else None
    t_fat = targets.get("target_fat_g") if targets else None
    t_carb = targets.get("target_carbs_g") if targets else None

    targets_line = (
        f"Дневные нормы пользователя: {format_amount(t_cal)} ккал, белки {format_amount(t_pro)} г, "
        f"жиры {format_amount(t_fat)} г, углеводы {format_amount(t_carb)} г. "
        if any(value is not None for value in (t_cal, t_pro, t_fat, t_carb))
        else "Дневные нормы пользователя не заданы (знак '?' означает, что нормы нет): оценивай день без сравнения с нормами. "
    )

    totals_line = (
        f"Итого за {day_label(target_date)} ({totals['meals_count']} приёмов пищи): "
        f"{format_amount(totals['calories'])} ккал, белки {format_amount(totals['protein_g'])} г, "
        f"жиры {format_amount(totals['fat_g'])} г, углеводы {format_amount(totals['carbs_g'])} г, "
        f"клетчатка {format_amount(totals['fiber_g'])} г, сахар {format_amount(totals['sugar_g'])} г, "
        f"натрий {format_amount(totals['sodium_mg'])} мг. "
    )

    shown = meals[-MAX_MEALS_IN_PROMPT:]
    dropped = len(meals) - len(shown)
    meals_block = "\n".join(_meal_line(meal, tz_offset_minutes) for meal in shown)
    meals_line = (
        f"Приёмы пищи по времени:\n{meals_block}\n"
        + (
            f"(показаны последние {len(shown)} из {len(meals)} приёмов, "
            "остальные уже учтены в итогах дня)\n"
            if dropped > 0
            else ""
        )
    )

    persona_key = normalize_persona(persona)
    persona_text = sanitize_persona_text(persona_custom_text)
    persona_line = (
        f"Персонализация: {PERSONA_PROMPTS[persona_key]}"
        + (
            f' Пользовательский стиль: "{persona_text}". '
            if persona_key == "custom" and persona_text
            else ""
        )
        + " Персона влияет только на тон формулировок summary_text: длина, отсутствие эмодзи, "
        "формат ответа и все правила оценки выше действуют в полном объёме."
    )

    return f"""Ты — нутрициолог. Ты уже видел все приёмы пищи пользователя за один день и верни СТРОГО валидный JSON с полями:
{{
  "summary_text": "Итог дня РОВНО из 3-6 связанных предложений: без эмодзи.",
  "overall_score": 7.5
}}
Все числовые значения — float. overall_score от 1.0 до 10.0: это оценка дня целиком, а не средняя оценка блюд. summary_text — связный текст РОВНО из 3-6 предложений без воды и без эмодзи. Никаких пояснений, только JSON.

Правила итога дня (обязательно):
1. ДЛИНА: в summary_text РОВНО {SUMMARY_MIN_SENTENCES}-{SUMMARY_MAX_SENTENCES} предложений, связанных в один связный текст. Меньше {SUMMARY_MIN_SENTENCES} или больше {SUMMARY_MAX_SENTENCES} - нарушение. Каждое предложение несу: не добивай объём дежурными фразами.
2. НОЛЬ ЭМОДЗИ: ни одного эмодзи, смайлика, иконки или символического значка из наборов эмодзи. Только обычные буквы, пробелы и знаки препинания.
3. НИКАКИХ СПИСКОВ И РАЗМЕТОК: summary_text - один абзац обычным текстом, без маркеров, нумерации, заголовков и переносов строк.
4. О ЧЁМ ГОВОРИТЬ: как распределился день по времени (что оказалось тяжёлым приёмом, а что лёгким), что в составе было плюсом и где риск (сахар, соль, переработка, недостаток овощей или клетчатки), насколько день вписан в цель пользователя и одно конкретное действие на завтра.
5. ЧЕСТНОСТЬ: если день вышел за нормы - назови это прямо и конкретно ("превышено по калориям", "жиры выше нормы"), без приуменьшений. Если всё в пределах нормы - скажи это прямо. Если норм нет ('?') - оценивай день само по себе, без сравнения.
6. ЦИФРЫ В ИТОГЕ: числа макросов в summary_text допустимы и помогают - в отличие от вердикта по одному блюду, здесь итог сам по себе и есть смысл.
7. БЕЛОК - ВСЕГДА ПЛЮС: превышение белка никогда не подаётся как ошибка, избыток или замечание. Белок выше нормы - это польза для мышц и для сытости, и модель обязана это отметить.
8. ПЕРСОНА - ТОЛЬКО ТОН: любая персона задаёт только тон формулировок. Длина, отсутствие эмодзи, формат ответа, честность по превышениям и похвала белка действуют при любой персона.

{persona_line}

Контекст:
Цель пользователя: {describe_goal(user_goal)}. {targets_line}{totals_line}{meals_line}"""


def _sanitize_summary(text: str) -> str:
    """Apply the recap rules the model is asked for but cannot be trusted with."""
    cleaned = strip_emojis(" ".join(str(text).split()))
    if count_sentences(cleaned) > SUMMARY_MAX_SENTENCES:
        cleaned = clamp_sentences(cleaned, SUMMARY_MAX_SENTENCES)
    if count_sentences(cleaned) < SUMMARY_MIN_SENTENCES:
        logger.info(
            f"[AI Summary] summary_text is shorter than {SUMMARY_MIN_SENTENCES} sentences: "
            f"{count_sentences(cleaned)}"
        )
    return cleaned


def _validate_daily_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    """Check the answer is a usable recap and normalise its ranges.

    Raising here keeps a malformed answer inside the cascade: the caller treats
    it like any other model failure and moves on to the next model.
    """
    if not isinstance(result, dict):
        raise ValueError(f"Response must be a JSON object, got {type(result).__name__}")

    for field in REQUIRED_FIELDS:
        if field not in result:
            raise ValueError(f"Missing required field: {field}")

    if not isinstance(result.get("summary_text"), str) or not result["summary_text"].strip():
        raise ValueError("summary_text must be a non-empty string")

    sanitized = _sanitize_summary(result["summary_text"])
    if not sanitized.strip():
        raise ValueError("summary_text is empty after removing emoji")
    result["summary_text"] = sanitized
    result["overall_score"] = normalise_score(result["overall_score"])
    return result


async def generate_daily_summary_payload(
    target_date: date,
    totals: Dict[str, Any],
    meals: List[Meal],
    tz_offset_minutes: int = 0,
    user_goal: Optional[str] = None,
    targets: Optional[Dict[str, Any]] = None,
    persona: Optional[str] = None,
    persona_custom_text: Optional[str] = None,
) -> Dict[str, Any]:
    """Ask the cascade for one day's recap, bounded as a whole."""
    prompt = build_daily_summary_prompt(
        target_date=target_date,
        totals=totals,
        meals=meals,
        tz_offset_minutes=tz_offset_minutes,
        user_goal=user_goal,
        targets=targets,
        persona=persona,
        persona_custom_text=persona_custom_text,
    )
    return await asyncio.wait_for(
        run_text_cascade(prompt, _validate_daily_summary),
        timeout=DAILY_SUMMARY_TASK_TIMEOUT,
    )


async def get_daily_summary(
    db: AsyncSession,
    user_id: int,
    target_date: date,
) -> Optional[DailySummary]:
    """The stored recap of one day, or None when it was never written."""
    result = await db.execute(
        select(DailySummary).where(
            DailySummary.user_id == user_id,
            DailySummary.date == target_date,
        )
    )
    return result.scalar_one_or_none()


async def store_daily_summary(
    db: AsyncSession,
    user: User,
    target_date: date,
    payload: Dict[str, Any],
) -> DailySummary:
    """Write (or rewrite in place) the recap of one day.

    One row per (user, date), so a regenerated recap replaces the old one instead
    of racing it on read. Two writers can still meet on the same day - the batch
    pass and the user opening that day at the same moment - and the second insert
    would lose to the unique constraint, so that collision is resolved by reading
    the winner back rather than reported as a failure.
    """
    summary = await get_daily_summary(db, user.id, target_date)
    if summary is None:
        summary = DailySummary(user_id=user.id, date=target_date)
        db.add(summary)

    summary.summary_text = payload["summary_text"]
    summary.overall_score = payload["overall_score"]
    # Resolved once here, so the recap keeps the voice it was actually written in
    # even if the profile changes later - the same reason meals carry their persona.
    summary.ai_persona = normalize_persona(user.ai_persona)
    summary.updated_at = utcnow()

    try:
        await db.commit()
    except IntegrityError:
        logger.info(
            f"[AI Summary] Day {target_date} for user {user.id} was written concurrently, keeping the stored recap"
        )
        await db.rollback()
        stored = await get_daily_summary(db, user.id, target_date)
        if stored is not None:
            return stored
        raise

    await db.refresh(summary)
    return summary


async def write_daily_summary(
    db: AsyncSession,
    user: User,
    target_date: date,
    tz_offset_minutes: int = 0,
) -> Optional[DailySummary]:
    """Generate and store the recap of a day, or None when there is nothing to recap.

    Raises on model failure: callers that must not fail (the read path, the batch
    pass) catch it themselves and decide what the user sees.
    """
    meals = await load_day_meals(db, user.id, target_date, tz_offset_minutes)
    if not meals:
        return None

    targets = {
        "target_calories": user.target_calories,
        "target_protein_g": user.target_protein_g,
        "target_fat_g": user.target_fat_g,
        "target_carbs_g": user.target_carbs_g,
    }
    payload = await generate_daily_summary_payload(
        target_date=target_date,
        totals=summarise_day(meals),
        meals=meals,
        tz_offset_minutes=tz_offset_minutes,
        user_goal=user.goal,
        targets=targets,
        persona=user.ai_persona,
        persona_custom_text=user.ai_persona_custom_text,
    )
    logger.info(
        f"[AI Summary] Day {target_date} summarised for user {user.id} "
        f"from {len(meals)} meal(s), score {payload['overall_score']}"
    )
    return await store_daily_summary(db, user, target_date, payload)


def _summary_payload(
    summary: Optional[DailySummary],
    target_date: date,
    *,
    available: bool,
    reason: Optional[str],
    generated: bool = False,
    regenerated: bool = False,
) -> Dict[str, Any]:
    """Shape of the daily-summary response, for both the read and the empty path."""
    return {
        "date": target_date,
        "summary_text": summary.summary_text if summary else None,
        "overall_score": summary.overall_score if summary else None,
        "ai_persona": summary.ai_persona if summary else None,
        "available": available,
        "generated": generated,
        "regenerated": regenerated,
        "reason": reason,
    }


async def get_or_create_daily_summary(
    db: AsyncSession,
    user: User,
    target_date: date,
    tz_offset_minutes: int = 0,
    force: bool = False,
) -> Dict[str, Any]:
    """The recap of a day, generated on demand when it is missing.

    Only a finished day is generated: today is still being eaten, so a recap of
    it would be judged on meals the user has not logged yet and would then be
    wrong by the time they read it. Today's row (written by the previous run, if
    any) is still returned when it exists.

    `force` re-reads the day and rewrites the stored recap in place - the
    manual trigger on the card. A day that is still being eaten is never
    re-judged even when forced: the stored row is returned as-is, or the
    not-finished reason when there is nothing stored. A forced regeneration
    that fails keeps the last known recap instead of dropping the card to an
    empty state.

    Never raises. A failed generation returns the empty payload with a reason so
    the nutrition screen keeps rendering with an empty card.
    """
    existing = await get_daily_summary(db, user.id, target_date)
    if existing is not None and not force:
        return _summary_payload(existing, target_date, available=True, reason=None)

    local_today = local_day_of(utcnow(), tz_offset_minutes)
    if target_date >= local_today:
        if existing is not None:
            return _summary_payload(existing, target_date, available=True, reason=None)
        return _summary_payload(None, target_date, available=False, reason=REASON_DAY_NOT_FINISHED)

    try:
        written = await write_daily_summary(db, user, target_date, tz_offset_minutes)
    except Exception as e:
        # The failing statement may have left the session mid-transaction; the
        # rollback keeps this session usable for the rest of the request.
        logger.exception(f"[AI Summary] Day {target_date} failed for user {user.id}: {e}")
        await db.rollback()
        if existing is not None:
            return _summary_payload(existing, target_date, available=True, reason=None)
        return _summary_payload(None, target_date, available=False, reason=REASON_FAILED)

    if written is None:
        return _summary_payload(None, target_date, available=False, reason=REASON_NO_MEALS)
    return _summary_payload(
        written,
        target_date,
        available=True,
        reason=None,
        generated=True,
        regenerated=force and existing is not None,
    )


async def generate_pending_daily_summaries(
    db: AsyncSession,
    target_date: Optional[date] = None,
    tz_offset_minutes: int = 0,
    limit: int = MAX_USERS_PER_BATCH,
) -> int:
    """Write the missing recaps of one day for everyone who ate that day.

    The cron entry point (and what the app runs once at startup, for the day
    that just ended). Idempotent by construction: a day that already has a recap
    is skipped, and a user whose day holds no analysed meal is skipped too, so a
    second run on the same day costs nothing.

    One bad user never stops the pass, and the whole run is bounded by `limit`.
    """
    recap_date = target_date or (local_day_of(utcnow(), tz_offset_minutes) - timedelta(days=1))
    start_dt, end_dt = day_bounds_utc(recap_date, recap_date, tz_offset_minutes)

    result = await db.execute(
        select(Meal.user_id)
        .where(
            Meal.eaten_at >= start_dt,
            Meal.eaten_at <= end_dt,
            Meal.status == MealStatus.COMPLETED,
        )
        .group_by(Meal.user_id)
        .limit(limit)
    )
    user_ids = [int(value) for value in result.scalars().all()]

    written = 0
    for user_id in user_ids:
        try:
            if await get_daily_summary(db, user_id, recap_date) is not None:
                continue
            user = await db.get(User, user_id)
            if user is None:
                continue
            if await write_daily_summary(db, user, recap_date, tz_offset_minutes) is not None:
                written += 1
        except Exception as e:
            logger.exception(
                f"[AI Summary] Batch recap for user {user_id} on {recap_date} failed: {e}"
            )
            await db.rollback()

    logger.info(
        f"[AI Summary] Batch for {recap_date}: {written} recap(s) written "
        f"out of {len(user_ids)} user(s) with meals"
    )
    return written


__all__ = [
    "DAILY_SUMMARY_TASK_TIMEOUT",
    "MAX_MEALS_IN_PROMPT",
    "MAX_USERS_PER_BATCH",
    "REASON_NO_MEALS",
    "REASON_DAY_NOT_FINISHED",
    "REASON_FAILED",
    "SUMMARY_MAX_SENTENCES",
    "SUMMARY_MIN_SENTENCES",
    "build_daily_summary_prompt",
    "generate_daily_summary_payload",
    "generate_pending_daily_summaries",
    "get_daily_summary",
    "get_or_create_daily_summary",
    "load_day_meals",
    "store_daily_summary",
    "summarise_day",
    "write_daily_summary",
]