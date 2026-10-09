import logging
from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy import Date

from app.db.session import get_db
from app.models import User, Meal, WorkoutSession
from app.schemas import (
    AdminUserItem,
    AdminUserDetail,
    AdminUserListResponse,
    AdminStatusUpdate,
    AdminQuotaResetResponse,
    AdminStats,
)
from app.api.v1.routes import get_current_admin_user

router = APIRouter()

logger = logging.getLogger(__name__)


def _build_user_item(u: User) -> AdminUserItem:
    return AdminUserItem(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        role=u.role,
        is_active=u.is_active,
        is_admin=u.is_admin,
        is_premium=u.is_premium,
        premium_expires_at=u.premium_expires_at,
        meal_ai_daily_count=u.meal_ai_daily_count,
        created_workouts_count=u.created_workouts_count,
        created_at=u.created_at,
        updated_at=u.updated_at,
    )


def _build_user_detail(u: User) -> AdminUserDetail:
    return AdminUserDetail(
        id=u.id,
        email=u.email,
        full_name=u.full_name,
        role=u.role,
        is_active=u.is_active,
        is_admin=u.is_admin,
        is_premium=u.is_premium,
        premium_expires_at=u.premium_expires_at,
        meal_ai_daily_count=u.meal_ai_daily_count,
        last_meal_ai_date=u.last_meal_ai_date,
        last_workout_ai_analysis_at=u.last_workout_ai_analysis_at,
        last_nutrition_ai_analysis_at=u.last_nutrition_ai_analysis_at,
        created_workouts_count=u.created_workouts_count,
        created_at=u.created_at,
        updated_at=u.updated_at,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Get detailed info for a single user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    return _build_user_detail(user)


@router.get("/users", response_model=AdminUserListResponse)
async def list_users(
    search: Optional[str] = Query(None, description="Search by email or full name"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    is_admin: Optional[bool] = Query(None, description="Filter by admin status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """List users with pagination and search."""
    stmt = select(User).where(User.id != current_user.id)

    if search:
        stmt = stmt.where(
            or_(
                User.email.ilike(f"%{search}%"),
                User.full_name.ilike(f"%{search}%"),
            )
        )
    if is_active is not None:
        stmt = stmt.where(User.is_active == is_active)
    if is_admin is not None:
        stmt = stmt.where(User.is_admin == is_admin)

    total_result = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = int(total_result.scalar() or 0)

    stmt = (
        stmt.order_by(User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    users = result.scalars().all()

    return AdminUserListResponse(
        items=[_build_user_item(u) for u in users],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.patch("/users/{user_id}/status", response_model=AdminUserItem)
async def update_user_status(
    user_id: int,
    payload: AdminStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Toggle user active or admin status."""
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify own status"
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.is_admin is not None:
        user.is_admin = payload.is_admin

    user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    return _build_user_item(user)


@router.post("/users/{user_id}/reset-ai-quota", response_model=AdminQuotaResetResponse)
async def reset_ai_quota(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Reset AI usage counters for a user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    user.meal_ai_daily_count = 0
    user.last_meal_ai_date = None
    user.last_workout_ai_analysis_at = None
    user.last_nutrition_ai_analysis_at = None
    user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    return AdminQuotaResetResponse(
        id=user.id,
        email=user.email,
        meal_ai_daily_count=user.meal_ai_daily_count,
        last_meal_ai_date=user.last_meal_ai_date,
        last_workout_ai_analysis_at=user.last_workout_ai_analysis_at,
        last_nutrition_ai_analysis_at=user.last_nutrition_ai_analysis_at,
    )


@router.get("/stats", response_model=AdminStats)
async def get_admin_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """System overview metrics."""
    total_users_result = await db.execute(select(func.count()).select_from(User))
    total_users = int(total_users_result.scalar() or 0)

    active_users_result = await db.execute(
        select(func.count()).select_from(User).where(User.is_active.is_(True))
    )
    active_users = int(active_users_result.scalar() or 0)

    total_workouts_result = await db.execute(
        select(func.count()).select_from(WorkoutSession)
    )
    total_workouts = int(total_workouts_result.scalar() or 0)

    today = date.today()
    active_today_result = await db.execute(
        select(func.count())
        .select_from(WorkoutSession)
        .where(func.cast(WorkoutSession.started_at, Date) == today)
    )
    active_today = int(active_today_result.scalar() or 0)

    total_meals_result = await db.execute(select(func.count()).select_from(Meal))
    total_meals = int(total_meals_result.scalar() or 0)

    failed_meals_result = await db.execute(
        select(func.count()).select_from(Meal).where(Meal.status == "failed")
    )
    failed_meals = int(failed_meals_result.scalar() or 0)

    ai_error_rate = total_meals > 0 and (failed_meals / total_meals * 100) or 0.0

    return AdminStats(
        total_users=total_users,
        active_users=active_users,
        total_workouts=total_workouts,
        active_today=active_today,
        total_meals=total_meals,
        ai_error_rate=round(ai_error_rate, 2),
    )
