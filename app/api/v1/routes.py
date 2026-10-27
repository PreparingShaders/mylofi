import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app.core.config import get_settings
from app.db.session import get_db
from app.models import Feedback, User, VerificationCode
from app.schemas import (
    AddExerciseToSessionRequest,
    AiPersona,
    AIWorkoutPreviewRequest,
    AIWorkoutPreviewResponse,
    AIWorkoutSummaryRequest,
    AIWorkoutSummaryResponse,
    AnthropometricsResponse,
    AnthropometricsUpdate,
    BuildWorkoutSessionRequest,
    CreateSetRequest,
    DailySummaryResponse,
    ExerciseCatalogCreate,
    ExerciseCatalogResponse,
    ExerciseCatalogUpdate,
    FeedbackCategory,
    FeedbackResponse,
    FeedbackStatus,
    MealCreate,
    MealListResponse,
    MealResponse,
    MealUpdate,
    PasswordResetConfirm,
    PhotoUploadResponse,
    QuickStartWorkoutRequest,
    QuickStartWorkoutResponse,
    RefreshTokenRequest,
    ResendCodeRequest,
    TemplateStartRequest,
    Token,
    UsageResponse,
    UserMe,
    UserRegister,
    UserUpdate,
    VerificationRequest,
    VerificationResponse,
    VerificationVerify,
    WorkoutCompletionRequest,
    WorkoutCompletionResponse,
    WorkoutHistoryResponse,
    WorkoutSessionCreate,
    WorkoutSessionResponse,
    WorkoutSessionUpdate,
    WorkoutSetResponse,
    WorkoutSetUpdate,
    WorkoutTemplateCreate,
    WorkoutTemplateResponse,
    WorkoutTemplateUpdate,
)
from app.schemas.ai_synergy import (
    AISynergyRequest,
    AISynergyResponse,
    AISynergySavedResponse,
)
from app.services.ai_summary import get_or_create_daily_summary
from app.services.ai_workout_service import (
    AI_PLAN_STATUS_PENDING,
    _get_ai_preview_lock,
    analyze_workout_session,
    analyze_workout_session_task,
    build_workout_preview,
    build_workout_preview_and_store,
    get_workout_analysis,
    load_stored_ai_plan,
    wait_for_stored_ai_plan,
)
from app.services.auth import (
    create_user_tokens,
    decode_token,
    get_password_hash,
    revoke_all_user_refresh_tokens,
    rotate_refresh_token,
    store_verification_code,
    verify_password,
)
from app.services.email import send_verification_email
from app.services.exercise_data import EQUIPMENT, MUSCLE_GROUPS
from app.services.limits import (
    build_usage_snapshot,
    can_create_workout_template,
    can_use_meal_ai,
    consume_meal_ai,
    count_workout_templates,
)
from app.services.nutrition import (
    create_meal,
    delete_meal,
    get_daily_nutrition_summary,
    get_meal,
    get_meals_for_date,
    get_meals_for_range,
    get_period_nutrition_summary,
    meal_to_response,
    normalize_tz_offset,
    process_meal_photo_task,
    retry_meal_analysis,
    resolve_eaten_at,
    save_uploaded_photo,
    update_meal,
    utcnow,
)
from app.services.nutrition_targets import (
    calculate_macro_targets,
    normalize_activity_level,
    normalize_goal,
)
from app.services.workout import (
    add_exercise_to_session,
    build_session_exercises_from_template,
    build_workout_session,
    cancel_workout_session,
    complete_workout_session,
    create_exercise,
    create_session_set,
    create_workout_session,
    create_workout_template,
    delete_exercise,
    delete_workout_session,
    delete_workout_set,
    delete_workout_template,
    get_active_workout_session,
    get_exercises,
    get_filtered_tonnage,
    get_workout_history,
    get_workout_session,
    get_workout_session_detail,
    get_workout_statistics,
    get_workout_template,
    get_workout_templates,
    quick_start_workout,
    update_exercise,
    update_set_completion,
    update_workout_session,
    update_workout_template,
)
from app.ws.manager import get_websocket_user, manager
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    Request,
    Response,
    WebSocketDisconnect,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter()


# ===== Dependency: Get Current User =====
async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    token = request.cookies.get("access_token")
    if not token:
        authorization = request.headers.get("authorization")
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ", 1)[1]
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
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
        select(User).where(User.id == user_id, User.is_active)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    now = datetime.now(timezone.utc)
    last = user.last_seen_at
    needs_update = False
    if last is None:
        needs_update = True
    else:
        last_utc = last if last.tzinfo is not None else last.replace(tzinfo=timezone.utc)
        if last_utc < now - timedelta(minutes=5):
            needs_update = True
    if needs_update:
        user.last_seen_at = now
        await db.commit()

    return user


async def get_current_admin_user(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """Dependency that gates every admin endpoint.

    A non-admin reaches the panel routes and gets a 403 rather than an
    unauthenticated redirect, so the frontend never treats "forbidden" as a
    reason to drop the session.
    """
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


async def get_optional_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User | None:
    token = request.cookies.get("access_token")
    if not token:
        authorization = request.headers.get("authorization")
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split(" ", 1)[1]
    if not token:
        return None
    payload = decode_token(token)

    if not payload or payload.type != "access":
        return None

    try:
        user_id = int(payload.sub)
    except (ValueError, TypeError):
        return None

    result = await db.execute(
        select(User).where(User.id == user_id, User.is_active)
    )
    return result.scalar_one_or_none()


# Need to import select for the dependency


logger = logging.getLogger(__name__)


# Close code sent when the handshake carries an invalid or expired token.
# The client treats it as final: reconnecting with the same token would only
# produce the same rejection.
WS_CLOSE_UNAUTHORIZED = 4001


# ===== Auth Routes =====


@router.post("/auth/register", response_model=VerificationResponse)
async def register(user_data: UserRegister, db: AsyncSession = Depends(get_db)):
    """Step 1 of registration: generates a 6-digit code and emails it.

    The user is not created yet — only a VerificationCode row is written.
    The caller must confirm the code via /auth/verify-register before the
    account exists in the database.
    """
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    code = await store_verification_code(
        db,
        email=user_data.email,
        purpose="register",
        password_hash=get_password_hash(user_data.password),
        full_name=user_data.full_name,
    )

    await send_verification_email(user_data.email, code, purpose="register")

    return VerificationResponse(status="verification_required", email=user_data.email)


@router.post("/auth/verify-register", response_model=Token)
async def verify_register(
    verify_data: VerificationVerify,
    db: AsyncSession = Depends(get_db),
):
    """Step 2 of registration: confirm the 6-digit code and create the user."""
    result = await db.execute(
        select(VerificationCode).where(
            VerificationCode.email == verify_data.email,
            VerificationCode.purpose == "register",
        )
    )
    stored = result.scalar_one_or_none()
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Код не найден. Запросите новый код.",
        )

    if stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Срок действия кода истёл. Запросите новый код.",
        )

    if stored.code != verify_data.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный код подтверждения",
        )

    if not stored.password_hash:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ошибка регистрации: данные не сохранены",
        )

    # The first user on the platform becomes an admin
    user_count_result = await db.execute(select(func.count()).select_from(User))
    total_users = int(user_count_result.scalar() or 0)

    user = User(
        email=stored.email,
        hashed_password=stored.password_hash,
        full_name=stored.full_name,
        is_admin=(total_users == 0),
        is_verified=True,
    )
    db.add(user)
    await db.commit()

    await db.delete(stored)
    await db.commit()

    access_token, refresh_token = await create_user_tokens(db, user)
    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/auth/resend-code", response_model=VerificationResponse)
async def resend_code(
    resend_data: ResendCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate a new verification code and email it again."""
    if resend_data.purpose == "register":
        result = await db.execute(
            select(VerificationCode).where(
                VerificationCode.email == resend_data.email,
                VerificationCode.purpose == "register",
            )
        )
        stored = result.scalar_one_or_none()
    else:
        stored = None

    code = await store_verification_code(
        db,
        email=resend_data.email,
        purpose=resend_data.purpose,
        password_hash=stored.password_hash if stored else None,
        full_name=stored.full_name if stored else None,
    )

    await send_verification_email(resend_data.email, code, purpose=resend_data.purpose)
    return VerificationResponse(status="code_sent", email=resend_data.email)


@router.post("/auth/forgot-password", response_model=VerificationResponse)
async def forgot_password(
    request: VerificationRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate a password-reset code. Always returns success for security."""
    result = await db.execute(select(User).where(User.email == request.email))
    user = result.scalar_one_or_none()

    if user:
        code = await store_verification_code(
            db, email=request.email, purpose="reset_password"
        )
        await send_verification_email(request.email, code, purpose="reset_password")

    return VerificationResponse(status="code_sent", email=request.email)


@router.post("/auth/verify-reset-code")
async def verify_reset_code(
    verify_data: VerificationVerify,
    db: AsyncSession = Depends(get_db),
):
    """Verify a password-reset code without consuming it yet."""
    result = await db.execute(
        select(VerificationCode).where(
            VerificationCode.email == verify_data.email,
            VerificationCode.purpose == "reset_password",
        )
    )
    stored = result.scalar_one_or_none()
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Код не найден. Запросите новый код.",
        )

    if stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Срок действия кода истёл. Запросите новый код.",
        )

    if stored.code != verify_data.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный код подтверждения",
        )

    return {"status": "verified", "email": verify_data.email}


@router.post("/auth/reset-password")
async def reset_password(
    reset_data: PasswordResetConfirm,
    db: AsyncSession = Depends(get_db),
):
    """Verify the code and update the user's password."""
    result = await db.execute(
        select(VerificationCode).where(
            VerificationCode.email == reset_data.email,
            VerificationCode.purpose == "reset_password",
        )
    )
    stored = result.scalar_one_or_none()
    if not stored:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Код не найден. Запросите новый код.",
        )

    if stored.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Срок действия кода истёл. Запросите новый код.",
        )

    if stored.code != reset_data.code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный код подтверждения",
        )

    user_result = await db.execute(select(User).where(User.email == reset_data.email))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    user.hashed_password = get_password_hash(reset_data.new_password)
    await db.delete(stored)
    await db.commit()

    return {"status": "password_reset", "email": reset_data.email}


@router.post("/auth/login", response_model=Token)
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
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

    user.last_seen_at = datetime.now(timezone.utc)
    access_token, refresh_token = await create_user_tokens(db, user)
    secure = request.url.is_secure if request else False
    response.set_cookie("access_token", access_token, httponly=True, samesite="lax", secure=secure, max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES*60)
    response.set_cookie("refresh_token", refresh_token, httponly=True, samesite="lax", secure=secure, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS*86400)
    return Token(access_token=access_token, refresh_token=refresh_token)


@router.post("/auth/refresh", response_model=Token)
async def refresh_token(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token from cookie.

    The HttpOnly refresh_token cookie is the primary source of the refresh
    token. The response body also carries the new access_token so that the
    frontend can cache it in localStorage for instant UI rendering on the
    next cold start (iOS standalone PWAs evict localStorage on process kill).
    """
    refresh = request.cookies.get("refresh_token")
    if not refresh:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        access_token, new_refresh = await rotate_refresh_token(db, refresh)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    secure = request.url.is_secure
    response.set_cookie("access_token", access_token, httponly=True, samesite="lax", secure=secure, max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES*60)
    response.set_cookie("refresh_token", new_refresh, httponly=True, samesite="lax", secure=secure, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS*86400)
    return Token(access_token=access_token, refresh_token=new_refresh)


@router.post("/auth/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Logout - revoke refresh token"""
    from app.services.auth import revoke_refresh_token

    refresh = request.cookies.get("refresh_token")
    if refresh:
        await revoke_refresh_token(db, refresh)
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"message": "Successfully logged out"}


@router.post("/auth/logout-all")
async def logout_all(
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Logout from all devices - revoke all refresh tokens"""
    await revoke_all_user_refresh_tokens(db, current_user.id)
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"message": "Successfully logged out from all devices"}


# ===== User Routes =====
@router.get("/users/me", response_model=UserMe)
async def get_current_user_info(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current user profile"""
    await db.refresh(current_user)
    return UserMe.model_validate(current_user)


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

    # The persona is validated as an enum, so it arrives as a member: store the
    # plain key the column and the prompt builder both work with.
    persona = update_data.get("ai_persona")
    if isinstance(persona, AiPersona):
        update_data["ai_persona"] = persona.value

    # A persona switch to anything but "custom" retires the custom wording, so
    # switching back does not silently revive an instruction the user left behind.
    if (
        "ai_persona" in update_data
        and update_data["ai_persona"] != AiPersona.CUSTOM.value
    ):
        update_data["ai_persona_custom_text"] = None

    for field, value in update_data.items():
        setattr(current_user, field, value)

    current_user.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(current_user)
    return UserMe.model_validate(current_user)


@router.patch("/users/me/anthropometrics", response_model=AnthropometricsResponse)
async def update_anthropometrics(
    data: AnthropometricsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Store the anthropometrics and recalculate the target KBZhU and macros"""
    activity_level = normalize_activity_level(data.activity_level)
    goal = normalize_goal(data.goal.value)

    current_user.gender = data.gender.value
    current_user.age = data.age
    current_user.height_cm = data.height_cm
    current_user.weight_kg = data.weight_kg
    current_user.activity_level = activity_level
    current_user.goal = goal
    current_user.target_weight_kg = data.target_weight_kg
    current_user.updated_at = datetime.now(timezone.utc)

    targets = calculate_macro_targets(
        weight_kg=current_user.weight_kg,
        height_cm=current_user.height_cm,
        age=current_user.age,
        gender=current_user.gender,
        activity_level=activity_level,
        goal=goal,
    )

    # The schema validates the four formula inputs, so a None result would mean
    # the service contract broke rather than that the client sent bad data.
    if targets is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Не удалось рассчитать норму калорий: проверьте пол, возраст, рост и вес",
        )

    current_user.target_calories = targets.calories
    current_user.target_protein_g = targets.protein_g
    current_user.target_fat_g = targets.fat_g
    current_user.target_carbs_g = targets.carbs_g

    await db.commit()
    await db.refresh(current_user)

    return {
        "user": UserMe.model_validate(current_user),
        "targets": {
            "bmr": targets.bmr,
            "tdee": targets.tdee,
            "calories": targets.calories,
            "protein_g": targets.protein_g,
            "fat_g": targets.fat_g,
            "carbs_g": targets.carbs_g,
        },
    }


@router.get("/users/me/usage", response_model=UsageResponse)
async def get_usage_info(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get tiered usage counters and remaining quota for the current user"""
    template_count = await count_workout_templates(db, current_user.id)
    snapshot = build_usage_snapshot(current_user, template_count)
    # The snapshot may have rolled the daily counter over to the current UTC day.
    await db.commit()
    return snapshot


@router.post("/users/me/activate-pro", response_model=UsageResponse)
async def activate_pro(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Activate the PRO plan for the current user"""
    current_user.is_premium = True
    current_user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(current_user)

    template_count = await count_workout_templates(db, current_user.id)
    return build_usage_snapshot(current_user, template_count)


@router.post("/users/me/toggle-pro", response_model=UsageResponse)
async def toggle_pro(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dev/testing switch between the Free and PRO tiers"""
    current_user.is_premium = not bool(current_user.is_premium)
    current_user.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(current_user)

    template_count = await count_workout_templates(db, current_user.id)
    return build_usage_snapshot(current_user, template_count)


# ===== Feedback Routes =====
MAX_FEEDBACK_IMAGES = 3
MAX_IMAGE_SIZE_MB = 10
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


async def validate_and_save_feedback_images(
    images: list[UploadFile],
) -> list[str]:
    """Validate and save uploaded images, return list of saved paths."""
    saved_paths = []
    for image in images:
        if not image.content_type or image.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid file type: {image.content_type}. Allowed: JPEG, PNG, WebP, GIF",
            )

        content = await image.read()
        if len(content) > MAX_IMAGE_SIZE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File too large. Max size: {MAX_IMAGE_SIZE_MB}MB",
            )

        photo_path, _ = await save_uploaded_photo(content, image.filename or "photo.jpg")
        saved_paths.append(photo_path)

    return saved_paths


@router.post("/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    category: str = Form(...),
    message: str = Form(...),
    email: str | None = Form(None),
    images: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Create a feedback/support ticket from authenticated user or guest."""
    # Validate category
    try:
        feedback_category = FeedbackCategory(category)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid category. Allowed: {[c.value for c in FeedbackCategory]}",
        )

    # Validate message length
    if not message or len(message.strip()) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message cannot be empty",
        )
    if len(message) > 5000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message too long (max 5000 characters)",
        )

    # Validate image count
    if len(images) > MAX_FEEDBACK_IMAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum {MAX_FEEDBACK_IMAGES} images allowed",
        )

    # Determine email
    if current_user:
        user_email = current_user.email
        user_id = current_user.id
    else:
        if not email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is required for guest submissions",
            )
        # Validate email format for guest submissions. The schema re-validates
        # on the way out, so an invalid one must be rejected here with 400 rather
        # than allowed to reach the response serializer and 500.
        if "@" not in email or email.count("@") != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid email format",
            )
        local, domain = email.split("@")
        if not local or not domain or " " in email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid email format",
            )
        user_email = email
        user_id = None

    # Save images
    image_paths = []
    if images:
        image_paths = await validate_and_save_feedback_images(images)

    # Create feedback record
    import json
    feedback = Feedback(
        user_id=user_id,
        email=user_email,
        category=feedback_category.value,
        message=message.strip(),
        images=json.dumps(image_paths) if image_paths else None,
        status=FeedbackStatus.NEW.value,
    )
    db.add(feedback)
    await db.commit()
    # No refresh needed: the INSERT ... RETURNING already populated id and
    # created_at, and the session uses expire_on_commit=False so the values
    # stay loaded. Refreshing here would open a second transaction, which is
    # impossible when the caller's session is already inside a closed one.

    return FeedbackResponse(
        id=feedback.id,
        email=feedback.email,
        category=FeedbackCategory(feedback.category),
        message=feedback.message,
        images=json.loads(feedback.images) if feedback.images else None,
        status=FeedbackStatus(feedback.status),
        created_at=feedback.created_at,
    )


# ===== Nutrition Routes =====
@router.post(
    "/nutrition/photos",
    response_model=PhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_meal_photo(
    file: UploadFile = File(...),
    eaten_at: str | None = Form(None),
    notes: str | None = Form(None),
    tz_offset: int | None = Form(None),
    tz: str | None = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a meal photo for analysis.

    `eaten_at` is the instant the photo was taken and `tz_offset` the minutes
    behind UTC of the device that took it. The instant alone says when the meal
    happened; the offset says which local day it belongs to, which is what the
    day view and the "already eaten today" balance are built from.
    """
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image",
        )

    # Daily quota for photo recognition (Free: 5 per UTC day)
    meal_ai_limit = can_use_meal_ai(current_user)
    if not meal_ai_limit.allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=meal_ai_limit.message,
        )

    # Check file size
    file_content = await file.read()
    max_size = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(file_content) > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Max size: {settings.MAX_FILE_SIZE_MB}MB",
        )

    # The client's offset decides how a naive timestamp is read and which local
    # day the meal is filed under; a client that sends neither keeps UTC.
    tz_offset_minutes = normalize_tz_offset(tz_offset)
    parsed_eaten_at = resolve_eaten_at(eaten_at, tz_offset_minutes)
    if tz:
        logger.info(
            f"[Photos] Meal photo from {tz} (offset {tz_offset_minutes}m), "
            f"stored at {parsed_eaten_at.isoformat()}Z"
        )

    # Save photo
    photo_path, thumbnail_path = await save_uploaded_photo(
        file_content, file.filename or "photo.jpg"
    )

    # Create meal record
    meal_data = MealCreate(eaten_at=parsed_eaten_at, notes=notes)
    meal = await create_meal(db, current_user.id, meal_data, photo_path, thumbnail_path)

    consume_meal_ai(current_user)
    await db.commit()

    # Trigger async vision API processing
    background_tasks.add_task(process_meal_photo_task, meal.id, tz_offset_minutes)

    return PhotoUploadResponse(
        meal_id=meal.id,
        status=meal.status,
        message="Photo uploaded. Analysis started.",
    )


TZ_OFFSET_DESCRIPTION = (
    "Minutes the client is behind UTC (Date.getTimezoneOffset(), so UTC+3 is -180). "
    "Day bounds and day buckets are resolved in the client's local time; omitted means UTC."
)


@router.get("/nutrition/logs", response_model=MealListResponse)
async def get_nutrition_logs(
    date: str | None = Query(None, description="Date in YYYY-MM-DD format"),
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get meals for a specific date"""
    offset = normalize_tz_offset(tz_offset)
    return await get_meals_for_date(
        db, current_user.id, _parse_target_date(date, offset), offset
    )


@router.get("/nutrition/meals", response_model=MealListResponse)
async def get_nutrition_meals_range(
    start_date: str | None = Query(None, description="Range start, YYYY-MM-DD"),
    end_date: str | None = Query(None, description="Range end, YYYY-MM-DD"),
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get meals with their totals for an arbitrary inclusive date range"""
    offset = normalize_tz_offset(tz_offset)
    start = _parse_target_date(start_date, offset)
    end = _parse_target_date(end_date, offset)
    if end < start:
        start, end = end, start
    return await get_meals_for_range(db, current_user.id, start, end, offset)


@router.get("/nutrition/summary")
async def get_nutrition_summary(
    date: str | None = Query(None, description="Date in YYYY-MM-DD format"),
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get aggregated nutrition summary for a date"""
    offset = normalize_tz_offset(tz_offset)
    return await get_daily_nutrition_summary(
        db, current_user.id, _parse_target_date(date, offset), offset
    )


@router.get("/nutrition/daily-summary", response_model=DailySummaryResponse)
async def get_nutrition_daily_summary(
    date: str | None = Query(None, description="Date in YYYY-MM-DD format"),
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    force: bool = Query(
        False, description="Regenerate the recap even when one is already stored"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI recap of one day, generated on demand when it is missing.

    A finished day with no stored recap is written on the first request for it,
    so the card is never a second visit away from being there. Today is not
    generated - the day is still being eaten - and neither is a day without
    analysed meals; both answer with `available: false` and a reason the card
    renders, never with an error. `force=true` re-reads a finished day and
    rewrites its stored recap in place (the manual trigger on the card); a
    forced run that fails keeps the last known recap.
    """
    offset = normalize_tz_offset(tz_offset)
    target_date = _parse_target_date(date, offset)
    payload = await get_or_create_daily_summary(
        db, current_user, target_date, offset, force=force
    )
    return payload


def _parse_target_date(date: str | None, tz_offset_minutes: int = 0) -> date:
    """Parse an optional YYYY-MM-DD query param, falling back to today.

    The fallback is today *on the client's clock*: the device is the only thing
    that knows where its own midnight is, so a request without a date returns
    the user's day rather than the server's.
    """
    if date:
        try:
            return datetime.fromisoformat(date).date()
        except ValueError:
            pass
    return (utcnow() - timedelta(minutes=tz_offset_minutes)).date()


@router.get("/nutrition/week")
async def get_nutrition_week(
    date: str | None = Query(None, description="Any date within the week, YYYY-MM-DD"),
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get weekly nutrition totals and per-day averages (week starts on Monday)"""
    offset = normalize_tz_offset(tz_offset)
    return await get_period_nutrition_summary(
        db,
        current_user.id,
        _parse_target_date(date, offset),
        "week",
        tz_offset_minutes=offset,
    )


@router.get("/nutrition/month")
async def get_nutrition_month(
    date: str | None = Query(None, description="Any date within the month, YYYY-MM-DD"),
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get monthly nutrition totals and per-day averages"""
    offset = normalize_tz_offset(tz_offset)
    return await get_period_nutrition_summary(
        db,
        current_user.id,
        _parse_target_date(date, offset),
        "month",
        tz_offset_minutes=offset,
    )


@router.get("/nutrition/range")
async def get_nutrition_range(
    start_date: str | None = Query(None, description="Range start, YYYY-MM-DD"),
    end_date: str | None = Query(None, description="Range end, YYYY-MM-DD"),
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get totals and per-day averages for an arbitrary inclusive date range"""
    offset = normalize_tz_offset(tz_offset)
    start = _parse_target_date(start_date, offset)
    end = _parse_target_date(end_date, offset)
    if end < start:
        start, end = end, start
    return await get_period_nutrition_summary(
        db,
        current_user.id,
        start,
        "custom",
        start_date=start,
        end_date=end,
        tz_offset_minutes=offset,
    )


@router.get("/nutrition/meals/{meal_id}", response_model=MealResponse)
async def get_meal_endpoint(
    meal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single meal by id.

    The frontend polls this while a photo analysis runs in the
    background: `status` - plus the macros and verdict once they land -
    is what tells the loading overlay the analysis is finished.
    """
    meal = await get_meal(db, meal_id, current_user.id)
    if not meal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found"
        )
    return meal_to_response(meal)


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found"
        )
    # `meal_to_response` parses the JSON-encoded `tags` column into a list so the
    # MealResponse schema (which expects List[str]) validates instead of 500-ing.
    return meal_to_response(meal)


@router.delete("/nutrition/meals/{meal_id}")
async def delete_meal_endpoint(
    meal_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a meal"""
    success = await delete_meal(db, meal_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found"
        )
    return {"message": "Meal deleted"}


@router.post("/nutrition/meals/{meal_id}/retry-analysis", response_model=MealResponse)
async def retry_meal_analysis_endpoint(
    meal_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reset a failed or stuck meal to PENDING and re-run the photo analysis task.

    Only meals that still have their photo on disk can be retried: without the
    source image the vision cascade has nothing to process.
    """
    meal = await retry_meal_analysis(db, meal_id, current_user.id)
    if not meal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meal not found or cannot be retried",
        )

    # Re-queue the background analysis. The meal was reset to PENDING in the
    # service call above, so the task picks up from the initial processing step.
    background_tasks.add_task(process_meal_photo_task, meal.id)
    return meal_to_response(meal)


# Need to import settings


settings = get_settings()


# ===== Exercise Catalog Routes =====
@router.get("/workouts/exercises", response_model=list[ExerciseCatalogResponse])
async def list_exercises(
    muscle_group: str | None = Query(None, description="Filter by muscle group"),
    equipment: str | None = Query(None, description="Filter by equipment"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get exercises from the catalog (global + personal)"""
    return await get_exercises(
        db, muscle_group=muscle_group, equipment=equipment, user_id=current_user.id
    )


@router.get("/workouts/exercises/meta")
async def list_exercise_categories():
    """Categories reference (muscle groups + equipment) for filters/UI"""
    return {"muscle_groups": MUSCLE_GROUPS, "equipment": EQUIPMENT}


@router.post(
    "/workouts/exercises",
    response_model=ExerciseCatalogResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_exercise_endpoint(
    exercise_data: ExerciseCatalogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a personal exercise for the current user"""
    return await create_exercise(db, current_user.id, exercise_data)


@router.put("/workouts/exercises/{exercise_id}", response_model=ExerciseCatalogResponse)
async def update_exercise_endpoint(
    exercise_id: int,
    exercise_data: ExerciseCatalogUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a personal exercise"""
    exercise = await update_exercise(db, exercise_id, current_user.id, exercise_data)
    if not exercise:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found"
        )
    return exercise


@router.delete("/workouts/exercises/{exercise_id}")
async def delete_exercise_endpoint(
    exercise_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a personal exercise"""
    success = await delete_exercise(db, exercise_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Exercise not found"
        )
    return {"message": "Exercise deleted"}


@router.post(
    "/workouts/sessions/build",
    response_model=WorkoutSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def build_workout_session_endpoint(
    session_data: BuildWorkoutSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Build a workout session from exercises picked from the catalog"""
    active = await get_active_workout_session(db, current_user.id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active workout session. Complete or cancel it first.",
        )
    try:
        session = await build_workout_session(db, current_user.id, session_data)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return session


# ===== Workout Template Routes =====
@router.post(
    "/workouts/templates",
    response_model=WorkoutTemplateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workout_template_endpoint(
    template_data: WorkoutTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new workout template"""
    # Free tier allows at most 3 custom templates
    template_count = await count_workout_templates(db, current_user.id)
    template_limit = can_create_workout_template(current_user, template_count)
    if not template_limit.allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=template_limit.message,
        )

    template = await create_workout_template(db, current_user.id, template_data)
    current_user.created_workouts_count = template_count + 1
    await db.commit()
    return template


@router.get("/workouts/templates", response_model=list[WorkoutTemplateResponse])
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Template not found"
        )
    return template


@router.patch(
    "/workouts/templates/{template_id}", response_model=WorkoutTemplateResponse
)
async def update_workout_template_endpoint(
    template_id: int,
    template_data: WorkoutTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a workout template"""
    template = await update_workout_template(
        db, template_id, current_user.id, template_data
    )
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Template not found"
        )
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Template not found"
        )
    return {"message": "Template deleted"}


# ===== Workout Session Routes =====
@router.post(
    "/workouts/sessions/quick-start",
    response_model=QuickStartWorkoutResponse,
    status_code=status.HTTP_201_CREATED,
)
async def quick_start_session(
    request: QuickStartWorkoutRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a ready-to-go workout session based on a goal.

    When `request.with_ai_plan` is set, an AI plan is generated in the background
    and stored on the session so the preview endpoint can serve it immediately on
    the next call, without blocking the session creation.
    """
    active = await get_active_workout_session(db, current_user.id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active workout session. Complete or cancel it first.",
        )
    try:
        session = await quick_start_workout(
            db, current_user.id, request.goal.value, reduce=request.reduce
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    if getattr(request, "with_ai_plan", False):
        session.ai_plan_status = AI_PLAN_STATUS_PENDING
        await db.commit()
        background_tasks.add_task(build_workout_preview_and_store, session.id)


    return QuickStartWorkoutResponse(session_id=session.id)


@router.post(
    "/workouts/sessions",
    response_model=WorkoutSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
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


@router.get(
    "/workouts/sessions/active", response_model=Optional[WorkoutSessionResponse]
)
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    return session


@router.patch("/workouts/sessions/{session_id}", response_model=WorkoutSessionResponse)
async def update_workout_session_endpoint(
    session_id: int,
    session_data: WorkoutSessionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a workout session (add sets, update reps/weight, etc.)"""
    session = await update_workout_session(
        db, session_id, current_user.id, session_data
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    return session


@router.post(
    "/workouts/sessions/{session_id}/complete",
    response_model=WorkoutCompletionResponse,
)
async def complete_workout_session_endpoint(
    session_id: int,
    request: WorkoutCompletionRequest | None = None,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Complete a workout session, optionally triggering AI analysis.

    With `with_ai_analysis=true`, the retrospective verdict is enqueued as a
    background task and a 202 answer is returned immediately: the verdict lands
    on the session asynchronously and the client picks it up from the history
    card via GET /ai/workout-summary/{workout_id}. Without the flag the session
    is completed synchronously and the caller receives a `WorkoutCompletionResponse`.
    """
    data = request or WorkoutCompletionRequest()
    logger.info(
        "[complete_workout_session_endpoint] session_id=%s user_id=%s "
        "with_ai_analysis=%s duration_seconds=%s",
        session_id, current_user.id, data.with_ai_analysis, data.duration_seconds,
    )
    session = await complete_workout_session(
        db,
        session_id,
        current_user.id,
        duration_seconds=data.duration_seconds,
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    if data.with_ai_analysis:
        background_tasks.add_task(
            analyze_workout_session_task,
            session.id,
            current_user.id,
            notes=data.notes,
            force=False,
        )
        return WorkoutCompletionResponse(
            session_id=session.id,
            message="Workout completed; AI analysis started.",
        )
    return WorkoutCompletionResponse(
        session_id=session.id,
        message="Workout completed.",
    )


@router.post(
    "/workouts/sessions/{session_id}/cancel", response_model=WorkoutSessionResponse
)
async def cancel_workout_session_endpoint(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel a workout session"""
    session = await cancel_workout_session(db, session_id, current_user.id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    return session


@router.delete("/workouts/sessions/{session_id}")
async def delete_workout_session_endpoint(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a workout session"""
    success = await delete_workout_session(db, session_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    return {"message": "Session deleted"}


@router.post(
    "/workouts/templates/{template_id}/start",
    response_model=WorkoutSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def start_workout_from_template(
    template_id: int,
    request: TemplateStartRequest | None = None,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start a workout session from a template.

    With `with_ai_plan=true` the AI preview is generated in the background and
    stored on the new session, so the preview endpoint can serve it without a
    model round-trip on the first open.
    """
    data = request or TemplateStartRequest()
    active = await get_active_workout_session(db, current_user.id)
    if active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active workout session. Complete or cancel it first.",
        )
    template = await get_workout_template(db, template_id, current_user.id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Template not found"
        )

    session_exercises = await build_session_exercises_from_template(
        db, template, current_user.id
    )

    # Create session from template
    session_data = WorkoutSessionCreate(
        template_id=template.id,
        name=template.name,
        exercises=session_exercises,
    )
    session = await create_workout_session(db, current_user.id, session_data)

    if data.with_ai_plan:
        session.ai_plan_status = AI_PLAN_STATUS_PENDING
        await db.commit()
        background_tasks.add_task(build_workout_preview_and_store, session.id)

        session = await get_workout_session(db, session.id, current_user.id)
        if session is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
            )

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


@router.get("/workouts/statistics")
async def get_workout_statistics_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get workout statistics for current user"""
    return await get_workout_statistics(db, current_user.id)


@router.get("/workouts/tonnage")
async def get_tonnage_endpoint(
    period: str = Query("week", description="Preset window: week, month or all"),
    start_date: str | None = Query(
        None, description="Range start, YYYY-MM-DD (overrides period)"
    ),
    end_date: str | None = Query(
        None, description="Range end, YYYY-MM-DD (overrides period)"
    ),
    muscle_group: str | None = Query(
        None, description="Filter by catalog muscle group"
    ),
    exercise_name: str | None = Query(None, description="Filter by exercise name"),
    template_id: int | None = Query(None, description="Filter by source template"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Exact tonnage (weight_kg * reps) over completed sets, with a period-over-period delta"""
    return await get_filtered_tonnage(
        db,
        current_user.id,
        period=period,
        start_date=start_date,
        end_date=end_date,
        muscle_group=muscle_group,
        exercise_name=exercise_name,
        template_id=template_id,
    )


@router.get("/workouts/history/{session_id}")
async def get_workout_history_detail_endpoint(
    session_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Detailed history for a single session: metrics, delta, summary and per-exercise trends"""
    detail = await get_workout_session_detail(db, current_user.id, session_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    return detail


@router.patch("/workouts/sets/{set_id}")
async def update_set_endpoint(
    set_id: int,
    set_data: WorkoutSetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a workout set (complete, update weight/reps, record the measured rest)"""
    logger.info(
        "[update_set_endpoint] set_id=%s user_id=%s payload=%s",
        set_id, current_user.id, set_data.model_dump(exclude_unset=True),
    )
    workout_set = await update_set_completion(
        db,
        set_id,
        current_user.id,
        set_data.is_completed,
        set_data.weight_kg,
        set_data.reps,
        set_data.rpe,
        set_data.rest_time_seconds,
    )
    if not workout_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Set not found"
        )
    return {
        "message": "Set updated",
        "is_completed": workout_set.is_completed,
        "rest_time_seconds": workout_set.rest_time_seconds,
    }


@router.post("/workouts/sets", response_model=WorkoutSetResponse, status_code=status.HTTP_201_CREATED)
async def create_set_endpoint(
    set_data: CreateSetRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a set to an existing session exercise."""
    workout_set = await create_session_set(
        db,
        current_user.id,
        set_data.exercise_id,
        set_data.set_number,
        set_data.weight_kg,
        set_data.reps,
        set_data.rest_seconds,
    )
    if not workout_set:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exercise not found or not in your session",
        )
    return workout_set


@router.delete("/workouts/sets/{set_id}")
async def delete_set_endpoint(
    set_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a workout set."""
    success = await delete_workout_set(db, set_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Set not found"
        )
    return {"message": "Set deleted"}


@router.post(
    "/workouts/sessions/{session_id}/exercises",
    response_model=WorkoutSessionResponse,
)
async def add_exercise_to_session_endpoint(
    session_id: int,
    exercise_data: AddExerciseToSessionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add an exercise from the catalog to an in-progress session."""
    session = await add_exercise_to_session(
        db,
        current_user.id,
        session_id,
        exercise_data.exercise_id,
        exercise_data.target_sets,
        exercise_data.default_reps,
        exercise_data.default_rest_seconds,
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found, not active, or exercise not accessible",
        )
    return session


# ===== AI Workout Coach Routes =====
# The coach answers at the two ends of a session: a plan before the first set, a
# verdict after the last one. Both degrade to an empty state with a reason rather
# than failing the request - the workout is what the user came for, and neither
# the model nor the tier may take it away. That also keeps a quota answer out of
# HTTP 403, which the client treats as a reason to drop the session.
@router.post("/ai/workout-preview", response_model=AIWorkoutPreviewResponse)
async def ai_workout_preview(
    request: AIWorkoutPreviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Recommended weights, reps and focus notes for the session about to start.

    Answers for a saved template (`template_id`) or for a plain list of exercise
    names, so a session assembled from the catalog can be planned too. Nothing is
    stored and no quota is spent: the plan belongs to the workout in progress,
    and the weekly allowance is for the retrospective analysis. A model failure
    answers `available: false` with a reason and the user starts the workout
    without the coach.

    When a plan was already generated and stored for a session (started with
    `with_ai_plan`), it is read from the database instead of recomputing it, so
    the preview survives across page loads while the workout is in progress.
    """
    template = None
    if request.template_id is not None:
        template = await get_workout_template(db, request.template_id, current_user.id)
        if template is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Template not found"
            )

    session = None
    if request.session_id is not None:
        session = await get_workout_session(db, request.session_id, current_user.id)
        stored = load_stored_ai_plan(session) if session is not None else None
        if stored is not None:
            return stored

        # The session was started with `with_ai_plan`, so a background task is
        # generating the plan right now. Wait for it instead of starting a second
        # generation: two callers 31 ms apart used to both call the model.
        if session is not None and getattr(session, "ai_plan_status", None) == AI_PLAN_STATUS_PENDING:
            stored = await wait_for_stored_ai_plan(db, request.session_id, current_user.id)
            if stored is not None:
                return stored

    # No stored plan and no background task that will produce one soon: generate
    # on demand. The lock keeps two concurrent callers from both doing it.
    if request.session_id is not None:
        lock = _get_ai_preview_lock(request.session_id)
        async with lock:
            # Re-check under the lock: the background task may have landed while
            # we waited for it, or a sibling caller may have just stored a plan.
            session = await get_workout_session(db, request.session_id, current_user.id)
            if session is not None:
                stored = load_stored_ai_plan(session)
                if stored is not None:
                    return stored
            return await build_workout_preview(
                db,
                current_user,
                template=template,
                exercises=request.exercises,
                goal=request.goal,
                name=request.name,
                reduce=request.reduce,
            )

    return await build_workout_preview(
        db,
        current_user,
        template=template,
        exercises=request.exercises,
        goal=request.goal,
        name=request.name,
        reduce=request.reduce,
    )


@router.post(
    "/ai/workout-summary/{workout_id}", response_model=AIWorkoutSummaryResponse
)
async def ai_workout_summary(
    workout_id: int,
    request: AIWorkoutSummaryRequest | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyse a finished or historical workout and store the verdict on it.

    `notes` is what the model cannot see on its own (a sore shoulder, a rushed
    session), and `force=true` rewrites a verdict that is already stored - the
    re-analyze button on the history card, which on the Free tier spends the same
    weekly allowance as a first analysis.

    A session that was never analysed, a spent quota and a failed generation all
    answer `available: false` with a reason, and a failed re-analysis keeps the
    verdict that was already stored.
    """
    data = request or AIWorkoutSummaryRequest()
    session = await get_workout_session(db, workout_id, current_user.id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    if not current_user.is_premium:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Анализ тренировок ИИ доступен только по подписке Premium",
        )

    return await analyze_workout_session(
        db,
        current_user,
        session,
        notes=data.notes,
        force=data.force,
    )


@router.get("/ai/workout-summary/{workout_id}", response_model=AIWorkoutSummaryResponse)
async def ai_workout_summary_read(
    workout_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Read the stored verdict of a workout, or the reason there is none.

    Never asks the model: re-opening a session in the history costs no quota, and
    a session that was never analysed is an empty card rather than a silent spend.
    """
    session = await get_workout_session(db, workout_id, current_user.id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )

    return await get_workout_analysis(db, current_user, session)


# ===== WebSocket =====
@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Live channel for background-analysis updates.

    The socket only carries notifications - "meal 42 is analysed" - and never
    data the REST endpoints do not also serve. A client that loses the socket
    therefore falls back to polling the meal status and misses nothing, which
    is why the handshake is deliberately cheap and the ping/pong exchange is
    the only traffic it expects.
    """
    user_id = await get_websocket_user(websocket, db, token)
    if not user_id:
        # Accepted first, closed second: a browser can only report a close
        # code when the handshake succeeded, and 4001 tells the client that
        # retrying with this token is pointless.
        await websocket.accept()
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Invalid or expired token")
        return

    await manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, TypeError):
                continue

            msg_type = msg.get("type") if isinstance(msg, dict) else None
            if msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif msg_type == "pong":
                # Answer to the server's own keepalive - nothing to do.
                continue
    except WebSocketDisconnect:
        logger.debug("[WS] Client disconnected (user_id=%s)", user_id)
    except Exception:
        logger.exception("[WS] Connection error (user_id=%s)", user_id)
    finally:
        manager.disconnect(websocket)


# ===== AI Synergy Routes =====
@router.post("/ai/synergy", response_model=AISynergyResponse)
async def ai_synergy(
    request: AISynergyRequest,
    tz_offset: int | None = Query(None, description=TZ_OFFSET_DESCRIPTION),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.ai_synergy_service import run_ai_synergy

    if not current_user.is_premium:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Анализ ИИ-Синергия доступен только по подписке Premium",
        )

    try:
        tz_offset_minutes = normalize_tz_offset(tz_offset)
        result = await run_ai_synergy(
            db=db,
            user=current_user,
            avg_sleep_hours=request.avg_sleep_hours,
            period_days=request.period_days,
            start_date=request.start_date,
            end_date=request.end_date,
            tz_offset_minutes=tz_offset_minutes,
        )
        return result
    except ValueError as e:
        # Rate-limit window not yet elapsed: tell the user exactly when
        # the next analysis becomes available.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        logger.exception(f"AI synergy endpoint failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось выполнить анализ синергии",
        )


@router.get("/ai/synergy", response_model=AISynergySavedResponse)
async def get_ai_synergy(
    period_type: str | None = Query(
        None, description="Тип периода: week, month, custom"
    ),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch the most recent saved synergy report for the user.

    The report is keyed by `period_type` (and, for a custom window, the exact
    date range). When nothing has been generated yet the answer is
    `available: false` with a reason, so the frontend renders an empty slot
    instead of an error - a first-time visit costs nothing but a quiet line.
    """
    import json

    from app.services.ai_synergy_service import _get_latest_synergy, _normalise_finding

    if not current_user.is_premium:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Анализ ИИ-Синергия доступен только по подписке Premium",
        )

    try:
        latest = await _get_latest_synergy(db, current_user.id, period_type or "week")
        if latest is None or not latest.payload_json:
            return AISynergySavedResponse(
                available=False,
                reason="Ещё не запускался анализ ИИ-Синергии за этот период",
            )

        payload = json.loads(latest.payload_json)
        verdict = payload.get("verdict") if isinstance(payload, dict) else None
        if verdict and isinstance(verdict, dict) and latest.ai_persona:
            verdict["ai_persona"] = latest.ai_persona
            # Legacy reports may store findings as plain strings instead of
            # {text, tone} objects. Normalise them so the response always
            # satisfies the AISynergyFinding contract.
            for findings_field in ("key_findings", "growth_points", "risk_factors"):
                raw = verdict.get(findings_field)
                if isinstance(raw, list):
                    verdict[findings_field] = [_normalise_finding(f) for f in raw]
        return AISynergySavedResponse(
            available=True,
            analyzed_at=latest.created_at,
            period_days=payload.get("period_days")
            if isinstance(payload, dict)
            else None,
            period_type=latest.period_type,
            start_date=latest.start_date,
            end_date=latest.end_date,
            metrics_snapshot=payload.get("metrics_snapshot")
            if isinstance(payload, dict)
            else None,
            verdict=verdict,
        )
    except Exception as e:
        logger.exception(f"Failed to fetch saved synergy: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось загрузить сохранённый анализ синергии",
        )
