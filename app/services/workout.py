from datetime import datetime
from typing import Optional, List
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    WorkoutTemplate,
    WorkoutTemplateExercise,
    WorkoutSession,
    WorkoutSessionExercise,
    WorkoutSet,
    WorkoutSessionStatus,
)
from app.schemas import (
    WorkoutTemplateCreate,
    WorkoutTemplateUpdate,
    WorkoutTemplateExerciseCreate,
    WorkoutSessionCreate,
    WorkoutSessionUpdate,
    WorkoutSessionExerciseCreate,
    WorkoutSetCreate,
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

    template.updated_at = datetime.utcnow()
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
                                        workout_set.completed_at = datetime.utcnow()
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

    session.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(session)
    return session


async def complete_workout_session(db: AsyncSession, session_id: int, user_id: int) -> Optional[WorkoutSession]:
    """Mark a workout session as completed"""
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    session.status = WorkoutSessionStatus.COMPLETED
    session.completed_at = datetime.utcnow()
    if session.started_at:
        session.duration_seconds = int((session.completed_at - session.started_at).total_seconds())
    session.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(session)
    return session


async def cancel_workout_session(db: AsyncSession, session_id: int, user_id: int) -> Optional[WorkoutSession]:
    """Cancel a workout session"""
    session = await get_workout_session(db, session_id, user_id)
    if not session:
        return None

    session.status = WorkoutSessionStatus.CANCELLED
    session.completed_at = datetime.utcnow()
    if session.started_at:
        session.duration_seconds = int((session.completed_at - session.started_at).total_seconds())
    session.updated_at = datetime.utcnow()

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
    is_completed: bool,
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

    if is_completed and not workout_set.is_completed:
        workout_set.completed_at = datetime.utcnow()
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