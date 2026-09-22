from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from enum import Enum


# Base schemas
class UserRole(str, Enum):
    USER = "user"
    ADMIN = "admin"


class MealStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class WorkoutSessionStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


# Auth schemas
class TokenBase(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class Token(TokenBase):
    model_config = ConfigDict(from_attributes=True)


class TokenPayload(BaseModel):
    sub: str
    exp: int
    type: str


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: Optional[str] = Field(None, max_length=255)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


# User schemas
class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    birth_date: Optional[datetime] = None
    gender: Optional[str] = None
    activity_level: Optional[str] = None
    target_calories: Optional[int] = None
    target_protein_g: Optional[float] = None
    target_fat_g: Optional[float] = None
    target_carbs_g: Optional[float] = None


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    birth_date: Optional[datetime] = None
    gender: Optional[str] = None
    activity_level: Optional[str] = None
    target_calories: Optional[int] = None
    target_protein_g: Optional[float] = None
    target_fat_g: Optional[float] = None
    target_carbs_g: Optional[float] = None
    push_subscription: Optional[str] = None


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: UserRole
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserMe(UserResponse):
    pass


# Nutrition schemas
class MealBase(BaseModel):
    eaten_at: datetime
    notes: Optional[str] = None


class MealCreate(MealBase):
    pass


class MealUpdate(BaseModel):
    calories: Optional[float] = None
    protein_g: Optional[float] = None
    fat_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fiber_g: Optional[float] = None
    sugar_g: Optional[float] = None
    sodium_mg: Optional[float] = None
    dish_name: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    eaten_at: Optional[datetime] = None


class MealResponse(MealBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    photo_path: Optional[str] = None
    photo_thumbnail_path: Optional[str] = None
    calories: Optional[float] = None
    protein_g: Optional[float] = None
    fat_g: Optional[float] = None
    carbs_g: Optional[float] = None
    fiber_g: Optional[float] = None
    sugar_g: Optional[float] = None
    sodium_mg: Optional[float] = None
    dish_name: Optional[str] = None
    tags: Optional[List[str]] = None
    status: MealStatus
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class MealListResponse(BaseModel):
    meals: List[MealResponse]
    total: int
    date: datetime

    # Aggregated nutrition for the day
    total_calories: float = 0
    total_protein_g: float = 0
    total_fat_g: float = 0
    total_carbs_g: float = 0


class PhotoUploadResponse(BaseModel):
    meal_id: int
    status: MealStatus
    message: str


# Workout schemas
class WorkoutTemplateExerciseBase(BaseModel):
    name: str = Field(max_length=255)
    order: int = 0
    target_sets: int = Field(default=3, ge=1)
    target_reps: int = Field(default=10, ge=1)
    target_weight_kg: Optional[float] = None
    rest_seconds: int = Field(default=90, ge=0)
    notes: Optional[str] = None


class WorkoutTemplateExerciseCreate(WorkoutTemplateExerciseBase):
    pass


class WorkoutTemplateExerciseUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    order: Optional[int] = None
    target_sets: Optional[int] = Field(None, ge=1)
    target_reps: Optional[int] = Field(None, ge=1)
    target_weight_kg: Optional[float] = None
    rest_seconds: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None


class WorkoutTemplateExerciseResponse(WorkoutTemplateExerciseBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_id: int


class WorkoutTemplateBase(BaseModel):
    name: str = Field(max_length=255)
    description: Optional[str] = None
    is_default: bool = False


class WorkoutTemplateCreate(WorkoutTemplateBase):
    exercises: List[WorkoutTemplateExerciseCreate] = []


class WorkoutTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    is_default: Optional[bool] = None
    exercises: Optional[List[WorkoutTemplateExerciseCreate]] = None


class WorkoutTemplateResponse(WorkoutTemplateBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    exercises: List[WorkoutTemplateExerciseResponse] = []
    created_at: datetime
    updated_at: datetime


class WorkoutSetBase(BaseModel):
    set_number: int = Field(ge=1)
    weight_kg: Optional[float] = None
    reps: int = Field(ge=1)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    is_completed: bool = False
    rest_seconds: Optional[int] = Field(None, ge=0)


class WorkoutSetCreate(WorkoutSetBase):
    pass


class WorkoutSetUpdate(BaseModel):
    weight_kg: Optional[float] = None
    reps: Optional[int] = Field(None, ge=1)
    rpe: Optional[float] = Field(None, ge=1, le=10)
    is_completed: Optional[bool] = None
    rest_seconds: Optional[int] = Field(None, ge=0)


class WorkoutSetResponse(WorkoutSetBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    exercise_id: int
    completed_at: Optional[datetime] = None
    created_at: datetime


class WorkoutSessionExerciseBase(BaseModel):
    name: str = Field(max_length=255)
    order: int = 0
    notes: Optional[str] = None


class WorkoutSessionExerciseCreate(WorkoutSessionExerciseBase):
    sets: List[WorkoutSetCreate] = []


class WorkoutSessionExerciseUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    order: Optional[int] = None
    notes: Optional[str] = None
    sets: Optional[List[WorkoutSetCreate]] = None


class WorkoutSessionExerciseResponse(WorkoutSessionExerciseBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    sets: List[WorkoutSetResponse] = []


class WorkoutSessionBase(BaseModel):
    name: str = Field(max_length=255)
    template_id: Optional[int] = None
    notes: Optional[str] = None


class WorkoutSessionCreate(WorkoutSessionBase):
    exercises: List[WorkoutSessionExerciseCreate] = []


class WorkoutSessionUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    status: Optional[WorkoutSessionStatus] = None
    notes: Optional[str] = None
    exercises: Optional[List[WorkoutSessionExerciseCreate]] = None


class WorkoutSessionResponse(WorkoutSessionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    status: WorkoutSessionStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    exercises: List[WorkoutSessionExerciseResponse] = []
    created_at: datetime
    updated_at: datetime


class WorkoutHistoryResponse(BaseModel):
    sessions: List[WorkoutSessionResponse]
    total: int


# Exercise catalog schemas
class WorkoutGoal(str, Enum):
    STRENGTH = "strength"
    HYPERTROPHY = "hypertrophy"
    ENDURANCE = "endurance"


class ExerciseCatalogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    name: str
    muscle_group: str
    equipment: str
    is_compound: bool
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ExerciseCatalogCreate(BaseModel):
    name: str = Field(max_length=255)
    muscle_group: str = Field(max_length=50)
    equipment: str = Field(max_length=50)
    is_compound: bool = True
    description: Optional[str] = None


class ExerciseCatalogUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    muscle_group: Optional[str] = Field(None, max_length=50)
    equipment: Optional[str] = Field(None, max_length=50)
    is_compound: Optional[bool] = None
    description: Optional[str] = None


class BuildWorkoutSessionRequest(BaseModel):
    name: str = Field(max_length=255)
    exercise_ids: List[int] = Field(min_length=1)
    default_sets: int = Field(default=3, ge=1)
    default_reps: int = Field(default=10, ge=1)
    default_rest_seconds: int = Field(default=90, ge=0)
    notes: Optional[str] = None


class QuickStartWorkoutRequest(BaseModel):
    goal: WorkoutGoal = Field(default=WorkoutGoal.STRENGTH)


class QuickStartWorkoutResponse(BaseModel):
    session_id: int


# WebSocket schemas
class WSMessageType(str, Enum):
    MEAL_UPDATE = "meal_update"
    MEAL_COMPLETED = "meal_completed"
    MEAL_FAILED = "meal_failed"
    PING = "ping"
    PONG = "pong"


class WSMessage(BaseModel):
    type: WSMessageType
    payload: dict


class WSMealUpdatePayload(BaseModel):
    meal_id: int
    status: MealStatus
    calories: Optional[float] = None
    protein_g: Optional[float] = None
    fat_g: Optional[float] = None
    carbs_g: Optional[float] = None
    dish_name: Optional[str] = None
    tags: Optional[List[str]] = None
    error_message: Optional[str] = None


__all__ = [
    "UserRole",
    "MealStatus",
    "WorkoutSessionStatus",
    "Token",
    "TokenPayload",
    "UserRegister",
    "UserLogin",
    "RefreshTokenRequest",
    "UserBase",
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserMe",
    "MealBase",
    "MealCreate",
    "MealUpdate",
    "MealResponse",
    "MealListResponse",
    "PhotoUploadResponse",
    "WorkoutTemplateExerciseBase",
    "WorkoutTemplateExerciseCreate",
    "WorkoutTemplateExerciseUpdate",
    "WorkoutTemplateExerciseResponse",
    "WorkoutTemplateBase",
    "WorkoutTemplateCreate",
    "WorkoutTemplateUpdate",
    "WorkoutTemplateResponse",
    "WorkoutSetBase",
    "WorkoutSetCreate",
    "WorkoutSetUpdate",
    "WorkoutSetResponse",
    "WorkoutSessionExerciseBase",
    "WorkoutSessionExerciseCreate",
    "WorkoutSessionExerciseUpdate",
    "WorkoutSessionExerciseResponse",
    "WorkoutSessionBase",
    "WorkoutSessionCreate",
    "WorkoutSessionUpdate",
    "WorkoutSessionResponse",
    "WorkoutHistoryResponse",
    "WSMessageType",
    "WSMessage",
    "WSMealUpdatePayload",
    "WorkoutGoal",
    "ExerciseCatalogResponse",
    "ExerciseCatalogCreate",
    "ExerciseCatalogUpdate",
    "BuildWorkoutSessionRequest",
    "QuickStartWorkoutRequest",
    "QuickStartWorkoutResponse",
]