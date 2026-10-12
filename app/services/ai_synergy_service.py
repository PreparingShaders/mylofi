"""AI Synergy service - cross-analysis of nutrition and workouts."""

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Meal,
    MealStatus,
    PeriodSummary,
    User,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSessionStatus,
    WorkoutSet,
    ExerciseCatalog,
)
from app.services.ai_vision import (
    normalise_score,
    normalize_persona,
    run_text_cascade,
    strip_emojis,
)
from app.services.nutrition import utcnow

logger = logging.getLogger(__name__)

SYNERGY_TASK_TIMEOUT = 60.0
SYNERGY_RATE_LIMIT_DAYS = 7

REQUIRED_FIELDS = [
    "verdict_headline",
    "overall_score",
    "key_findings",
    "growth_points",
    "risk_factors",
    "nutrition_adjustment",
    "workout_adjustment",
]

OTHER_MUSCLE_GROUP = "прочие мышцы"
MUSCLE_GROUP_LABELS = {
    "back": "Спина",
    "chest": "Грудь",
    "quadriceps": "Квадрицепс",
    "hamstrings": "Бицепс бедра",
    "glutes": "Ягодицы",
    "shoulders": "Плечи",
    "biceps": "Бицепс",
    "triceps": "Трицепс",
    "abs": "Пресс",
    "calves": "Икры",
    OTHER_MUSCLE_GROUP: "Прочие мышцы",
}


def _translate_muscle_group(value: Any) -> str:
    key = " ".join(str(value or "").split()).lower()
    if not key:
        return OTHER_MUSCLE_GROUP
    return MUSCLE_GROUP_LABELS.get(key, key)


PERSONA_PROMPTS = {
    "kind": (
        "Ты — добрый эксперт по спортивной нутрициологии и силовой подготовке. "
        "Говори тепло, поддерживающе и конструктивно."
    ),
    "strict": (
        "Ты — строгий эксперт по спортивной нутрициологии и силовой подготовке. "
        "Говори коротко, по делу и без уступок."
    ),
    "sarcastic": (
        "Ты — эксперт в духе Джарвиса: спокойный, умный, с сухим английским юмором. "
        "Ирония направлена на подходы и привычки, а не на человека."
    ),
    "custom": (
        "Ты — эксперт по спортивной нутрициологии и силовой подготовке. "
        "Стиль общения пользователь задаёт сам."
    ),
}
DEFAULT_PERSONA = "kind"


def _format_amount(value: Any) -> str:
    if value is None:
        return "?"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "?"
    return f"{number:g}"


def describe_goal(user_goal: Optional[str]) -> str:
    GOAL_LABELS = {
        "lose": "дефицит калорий (похудение)",
        "maintain": "поддержание веса",
        "gain": "профицит калорий (набор массы)",
        "deficit": "дефицит калорий (похудение)",
        "surplus": "профицит калорий (набор массы)",
        "weight_loss": "дефицит калорий (похудение)",
        "muscle_gain": "профицит калорий (набор массы)",
    }
    return GOAL_LABELS.get((user_goal or "").lower(), "не определена")


def build_synergy_prompt(
    user: User,
    aggregated: Dict[str, Any],
    avg_sleep_hours: Optional[float] = None,
) -> str:
    persona_key = normalize_persona(user.ai_persona)
    persona_text = PERSONA_PROMPTS.get(persona_key, PERSONA_PROMPTS[DEFAULT_PERSONA])

    days_analyzed = aggregated.get("period_summary", {}).get("days_analyzed", 14) if isinstance(aggregated, dict) else 14

    prompt = f"""Ты — ведущий эксперт по спортивной нутрициологии и силовой подготовке. Твоя задача — провести глубокий перекрестный анализ данных пользователя за последние {days_analyzed} дней (питание, тренировки, антропометрия, сон) и выявить скрытые причины стагнации или точки прорыва.

{persona_text}

Правила анализа:
1. Сопоставь реальное потребление калорий и белка с целью пользователя (набор массы / похудение / поддержание).
2. Оцени связь между качеством питания и силовыми результатами (тоннаж, RPE, прогресс по весам).
3. Дай конструктивные, научно обоснованные и при этом практичные рекомендации без воды.

=== ИНСТРУКЦИИ ПО ОЦЕНКЕ (overall_score) ===
Оценка должна честно отражать баланс питания и тренировок. Используй полный диапазон 1–10:
- 1–2: Критический дефицит калорий (>30% ниже цели) ИЛИ белок <1.0 г/кг веса ИЛИ полное отсутствие тренировок при цели набора массы.
- 3–4: Сильный дефицит калорий (20–30% ниже цели) ИЛИ белок 1.0–1.4 г/кг ИЛИ сильный перекос по макронутриентам (жиры/углеводы >40% от цели) ИЛИ тренировки есть, но объём/интенсивность не соответствуют цели.
- 5–6: Умеренные отклонения: калории ±15% от цели, белок 1.4–1.8 г/кг, тренировки регулярны, но прогресс по тоннажу стагнирует.
- 7: Хороший баланс: калории ±10% от цели, белок 1.8–2.2 г/кг, тренировки системны, тоннаж растёт.
- 8–9: Отличная синергия: калории и белок в цели, макросы сбалансированы, тоннаж прогрессирует, RPE в норме, сон 7+ ч.
- 10: Идеальное выполнение: все метрики в зелёной зоне, прогресс по весам стабилен, восстановление оптимально.

НИКОГДА не ставь 8–10 при дефиците калорий >15% или белке <1.6 г/кг (для цели набора) или при отсутствии прогресса тоннажа за 2+ недели.

Данные пользователя:
{json.dumps(aggregated, ensure_ascii=False, indent=2)}

Формат ответа (строго валидный JSON):
{{
  "verdict_headline": "Краткий вердикт синергии (до 10 слов)",
   "overall_score": 8.5,
  "key_findings": [
    "Пункт анализа 1...",
    "Пункт анализа 2..."
  ],
  "growth_points": [
    "Точка роста 1 (что улучшить)...",
    "Точка роста 2..."
  ],
  "risk_factors": [
    "Риск или узкое место 1..."
  ],
  "nutrition_adjustment": "Комплексная рекомендация по питанию под тренировочный план",
  "workout_adjustment": "Рекомендация по тренировкам под текущий рацион"
}}

Ответ должен быть только валидным JSON без комментариев.
"""
    return prompt

async def _aggregate_period_data(
    db: AsyncSession,
    user: User,
    period_days: int = 14,
    tz_offset_minutes: int = 0,
    start_dt: Optional[datetime] = None,
    end_dt: Optional[datetime] = None,
) -> Dict[str, Any]:
    now = utcnow()
    # A custom window overrides the preset day count; otherwise fall back to
    # "last N days ending now".
    if start_dt is None:
        start_dt = now - timedelta(days=period_days)
    if end_dt is None:
        end_dt = now
    # days_analyzed drives the prompt and the response label: it is the span
    # actually inspected, not the requested preset (a custom range can be any
    # number of days long).
    days_analyzed = max(1, (end_dt - start_dt).days)

    # Meals
    meal_result = await db.execute(
        select(
            func.count(Meal.id),
            func.coalesce(func.avg(Meal.calories), 0),
            func.coalesce(func.avg(Meal.protein_g), 0),
            func.coalesce(func.avg(Meal.carbs_g), 0),
            func.coalesce(func.avg(Meal.fat_g), 0),
            func.coalesce(func.avg(Meal.quality_score), 0),
        ).where(
            Meal.user_id == user.id,
            Meal.eaten_at >= start_dt,
            Meal.eaten_at <= end_dt,
            Meal.status == MealStatus.COMPLETED,
        )
    )
    mr = meal_result.one()
    meals_logged_count = int(mr[0] or 0)
    avg_daily_calories = float(mr[1] or 0)
    avg_daily_protein_g = float(mr[2] or 0)
    avg_daily_carbs_g = float(mr[3] or 0)
    avg_daily_fat_g = float(mr[4] or 0)
    avg_meal_quality_score = float(mr[5] or 0) if mr[5] else 0.0

    # For target adherence, sum over days? The spec gives daily averages; compute based on totals
    calorie_target_adherence_pct = (
        (avg_daily_calories / user.target_calories * 100) if user.target_calories and user.target_calories > 0 else 0.0
    )
    protein_target_adherence_pct = (
        (avg_daily_protein_g / user.target_protein_g * 100) if user.target_protein_g and user.target_protein_g > 0 else 0.0
    )

    # Workouts - completed
    workout_result = await db.execute(
        select(WorkoutSession).where(
            WorkoutSession.user_id == user.id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSession.started_at >= start_dt,
            WorkoutSession.started_at <= end_dt,
        )
    )
    workouts = list(workout_result.scalars().all())

    total_workouts = len(workouts)
    total_duration = sum(w.duration_seconds or 0 for w in workouts)
    avg_workout_duration_min = (total_duration / 60.0 / total_workouts) if total_workouts > 0 else 0.0

    # Tonnage and muscle groups
    total_tonnage_kg = 0.0
    muscle_groups_hit = {}
    total_rpe_sum = 0.0
    rpe_count = 0

    for ws in workouts:
        # Load sets
        sets_res = await db.execute(
            select(WorkoutSet)
            .join(WorkoutSessionExercise)
            .where(WorkoutSessionExercise.session_id == ws.id)
        )
        sets = list(sets_res.scalars().all())
        for s in sets:
            if s.weight_kg and s.reps:
                total_tonnage_kg += s.weight_kg * s.reps
            if s.rpe is not None:
                total_rpe_sum += float(s.rpe)
                rpe_count += 1

        # Muscle groups from exercises
        ex_res = await db.execute(
            select(WorkoutSessionExercise, ExerciseCatalog.muscle_group)
            .outerjoin(ExerciseCatalog, ExerciseCatalog.name == WorkoutSessionExercise.name)
            .where(WorkoutSessionExercise.session_id == ws.id)
        )
        for ex, mg in ex_res.all():
            group = _translate_muscle_group(mg or "прочие мышцы")
            # map to key like chest/legs/back as in plan?
            muscle_groups_hit[group] = muscle_groups_hit.get(group, 0) + 1

    avg_rpe = (total_rpe_sum / rpe_count) if rpe_count > 0 else 0.0

    # Simple tonnage trend (placeholder - compare halves)
    tonnage_trend_pct = 0.0

    aggregated = {
        "user_profile": {
            "goal": user.goal,
            "activity_level": user.activity_level,
            "weight_kg": user.weight_kg,
            "target_weight_kg": user.target_weight_kg,
            "target_calories": user.target_calories,
            "target_protein_g": user.target_protein_g,
        },
        "period_summary": {
            "days_analyzed": days_analyzed,
            "nutrition": {
                "avg_daily_calories": round(avg_daily_calories, 2),
                "avg_daily_protein_g": round(avg_daily_protein_g, 2),
                "avg_daily_carbs_g": round(avg_daily_carbs_g, 2),
                "avg_daily_fat_g": round(avg_daily_fat_g, 2),
                "calorie_target_adherence_pct": round(calorie_target_adherence_pct, 2),
                "protein_target_adherence_pct": round(protein_target_adherence_pct, 2),
                "avg_meal_quality_score": round(avg_meal_quality_score, 2),
                "meals_logged_count": meals_logged_count,
            },
            "workouts": {
                "total_workouts": total_workouts,
                "avg_workout_duration_min": round(avg_workout_duration_min, 2),
                "total_tonnage_kg": round(total_tonnage_kg, 2),
                "tonnage_trend_pct": round(tonnage_trend_pct, 2),
                "muscle_groups_hit": muscle_groups_hit,
                "avg_rpe": round(avg_rpe, 2),
            },
        },
    }
    return aggregated


def _validate_synergy(result: Dict[str, Any]) -> Dict[str, Any]:
    """Check the model answer is a usable synergy verdict payload."""
    if not isinstance(result, dict):
        raise ValueError(f"Response must be a JSON object, got {type(result).__name__}")
    for field in REQUIRED_FIELDS:
        if field not in result:
            raise ValueError(f"Missing required field: {field}")
    result["overall_score"] = normalise_score(result["overall_score"])
    if not isinstance(result.get("key_findings"), list):
        raise ValueError("key_findings must be a list")
    if not isinstance(result.get("growth_points"), list):
        raise ValueError("growth_points must be a list")
    if not isinstance(result.get("risk_factors"), list):
        raise ValueError("risk_factors must be a list")
    if not isinstance(result.get("verdict_headline"), str) or not result["verdict_headline"].strip():
        raise ValueError("verdict_headline must be a non-empty string")
    for list_field in ("key_findings", "growth_points", "risk_factors"):
        result[list_field] = [strip_emojis(str(x)) for x in result[list_field] if str(x).strip()]
    return result


def _resolve_period_type(period_days: Optional[int], start_date: Optional[date], end_date: Optional[date]) -> str:
    """Derive the period_type label used for storage and rate limiting."""
    if start_date is not None and end_date is not None:
        span_days = max(1, (end_date - start_date).days)
        if span_days <= 31:
            return "month"
        return "custom"
    if period_days is not None:
        if period_days >= 30:
            return "month"
        return "week"
    return "week"


async def _get_latest_synergy(
    db: AsyncSession,
    user_id: int,
    period_type: str,
) -> Optional[PeriodSummary]:
    """Most recent synergy row for the user and period type, or None."""
    result = await db.execute(
        select(PeriodSummary)
        .where(
            PeriodSummary.user_id == user_id,
            PeriodSummary.period_type == period_type,
        )
        .order_by(PeriodSummary.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


def _check_synergy_rate_limit(latest: Optional[PeriodSummary]) -> None:
    """Raise ValueError when the 7-day cooldown has not elapsed.

    The message names the exact date the next analysis becomes available,
    so the frontend can render it verbatim instead of a generic error.
    """
    if latest is None:
        return
    now = utcnow()
    next_available = latest.created_at + timedelta(days=SYNERGY_RATE_LIMIT_DAYS)
    if now < next_available:
        raise ValueError(
            f"С момента последнего анализа прошло меньше {SYNERGY_RATE_LIMIT_DAYS} дней. "
            f"Новый анализ станет доступен {next_available.strftime('%Y-%m-%d')}"
        )


async def _persist_synergy(
    db: AsyncSession,
    user: User,
    period_type: str,
    start_date: date,
    end_date: date,
    response: Dict[str, Any],
) -> PeriodSummary:
    """Append a new synergy verdict row without overwriting previous analyses."""
    record = PeriodSummary(
        user_id=user.id,
        period_type=period_type,
        start_date=start_date,
        end_date=end_date,
        summary_text=response.get("verdict", {}).get("headline", ""),
        overall_score=response.get("verdict", {}).get("overall_score"),
        payload_json=json.dumps(response, ensure_ascii=False, default=_json_default),
        ai_persona=user.ai_persona,
    )
    db.add(record)
    await db.flush()
    return record


def _json_default(obj: Any) -> Any:
    """Fallback for json.dumps so datetime / date values serialize cleanly."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, set):
        return list(obj)
    return str(obj)


async def run_ai_synergy(
    db: AsyncSession,
    user: User,
    avg_sleep_hours: Optional[float] = None,
    period_days: Optional[int] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    tz_offset_minutes: int = 0,
) -> Dict[str, Any]:
    now = utcnow()
    # A custom date range takes precedence over the preset day count; an
    # explicit period_days falls back to the preset, which itself defaults to 14.
    start_dt = end_dt = None
    if start_date is not None:
        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    if end_date is not None:
        end_dt = datetime.combine(end_date, datetime.max.time(), tzinfo=timezone.utc)
        if end_dt > now:
            end_dt = now

    if period_days is None:
        if start_dt is not None and end_dt is not None:
            period_days = max(1, (end_dt - start_dt).days)
        else:
            period_days = 14

    period_type = _resolve_period_type(period_days, start_date, end_date)
    latest = await _get_latest_synergy(db, user.id, period_type)
    _check_synergy_rate_limit(latest)

    aggregated = await _aggregate_period_data(
        db, user, period_days, tz_offset_minutes, start_dt=start_dt, end_dt=end_dt,
    )

    if avg_sleep_hours is not None:
        aggregated["period_summary"]["lifestyle"] = {"avg_sleep_hours": float(avg_sleep_hours)}
    else:
        aggregated["period_summary"]["lifestyle"] = {"avg_sleep_hours": None}

    prompt = build_synergy_prompt(user, aggregated, avg_sleep_hours)

    try:
        result = await asyncio.wait_for(
            run_text_cascade(
                prompt=prompt,
                validate=_validate_synergy,
                log_prefix="[AI Synergy]",
            ),
            timeout=SYNERGY_TASK_TIMEOUT,
        )
    except Exception as e:
        logger.exception(f"AI synergy failed: {e}")
        raise

    verdict = dict(result)

    overall_score = normalise_score(verdict.get("overall_score"))

    response = {
        "success": True,
        "analyzed_at": utcnow(),
        "period_days": period_days,
        "period_type": period_type,
        "metrics_snapshot": {
            "avg_calories": round(aggregated["period_summary"]["nutrition"]["avg_daily_calories"]),
            "avg_protein": round(aggregated["period_summary"]["nutrition"]["avg_daily_protein_g"]),
            "total_workouts": aggregated["period_summary"]["workouts"]["total_workouts"],
            "tonnage_trend": f"{aggregated['period_summary']['workouts']['tonnage_trend_pct']:+.1f}%",
        },
        "verdict": {
            "headline": strip_emojis(str(verdict.get("verdict_headline", "")))[:120],
            "overall_score": overall_score,
            "key_findings": [strip_emojis(str(x)) for x in (verdict.get("key_findings") or [])][:10],
            "growth_points": [strip_emojis(str(x)) for x in (verdict.get("growth_points") or [])][:10],
            "risk_factors": [strip_emojis(str(x)) for x in (verdict.get("risk_factors") or [])][:10],
            "nutrition_adjustment": strip_emojis(str(verdict.get("nutrition_adjustment", "")))[:800],
            "workout_adjustment": strip_emojis(str(verdict.get("workout_adjustment", "")))[:800],
            "ai_persona": user.ai_persona,
        },
    }

    await _persist_synergy(
        db,
        user,
        period_type,
        start_date or (start_dt.date() if start_dt else (now - timedelta(days=period_days)).date()),
        end_date or (end_dt.date() if end_dt else now.date()),
        response,
    )
    await db.commit()

    return response
