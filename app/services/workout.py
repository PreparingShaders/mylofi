from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict
from sqlalchemy import select, func, or_, and_
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
from app.services.exercise_data import EXERCISE_SEED
from app.schemas import (
    WorkoutTemplateCreate,
    WorkoutTemplateUpdate,
    WorkoutSessionCreate,
    WorkoutSessionUpdate,
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
    return await get_workout_template(db, template.id, user_id)


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
    return await get_workout_template(db, template.id, user_id)


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
                rest_time_seconds=set_data.rest_time_seconds,
            )
            db.add(workout_set)

    await db.commit()
    return await get_workout_session(db, session.id, user_id)


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
                    if exercise_data.name is not None:
                        exercise.name = exercise_data.name
                    if exercise_data.order is not None:
                        exercise.order = exercise_data.order
                    if exercise_data.notes is not None:
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
                                    workout_set.rest_time_seconds = set_data.rest_time_seconds
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
                                    rest_time_seconds=set_data.rest_time_seconds,
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
                        rest_time_seconds=set_data.rest_time_seconds,
                    )
                    db.add(workout_set)

    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_workout_session(db, session.id, user_id)


async def complete_workout_session(
    db: AsyncSession,
    session_id: int,
    user_id: int,
    duration_seconds: Optional[int] = None,
) -> Optional[WorkoutSession]:
    """Mark a workout session as completed.

    If the client provides `duration_seconds`, it is used directly. Otherwise
    the duration is derived from the started_at / completed_at timestamps so
    older clients and offline replays still get a sensible value.
    """
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    session.status = WorkoutSessionStatus.COMPLETED
    completed_at = datetime.now(timezone.utc)
    session.completed_at = completed_at
    if duration_seconds is not None:
        session.duration_seconds = max(0, duration_seconds)
    else:
        session.duration_seconds = resolve_duration_seconds(session.started_at, completed_at)
    session.updated_at = datetime.now(timezone.utc)

    await db.commit()
    return await get_workout_session(db, session.id, user_id)


async def cancel_workout_session(db: AsyncSession, session_id: int, user_id: int) -> Optional[WorkoutSession]:
    """Cancel a workout session"""
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    session.status = WorkoutSessionStatus.CANCELLED
    completed_at = datetime.now(timezone.utc)
    session.completed_at = completed_at
    session.duration_seconds = resolve_duration_seconds(session.started_at, completed_at)
    session.updated_at = datetime.now(timezone.utc)

    await db.commit()
    return await get_workout_session(db, session.id, user_id)


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
    rest_time_seconds: Optional[int] = None,
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
            # Undoing the check means the set was not performed, so any break
            # measured after it belongs to a set that does not exist yet.
            workout_set.rest_time_seconds = None
        workout_set.is_completed = is_completed
    if weight_kg is not None:
        workout_set.weight_kg = weight_kg
    if reps is not None:
        workout_set.reps = reps
    if rpe is not None:
        workout_set.rpe = rpe
    # Applied after the completion branch so an explicit measurement is never
    # dropped by the clear above; the client writes it on its own patch.
    if rest_time_seconds is not None:
        workout_set.rest_time_seconds = rest_time_seconds

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
        past_sets = await get_last_exercise_sets(db, user_id, ex.name)
        target_sets = data.default_sets
        if past_sets:
            for ps in past_sets[:target_sets]:
                db.add(
                    WorkoutSet(
                        exercise_id=exercise.id,
                        set_number=ps.set_number,
                        reps=ps.reps,
                        weight_kg=ps.weight_kg,
                        rest_seconds=data.default_rest_seconds,
                    )
                )
        start_num = (past_sets[-1].set_number + 1) if past_sets else 1
        remaining = target_sets - len(past_sets) if past_sets else target_sets
        for set_num in range(start_num, start_num + remaining):
            db.add(
                WorkoutSet(
                    exercise_id=exercise.id,
                    set_number=set_num,
                    reps=data.default_reps,
                    weight_kg=0.0,
                    rest_seconds=data.default_rest_seconds,
                )
            )

    await db.commit()
    return await get_workout_session(db, session.id, user_id)


async def select_quick_start_exercises(db: AsyncSession, goal: str, reduce: bool = False) -> List[ExerciseCatalog]:
    """The catalog picks a quick start is built from, for a goal.

    Shared with the AI preview: the plan has to talk about the movements the
    quick start will really create, not a guess at them, or the badges would
    describe a different workout than the one on screen.

    `reduce` asks for the lighter half of the catalogue picks - the strength
    variant, which keeps the compound lifts and drops the accessories. It is
    the same selection the coach is asked to trim, so the plan and the session
    agree on what "shorter" means.
    """
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

    if not reduce and goal in ("hypertrophy", "endurance"):
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

    return selected


async def quick_start_workout(
    db: AsyncSession,
    user_id: int,
    goal: str,
    *,
    reduce: bool = False,
) -> WorkoutSession:
    """Create a workout session from catalog exercises for a given goal.

    Goal presets:
      - strength:   compound lifts, 1 per major muscle group, 3x5
      - hypertrophy: compound lifts + isolation accessories, 3x10
      - endurance:  compound lifts + abs, 2x15

    `reduce` asks for the lighter half of the catalogue picks (the strength
    variant), which keeps the compound lifts and drops the accessories. It is
    the same selection the coach is asked to trim, so the plan and the session
    agree on what "shorter" means.
    """
    settings = WORKOUT_GOAL_SETTINGS.get(goal, WORKOUT_GOAL_SETTINGS["hypertrophy"])

    selected = await select_quick_start_exercises(db, goal, reduce=reduce)

    if not selected:
        raise ValueError("Exercise catalog is empty")

    default_sets = settings["default_sets"]
    default_reps = settings["default_reps"]
    default_rest = settings["default_rest_seconds"]

    session = WorkoutSession(
        user_id=user_id,
        name=f"Quick-start: {goal.title()} Workout" + (" (reduced)" if reduce else ""),
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

        past_sets = await get_last_exercise_sets(db, user_id, ex.name)
        target_sets = default_sets
        if past_sets:
            for ps in past_sets[:target_sets]:
                db.add(
                    WorkoutSet(
                        exercise_id=exercise.id,
                        set_number=ps.set_number,
                        reps=ps.reps,
                        weight_kg=ps.weight_kg,
                        rest_seconds=default_rest,
                    )
                )
        start_num = (past_sets[-1].set_number + 1) if past_sets else 1
        remaining = target_sets - len(past_sets) if past_sets else target_sets
        for set_num in range(start_num, start_num + remaining):
            db.add(
                WorkoutSet(
                    exercise_id=exercise.id,
                    set_number=set_num,
                    reps=default_reps,
                    weight_kg=0.0,
                    rest_seconds=default_rest,
                )
            )

    await db.commit()
    return await get_workout_session(db, session.id, user_id)


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


# ===== Tonnage =====
# None means "no lower bound" for the `all` preset, which is bounded by the
# earliest session instead of a fixed number of days.
TONNAGE_PERIOD_DAYS = {"week": 7, "month": 30, "all": None}
# Day buckets stay readable for the 7/30 day presets; a multi-year "all time"
# range would otherwise produce thousands of unusable bars.
TONNAGE_BUCKET = {"week": "day", "month": "day", "all": "month"}
MONTH_LABELS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]


def as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Make a datetime timezone-aware in UTC; the DB driver may return naive values."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def resolve_duration_seconds(started_at: Optional[datetime], completed_at: Optional[datetime]) -> int:
    """How long a session took, in seconds, never negative.

    `started_at` reaches the database from a client clock while `completed_at` is
    the server's, so a session opened with a local wall clock and closed in UTC
    comes back as an inverted interval - that is how a 177-minute workout was
    stored as -177 minutes and shown back to the user as such. Both stamps are
    normalised to UTC first, and the magnitude is taken, so a mismatched offset
    costs the verdict its sign but not its length. A missing stamp has no
    duration to report, so it reads as 0.
    """
    start = as_utc(started_at)
    end = as_utc(completed_at)
    if start is None or end is None:
        return 0
    return abs(int((end - start).total_seconds()))


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO-8601 date or datetime, returning None for unusable input."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    # A bare YYYY-MM-DD parses as midnight naive; treat it as UTC so date
    # filters coming from the browser do not shift by the client offset.
    return as_utc(parsed)


def month_start(value: datetime) -> datetime:
    return value.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def resolve_tonnage_range(
    period: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> tuple[datetime, datetime]:
    """Resolve the effective [start, end] window for a tonnage query.

    An explicit range always wins over the `period` preset so the bottom sheet
    overrides can narrow or widen the window the inline tabs selected. When only
    one bound is explicit the other is filled in from the preset, so a lone
    end date keeps the week/month/all window it was paired with instead of
    silently starting at the first of the current month.
    """
    now = datetime.now(timezone.utc)
    explicit_start = parse_iso_datetime(start_date)
    explicit_end = parse_iso_datetime(end_date)

    if explicit_start and explicit_end:
        start, end = explicit_start, explicit_end
        if end <= start:
            end = start + timedelta(days=1)
        return start, end

    if period == "month":
        preset_start = month_start(now)
    elif period == "all":
        preset_start = datetime(1970, 1, 1, tzinfo=timezone.utc)
    else:
        preset_start = now - timedelta(days=7)

    if explicit_start:
        start = explicit_start
        end = explicit_end or now
    elif explicit_end:
        start = preset_start
        end = explicit_end
    else:
        start, end = preset_start, now

    if end <= start:
        end = start + timedelta(days=1)
    return start, end


def build_tonnage_buckets(start: datetime, end: datetime, granularity: str) -> List[dict]:
    """Build a dense, zero-filled bucket list covering [start, end]."""
    buckets: List[dict] = []
    if granularity == "month":
        year, month = start.year, start.month
        last_year, last_month = end.year, end.month
        while (year, month) <= (last_year, last_month):
            cursor = datetime(year, month, 1, tzinfo=timezone.utc)
            buckets.append(
                {
                    "key": cursor.strftime("%Y-%m"),
                    "label": f"{MONTH_LABELS[month - 1]} {year}",
                    "start": cursor,
                    "tonnage_kg": 0.0,
                    "sets_count": 0,
                    "workouts": 0,
                }
            )
            month += 1
            if month > 12:
                month = 1
                year += 1
        return buckets

    cursor = start.replace(hour=0, minute=0, second=0, microsecond=0)
    last = end.replace(hour=0, minute=0, second=0, microsecond=0)
    while cursor <= last:
        buckets.append(
            {
                "key": cursor.strftime("%Y-%m-%d"),
                "label": f"{cursor.day} {MONTH_LABELS[cursor.month - 1]}",
                "start": cursor,
                "tonnage_kg": 0.0,
                "sets_count": 0,
                "workouts": 0,
            }
        )
        cursor += timedelta(days=1)
    return buckets


async def get_filtered_tonnage(
    db: AsyncSession,
    user_id: int,
    period: Optional[str] = "week",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    muscle_group: Optional[str] = None,
    exercise_name: Optional[str] = None,
    template_id: Optional[int] = None,
) -> dict:
    """Aggregate exact tonnage (weight_kg * reps) over completed sets.

    Supports the inline period presets as well as the bottom sheet filters
    (date range, muscle group, exercise, template). The comparison window is
    the immediately preceding span of equal length, so the UI can show a delta.
    """
    start, end = resolve_tonnage_range(period, start_date, end_date)
    unbounded = (period or "week") == "all" and not start_date and not end_date

    query = (
        select(
            WorkoutSession.id.label("session_id"),
            WorkoutSession.name.label("name"),
            WorkoutSession.completed_at.label("completed_at"),
            WorkoutSession.started_at.label("started_at"),
            func.coalesce(func.sum(WorkoutSet.weight_kg * WorkoutSet.reps), 0).label("tonnage"),
            func.count(WorkoutSet.id).label("sets_count"),
        )
        .select_from(WorkoutSession)
        .join(WorkoutSessionExercise, WorkoutSessionExercise.session_id == WorkoutSession.id)
        .join(WorkoutSet, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSet.is_completed.is_(True),
            WorkoutSet.weight_kg.isnot(None),
            WorkoutSet.reps.isnot(None),
        )
        .group_by(WorkoutSession.id)
    )

    if exercise_name:
        # Substring match so the filter behaves like the catalog search box;
        # LIKE wildcards inside the user input are escaped to stay literal.
        needle = exercise_name.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(WorkoutSessionExercise.name.ilike(f"%{needle}%"))
    if template_id:
        query = query.where(WorkoutSession.template_id == template_id)
    if muscle_group:
        # Session exercises are free-text names, so the muscle group is only
        # resolvable through the catalog (global entry or the user's own).
        query = query.join(
            ExerciseCatalog,
            and_(
                func.lower(ExerciseCatalog.name) == func.lower(WorkoutSessionExercise.name),
                or_(ExerciseCatalog.user_id.is_(None), ExerciseCatalog.user_id == user_id),
            ),
        ).where(ExerciseCatalog.muscle_group == muscle_group)

    result = await db.execute(query)

    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[Tonnage Debug] Query executed for user_id={user_id}, period={period}, start_date={start_date}, end_date={end_date}, muscle_group={muscle_group}, exercise_name={exercise_name}, template_id={template_id}")

    session_rows: List[dict] = []
    for tonnage_row in result.all():
        stamp = as_utc(tonnage_row.completed_at) or as_utc(tonnage_row.started_at)
        if stamp is None:
            continue
        session_rows.append(
            {
                "session_id": tonnage_row.session_id,
                "name": tonnage_row.name,
                "timestamp": stamp,
                "tonnage": float(tonnage_row.tonnage or 0),
                "sets_count": int(tonnage_row.sets_count or 0),
            }
        )

    logger.info(f"[Tonnage Debug] Found {len(session_rows)} completed sessions, total_tonnage will be calculated from these")

    # `all` starts at the epoch so no data is missed; pull it back to the
    # earliest session so the chart does not open with decades of empty bars.
    if unbounded and session_rows:
        start = month_start(min(entry["timestamp"] for entry in session_rows))
    elif unbounded:
        start = month_start(end)

    window_seconds = max(1.0, (end - start).total_seconds())
    previous_start = start - timedelta(seconds=window_seconds)

    total_tonnage = 0.0
    total_sets = 0
    total_workouts = 0
    previous_tonnage = 0.0
    for entry in session_rows:
        if previous_start <= entry["timestamp"] < start:
            previous_tonnage += entry["tonnage"]
        elif start <= entry["timestamp"] <= end:
            total_tonnage += entry["tonnage"]
            total_sets += entry["sets_count"]
            total_workouts += 1

    granularity = TONNAGE_BUCKET.get(period or "week", "day")
    buckets = build_tonnage_buckets(start, end, granularity)
    bucket_index = {bucket["key"]: bucket for bucket in buckets}

    def bucket_key_for(stamp: datetime, granularity_key: str) -> Optional[str]:
        if granularity_key == "month":
            return stamp.strftime("%Y-%m")
        return stamp.strftime("%Y-%m-%d")

    for entry in session_rows:
        if not (start <= entry["timestamp"] <= end):
            continue
        bucket = bucket_index.get(bucket_key_for(entry["timestamp"], granularity))
        if bucket is None:
            continue
        bucket["tonnage_kg"] += entry["tonnage"]
        bucket["sets_count"] += entry["sets_count"]
        bucket["workouts"] += 1

    for bucket in buckets:
        bucket["start"] = bucket["start"].isoformat()
        bucket["tonnage_kg"] = round(bucket["tonnage_kg"], 1)

    delta_kg = total_tonnage - previous_tonnage
    has_previous = previous_tonnage > 0

    return {
        "period": period if period in TONNAGE_PERIOD_DAYS else "week",
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "total_tonnage_kg": round(total_tonnage, 1),
        "workouts_count": total_workouts,
        "sets_count": total_sets,
        "avg_tonnage_kg": round(total_tonnage / total_workouts, 1) if total_workouts else 0.0,
        "previous_total_tonnage_kg": round(previous_tonnage, 1) if has_previous else None,
        "delta_kg": round(delta_kg, 1) if has_previous else None,
        "delta_percent": round((delta_kg / previous_tonnage) * 100, 1) if has_previous else None,
        "granularity": granularity,
        "series": buckets,
        "filters": {
            "start_date": start_date or None,
            "end_date": end_date or None,
            "muscle_group": muscle_group or None,
            "exercise_name": exercise_name or None,
            "template_id": template_id,
        },
    }


def estimate_one_rep_max(weight_kg: Optional[float], reps: Optional[int]) -> float:
    """Epley formula: estimated 1RM from a single set."""
    if not weight_kg or not reps:
        return 0.0
    return weight_kg * (1 + reps / 30)


def _session_tonnage(exercises: List[WorkoutSessionExercise], only_completed: bool = True) -> float:
    total = 0.0
    for exercise in exercises or []:
        for workout_set in exercise.sets or []:
            if only_completed and not workout_set.is_completed:
                continue
            total += (workout_set.weight_kg or 0) * (workout_set.reps or 0)
    return total


def _session_best_set(exercises: List[WorkoutSessionExercise]) -> Optional[dict]:
    best = None
    for exercise in exercises or []:
        for workout_set in exercise.sets or []:
            if not workout_set.is_completed:
                continue
            if not workout_set.weight_kg or not workout_set.reps:
                continue
            if best is None or workout_set.weight_kg > best["weight_kg"]:
                best = {
                    "weight_kg": workout_set.weight_kg,
                    "reps": workout_set.reps,
                    "rpe": workout_set.rpe,
                }
    return best


def build_session_summary_text(detail: dict) -> str:
    """Rule-based workout summary used where no AI provider is configured.

    Mirrors what an LLM prompt would return for this payload, so the history
    view always has a readable narrative to show.
    """
    metrics = detail.get("metrics", {})
    delta = detail.get("delta", {})
    name = detail.get("name") or "Тренировка"
    tonnage = metrics.get("tonnage_kg", 0)
    sets_done = metrics.get("completed_sets", 0)
    sets_total = metrics.get("total_sets", 0)
    duration_min = metrics.get("duration_min", 0)

    if tonnage <= 0 and sets_done == 0:
        return f"«{name}»: выполненных подходов с весом нет — тоннаж не зафиксирован."

    parts = [f"«{name}»: {sets_done} из {sets_total} подходов, тоннаж {round(tonnage)} кг"]

    top = detail.get("top_exercise")
    if top:
        parts.append(f"основная работа — {top['name']} ({round(top['tonnage_kg'])} кг)")

    best = detail.get("best_set")
    if best:
        parts.append(f"лучший подход {best['weight_kg']}×{best['reps']}")

    if duration_min:
        parts.append(f"время {round(duration_min)} мин")

    delta_percent = delta.get("percent")
    if delta_percent is not None:
        direction = "выше" if delta_percent >= 0 else "ниже"
        parts.append(f"тоннаж на {abs(delta_percent)}% {direction} прошлой тренировки")

    completion = metrics.get("completion_percent", 0)
    if completion < 100:
        parts.append(f"выполнено {completion}% плана")

    return ", ".join(parts) + "."


async def get_workout_session_detail(
    db: AsyncSession,
    user_id: int,
    session_id: int,
) -> Optional[dict]:
    """Detailed history payload for a single workout session.

    Includes summary metrics, the tonnage delta against the previous session,
    a generated summary, and per-exercise tonnage / estimated-1RM trend lines
    built from the most recent completed sessions.
    """
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    exercises = sorted(session.exercises or [], key=lambda ex: (ex.order or 0, ex.id))
    metrics = {"tonnage_kg": 0.0, "total_sets": 0, "completed_sets": 0, "exercises_count": len(exercises)}
    for exercise in exercises:
        for workout_set in exercise.sets or []:
            metrics["total_sets"] += 1
            if not workout_set.is_completed:
                continue
            metrics["completed_sets"] += 1
            metrics["tonnage_kg"] += (workout_set.weight_kg or 0) * (workout_set.reps or 0)
    metrics["completion_percent"] = (
        round((metrics["completed_sets"] / metrics["total_sets"]) * 100) if metrics["total_sets"] else 0
    )
    metrics["tonnage_kg"] = round(metrics["tonnage_kg"], 1)
    # A session closed before durations were normalised can still hold a negative
    # value, and the history card prints this figure as it is.
    duration_seconds = abs(session.duration_seconds or 0)
    metrics["duration_seconds"] = duration_seconds
    metrics["duration_min"] = round(duration_seconds / 60, 1) if duration_seconds else 0

    completed_sessions_result = await db.execute(
        select(WorkoutSession.id, WorkoutSession.name, WorkoutSession.started_at, WorkoutSession.completed_at)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
        )
        .order_by(WorkoutSession.started_at.desc())
        .limit(20)
    )
    history_rows = [
        {
            "id": row.id,
            "name": row.name,
            "timestamp": as_utc(row.completed_at) or as_utc(row.started_at),
        }
        for row in completed_sessions_result.all()
    ]
    history_ids = [row["id"] for row in history_rows]

    # The trend window is the N most recent sessions, so opening an old session
    # would otherwise leave its own point out of its trend lines.
    if session.id not in history_ids:
        own_timestamp = as_utc(session.completed_at) or as_utc(session.started_at)
        history_rows.append({"id": session.id, "name": session.name, "timestamp": own_timestamp})
        history_ids.append(session.id)

    # One query for every exercise/set of the recent sessions, then group in
    # Python: cheaper and more predictable than a query per exercise.
    per_session: dict[int, Dict[str, dict]] = {}
    if history_ids:
        trend_result = await db.execute(
            select(
                WorkoutSessionExercise.session_id.label("session_id"),
                WorkoutSessionExercise.name.label("name"),
                func.coalesce(func.sum(WorkoutSet.weight_kg * WorkoutSet.reps), 0).label("tonnage"),
                func.max(WorkoutSet.weight_kg * (1 + WorkoutSet.reps / 30.0)).label("e1rm"),
            )
            .select_from(WorkoutSessionExercise)
            .join(WorkoutSet, WorkoutSet.exercise_id == WorkoutSessionExercise.id)
            .where(
                WorkoutSessionExercise.session_id.in_(history_ids),
                WorkoutSet.is_completed.is_(True),
                WorkoutSet.weight_kg.isnot(None),
                WorkoutSet.reps.isnot(None),
            )
            .group_by(WorkoutSessionExercise.session_id, WorkoutSessionExercise.name)
        )
        for trend_row in trend_result.all():
            trend_key = (trend_row.name or "").strip().lower()
            if not trend_key:
                continue
            per_session.setdefault(trend_row.session_id, {})[trend_key] = {
                "tonnage_kg": float(trend_row.tonnage or 0),
                "e1rm": float(trend_row.e1rm or 0),
            }

    history_chronological: List[dict] = sorted(
        (entry for entry in history_rows if entry["timestamp"] is not None),
        key=lambda entry: entry["timestamp"],
    )

    def session_metrics_for(session_id_value: int) -> dict:
        """Tonnage, sets count and session name for one history entry."""
        for entry in history_chronological:
            if entry["id"] == session_id_value:
                entries = per_session.get(session_id_value, {})
                return {
                    "name": entry["name"],
                    "timestamp": entry["timestamp"],
                    "tonnage_kg": round(sum(item["tonnage_kg"] for item in entries.values()), 1),
                }
        return {"name": None, "timestamp": None, "tonnage_kg": 0.0}

    current_tonnage = metrics["tonnage_kg"]

    # The previous session is the one immediately before this one in
    # chronological order; the oldest session in the window has none.
    previous_entry: Optional[dict] = None
    for index, entry in enumerate(history_chronological):
        if entry["id"] == session.id:
            if index > 0:
                previous_entry = history_chronological[index - 1]
            break

    previous_tonnage = None
    delta_percent = None
    if previous_entry:
        previous_tonnage = session_metrics_for(previous_entry["id"])["tonnage_kg"]
        if previous_tonnage > 0:
            delta_percent = round(((current_tonnage - previous_tonnage) / previous_tonnage) * 100, 1)

    exercise_details: List[dict] = []
    for exercise in exercises:
        exercise_key = (exercise.name or "").strip().lower()
        tonnage = 0.0
        completed = 0
        total = 0
        best_e1rm = 0.0
        volume_reps = 0
        for workout_set in exercise.sets or []:
            total += 1
            if not workout_set.is_completed:
                continue
            completed += 1
            tonnage += (workout_set.weight_kg or 0) * (workout_set.reps or 0)
            volume_reps += workout_set.reps or 0
            best_e1rm = max(best_e1rm, estimate_one_rep_max(workout_set.weight_kg, workout_set.reps))

        tonnage_series = []
        e1rm_series = []
        for history_entry in history_chronological:
            exercise_entry = per_session.get(history_entry["id"], {}).get(exercise_key)
            if not exercise_entry:
                continue
            tonnage_series.append({"session_id": history_entry["id"], "value": round(exercise_entry["tonnage_kg"], 1)})
            e1rm_series.append({"session_id": history_entry["id"], "value": round(exercise_entry["e1rm"], 1)})

        exercise_details.append(
            {
                "id": exercise.id,
                "name": exercise.name,
                "notes": exercise.notes,
                "total_sets": total,
                "completed_sets": completed,
                "reps": volume_reps,
                "tonnage_kg": round(tonnage, 1),
                "best_e1rm": round(best_e1rm, 1),
                "best_set": _session_best_set([exercise]),
                "sets": [
                    {
                        "set_number": workout_set.set_number,
                        "weight_kg": workout_set.weight_kg,
                        "reps": workout_set.reps,
                        "rpe": workout_set.rpe,
                        "is_completed": workout_set.is_completed,
                        "rest_seconds": workout_set.rest_seconds,
                        "rest_time_seconds": workout_set.rest_time_seconds,
                    }
                    for workout_set in sorted(exercise.sets or [], key=lambda s: s.set_number)
                ],
                "tonnage_series": tonnage_series,
                "e1rm_series": e1rm_series,
            }
        )

    top_exercise: Optional[dict] = None
    if exercise_details:
        top_exercise = max(exercise_details, key=lambda item: float(item["tonnage_kg"]))

    started_at_utc = as_utc(session.started_at)
    completed_at_utc = as_utc(session.completed_at)

    detail = {
        "id": session.id,
        "name": session.name,
        "status": session.status.value if hasattr(session.status, "value") else session.status,
        "template_id": session.template_id,
        "notes": session.notes,
        "started_at": started_at_utc.isoformat() if started_at_utc else None,
        "completed_at": completed_at_utc.isoformat() if completed_at_utc else None,
        "metrics": metrics,
        "delta": {
            "previous_session_id": previous_entry["id"] if previous_entry else None,
            "previous_session_name": previous_entry["name"] if previous_entry else None,
            "previous_tonnage_kg": previous_tonnage,
            "tonnage_kg": round(current_tonnage - previous_tonnage, 1) if previous_tonnage is not None else None,
            "percent": delta_percent,
        },
        "best_set": _session_best_set(exercises),
        "top_exercise": top_exercise,
        "exercises": exercise_details,
    }
    detail["summary"] = build_session_summary_text(detail)
    return detail


async def get_last_exercise_sets(db: AsyncSession, user_id: int, exercise_name: str) -> Optional[List[WorkoutSet]]:
    """Get sets of the last completed workout session containing the given exercise with weights"""
    print(f"[DEBUG] get_last_exercise_sets called for user_id={user_id}, exercise_name='{exercise_name}'")
    subq_results = await db.execute(
        select(WorkoutSessionExercise.session_id)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSessionExercise.session_id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.status == WorkoutSessionStatus.COMPLETED,
            WorkoutSessionExercise.name.ilike(exercise_name.strip()),
        )
        .order_by(WorkoutSession.started_at.desc())
    )
    session_ids = [row[0] for row in subq_results.all()]
    print(f"[DEBUG] Found completed session_ids for exercise '{exercise_name}': {session_ids}")

    if not session_ids:
        return []

    # Fetch sessions in order of started_at desc
    for s_id in session_ids:
        res = await db.execute(
            select(WorkoutSession)
            .where(WorkoutSession.id == s_id)
            .options(selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets))
        )
        session = res.scalar_one_or_none()
        if session:
            for ex in session.exercises:
                if ex.name.strip().lower() == exercise_name.strip().lower():
                    sets = sorted(ex.sets, key=lambda s: s.set_number)
                    weights = [s.weight_kg for s in sets]
                    print(f"[DEBUG] Session {s_id} exercise '{ex.name}' weights: {weights}")
                    if any(s.weight_kg is not None and s.weight_kg > 0 for s in sets):
                        return sets

    # Fallback to the first session found if none have weights > 0
    res = await db.execute(
        select(WorkoutSession)
        .where(WorkoutSession.id == session_ids[0])
        .options(selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets))
    )
    session = res.scalar_one_or_none()
    if session:
        for ex in session.exercises:
            if ex.name.strip().lower() == exercise_name.strip().lower():
                return sorted(ex.sets, key=lambda s: s.set_number)

    return []