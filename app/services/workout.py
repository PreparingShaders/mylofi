from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    WorkoutTemplate,
    WorkoutTemplateExercise,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSet,
    WorkoutSessionStatus,
    ExerciseCatalog,
)
from app.services.exercise_data import EXERCISE_SEED, MUSCLE_GROUPS, EQUIPMENT
from app.schemas import (
    WorkoutTemplateCreate,
    WorkoutTemplateUpdate,
    WorkoutTemplateExerciseCreate,
    WorkoutSessionCreate,
    WorkoutSessionUpdate,
    WorkoutSessionExerciseCreate,
    WorkoutSetCreate,
    ExerciseCatalogCreate,
    ExerciseCatalogUpdate,
    BuildWorkoutSessionRequest,
)


async def create_workout_template(
    db: AsyncSession,
    user_id: int,
    template_data: WorkoutTemplateCreate,
) -> WorkoutTemplate:
    """Create a new workout template with exercises"""
    template = WorkoutTemplate(
        user_id=user_id,
        name=template_data.name,
        description=template_data.description,
        is_default=template_data.is_default,
    )
    db.add(template)
    await db.flush()

    for i, exercise_data in enumerate(template_data.exercises):
        exercise = WorkoutTemplateExercise(
            template_id=template.id,
            name=exercise_data.name,
            order=exercise_data.order or i,
            target_sets=exercise_data.target_sets,
            target_reps=exercise_data.target_reps,
            target_weight_kg=exercise_data.target_weight_kg,
            rest_seconds=exercise_data.rest_seconds,
            notes=exercise_data.notes,
        )
        db.add(exercise)

    await db.commit()
    await db.refresh(template)
    return template


async def get_workout_templates(db: AsyncSession, user_id: int) -> List[WorkoutTemplate]:
    """Get all workout templates for a user"""
    result = await db.execute(
        select(WorkoutTemplate)
        .where(WorkoutTemplate.user_id == user_id)
        .options(selectinload(WorkoutTemplate.exercises))
        .order_by(WorkoutTemplate.is_default.desc(), WorkoutTemplate.created_at.desc())
    )
    return result.scalars().all()


async def get_workout_template(db: AsyncSession, template_id: int, user_id: int) -> Optional[WorkoutTemplate]:
    """Get a specific workout template"""
    result = await db.execute(
        select(WorkoutTemplate)
        .where(WorkoutTemplate.id == template_id, WorkoutTemplate.user_id == user_id)
        .options(selectinload(WorkoutTemplate.exercises))
    )
    return result.scalar_one_or_none()


async def update_workout_template(
    db: AsyncSession,
    template_id: int,
    user_id: int,
    template_data: WorkoutTemplateUpdate,
) -> Optional[WorkoutTemplate]:
    """Update a workout template"""
    template = await get_workout_template(db, template_id, user_id)
    if not template:
        return None

    update_data = template_data.model_dump(exclude_unset=True, exclude={"exercises"})
    for field, value in update_data.items():
        setattr(template, field, value)

    # Handle exercises if provided
    if template_data.exercises is not None:
        # Delete existing exercises
        for exercise in template.exercises:
            await db.delete(exercise)
        await db.flush()

        # Add new exercises
        for i, exercise_data in enumerate(template_data.exercises):
            exercise = WorkoutTemplateExercise(
                template_id=template.id,
                name=exercise_data.name,
                order=exercise_data.order or i,
                target_sets=exercise_data.target_sets,
                target_reps=exercise_data.target_reps,
                target_weight_kg=exercise_data.target_weight_kg,
                rest_seconds=exercise_data.rest_seconds,
                notes=exercise_data.notes,
            )
            db.add(exercise)

    template.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(template)
    return template


async def delete_workout_template(db: AsyncSession, template_id: int, user_id: int) -> bool:
    """Delete a workout template"""
    template = await get_workout_template(db, template_id, user_id)
    if not template:
        return False

    await db.delete(template)
    await db.commit()
    return True


async def create_workout_session(
    db: AsyncSession,
    user_id: int,
    session_data: WorkoutSessionCreate,
) -> WorkoutSession:
    """Create a new workout session"""
    session = WorkoutSession(
        user_id=user_id,
        template_id=session_data.template_id,
        name=session_data.name,
        notes=session_data.notes,
        started_at=datetime.now(timezone.utc),
        status=WorkoutSessionStatus.ACTIVE,
    )
    db.add(session)
    await db.flush()

    for i, exercise_data in enumerate(session_data.exercises):
        exercise = WorkoutSessionExercise(
            session_id=session.id,
            name=exercise_data.name,
            order=exercise_data.order or i,
            notes=exercise_data.notes,
        )
        db.add(exercise)
        await db.flush()

        for set_data in exercise_data.sets:
            workout_set = WorkoutSet(
                exercise_id=exercise.id,
                set_number=set_data.set_number,
                weight_kg=set_data.weight_kg,
                reps=set_data.reps,
                rpe=set_data.rpe,
                is_completed=set_data.is_completed,
                rest_seconds=set_data.rest_seconds,
            )
            db.add(workout_set)

    await db.commit()
    await db.refresh(session)
    return session


async def get_workout_session(
    db: AsyncSession,
    session_id: int,
    user_id: int,
) -> Optional[WorkoutSession]:
    """Get a workout session with all exercises and sets"""
    result = await db.execute(
        select(WorkoutSession)
        .where(WorkoutSession.id == session_id, WorkoutSession.user_id == user_id)
        .options(
            selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets)
        )
    )
    return result.scalar_one_or_none()


async def get_active_workout_session(db: AsyncSession, user_id: int) -> Optional[WorkoutSession]:
    """Get the currently active workout session for a user"""
    result = await db.execute(
        select(WorkoutSession)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.ACTIVE,
        )
        .options(
            selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets)
        )
        .order_by(WorkoutSession.started_at.desc())
    )
    return result.scalar_one_or_none()


async def update_workout_session(
    db: AsyncSession,
    session_id: int,
    user_id: int,
    session_data: WorkoutSessionUpdate,
) -> Optional[WorkoutSession]:
    """Update a workout session"""
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    update_data = session_data.model_dump(exclude_unset=True, exclude={"exercises"})
    for field, value in update_data.items():
        setattr(session, field, value)

    # Handle exercises if provided
    if session_data.exercises is not None:
        for exercise_data in session_data.exercises:
            if exercise_data.id:
                # Update existing exercise
                exercise_result = await db.execute(
                    select(WorkoutSessionExercise)
                    .where(
                        WorkoutSessionExercise.id == exercise_data.id,
                        WorkoutSessionExercise.session_id == session_id,
                    )
                )
                exercise = exercise_result.scalar_one_or_none()
                if exercise:
                    exercise.name = exercise_data.name
                    exercise.order = exercise_data.order
                    exercise.notes = exercise_data.notes

                    # Handle sets
                    if exercise_data.sets is not None:
                        for set_data in exercise_data.sets:
                            if set_data.id:
                                set_result = await db.execute(
                                    select(WorkoutSet).where(WorkoutSet.id == set_data.id)
                                )
                                workout_set = set_result.scalar_one_or_none()
                                if workout_set:
                                    workout_set.weight_kg = set_data.weight_kg
                                    workout_set.reps = set_data.reps
                                    workout_set.rpe = set_data.rpe
                                    workout_set.is_completed = set_data.is_completed
                                    workout_set.rest_seconds = set_data.rest_seconds
                                    if set_data.is_completed and not workout_set.completed_at:
                                        workout_set.completed_at = datetime.now(timezone.utc)
                            else:
                                # New set
                                workout_set = WorkoutSet(
                                    exercise_id=exercise.id,
                                    set_number=set_data.set_number,
                                    weight_kg=set_data.weight_kg,
                                    reps=set_data.reps,
                                    rpe=set_data.rpe,
                                    is_completed=set_data.is_completed,
                                    rest_seconds=set_data.rest_seconds,
                                )
                                db.add(workout_set)
            else:
                # New exercise
                exercise = WorkoutSessionExercise(
                    session_id=session.id,
                    name=exercise_data.name,
                    order=exercise_data.order,
                    notes=exercise_data.notes,
                )
                db.add(exercise)
                await db.flush()

                for set_data in exercise_data.sets:
                    workout_set = WorkoutSet(
                        exercise_id=exercise.id,
                        set_number=set_data.set_number,
                        weight_kg=set_data.weight_kg,
                        reps=set_data.reps,
                        rpe=set_data.rpe,
                        is_completed=set_data.is_completed,
                        rest_seconds=set_data.rest_seconds,
                    )
                    db.add(workout_set)

    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    return session


async def complete_workout_session(db: AsyncSession, session_id: int, user_id: int) -> Optional[WorkoutSession]:
    """Mark a workout session as completed"""
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    session.status = WorkoutSessionStatus.COMPLETED
    completed_at = datetime.now(timezone.utc)
    session.completed_at = completed_at
    if session.started_at:
        # Ensure both datetimes are timezone-aware
        started_at = session.started_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        session.duration_seconds = int((completed_at - started_at).total_seconds())
    session.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(session)
    return session


async def cancel_workout_session(db: AsyncSession, session_id: int, user_id: int) -> Optional[WorkoutSession]:
    """Cancel a workout session"""
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    session.status = WorkoutSessionStatus.CANCELLED
    completed_at = datetime.now(timezone.utc)
    session.completed_at = completed_at
    if session.started_at:
        # Ensure both datetimes are timezone-aware
        started_at = session.started_at
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        session.duration_seconds = int((completed_at - started_at).total_seconds())
    session.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(session)
    return session


async def get_workout_history(
    db: AsyncSession,
    user_id: int,
    limit: int = 50,
    offset: int = 0,
) -> tuple[List[WorkoutSession], int]:
    """Get workout history with pagination"""
    # Get total count
    count_result = await db.execute(
        select(func.count(WorkoutSession.id)).where(WorkoutSession.user_id == user_id)
    )
    total = count_result.scalar()

    # Get sessions
    result = await db.execute(
        select(WorkoutSession)
        .where(WorkoutSession.user_id == user_id)
        .options(
            selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets)
        )
        .order_by(WorkoutSession.started_at.desc())
        .limit(limit)
        .offset(offset)
    )
    sessions = result.scalars().all()

    return sessions, total


async def update_set_completion(
    db: AsyncSession,
    set_id: int,
    user_id: int,
    is_completed: Optional[bool] = None,
    weight_kg: Optional[float] = None,
    reps: Optional[int] = None,
    rpe: Optional[float] = None,
) -> Optional[WorkoutSet]:
    """Update a workout set completion status"""
    result = await db.execute(
        select(WorkoutSet)
        .join(WorkoutSessionExercise)
        .join(WorkoutSession)
        .where(
            WorkoutSet.id == set_id,
            WorkoutSession.user_id == user_id,
        )
    )
    workout_set = result.scalar_one_or_none()
    if not workout_set:
        return None

    if is_completed is not None:
        if is_completed and not workout_set.is_completed:
            workout_set.completed_at = datetime.now(timezone.utc)
        elif not is_completed:
            workout_set.completed_at = None
        workout_set.is_completed = is_completed
    if weight_kg is not None:
        workout_set.weight_kg = weight_kg
    if reps is not None:
        workout_set.reps = reps
    if rpe is not None:
        workout_set.rpe = rpe

    await db.commit()
    await db.refresh(workout_set)
    return workout_set


# ===== Exercise Catalog =====
WORKOUT_GOAL_SETTINGS = {
    "strength": {"default_sets": 3, "default_reps": 5, "default_rest_seconds": 90},
    "hypertrophy": {"default_sets": 3, "default_reps": 10, "default_rest_seconds": 60},
    "endurance": {"default_sets": 2, "default_reps": 15, "default_rest_seconds": 45},
}

MAJOR_MUSCLE_GROUPS = ["quadriceps", "glutes", "chest", "back", "shoulders"]


async def seed_exercise_catalog(db: AsyncSession) -> None:
    """Insert catalog exercises that are missing (preserves personal ones)."""
    result = await db.execute(
        select(ExerciseCatalog.name).where(ExerciseCatalog.user_id.is_(None))
    )
    existing_names = {row for row in result.scalars().all()}
    new_items = [
        ExerciseCatalog(**item) for item in EXERCISE_SEED if item["name"] not in existing_names
    ]
    if new_items:
        db.add_all(new_items)
        await db.commit()


async def get_exercises(
    db: AsyncSession,
    muscle_group: Optional[str] = None,
    equipment: Optional[str] = None,
    user_id: Optional[int] = None,
) -> List[ExerciseCatalog]:
    """Return exercises from the catalog, optionally filtered.

    Includes global exercises plus the given user's personal exercises.
    """
    query = select(ExerciseCatalog)
    if user_id is not None:
        query = query.where(
            or_(ExerciseCatalog.user_id.is_(None), ExerciseCatalog.user_id == user_id)
        )
    if muscle_group:
        query = query.where(ExerciseCatalog.muscle_group == muscle_group)
    if equipment:
        query = query.where(ExerciseCatalog.equipment == equipment)
    query = query.order_by(ExerciseCatalog.muscle_group, ExerciseCatalog.name)
    result = await db.execute(query)
    return result.scalars().all()


async def create_exercise(
    db: AsyncSession,
    user_id: int,
    exercise_data: ExerciseCatalogCreate,
) -> ExerciseCatalog:
    """Create a personal exercise for the user."""
    exercise = ExerciseCatalog(
        user_id=user_id,
        name=exercise_data.name,
        muscle_group=exercise_data.muscle_group,
        equipment=exercise_data.equipment,
        is_compound=exercise_data.is_compound,
        description=exercise_data.description,
    )
    db.add(exercise)
    await db.commit()
    await db.refresh(exercise)
    return exercise


async def update_exercise(
    db: AsyncSession,
    exercise_id: int,
    user_id: int,
    exercise_data: ExerciseCatalogUpdate,
) -> Optional[ExerciseCatalog]:
    """Update a user's personal exercise."""
    result = await db.execute(
        select(ExerciseCatalog).where(
            ExerciseCatalog.id == exercise_id,
            ExerciseCatalog.user_id == user_id,
        )
    )
    exercise = result.scalar_one_or_none()
    if not exercise:
        return None

    update_data = exercise_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(exercise, field, value)

    exercise.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(exercise)
    return exercise


async def delete_exercise(
    db: AsyncSession,
    exercise_id: int,
    user_id: int,
) -> bool:
    """Delete a user's personal exercise."""
    result = await db.execute(
        select(ExerciseCatalog).where(
            ExerciseCatalog.id == exercise_id,
            ExerciseCatalog.user_id == user_id,
        )
    )
    exercise = result.scalar_one_or_none()
    if not exercise:
        return False
    await db.delete(exercise)
    await db.commit()
    return True


async def build_workout_session(
    db: AsyncSession,
    user_id: int,
    data: BuildWorkoutSessionRequest,
) -> WorkoutSession:
    """Build a workout session from exercises picked from the catalog."""
    exercise_result = await db.execute(
        select(ExerciseCatalog).where(
            ExerciseCatalog.id.in_(data.exercise_ids),
            or_(
                ExerciseCatalog.user_id.is_(None),
                ExerciseCatalog.user_id == user_id,
            ),
        )
    )
    exercises = exercise_result.scalars().all()
    if len(exercises) != len(data.exercise_ids):
        raise ValueError("One or more selected exercises were not found")

    session = WorkoutSession(
        user_id=user_id,
        name=data.name,
        started_at=datetime.now(timezone.utc),
        status=WorkoutSessionStatus.ACTIVE,
        notes=data.notes,
    )
    db.add(session)
    await db.flush()

    ex_by_id = {ex.id: ex for ex in exercises}
    for i, ex_id in enumerate(data.exercise_ids):
        ex = ex_by_id[ex_id]
        exercise = WorkoutSessionExercise(
            session_id=session.id,
            name=ex.name,
            order=i,
            notes=f"{ex.muscle_group} / {ex.equipment}{' | ' + (ex.description or '') if ex.description else ''}",
        )
        db.add(exercise)
        await db.flush()
        for set_num in range(1, data.default_sets + 1):
            db.add(
                WorkoutSet(
                    exercise_id=exercise.id,
                    set_number=set_num,
                    reps=data.default_reps,
                    rest_seconds=data.default_rest_seconds,
                )
            )

    await db.commit()
    await db.refresh(session)
    return session


async def quick_start_workout(
    db: AsyncSession,
    user_id: int,
    goal: str,
) -> WorkoutSession:
    """Create a workout session from catalog exercises for a given goal.

    Goal presets:
      - strength:   compound lifts, 1 per major muscle group, 3x5
      - hypertrophy: compound lifts + isolation accessories, 3x10
      - endurance:  compound lifts + abs, 2x15
    """
    settings = WORKOUT_GOAL_SETTINGS.get(goal, WORKOUT_GOAL_SETTINGS["hypertrophy"])

    selected: List[ExerciseCatalog] = []
    for group in MAJOR_MUSCLE_GROUPS:
        result = await db.execute(
            select(ExerciseCatalog)
            .where(
                ExerciseCatalog.muscle_group == group,
                ExerciseCatalog.is_compound.is_(True),
            )
            .order_by(ExerciseCatalog.name)
            .limit(1)
        )
        ex = result.scalar_one_or_none()
        if ex:
            selected.append(ex)

    if goal in ("hypertrophy", "endurance"):
        for group in ("biceps", "triceps", "abs"):
            result = await db.execute(
                select(ExerciseCatalog)
                .where(
                    ExerciseCatalog.muscle_group == group,
                    ExerciseCatalog.is_compound.is_(False),
                )
                .order_by(ExerciseCatalog.name)
                .limit(1)
            )
            ex = result.scalar_one_or_none()
            if ex:
                selected.append(ex)

    if not selected:
        raise ValueError("Exercise catalog is empty")

    default_sets = settings["default_sets"]
    default_reps = settings["default_reps"]
    default_rest = settings["default_rest_seconds"]

    session = WorkoutSession(
        user_id=user_id,
        name=f"Quick-start: {goal.title()} Workout",
        started_at=datetime.now(timezone.utc),
        status=WorkoutSessionStatus.ACTIVE,
    )
    db.add(session)
    await db.flush()

    for i, ex in enumerate(selected):
        exercise = WorkoutSessionExercise(
            session_id=session.id,
            name=ex.name,
            order=i,
            notes=f"{ex.muscle_group} / {ex.equipment} | {default_sets}x{default_reps}",
        )
        db.add(exercise)
        await db.flush()

        for set_num in range(1, default_sets + 1):
            db.add(
                WorkoutSet(
                    exercise_id=exercise.id,
                    set_number=set_num,
                    reps=default_reps,
                    rest_seconds=default_rest,
                )
            )

    await db.commit()
    await db.refresh(session)
    return session


async def get_workout_statistics(
    db: AsyncSession,
    user_id: int,
) -> dict:
    """Get workout statistics for a user"""
    from sqlalchemy import func, extract
    from datetime import datetime, timedelta

    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    year_ago = now - timedelta(days=365)

    # Total workouts
    total_result = await db.execute(
        select(func.count(WorkoutSession.id)).where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
        )
    )
    total_workouts = total_result.scalar() or 0

    # This week
    week_result = await db.execute(
        select(func.count(WorkoutSession.id)).where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSession.completed_at >= week_ago,
        )
    )
    workouts_this_week = week_result.scalar() or 0

    # This month
    month_result = await db.execute(
        select(func.count(WorkoutSession.id)).where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSession.completed_at >= month_ago,
        )
    )
    workouts_this_month = month_result.scalar() or 0

    # Total volume (weight * reps * sets)
    volume_result = await db.execute(
        select(
            func.sum(WorkoutSet.weight_kg * WorkoutSet.reps).label("total_volume"),
            func.count(WorkoutSet.id).label("total_sets"),
            func.sum(WorkoutSession.duration_seconds).label("total_duration"),
        )
        .join(WorkoutSessionExercise, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
        .join(WorkoutSession, WorkoutSessionExercise.session_id == WorkoutSession.id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSet.is_completed == True,
            WorkoutSet.weight_kg.isnot(None),
        )
    )
    volume_data = volume_result.first()
    total_volume_kg = volume_data.total_volume or 0
    total_sets = volume_data.total_sets or 0
    total_duration_seconds = volume_data.total_duration or 0

    # Workouts by muscle group
    muscle_group_result = await db.execute(
        select(
            WorkoutSessionExercise.name,
            func.count(WorkoutSet.id).label("sets_count"),
            func.sum(WorkoutSet.weight_kg * WorkoutSet.reps).label("volume"),
        )
        .join(WorkoutSet, WorkoutSessionExercise.id == WorkoutSet.exercise_id)
        .join(WorkoutSession, WorkoutSessionExercise.session_id == WorkoutSession.id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSet.is_completed == True,
            WorkoutSet.weight_kg.isnot(None),
        )
        .group_by(WorkoutSessionExercise.name)
        .order_by(func.count(WorkoutSet.id).desc())
        .limit(10)
    )
    top_exercises = [
        {
            "name": row.name,
            "sets": row.sets_count,
            "volume_kg": float(row.volume or 0),
        }
        for row in muscle_group_result.all()
    ]

    # Workout streak (consecutive weeks with at least 1 workout)
    streak_result = await db.execute(
        select(
            extract('year', WorkoutSession.completed_at).label('year'),
            extract('week', WorkoutSession.completed_at).label('week'),
        )
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSession.completed_at >= year_ago,
        )
        .group_by('year', 'week')
        .order_by('year', 'week')
    )
    active_weeks = set()
    for row in streak_result.all():
        active_weeks.add((int(row.year), int(row.week)))

    current_streak = 0
    current_year, current_week = now.isocalendar()[0], now.isocalendar()[1]
    while (current_year, current_week) in active_weeks:
        current_streak += 1
        current_week -= 1
        if current_week == 0:
            current_week = 52
            current_year -= 1

    return {
        "total_workouts": total_workouts,
        "workouts_this_week": workouts_this_week,
        "workouts_this_month": workouts_this_month,
        "total_volume_kg": round(total_volume_kg, 1),
        "total_sets": total_sets,
        "total_duration_hours": round(total_duration_seconds / 3600, 1),
        "avg_workout_duration_min": round((total_duration_seconds / 60) / total_workouts, 1) if total_workouts > 0 else 0,
        "current_streak_weeks": current_streak,
        "top_exercises": top_exercises,
    }