import enum
from datetime import date, datetime
from typing import Optional
from sqlalchemy import (
    String,
    Integer,
    Float,
    Date,
    DateTime,
    ForeignKey,
    Enum,
    Text,
    Boolean,
    Index,
    UniqueConstraint,
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
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0", nullable=False)

    # Profile data
    height_cm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    birth_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    activity_level: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    goal: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Target macros
    target_weight_kg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_calories: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_protein_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_fat_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    target_carbs_g: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # AI nutritionist persona (tone of voice). Plain strings, not an Enum column:
    # adding a persona must not need a migration, and the model already stores
    # `gender` / `activity_level` / `goal` the same way.
    ai_persona: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    ai_persona_custom_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Push notifications
    push_subscription: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Subscription
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    premium_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Usage counters
    meal_ai_daily_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    last_meal_ai_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    last_workout_ai_analysis_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_nutrition_ai_analysis_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_workouts_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
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
    daily_summaries: Mapped[list["DailySummary"]] = relationship(
        "DailySummary", back_populates="user", cascade="all, delete-orphan"
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

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

    # AI Quality Assessment
    quality_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    quality_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_insight: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Persona the verdict was written in. Copied from the user at analysis time
    # rather than read live, so the card keeps labelling the voice the user
    # actually got even after they switch persona.
    ai_persona: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # Timing
    eaten_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="meals")

    __table_args__ = (Index("ix_meals_user_eaten_at", "user_id", "eaten_at"),)


class DailySummary(Base):
    """One AI-written recap of a single calendar day of meals.

    One row per (user, date): the endpoint regenerates in place rather than
    appending, so a day never collects several takes of the same recap and a
    re-read of the card can never pick up a stale one.
    """

    __tablename__ = "daily_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # The user's local calendar day, exactly as the nutrition day view files the
    # meals. Stored as a plain date so the recap survives the client that asked
    # for it going away. Indexed on its own because the batch pass walks one day
    # for every user; (user_id, date) is served by the unique constraint below.
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Persona the recap was written in. Copied from the profile at generation
    # time, for the same reason meals carry theirs: switching persona must not
    # relabel text that was written in another voice.
    ai_persona: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="daily_summaries")

    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_daily_summaries_user_date"),)


class WorkoutTemplate(Base):
    __tablename__ = "workout_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
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
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # AI coach verdict for this session. All three are nullable: a session is
    # written before it is analysed and most are never analysed at all, so the
    # feature is opt-in rather than part of the session's lifecycle.
    # `ai_summary` is the headline text the history card renders,
    # `ai_recommendations_json` the JSON-encoded breakdown under it (overall
    # score, per-muscle-group volume, recovery advice, recommendations) - plain
    # text like `Meal.tags`, so no JSON column is needed on SQLite either.
    # `analyzed_at` records when the verdict was written, so a re-analysis is
    # visible as such and the Free-tier cooldown has a date to count from.
    ai_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_recommendations_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Persona the verdict was written in. Copied from the profile at analysis time
    # rather than read live, for the same reason meals and daily recaps carry
    # theirs: switching persona must not relabel text written in another voice.
    ai_persona: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # AI coach preview plan for this session. Generated asynchronously when the
    # session is started with `with_ai_plan=True`, and stored so the workout screen
    # can read it back after the countdown without a second model call.
    # `ai_plan_json` holds the plan payload (focus, motivation, recommendations),
    # and `ai_plan_status` tracks whether generation is pending, done, or failed.
    ai_plan_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_plan_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="workout_sessions")
    template: Mapped[Optional["WorkoutTemplate"]] = relationship("WorkoutTemplate")
    exercises: Mapped[list["WorkoutSessionExercise"]] = relationship(
        "WorkoutSessionExercise", back_populates="session", cascade="all, delete-orphan", order_by="WorkoutSessionExercise.order"
    )

    __table_args__ = (Index("ix_workout_sessions_user_started", "user_id", "started_at"),)

    @property
    def has_ai_analysis(self) -> bool:
        """Whether this session already carries an AI verdict.

        Read by the history list to tell "analyze" from "re-analyze" without
        shipping the whole verdict text in a list of a hundred sessions.
        """
        return bool(self.ai_summary) or bool(self.analyzed_at)


class WorkoutSessionExercise(Base):
    __tablename__ = "workout_session_exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

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
    # Measured rest after this set, as opposed to `rest_seconds` above, which is
    # what the plan asked for. Kept as two columns because the difference is the
    # point: a break that came up short of the target is what the coach reads.
    # Nullable - a set done without the timer, or one written before it existed,
    # simply has no measured rest.
    rest_time_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    exercise: Mapped["WorkoutSessionExercise"] = relationship("WorkoutSessionExercise", back_populates="sets")

    __table_args__ = (Index("ix_workout_sets_exercise_set", "exercise_id", "set_number", unique=True),)


class ExerciseCatalog(Base):
    __tablename__ = "exercise_catalog"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    muscle_group: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    equipment: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    is_compound: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped[Optional["User"]] = relationship("User", backref="exercises")

    __table_args__ = (Index("ix_exercise_catalog_muscle_equipment", "muscle_group", "equipment"),)


__all__ = [
    "User",
    "RefreshToken",
    "Meal",
    "MealStatus",
    "DailySummary",
    "WorkoutTemplate",
    "WorkoutTemplateExercise",
    "WorkoutSession",
    "WorkoutSessionExercise",
    "WorkoutSet",
    "WorkoutSessionStatus",
    "UserRole",
    "ExerciseCatalog",
]
