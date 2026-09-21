import os
import uuid
import shutil
from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Meal, MealStatus, User
from app.schemas import MealCreate, MealUpdate, MealResponse, MealListResponse
from app.core.config import get_settings

settings = get_settings()


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
        import json
        update_data["tags"] = json.dumps(update_data["tags"])

    for field, value in update_data.items():
        setattr(meal, field, value)

    meal.updated_at = datetime.utcnow()
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


async def get_meals_for_date(
    db: AsyncSession,
    user_id: int,
    target_date: date,
) -> MealListResponse:
    """Get all meals for a specific date with aggregated nutrition"""
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())

    result = await db.execute(
        select(Meal)
        .where(
            Meal.user_id == user_id,
            Meal.eaten_at >= start_of_day,
            Meal.eaten_at <= end_of_day,
        )
        .order_by(Meal.eaten_at.desc())
    )
    meals = result.scalars().all()

    # Calculate totals
    total_calories = sum(m.calories or 0 for m in meals)
    total_protein = sum(m.protein_g or 0 for m in meals)
    total_fat = sum(m.fat_g or 0 for m in meals)
    total_carbs = sum(m.carbs_g or 0 for m in meals)

    meal_responses = []
    for meal in meals:
        tags = None
        if meal.tags:
            import json
            try:
                tags = json.loads(meal.tags)
            except Exception:
                tags = []
        meal_responses.append(MealResponse(
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
            tags=tags,
            notes=meal.notes,
            status=meal.status,
            error_message=meal.error_message,
            eaten_at=meal.eaten_at,
            created_at=meal.created_at,
            updated_at=meal.updated_at,
        ))

    return MealListResponse(
        meals=meal_responses,
        total=len(meal_responses),
        date=datetime.combine(target_date, datetime.min.time()),
        total_calories=total_calories,
        total_protein_g=total_protein,
        total_fat_g=total_fat,
        total_carbs_g=total_carbs,
    )


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
) -> Optional[Meal]:
    """Update meal with analysis results from vision API"""
    import json

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
    meal.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(meal)
    return meal


async def mark_meal_failed(
    db: AsyncSession,
    meal_id: int,
    error_message: str,
) -> Optional[Meal]:
    """Mark meal processing as failed"""
    result = await db.execute(select(Meal).where(Meal.id == meal_id))
    meal = result.scalar_one_or_none()
    if not meal:
        return None

    meal.status = MealStatus.FAILED
    meal.error_message = error_message
    meal.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(meal)
    return meal


async def get_daily_nutrition_summary(
    db: AsyncSession,
    user_id: int,
    target_date: date,
) -> dict:
    """Get aggregated nutrition for a day"""
    start_of_day = datetime.combine(target_date, datetime.min.time())
    end_of_day = datetime.combine(target_date, datetime.max.time())

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