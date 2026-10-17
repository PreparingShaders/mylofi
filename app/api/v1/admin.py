import logging
from datetime import date, datetime, timedelta, time, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy import Date

from app.db.session import get_db
from app.models import Feedback, FeedbackStatus, Meal, User, WorkoutSession, WorkoutSessionStatus
from app.schemas import (
    AdminFeedbackItem,
    AdminFeedbackListResponse,
    AdminFeedbackReply,
    AdminFeedbackUpdate,
    AdminUserItem,
    AdminUserDetail,
    AdminUserListResponse,
    AdminStatusUpdate,
    AdminPremiumUpdate,
    AdminQuotaResetResponse,
    AdminStats,
)
from app.api.v1.routes import get_current_admin_user
from app.services.email import send_feedback_reply_email

router = APIRouter()

logger = logging.getLogger(__name__)


async def _user_counts(db: AsyncSession, user_id: int) -> tuple[int, int]:
    """Total logged meals and completed workout sessions for a user."""
    meals_result = await db.execute(
        select(func.count(Meal.id)).where(Meal.user_id == user_id)
    )
    total_meals = int(meals_result.scalar() or 0)

    workouts_result = await db.execute(
        select(func.count(WorkoutSession.id)).where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
        )
    )
    completed_workouts = int(workouts_result.scalar() or 0)

    return total_meals, completed_workouts


async def _effective_last_seen(db: AsyncSession, u: User) -> Optional[datetime]:
    candidates = []
    if u.last_seen_at is not None:
        ls = u.last_seen_at
        if ls.tzinfo is None:
            ls = ls.replace(tzinfo=timezone.utc)
        candidates.append(ls)
    if u.last_workout_ai_analysis_at is not None:
        v = u.last_workout_ai_analysis_at
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        candidates.append(v)
    if u.last_nutrition_ai_analysis_at is not None:
        v = u.last_nutrition_ai_analysis_at
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        candidates.append(v)

    # latest workout session timestamp
    ws_result = await db.execute(
        select(func.max(WorkoutSession.updated_at)).where(WorkoutSession.user_id == u.id)
    )
    ws_ts = ws_result.scalar()
    if ws_ts is None:
        ws_result = await db.execute(
            select(func.max(WorkoutSession.created_at)).where(WorkoutSession.user_id == u.id)
        )
        ws_ts = ws_result.scalar()
    if ws_ts is not None:
        if ws_ts.tzinfo is None:
            ws_ts = ws_ts.replace(tzinfo=timezone.utc)
        candidates.append(ws_ts)

    # latest meal timestamp
    meal_result = await db.execute(
        select(func.max(Meal.created_at)).where(Meal.user_id == u.id)
    )
    meal_ts = meal_result.scalar()
    if meal_ts is not None:
        if meal_ts.tzinfo is None:
            meal_ts = meal_ts.replace(tzinfo=timezone.utc)
        candidates.append(meal_ts)

    if not candidates:
        return None
    return max(candidates)


async def _build_user_item(db: AsyncSession, u: User) -> AdminUserItem:
    total_meals, completed_workouts = await _user_counts(db, u.id)
    effective = await _effective_last_seen(db, u)
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
        last_seen_at=effective,
        total_meals_count=total_meals,
        completed_workouts_count=completed_workouts,
        total_ai_requests=u.total_ai_requests or 0,
        created_at=u.created_at,
        updated_at=u.updated_at,
    )


async def _build_user_detail(db: AsyncSession, u: User) -> AdminUserDetail:
    total_meals, completed_workouts = await _user_counts(db, u.id)
    effective = await _effective_last_seen(db, u)
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
        last_seen_at=effective,
        total_meals_count=total_meals,
        completed_workouts_count=completed_workouts,
        total_ai_requests=u.total_ai_requests or 0,
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

    return await _build_user_detail(db, user)


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
        items=[await _build_user_item(db, u) for u in users],
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

    return await _build_user_item(db, user)


@router.patch("/users/{user_id}/premium", response_model=AdminUserDetail)
async def update_user_premium(
    user_id: int,
    payload: AdminPremiumUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Grant or revoke premium subscription for a user.

    Granting extends the subscription from ``max(now, existing_expiry)``
    when the user already has an active (or future-dated) subscription,
    so granted days never overwrite time the user has already paid for.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    action = (payload.action or "").strip().lower()
    now = datetime.now(timezone.utc)

    if action == "revoke":
        user.is_premium = False
        user.premium_expires_at = None
    elif action == "grant_custom" or payload.start_date is not None or payload.end_date is not None:
        start_date = payload.start_date
        end_date = payload.end_date
        if start_date is None or end_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Start date and end date are both required",
            )
        if start_date > end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid date range: start_date must not be after end_date",
            )

        user.is_premium = True
        # End of day in UTC: access stays valid throughout the entire end date.
        user.premium_expires_at = datetime.combine(end_date, time.max, tzinfo=timezone.utc)
    else:
        days = payload.days
        if action == "grant_7":
            days = 7
        elif action == "grant_30":
            days = 30
        if days is None or days <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid premium duration",
            )

        base = now
        if user.premium_expires_at is not None:
            existing = user.premium_expires_at
            if existing.tzinfo is None:
                existing = existing.replace(tzinfo=timezone.utc)
            base = max(now, existing)

        user.is_premium = True
        user.premium_expires_at = base + timedelta(days=days)

    user.updated_at = now
    await db.commit()
    await db.refresh(user)

    return await _build_user_detail(db, user)


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


# ===== Feedback Admin Routes =====
async def _build_feedback_item(db: AsyncSession, f: Feedback) -> AdminFeedbackItem:
    user_email = None
    if f.user_id:
        result = await db.execute(select(User).where(User.id == f.user_id))
        user = result.scalar_one_or_none()
        if user:
            user_email = user.email
    import json
    return AdminFeedbackItem(
        id=f.id,
        email=f.email,
        category=f.category,
        message=f.message,
        images=json.loads(f.images) if f.images else None,
        status=f.status,
        user_id=f.user_id,
        user_email=user_email,
        created_at=f.created_at,
    )


@router.get("/feedback", response_model=AdminFeedbackListResponse)
async def list_feedback(
    status: str | None = Query(None, description="Filter by status: new, resolved"),
    category: str | None = Query(None, description="Filter by category"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """List feedback items with pagination and filters."""
    stmt = select(Feedback)

    if status:
        stmt = stmt.where(Feedback.status == status)
    if category:
        stmt = stmt.where(Feedback.category == category)

    total_result = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = int(total_result.scalar() or 0)

    stmt = (
        stmt.order_by(Feedback.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    feedback_items = result.scalars().all()

    return AdminFeedbackListResponse(
        items=[await _build_feedback_item(db, f) for f in feedback_items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/feedback/{feedback_id}", response_model=AdminFeedbackItem)
async def get_feedback(
    feedback_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Get a single feedback item by id for the detail modal."""
    result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found"
        )
    return await _build_feedback_item(db, feedback)


@router.patch("/feedback/{feedback_id}", response_model=AdminFeedbackItem)
async def update_feedback(
    feedback_id: int,
    payload: AdminFeedbackUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Update feedback status and optionally grant PRO to the associated user."""
    result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found"
        )

    # Update status if provided
    if payload.status is not None:
        feedback.status = payload.status.value

    # Grant PRO if requested
    if payload.grant_pro:
        target_user = None
        if feedback.user_id:
            result = await db.execute(select(User).where(User.id == feedback.user_id))
            target_user = result.scalar_one_or_none()
        elif feedback.email:
            result = await db.execute(select(User).where(User.email == feedback.email))
            target_user = result.scalar_one_or_none()

        if target_user:
            # Use existing premium grant logic: extend from max(now, existing_expiry)
            now = datetime.now(timezone.utc)
            base = now
            if target_user.premium_expires_at is not None:
                existing = target_user.premium_expires_at
                if existing.tzinfo is None:
                    existing = existing.replace(tzinfo=timezone.utc)
                base = max(now, existing)

            target_user.is_premium = True
            target_user.premium_expires_at = base + timedelta(days=30)
            target_user.updated_at = now

    await db.commit()
    await db.refresh(feedback)

    return await _build_feedback_item(db, feedback)


@router.post("/feedback/{feedback_id}/reply", response_model=AdminFeedbackItem)
async def reply_feedback(
    feedback_id: int,
    payload: AdminFeedbackReply,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_user),
):
    """Send an email reply to a feedback item and mark it resolved."""
    result = await db.execute(select(Feedback).where(Feedback.id == feedback_id))
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found"
        )

    # Recipient email: the feedback's own email takes precedence, falling back
    # to the linked user's email (registered users vs landing guests).
    recipient_email = feedback.email or None
    if not recipient_email and feedback.user_id:
        user_result = await db.execute(select(User).where(User.id == feedback.user_id))
        user = user_result.scalar_one_or_none()
        if user:
            recipient_email = user.email

    if not recipient_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No email address to reply to",
        )

    # Best-effort email delivery: a failure is logged but still resolves the ticket.
    await send_feedback_reply_email(recipient_email, payload.reply_text)

    feedback.status = FeedbackStatus.RESOLVED.value
    await db.commit()
    await db.refresh(feedback)

    return await _build_feedback_item(db, feedback)
