from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form, WebSocket
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas import (
    UserRegister,
    UserLogin,
    UserResponse,
    UserMe,
    UserUpdate,
    Token,
    RefreshTokenRequest,
    MealCreate,
    MealUpdate,
    MealResponse,
    MealListResponse,
    PhotoUploadResponse,
    MealStatus,
    WorkoutTemplateCreate,
    WorkoutTemplateUpdate,
    WorkoutTemplateResponse,
    WorkoutSessionCreate,
    WorkoutSessionUpdate,
    WorkoutSessionResponse,
    WorkoutHistoryResponse,
    WorkoutSessionStatus,
    WSMessageType,
    WSMessage,
    WSMealUpdatePayload,
)
from app.services.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    create_user_tokens,
    validate_refresh_token,
    rotate_refresh_token,
    revoke_all_user_refresh_tokens,
)
from app.services.nutrition import (
    create_meal,
    get_meal,
    update_meal,
    delete_meal,
    get_meals_for_date,
    save_uploaded_photo,
    update_meal_analysis_result,
    mark_meal_failed,
    get_daily_nutrition_summary,
)
from app.services.workout import (
    create_workout_template,
    get_workout_templates,
    get_workout_template,
    update_workout_template,
    delete_workout_template,
    create_workout_session,
    get_workout_session,
    get_active_workout_session,
    update_workout_session,
    complete_workout_session,
    cancel_workout_session,
    get_workout_history,
    update_set_completion,
)
from app.models import User, Meal
from app.ws.manager import manager, get_websocket_user

router = APIRouter()


# ===== Dependency: Get Current User =====
async def get_current_user(
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = None,
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ")[1]
    payload = decode_token(token)

    if not payload or payload.type != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = int(payload.sub)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active == True)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


# Need to import select for the dependency
from sqlalchemy import select


# ===== Auth Routes =====
@router.post("/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister, db: AsyncSession = Depends(get_db)):
    """Register a new user"""
    # Check if email exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    # Create user
    hashed_password = get_password_hash(user_data.password)
    user = User(
        email=user_data.email,
        hashed_password=hashed_password,
        full_name=user_data.full_name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Create tokens
    access_token, refresh_token = await create_user_tokens(db, user)

    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/auth/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """Login with email and password"""
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )

    access_token, refresh_token = await create_user_tokens(db, user)
    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/auth/refresh", response_model=Token)
async def refresh_token(
    token_data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token"""
    try:
        access_token, refresh_token = await rotate_refresh_token(db, token_data.refresh_token)
        return Token(access_token=access_token, refresh_token=refresh_token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/auth/logout")
async def logout(
    token_data: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Logout - revoke refresh token"""
    from app.services.auth import revoke_refresh_token
    await revoke_refresh_token(db, token_data.refresh_token)
    return {"message": "Successfully logged out"}


@router.post("/auth/logout-all")
async def logout_all(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Logout from all devices - revoke all refresh tokens"""
    await revoke_all_user_refresh_tokens(db, current_user.id)
    return {"message": "Successfully logged out from all devices"}


# ===== User Routes =====
@router.get("/users/me", response_model=UserMe)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current user profile"""
    return current_user


@router.patch("/users/me", response_model=UserMe)
async def update_current_user(
    user_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update current user profile"""
    update_data = user_data.model_dump(exclude_unset=True)

    if "push_subscription" in update_data:
        current_user.push_subscription = update_data.pop("push_subscription")

    for field, value in update_data.items():
        setattr(current_user, field, value)

    current_user.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(current_user)
    return current_user


# ===== Nutrition Routes =====
@router.post("/nutrition/photos", response_model=PhotoUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_meal_photo(
    file: UploadFile = File(...),
    eaten_at: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a meal photo for analysis"""
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image",
        )

    # Check file size
    file_content = await file.read()
    max_size = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(file_content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Max size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    # Parse eaten_at or use now
    if eaten_at:
        try:
            parsed_eaten_at = datetime.fromisoformat(eaten_at.replace("Z", "+00:00"))
        except ValueError:
            parsed_eaten_at = datetime.utcnow()
    else:
        parsed_eaten_at = datetime.utcnow()

    # Save photo
    photo_path, thumbnail_path = await save_uploaded_photo(file_content, file.filename or "photo.jpg")

    # Create meal record
    meal_data = MealCreate(eaten_at=parsed_eaten_at, notes=notes)
    meal = await create_meal(db, current_user.id, meal_data, photo_path, thumbnail_path)

    # TODO: Trigger async vision API processing here
    # For now, meal stays in PENDING status

    return PhotoUploadResponse(
        meal_id=meal.id,
        status=meal.status,
        message="Photo uploaded. Analysis started.",
    )


@router.get("/nutrition/logs", response_model=MealListResponse)
async def get_nutrition_logs(
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get meals for a specific date"""
    if date:
        try:
            target_date = datetime.fromisoformat(date).date()
        except ValueError:
            target_date = datetime.utcnow().date()
    else:
        target_date = datetime.utcnow().date()

    return await get_meals_for_date(db, current_user.id, target_date)


@router.get("/nutrition/summary")
async def get_nutrition_summary(
    date: Optional[str] = Query(None, description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get aggregated nutrition summary for a date"""
    if date:
        try:
            target_date = datetime.fromisoformat(date).date()
        except ValueError:
            target_date = datetime.utcnow().date()
    else:
        target_date = datetime.utcnow().date()

    return await get_daily_nutrition_summary(db, current_user.id, target_date)


@router.patch("/nutrition/meals/{meal_id}", response_model=MealResponse)
async def update_meal_endpoint(
    meal_id: int,
    meal_data: MealUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update meal details (manual edit after analysis)"""
    meal = await update_meal(db, meal_id, current_user.id, meal_data)
    if not meal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found")
    return meal


@router.delete("/nutrition/meals/{meal_id}")
async def delete_meal_endpoint(
    meal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a meal"""
    success = await delete_meal(db, meal_id, current_user.id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found")
    return {"message": "Meal deleted"}


# Need to import settings
from app.core.config import get_settings
settings = get_settings()


# ===== Workout Template Routes =====
@router.post("/workouts/templates", response_model=WorkoutTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_workout_template_endpoint(
    template_data: WorkoutTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new workout template"""
    template = await create_workout_template(db, current_user.id, template_data)
    return template


@router.get("/workouts/templates", response_model=List[WorkoutTemplateResponse])
async def get_workout_templates_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all workout templates for current user"""
    templates = await get_workout_templates(db, current_user.id)
    return templates


@router.get("/workouts/templates/{template_id}", response_model=WorkoutTemplateResponse)
async def get_workout_template_endpoint(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific workout template"""
    template = await get_workout_template(db, template_id, current_user.id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return template


@router.patch("/workouts/templates/{template_id}", response_model=WorkoutTemplateResponse)
async def update_workout_template_endpoint(
    template_id: int,
    template_data: WorkoutTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a workout template"""
    template = await update_workout_template(db, template_id, current_user.id, template_data)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return template


@router.delete("/workouts/templates/{template_id}")
async def delete_workout_template_endpoint(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a workout template"""
    success = await delete_workout_template(db, template_id, current_user.id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return {"message": "Template deleted"}


# ===== Workout Session Routes =====
@router.post("/workouts/sessions", response_model=WorkoutSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_workout_session_endpoint(
    session_data: WorkoutSessionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start a new workout session"""
    # Check if there's already an active session
    active = await get_active_workout_session(db, current_user.id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active workout session. Complete or cancel it first.",
        )

    session = await create_workout_session(db, current_user.id, session_data)
    return session


@router.get("/workouts/sessions/active", response_model=Optional[WorkoutSessionResponse])
async def get_active_session(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get currently active workout session"""
    session = await get_active_workout_session(db, current_user.id)
    return session


@router.get("/workouts/sessions/{session_id}", response_model=WorkoutSessionResponse)
async def get_workout_session_endpoint(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific workout session"""
    session = await get_workout_session(db, session_id, current_user.id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.patch("/workouts/sessions/{session_id}", response_model=WorkoutSessionResponse)
async def update_workout_session_endpoint(
    session_id: int,
    session_data: WorkoutSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a workout session (add sets, update reps/weight, etc.)"""
    session = await update_workout_session(db, session_id, current_user.id, session_data)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.post("/workouts/sessions/{session_id}/complete", response_model=WorkoutSessionResponse)
async def complete_workout_session_endpoint(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Complete a workout session"""
    session = await complete_workout_session(db, session_id, current_user.id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.post("/workouts/sessions/{session_id}/cancel", response_model=WorkoutSessionResponse)
async def cancel_workout_session_endpoint(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel a workout session"""
    session = await cancel_workout_session(db, session_id, current_user.id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    return session


@router.get("/workouts/history", response_model=WorkoutHistoryResponse)
async def get_workout_history_endpoint(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get workout history with pagination"""
    sessions, total = await get_workout_history(db, current_user.id, limit, offset)
    return WorkoutHistoryResponse(sessions=sessions, total=total)


@router.patch("/workouts/sets/{set_id}")
async def update_set_endpoint(
    set_id: int,
    is_completed: bool = Form(...),
    weight_kg: Optional[float] = Form(None),
    reps: Optional[int] = Form(None),
    rpe: Optional[float] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a workout set (complete, update weight/reps)"""
    workout_set = await update_set_completion(
        db, set_id, current_user.id, is_completed, weight_kg, reps, rpe
    )
    if not workout_set:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Set not found")
    return {"message": "Set updated", "is_completed": workout_set.is_completed}


# ===== WebSocket =====
@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """WebSocket endpoint for real-time meal analysis updates"""
    user_id = await get_websocket_user(websocket, db, token)
    if not user_id:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await manager.connect(websocket, user_id)
    try:
        while True:
            # Keep connection alive, handle incoming messages if needed
            data = await websocket.receive_text()
            # Echo ping/pong for keepalive
            import json
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass
    except Exception:
        pass
    finally:
        manager.disconnect(websocket)