import json
import os
import io
import uuid
import shutil
import base64
import asyncio
import logging
import traceback
import time
from datetime import datetime, date, timedelta, timezone
from typing import Any, Optional, List
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select, func, and_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.models import Meal, MealStatus, User
from app.schemas import MealCreate, MealUpdate, MealResponse, MealListResponse
from app.core.config import get_settings
from app.db.session import async_session_maker
from app.services.ai_vision import analyze_meal_photo, normalize_persona

settings = get_settings()

logger = logging.getLogger(__name__)

MONTH_LABELS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

# Upper bound for an explicit range so one request can never ask for an
# unbounded daily series.
MAX_RANGE_DAYS = 366

# Wall-clock budget for one photo analysis. ai_vision bounds every individual
# model call; this bounds the cascade as a whole so a meal always reaches a
# terminal status (COMPLETED or FAILED) and the frontend poll loop always ends.
AI_TASK_TIMEOUT = 90.0

# A meal can only still be PENDING / PROCESSING this long if the worker died
# with it (restart, crash, lost DB connection), because the task above always
# writes a terminal status well inside this budget. Anything older is stuck and
# has to be failed explicitly, or both the card and the poll loop hang on it
# forever.
STUCK_MEAL_TIMEOUT = timedelta(minutes=5)

# Shown on the failed card, so the user knows the analysis never came back
# rather than that the food was rejected.
STUCK_MEAL_REASON = "Таймаут или сбой сервера"
STUCK_MEAL_ERROR = "Analysis did not report back: worker stopped mid-task (restart or crash)"

# Real offsets live between UTC-12 and UTC+14. A request claiming more than that
# is not a timezone, and letting it through would shift a day window by days.
MAX_TZ_OFFSET_MINUTES = 14 * 60


def utcnow() -> datetime:
    """Current instant as an aware UTC datetime.

    Aware, not naive, on purpose: asyncpg encodes a naive datetime by reading it
    as *process-local* time, so a naive "21:30 UTC" written on a Europe/Moscow
    host lands in the database as 18:30 UTC - the meal appears three hours early
    and, near midnight, on the wrong day. An aware value is encoded as the
    instant it is, whatever the host timezone is.
    """
    return datetime.now(timezone.utc)


def normalize_tz_offset(raw: Optional[Any]) -> int:
    """Minutes behind UTC as the browser reports them, or 0 when unusable.

    `Date.getTimezoneOffset()` counts minutes *behind* UTC, so UTC+3 arrives as
    -180 and every conversion below is a plain `+ offset` from local to UTC. The
    value reaches the server as a query param or a form field, so it is text
    most of the time.
    """
    if raw is None:
        return 0
    try:
        # float() first so a fractional or string-y value still lands on a
        # minute; a non-numeric one falls through to the UTC default.
        offset = int(float(raw))
    except (TypeError, ValueError):
        return 0
    return max(-MAX_TZ_OFFSET_MINUTES, min(MAX_TZ_OFFSET_MINUTES, offset))


def as_utc(value: datetime, tz_offset_minutes: int = 0) -> datetime:
    """Read a datetime as the instant it stands for, in aware UTC.

    An aware value already says when it happened. A naive one is read in the
    client's offset - that is the wall clock the device printed - so a local
    `00:30` with a UTC+3 offset becomes the instant `21:30Z` of the day before.
    """
    if value.tzinfo is None:
        return (value + timedelta(minutes=tz_offset_minutes)).replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def resolve_eaten_at(raw: Optional[Any], tz_offset_minutes: int = 0) -> datetime:
    """Turn a client timestamp into the aware UTC instant the meals table stores.

    The browser sends `new Date().toISOString()`, which is already an absolute
    instant, so the usual case only has to be read as UTC. A value without an
    offset is wall-clock time and is resolved with the offset the same request
    carries; anything unusable falls back to now rather than losing the meal.
    """
    if raw is None or raw == "":
        return utcnow()

    if isinstance(raw, datetime):
        return as_utc(raw, tz_offset_minutes)

    text = str(raw).strip()
    if text.endswith(("Z", "z")):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        logger.warning(f"[Nutrition] Unusable eaten_at value, falling back to now: {raw!r}")
        return utcnow()
    return as_utc(parsed, tz_offset_minutes)


def day_bounds_utc(start_date: date, end_date: date, tz_offset_minutes: int = 0) -> tuple[datetime, datetime]:
    """Inclusive [start, end] day window as aware UTC instants.

    A calendar day is a local notion: local midnight on `start_date` is
    `start_date 00:00 + offset` in UTC, so without the shift a meal eaten at
    00:30 UTC+3 falls into the previous day's window. Both bounds are aware so
    the comparison in SQL is between instants and not between local readings.
    """
    shift = timedelta(minutes=tz_offset_minutes)
    return (
        as_utc(datetime.combine(start_date, datetime.min.time())) + shift,
        as_utc(datetime.combine(end_date, datetime.max.time())) + shift,
    )


def local_day_of(value: datetime, tz_offset_minutes: int = 0) -> date:
    """The calendar day a stored instant belongs to, in the user's local time."""
    return (as_utc(value) - timedelta(minutes=tz_offset_minutes)).date()


async def ensure_upload_dir() -> str:
    """Ensure upload directory exists and return its path"""
    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    os.makedirs(os.path.join(upload_dir, "thumbnails"), exist_ok=True)
    return upload_dir


def generate_photo_filename(original_filename: str) -> str:
    """Generate a unique filename for uploaded photo"""
    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        ext = ".jpg"
    return f"{uuid.uuid4().hex}{ext}"


async def save_uploaded_photo(
    file_content: bytes,
    original_filename: str
) -> tuple[str, str]:
    """Save uploaded photo and return (photo_path, thumbnail_path)"""
    upload_dir = await ensure_upload_dir()
    filename = generate_photo_filename(original_filename)
    photo_path = os.path.join(upload_dir, filename)
    thumbnail_path = os.path.join(upload_dir, "thumbnails", filename)

    # Save original
    with open(photo_path, "wb") as f:
        f.write(file_content)

    # Create thumbnail (using Pillow)
    try:
        from PIL import Image
        with Image.open(photo_path) as img:
            img.thumbnail((400, 400), Image.Resampling.LANCZOS)
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            img.save(thumbnail_path, "JPEG", quality=80, optimize=True)
    except Exception:
        # If thumbnail creation fails, use original
        shutil.copy2(photo_path, thumbnail_path)

    return photo_path, thumbnail_path


async def create_meal(
    db: AsyncSession,
    user_id: int,
    meal_data: MealCreate,
    photo_path: Optional[str] = None,
    thumbnail_path: Optional[str] = None,
) -> Meal:
    """Create a new meal record"""
    meal = Meal(
        user_id=user_id,
        eaten_at=meal_data.eaten_at,
        notes=meal_data.notes,
        photo_path=photo_path,
        photo_thumbnail_path=thumbnail_path,
        status=MealStatus.PENDING if photo_path else MealStatus.COMPLETED,
    )
    db.add(meal)
    await db.commit()
    await db.refresh(meal)
    return meal


async def get_meal(db: AsyncSession, meal_id: int, user_id: int) -> Optional[Meal]:
    """Get a meal by ID for a specific user"""
    result = await db.execute(
        select(Meal).where(Meal.id == meal_id, Meal.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def update_meal(
    db: AsyncSession,
    meal_id: int,
    user_id: int,
    meal_data: MealUpdate,
) -> Optional[Meal]:
    """Update a meal record"""
    meal = await get_meal(db, meal_id, user_id)
    if not meal:
        return None

    update_data = meal_data.model_dump(exclude_unset=True)
    if "tags" in update_data and update_data["tags"] is not None:
        update_data["tags"] = json.dumps(update_data["tags"])

    # A hand-edited time arrives as whatever the client had; reading it as an
    # instant keeps it on the same axis as every other timestamp in the column.
    if isinstance(update_data.get("eaten_at"), datetime):
        update_data["eaten_at"] = as_utc(update_data["eaten_at"])

    for field, value in update_data.items():
        setattr(meal, field, value)

    meal.updated_at = utcnow()

    await db.commit()
    await db.refresh(meal)
    return meal


async def delete_meal(db: AsyncSession, meal_id: int, user_id: int) -> bool:
    """Delete a meal record"""
    meal = await get_meal(db, meal_id, user_id)
    if not meal:
        return False

    # Delete photo files if they exist
    if meal.photo_path and os.path.exists(meal.photo_path):
        os.remove(meal.photo_path)
    if meal.photo_thumbnail_path and os.path.exists(meal.photo_thumbnail_path):
        os.remove(meal.photo_thumbnail_path)

    await db.delete(meal)
    await db.commit()
    return True


def parse_iso_date(value: Optional[str]) -> Optional[date]:
    """Parse a YYYY-MM-DD query param, returning None for missing or unusable input."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).strip()).date()
    except ValueError:
        return None


def parse_tags(raw_tags: Optional[str]) -> Optional[List[str]]:
    """Decode the JSON tag array, falling back to no tags on malformed data."""
    if not raw_tags:
        return None
    try:
        return json.loads(raw_tags)
    except (TypeError, ValueError):
        return []


def meal_to_response(meal: Meal) -> MealResponse:
    """Map a Meal row onto its API representation."""
    return MealResponse(
        id=meal.id,
        user_id=meal.user_id,
        photo_path=meal.photo_path,
        photo_thumbnail_path=meal.photo_thumbnail_path,
        calories=meal.calories,
        protein_g=meal.protein_g,
        fat_g=meal.fat_g,
        carbs_g=meal.carbs_g,
        fiber_g=meal.fiber_g,
        sugar_g=meal.sugar_g,
        sodium_mg=meal.sodium_mg,
        dish_name=meal.dish_name,
        tags=parse_tags(meal.tags),
        notes=meal.notes,
        status=meal.status,
        error_message=meal.error_message,
        quality_score=meal.quality_score,
        quality_reason=meal.quality_reason,
        ai_insight=meal.ai_insight,
        ai_persona=meal.ai_persona,
        eaten_at=meal.eaten_at,
        created_at=meal.created_at,
        updated_at=meal.updated_at,
    )


def sum_meal_macros(meals: List[Meal]) -> dict:
    """Total calories and macros across the given meals."""
    return {
        "total_calories": sum(m.calories or 0 for m in meals),
        "total_protein_g": sum(m.protein_g or 0 for m in meals),
        "total_fat_g": sum(m.fat_g or 0 for m in meals),
        "total_carbs_g": sum(m.carbs_g or 0 for m in meals),
    }


async def get_user_macro_targets(db: AsyncSession, user_id: int) -> dict:
    """Daily KBZhU targets from the user profile."""
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    return {
        "target_calories": user.target_calories if user else None,
        "target_protein_g": user.target_protein_g if user else None,
        "target_fat_g": user.target_fat_g if user else None,
        "target_carbs_g": user.target_carbs_g if user else None,
    }


async def load_meals_for_range(
    db: AsyncSession,
    user_id: int,
    start_date: date,
    end_date: date,
    tz_offset_minutes: int = 0,
) -> MealListResponse:
    """Meals for an inclusive [start, end] window with their totals and targets.

    A single day is the start == end case, so the day view and the period views
    share one query and one payload shape. `tz_offset_minutes` places the window
    in the user's local days; 0 keeps the plain UTC day.
    """
    if end_date < start_date:
        start_date, end_date = end_date, start_date

    # Heal meals whose analysis died with the worker before answering, so this
    # read never hands the dashboard a meal that can only stay pending forever.
    await fail_stale_meals(db)

    start_dt, end_dt = day_bounds_utc(start_date, end_date, tz_offset_minutes)

    result = await db.execute(
        select(Meal)
        .where(
            Meal.user_id == user_id,
            Meal.eaten_at >= start_dt,
            Meal.eaten_at <= end_dt,
        )
        .order_by(Meal.eaten_at.desc())
    )
    meals = list(result.scalars().all())

    return MealListResponse(
        meals=[meal_to_response(meal) for meal in meals],
        total=len(meals),
        date=start_dt,
        **sum_meal_macros(meals),
        **await get_user_macro_targets(db, user_id),
    )


async def get_meals_for_date(
    db: AsyncSession,
    user_id: int,
    target_date: date,
    tz_offset_minutes: int = 0,
) -> MealListResponse:
    """Get all meals for a specific date with aggregated nutrition"""
    return await load_meals_for_range(db, user_id, target_date, target_date, tz_offset_minutes)


async def get_meals_for_range(
    db: AsyncSession,
    user_id: int,
    start_date: date,
    end_date: date,
    tz_offset_minutes: int = 0,
) -> MealListResponse:
    """Get meals for an arbitrary inclusive date range (custom period)."""
    return await load_meals_for_range(db, user_id, start_date, end_date, tz_offset_minutes)


async def get_meals_by_status(
    db: AsyncSession,
    user_id: int,
    status: MealStatus,
) -> List[Meal]:
    """Get meals by status for a user"""
    result = await db.execute(
        select(Meal)
        .where(Meal.user_id == user_id, Meal.status == status)
        .order_by(Meal.created_at.desc())
    )
    return result.scalars().all()


async def update_meal_analysis_result(
    db: AsyncSession,
    meal_id: int,
    calories: float,
    protein_g: float,
    fat_g: float,
    carbs_g: float,
    dish_name: str,
    tags: List[str],
    fiber_g: Optional[float] = None,
    sugar_g: Optional[float] = None,
    sodium_mg: Optional[float] = None,
    quality_score: Optional[float] = None,
    quality_reason: Optional[str] = None,
    ai_insight: Optional[str] = None,
) -> Optional[Meal]:
    """Update meal with analysis results from vision API"""
    result = await db.execute(select(Meal).where(Meal.id == meal_id))
    meal = result.scalar_one_or_none()
    if not meal:
        return None

    meal.calories = calories
    meal.protein_g = protein_g
    meal.fat_g = fat_g
    meal.carbs_g = carbs_g
    meal.fiber_g = fiber_g
    meal.sugar_g = sugar_g
    meal.sodium_mg = sodium_mg
    meal.dish_name = dish_name
    meal.tags = json.dumps(tags)
    meal.status = MealStatus.COMPLETED
    meal.quality_score = quality_score
    meal.quality_reason = quality_reason
    meal.ai_insight = ai_insight
    meal.updated_at = utcnow()

    await db.commit()
    await db.refresh(meal)
    return meal


async def mark_meal_failed(
    db: AsyncSession,
    meal_id: int,
    error_message: str,
    quality_reason: Optional[str] = None,
) -> Optional[Meal]:
    """Mark meal processing as failed.

    `quality_reason` carries the reason the AI card is shown to the user, so a
    failed analysis still renders its explanation instead of an empty card.
    """
    result = await db.execute(select(Meal).where(Meal.id == meal_id))
    meal = result.scalar_one_or_none()
    if not meal:
        return None

    meal.status = MealStatus.FAILED
    meal.error_message = error_message
    if quality_reason is not None:
        meal.quality_reason = quality_reason
    meal.updated_at = utcnow()

    await db.commit()
    await db.refresh(meal)
    return meal


async def fail_stale_meals(
    db: AsyncSession,
    stale_after: timedelta = STUCK_MEAL_TIMEOUT,
) -> int:
    """Fail every meal a dead worker left behind, returning how many were healed.

    Age comes from `created_at`, which the app never writes and which therefore
    always holds a true instant, and the cutoff is timezone-aware for the same
    reason: it is compared against the aware UTC stamps this module writes.

    One bulk UPDATE covers every user, which is what makes it cheap enough to
    run on the nutrition read path as well as at startup. Matching rows already
    loaded in the session are refreshed ("fetch"), so the same request can
    never answer with a status it just overwrote.
    """
    cutoff = datetime.now(timezone.utc) - stale_after

    result = await db.execute(
        update(Meal)
        .where(
            Meal.status.in_((MealStatus.PENDING, MealStatus.PROCESSING)),
            Meal.created_at < cutoff,
        )
        .values(
            status=MealStatus.FAILED,
            error_message=STUCK_MEAL_ERROR,
            quality_reason=STUCK_MEAL_REASON,
            updated_at=datetime.now(timezone.utc),
        )
        .returning(Meal.id)
        .execution_options(synchronize_session="fetch")
    )
    stale_ids = list(result.scalars().all())
    if not stale_ids:
        return 0

    await db.commit()
    logger.warning(
        f"[Meal Cleanup] Marked {len(stale_ids)} stuck meal(s) as FAILED "
        f"(pending/processing older than {stale_after}): {stale_ids}"
    )
    return len(stale_ids)


async def get_daily_nutrition_summary(
    db: AsyncSession,
    user_id: int,
    target_date: date,
    tz_offset_minutes: int = 0,
) -> dict:
    """Get aggregated nutrition for a day"""
    start_of_day, end_of_day = day_bounds_utc(target_date, target_date, tz_offset_minutes)

    result = await db.execute(
        select(
            func.coalesce(func.sum(Meal.calories), 0).label("calories"),
            func.coalesce(func.sum(Meal.protein_g), 0).label("protein_g"),
            func.coalesce(func.sum(Meal.fat_g), 0).label("fat_g"),
            func.coalesce(func.sum(Meal.carbs_g), 0).label("carbs_g"),
        )
        .where(
            Meal.user_id == user_id,
            Meal.eaten_at >= start_of_day,
            Meal.eaten_at <= end_of_day,
            Meal.status == MealStatus.COMPLETED,
        )
    )
    row = result.one()

    return {
        "calories": float(row.calories),
        "protein_g": float(row.protein_g),
        "fat_g": float(row.fat_g),
        "carbs_g": float(row.carbs_g),
    }


def get_period_bounds(target_date: date, period: str) -> tuple[date, date]:
    """Return the inclusive [start, end] dates of the week or month containing target_date.

    Weeks start on Monday, matching the frontend period label.
    """
    if period == "month":
        start = target_date.replace(day=1)
        if start.month == 12:
            next_month = start.replace(year=start.year + 1, month=1)
        else:
            next_month = start.replace(month=start.month + 1)
        return start, next_month - timedelta(days=1)

    start = target_date - timedelta(days=target_date.weekday())
    return start, start + timedelta(days=6)


def resolve_period_bounds(
    target_date: date,
    period: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> tuple[date, date]:
    """Inclusive [start, end] for a period preset or an explicit custom range.

    An explicit range always wins over the preset (the frontend range sheet is
    what drives it), is normalised when the bounds arrive swapped, and is
    clamped to MAX_RANGE_DAYS so a stray wide range cannot produce a huge series.
    """
    if start_date or end_date:
        start = start_date or end_date
        end = end_date or start_date
        if start > end:
            start, end = end, start
        if (end - start).days + 1 > MAX_RANGE_DAYS:
            end = start + timedelta(days=MAX_RANGE_DAYS - 1)
        return start, end

    return get_period_bounds(target_date, period)


def build_daily_buckets(start_date: date, end_date: date) -> List[dict]:
    """Build a dense, zero-filled day list covering [start_date, end_date].

    Days without logged meals stay in the list so the trend chart renders a
    continuous line instead of a series that skips empty days.
    """
    buckets: List[dict] = []
    cursor = start_date
    while cursor <= end_date:
        buckets.append(
            {
                "key": cursor.strftime("%Y-%m-%d"),
                "label": f"{cursor.day} {MONTH_LABELS[cursor.month - 1]}",
                "calories": 0.0,
                "protein_g": 0.0,
                "fat_g": 0.0,
                "carbs_g": 0.0,
                "meals_count": 0,
            }
        )
        cursor += timedelta(days=1)
    return buckets


async def get_period_nutrition_summary(
    db: AsyncSession,
    user_id: int,
    target_date: date,
    period: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    tz_offset_minutes: int = 0,
) -> dict:
    """Get aggregated nutrition for a week, a month or a custom range.

    Returns totals, per-day averages and a dense daily `series` so the UI can
    draw the intake trend without a second request. The calorie target travels
    with the payload because the trend chart draws it as a reference line.

    `tz_offset_minutes` keeps both the window and the daily buckets in the user's
    local days, so the trend line and the day view never disagree about which
    day a meal landed on.
    """
    explicit_range = bool(start_date or end_date)
    start_date, end_date = resolve_period_bounds(target_date, period, start_date, end_date)
    start_dt, end_dt = day_bounds_utc(start_date, end_date, tz_offset_minutes)
    days = (end_date - start_date).days + 1

    result = await db.execute(
        select(
            func.coalesce(func.sum(Meal.calories), 0).label("calories"),
            func.coalesce(func.sum(Meal.protein_g), 0).label("protein_g"),
            func.coalesce(func.sum(Meal.fat_g), 0).label("fat_g"),
            func.coalesce(func.sum(Meal.carbs_g), 0).label("carbs_g"),
        )
        .where(
            Meal.user_id == user_id,
            Meal.eaten_at >= start_dt,
            Meal.eaten_at <= end_dt,
            Meal.status == MealStatus.COMPLETED,
        )
    )
    row = result.one()

    total_calories = float(row.calories)
    total_protein = float(row.protein_g)
    total_fat = float(row.fat_g)
    total_carbs = float(row.carbs_g)

    meals_result = await db.execute(
        select(
            Meal.eaten_at,
            func.coalesce(Meal.calories, 0.0).label("calories"),
            func.coalesce(Meal.protein_g, 0.0).label("protein_g"),
            func.coalesce(Meal.fat_g, 0.0).label("fat_g"),
            func.coalesce(Meal.carbs_g, 0.0).label("carbs_g"),
        )
        .where(
            Meal.user_id == user_id,
            Meal.eaten_at >= start_dt,
            Meal.eaten_at <= end_dt,
            Meal.status == MealStatus.COMPLETED,
        )
    )

    buckets = build_daily_buckets(start_date, end_date)
    bucket_index = {bucket["key"]: bucket for bucket in buckets}
    for entry in meals_result.all():
        # The stored stamp is UTC; the bucket keys are the user's calendar days.
        bucket = bucket_index.get(local_day_of(entry.eaten_at, tz_offset_minutes).strftime("%Y-%m-%d"))
        if bucket is None:
            continue
        bucket["calories"] += float(entry.calories)
        bucket["protein_g"] += float(entry.protein_g)
        bucket["fat_g"] += float(entry.fat_g)
        bucket["carbs_g"] += float(entry.carbs_g)
        bucket["meals_count"] += 1

    for bucket in buckets:
        bucket["calories"] = round(bucket["calories"], 1)
        bucket["protein_g"] = round(bucket["protein_g"], 1)
        bucket["fat_g"] = round(bucket["fat_g"], 1)
        bucket["carbs_g"] = round(bucket["carbs_g"], 1)

    user_targets = await get_user_macro_targets(db, user_id)

    # Days that actually carry data define the average: dividing by the full
    # calendar span would drag the figure down with days the user never logged.
    active_days = sum(1 for bucket in buckets if bucket["meals_count"] > 0)
    avg_days = active_days or days
    if avg_days <= 0:
        avg_days = 1

    return {
        "period": "custom" if explicit_range else period,
        "start_date": start_date,
        "end_date": end_date,
        "days": days,
        "active_days": active_days,
        "total_calories": total_calories,
        "total_protein_g": total_protein,
        "total_fat_g": total_fat,
        "total_carbs_g": total_carbs,
        "avg_calories": total_calories / avg_days,
        "avg_protein_g": total_protein / avg_days,
        "avg_fat_g": total_fat / avg_days,
        "avg_carbs_g": total_carbs / avg_days,
        **user_targets,
        "granularity": "day",
        "series": buckets,
    }


def _user_facing_error(error: BaseException) -> str:
    """Short, non-technical reason shown on the failed meal card.

    The raw exception text stays in `error_message` and the server logs; this
    copy only has to tell the user what went wrong.
    """
    if isinstance(error, TimeoutError):
        return "Анализ ИИ занял слишком много времени. Попробуйте ещё раз."
    if isinstance(error, UnidentifiedImageError):
        return "Не удалось прочитать фото. Попробуйте загрузить другое изображение."
    if isinstance(error, FileNotFoundError):
        return "Фото не найдено на сервере."
    if isinstance(error, (ValueError, KeyError, TypeError, RuntimeError)):
        return "Не удалось распознать блюдо. Попробуйте ещё раз."
    return "Ошибка анализа фото. Попробуйте ещё раз."


async def process_meal_photo_task(meal_id: int, tz_offset_minutes: int = 0) -> None:
    """
    Background task to process meal photo with AI vision cascade.
    Runs in isolated DB session to avoid blocking main request thread.

    `tz_offset_minutes` is the offset the upload came from: it places the
    "already eaten today" balance in the user's own day, so the numbers the
    nutritionist is given match the day view they are compared against.

    Never raises: every failure path ends with the meal moved to FAILED so the
    frontend polling loop stops instead of spinning forever.
    """
    started_at = time.perf_counter()
    logger.info(f"[AI Task] Starting analysis for meal {meal_id}")

    async with async_session_maker() as db:
        try:
            result = await db.execute(select(Meal).where(Meal.id == meal_id))
            meal = result.scalar_one_or_none()
            if not meal:
                logger.error(f"[AI Task] Meal {meal_id} not found, nothing to analyze")
                return

            if not meal.photo_path or not os.path.exists(meal.photo_path):
                logger.error(f"[AI Task] Photo file missing for meal {meal_id}: {meal.photo_path}")
                await mark_meal_failed(
                    db,
                    meal_id,
                    "Photo file not found",
                    "Фото не найдено на сервере",
                )
                return

            meal.status = MealStatus.PROCESSING
            meal.error_message = None
            meal.updated_at = utcnow()
            await db.commit()
            logger.info(f"[AI Task] Meal {meal_id} marked as PROCESSING")

            user_targets = await get_user_macro_targets(db, meal.user_id)

            # The day this meal belongs to, in the user's local time: a UTC date
            # would pair a late-night meal with yesterday's totals.
            today = local_day_of(meal.eaten_at, tz_offset_minutes) if meal.eaten_at else utcnow().date()
            start_of_day, end_of_day = day_bounds_utc(today, today, tz_offset_minutes)
            balance_result = await db.execute(
                select(
                    func.coalesce(func.sum(Meal.calories), 0).label("calories"),
                    func.coalesce(func.sum(Meal.protein_g), 0).label("protein_g"),
                    func.coalesce(func.sum(Meal.fat_g), 0).label("fat_g"),
                    func.coalesce(func.sum(Meal.carbs_g), 0).label("carbs_g"),
                )
                .where(
                    Meal.user_id == meal.user_id,
                    Meal.eaten_at >= start_of_day,
                    Meal.eaten_at <= end_of_day,
                    Meal.status == MealStatus.COMPLETED,
                    Meal.id != meal.id,
                )
            )
            balance_row = balance_result.one()
            current_balance = {
                "calories": float(balance_row.calories),
                "protein_g": float(balance_row.protein_g),
                "fat_g": float(balance_row.fat_g),
                "carbs_g": float(balance_row.carbs_g),
            }

            user_goal = None
            persona = None
            persona_custom_text = None
            user_result = await db.execute(select(User).where(User.id == meal.user_id))
            user = user_result.scalar_one_or_none()
            if user:
                user_goal = user.goal
                persona = user.ai_persona
                persona_custom_text = user.ai_persona_custom_text

            # Resolved once here, so the meal carries the persona its verdict was
            # actually written in even if the profile changes later.
            persona = normalize_persona(persona)

            # Compress and resize image before encoding
            with Image.open(meal.photo_path) as img:
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                max_dim = 1024
                if max(img.size) > max_dim:
                    ratio = max_dim / max(img.size)
                    new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                    img = img.resize(new_size, Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=80, optimize=True)
                buffer.seek(0)
                base64_img = base64.b64encode(buffer.read()).decode("utf-8")

            logger.info(
                f"[AI Task] Image compressed successfully for meal {meal_id}: "
                f"{len(base64_img) // 1024} KB base64"
            )

            # Analyze with AI vision cascade, bounded as a whole
            logger.info(f"[AI Task] Calling ai_vision for meal {meal_id} (budget {AI_TASK_TIMEOUT}s)")
            try:
                analysis = await asyncio.wait_for(
                    analyze_meal_photo(
                        base64_img,
                        user_goal=user_goal,
                        targets=user_targets,
                        current_balance=current_balance,
                        user_notes=meal.notes,
                        persona=persona,
                        persona_custom_text=persona_custom_text,
                    ),
                    timeout=AI_TASK_TIMEOUT,
                )
            except asyncio.TimeoutError:
                raise TimeoutError(
                    f"AI analysis exceeded {AI_TASK_TIMEOUT:.0f}s and was cancelled"
                ) from None
            logger.info(f"[AI Task] ai_vision returned a result for meal {meal_id}")

            # Update meal with results
            meal.calories = float(analysis["calories"])
            meal.protein_g = float(analysis["protein_g"])
            meal.fat_g = float(analysis["fat_g"])
            meal.carbs_g = float(analysis["carbs_g"])
            meal.fiber_g = float(analysis.get("fiber_g", 0))
            meal.sugar_g = float(analysis.get("sugar_g", 0))
            meal.sodium_mg = float(analysis.get("sodium_mg", 0))
            meal.dish_name = analysis["dish_name"]
            meal.tags = json.dumps(analysis["tags"])
            meal.quality_score = float(analysis["quality_score"])
            meal.quality_reason = json.dumps(analysis.get("quality_metrics", []), ensure_ascii=False)
            meal.ai_insight = analysis.get("ai_verdict")
            meal.ai_persona = persona
            meal.status = MealStatus.COMPLETED
            meal.error_message = None
            meal.updated_at = utcnow()

            await db.commit()
            elapsed = time.perf_counter() - started_at
            logger.info(
                f"[AI Task] Meal {meal_id} analysis completed successfully "
                f"in {elapsed:.1f}s: {meal.dish_name}"
            )

        except Exception as e:
            elapsed = time.perf_counter() - started_at
            # Full traceback to stderr for debugging, structured copy for the log.
            traceback.print_exc()
            logger.exception(
                f"[AI Task] Meal {meal_id} analysis failed after {elapsed:.1f}s: "
                f"{type(e).__name__}: {e}"
            )

            error_text = f"{type(e).__name__}: {e}".strip()
            user_text = _user_facing_error(e)

            # The failing statement may have left the session mid-transaction;
            # without a rollback the status update below would fail too.
            try:
                await db.rollback()
            except Exception as db_error:
                logger.error(f"[AI Task] Rollback failed for meal {meal_id}: {db_error}")

            try:
                await mark_meal_failed(
                    db,
                    meal_id,
                    error_text[:2000],
                    user_text,
                )
                logger.info(f"[AI Task] Meal {meal_id} marked as FAILED")
            except Exception as db_error:
                logger.error(
                    f"[AI Task] Failed to mark meal {meal_id} as FAILED: {db_error}"
                )
                traceback.print_exc()
