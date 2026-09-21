import enum
from datetime import datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Enum,
    Text,
    Boolean,
    Index,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base


class UserRole(str, enum.Enum):
    USER = "user"
    ADMIN = "admin"


class MealStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class WorkoutSessionStatus(str, enum.Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.USER, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # Profile data
    height_cm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    birth_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    activity_level: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Target macros
    target_calories: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_protein_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_fat_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_carbs_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Push notifications
    push_subscription: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    meals: Mapped[list["Meal"]] = relationship("Meal", back_populates="user", cascade="all, delete-orphan")
    workout_templates: Mapped[list["WorkoutTemplate"]] = relationship(
        "WorkoutTemplate", back_populates="user", cascade="all, delete-orphan"
    )
    workout_sessions: Mapped[list["WorkoutSession"]] = relationship(
        "WorkoutSession", back_populates="user", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")

    __table_args__ = (Index("ix_refresh_tokens_user_expires", "user_id", "expires_at"),)


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    photo_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    photo_thumbnail_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Nutrition data (filled after analysis)
    calories: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    protein_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fat_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fiber_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sugar_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sodium_mg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Metadata
    dish_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    tags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array as string
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[MealStatus] = mapped_column(Enum(MealStatus), default=MealStatus.PENDING, nullable=False, index=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timing
    eaten_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="meals")

    __table_args__ = (Index("ix_meals_user_eaten_at", "user_id", "eaten_at"),)


class WorkoutTemplate(Base):
    __tablename__ = "workout_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="workout_templates")
    exercises: Mapped[list["WorkoutTemplateExercise"]] = relationship(
        "WorkoutTemplateExercise", back_populates="template", cascade="all, delete-orphan", order_by="WorkoutTemplateExercise.order"
    )


class WorkoutTemplateExercise(Base):
    __tablename__ = "workout_template_exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    template_id: Mapped[int] = mapped_column(Integer, ForeignKey("workout_templates.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    target_sets: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    target_reps: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    target_weight_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rest_seconds: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    template: Mapped["WorkoutTemplate"] = relationship("WorkoutTemplate", back_populates="exercises")


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    template_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("workout_templates.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[WorkoutSessionStatus] = mapped_column(Enum(WorkoutSessionStatus), default=WorkoutSessionStatus.ACTIVE, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="workout_sessions")
    template: Mapped[Optional["WorkoutTemplate"]] = relationship("WorkoutTemplate")
    exercises: Mapped[list["WorkoutSessionExercise"]] = relationship(
        "WorkoutSessionExercise", back_populates="session", cascade="all, delete-orphan", order_by="WorkoutSessionExercise.order"
    )

    __table_args__ = (Index("ix_workout_sessions_user_started", "user_id", "started_at"),)


class WorkoutSessionExercise(Base):
    __tablename__ = "workout_session_exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    session: Mapped["WorkoutSession"] = relationship("WorkoutSession", back_populates="exercises")
    sets: Mapped[list["WorkoutSet"]] = relationship("WorkoutSet", back_populates="exercise", cascade="all, delete-orphan", order_by="WorkoutSet.set_number")


class WorkoutSet(Base):
    __tablename__ = "workout_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    exercise_id: Mapped[int] = mapped_column(Integer, ForeignKey("workout_session_exercises.id", ondelete="CASCADE"), nullable=False, index=True)
    set_number: Mapped[int] = mapped_column(Integer, nullable=False)
    weight_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    reps: Mapped[int] = mapped_column(Integer, nullable=False)
    rpe: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Rate of Perceived Exertion
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    rest_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    exercise: Mapped["WorkoutSessionExercise"] = relationship("WorkoutSessionExercise", back_populates="sets")

    __table_args__ = (Index("ix_workout_sets_exercise_set", "exercise_id", "set_number", unique=True),)


__all__ = [
    "User",
    "RefreshToken",
    "Meal",
    "MealStatus",
    "WorkoutTemplate",
    "WorkoutTemplateExercise",
    "WorkoutSession",
    "WorkoutSessionExercise",
    "WorkoutSet",
    "WorkoutSessionStatus",
    "UserRole",
]