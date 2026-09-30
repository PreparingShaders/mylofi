"""Feature gates for the Free vs PRO tiers.

Free tier quotas:
- Meal photo AI recognition: 5 analyses per UTC day.
- Custom workout templates: 3 in total.
- Workout AI analysis: 1 per 7 days.
- Nutrition AI analysis: 1 per 7 days.
- Combined AI analysis: PRO only.

Every quota resets from state stored on the ``User`` row, so the gates are
evaluated against the database rather than an in-process counter.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, WorkoutTemplate

FREE_MEAL_AI_DAILY_LIMIT = 5
FREE_WORKOUT_TEMPLATE_LIMIT = 3
FREE_WEEKLY_AI_LIMIT = 1
AI_ANALYSIS_COOLDOWN_DAYS = 7


@dataclass(frozen=True)
class LimitDecision:
    """Outcome of a single feature gate check."""

    allowed: bool
    used: int
    limit: Optional[int]
    code: str
    message: str
    resets_at: Optional[datetime] = None

    @property
    def remaining(self) -> Optional[int]:
        if self.limit is None:
            return None
        return max(self.limit - self.used, 0)

    @property
    def percent_used(self) -> int:
        if not self.limit:
            return 0
        return min(round(self.used / self.limit * 100), 100)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Normalize a stored datetime to timezone-aware UTC.

    SQLite drops tzinfo even for ``DateTime(timezone=True)`` columns, so a value
    read back from the database has to be re-localized before arithmetic.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)


def _as_date(value) -> Optional[date]:
    """Coerce a ``Date`` or ``DateTime`` column value into a plain date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return _as_utc(value).date()
    if isinstance(value, date):
        return value
    return None


def _is_premium(user: User) -> bool:
    """``is_premium`` may still be None on a not-yet-flushed instance."""
    return bool(user.is_premium)


def reset_daily_meal_counter(user: User, today: Optional[date] = None) -> bool:
    """Zero ``meal_ai_daily_count`` when the stored day is not today (UTC).

    Returns True when the counter was reset, so callers can persist the change.
    """
    current_day = today or _utcnow().date()
    last_day = _as_date(user.last_meal_ai_date)
    if last_day is not None and last_day == current_day:
        return False
    user.meal_ai_daily_count = 0
    user.last_meal_ai_date = current_day
    return last_day is not None


def can_use_meal_ai(user: User, today: Optional[date] = None) -> LimitDecision:
    """Free: 5 photo analyses per UTC day. PRO: unlimited."""
    if _is_premium(user):
        return LimitDecision(
            allowed=True,
            used=user.meal_ai_daily_count or 0,
            limit=None,
            code="meal_ai",
            message="PRO: безлимитный анализ фото",
        )

    reset_daily_meal_counter(user, today)
    used = user.meal_ai_daily_count or 0
    allowed = used < FREE_MEAL_AI_DAILY_LIMIT
    return LimitDecision(
        allowed=allowed,
        used=used,
        limit=FREE_MEAL_AI_DAILY_LIMIT,
        code="meal_ai",
        message=(
            "Дневной лимит распознавания блюд исчерпан. Обновится завтра или доступно в PRO"
            if not allowed
            else "Осталось распознаваний сегодня"
        ),
        resets_at=_next_utc_midnight(),
    )


def consume_meal_ai(user: User, today: Optional[date] = None) -> None:
    """Record one meal photo analysis against the daily quota."""
    reset_daily_meal_counter(user, today)
    user.meal_ai_daily_count = (user.meal_ai_daily_count or 0) + 1


def can_create_workout_template(user: User, current_templates: int) -> LimitDecision:
    """Free: max 3 custom templates. PRO: unlimited."""
    if _is_premium(user):
        return LimitDecision(
            allowed=True,
            used=current_templates,
            limit=None,
            code="workout_templates",
            message="PRO: безлимитное число шаблонов",
        )

    allowed = current_templates < FREE_WORKOUT_TEMPLATE_LIMIT
    return LimitDecision(
        allowed=allowed,
        used=current_templates,
        limit=FREE_WORKOUT_TEMPLATE_LIMIT,
        code="workout_templates",
        message=(
            "Лимит шаблонов тренировок исчерпан. Доступно в PRO"
            if not allowed
            else "Осталось шаблонов тренировок"
        ),
    )


def _weekly_decision(
    user: User,
    last_used: Optional[datetime],
    code: str,
    limit_message: str,
    ok_message: str,
    now: Optional[datetime] = None,
) -> LimitDecision:
    if _is_premium(user):
        return LimitDecision(
            allowed=True,
            used=0 if last_used is None else 1,
            limit=None,
            code=code,
            message="PRO: безлимитный анализ",
        )

    moment = now or _utcnow()
    last = _as_utc(last_used)
    if last is None:
        used = 0
        available_at = None
    else:
        available_at = last + timedelta(days=AI_ANALYSIS_COOLDOWN_DAYS)
        used = 0 if moment >= available_at else 1

    allowed = used < FREE_WEEKLY_AI_LIMIT
    return LimitDecision(
        allowed=allowed,
        used=used,
        limit=FREE_WEEKLY_AI_LIMIT,
        code=code,
        message=limit_message if not allowed else ok_message,
        resets_at=available_at if not allowed else None,
    )


def can_run_workout_ai(user: User, now: Optional[datetime] = None) -> LimitDecision:
    """Free: 1 workout AI analysis per 7 days. PRO: unlimited."""
    return _weekly_decision(
        user,
        user.last_workout_ai_analysis_at,
        code="workout_ai",
        limit_message="ИИ-анализ тренировки доступен раз в 7 дней на Free. Доступно в PRO",
        ok_message="ИИ-анализ тренировки доступен",
        now=now,
    )


def can_run_nutrition_ai(user: User, now: Optional[datetime] = None) -> LimitDecision:
    """Free: 1 nutrition AI analysis per 7 days. PRO: unlimited."""
    return _weekly_decision(
        user,
        user.last_nutrition_ai_analysis_at,
        code="nutrition_ai",
        limit_message="ИИ-анализ питания доступен раз в 7 дней на Free. Доступно в PRO",
        ok_message="ИИ-анализ питания доступен",
        now=now,
    )


def can_use_combined_ai(user: User) -> LimitDecision:
    """Combined AI analysis is PRO only."""
    premium = _is_premium(user)
    return LimitDecision(
        allowed=premium,
        used=0 if premium else 1,
        limit=None if premium else 0,
        code="combined_ai",
        message=(
            "Комбинированный ИИ-анализ доступен только в PRO"
            if not premium
            else "Комбинированный ИИ-анализ доступен"
        ),
    )


def _next_utc_midnight(now: Optional[datetime] = None) -> datetime:
    moment = now or _utcnow()
    start_of_day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_of_day + timedelta(days=1)


async def count_workout_templates(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        select(func.count()).select_from(WorkoutTemplate).where(WorkoutTemplate.user_id == user_id)
    )
    return int(result.scalar() or 0)


def build_usage_snapshot(
    user: User,
    template_count: int,
    now: Optional[datetime] = None,
) -> dict:
    """Assemble the usage payload rendered by the Profile page."""
    moment = now or _utcnow()
    premium = _is_premium(user)

    if not premium:
        reset_daily_meal_counter(user, moment.date())

    template_limit = can_create_workout_template(user, template_count)
    meal_ai = can_use_meal_ai(user, moment.date())
    workout_ai = can_run_workout_ai(user, moment)
    nutrition_ai = can_run_nutrition_ai(user, moment)
    combined_ai = can_use_combined_ai(user)

    def entry(decision: LimitDecision) -> dict:
        return {
            "code": decision.code,
            "used": decision.used,
            "limit": decision.limit,
            "remaining": decision.remaining,
            "percent_used": decision.percent_used,
            "allowed": decision.allowed,
            "message": decision.message,
            "resets_at": decision.resets_at,
        }

    return {
        "is_premium": premium,
        "plan": "PRO" if premium else "FREE",
        "meal_ai_daily_count": user.meal_ai_daily_count or 0,
        "last_meal_ai_date": user.last_meal_ai_date,
        "created_workouts_count": template_count,
        "limits": {
            "meal_ai": entry(meal_ai),
            "workout_templates": entry(template_limit),
            "workout_ai": entry(workout_ai),
            "nutrition_ai": entry(nutrition_ai),
            "combined_ai": entry(combined_ai),
        },
    }


__all__ = [
    "FREE_MEAL_AI_DAILY_LIMIT",
    "FREE_WORKOUT_TEMPLATE_LIMIT",
    "FREE_WEEKLY_AI_LIMIT",
    "AI_ANALYSIS_COOLDOWN_DAYS",
    "LimitDecision",
    "reset_daily_meal_counter",
    "can_use_meal_ai",
    "consume_meal_ai",
    "can_create_workout_template",
    "can_run_workout_ai",
    "can_run_nutrition_ai",
    "can_use_combined_ai",
    "count_workout_templates",
    "build_usage_snapshot",
]
