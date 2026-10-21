# Implementation Plan: Fix `sqlalchemy.exc.MissingGreenlet` in AI Workout Preview & Session Fetching

## Goal
Fix `sqlalchemy.exc.MissingGreenlet` errors occurring in `ai_workout_preview` and `build_workout_preview_and_store` due to un-eagerly loaded relationships (`WorkoutSession.template`, `WorkoutSessionExercise.sets`) being accessed in asynchronous execution contexts (background tasks and route handlers).

## Affected Boundaries & Changes
- **`get_workout_session` (`app/services/workout.py`)**:
  - Update query options to include `.selectinload(WorkoutSession.template)` alongside `.selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets)`.
- **`build_workout_preview_and_store` (`app/services/ai_workout_service.py`)**:
  - Update background task session query to fully eager-load all necessary relationships:
    ```python
    .options(
        selectinload(WorkoutSession.template).selectinload(WorkoutTemplate.exercises),
        selectinload(WorkoutSession.exercises).selectinload(WorkoutSessionExercise.sets),
    )
    ```

## Validation Plan
1. Test AI workout preview endpoint (`POST /api/v1/ai/workout-preview`) with `session_id` on a session started with `with_ai_plan=true`.
2. Verify background task execution of `build_workout_preview_and_store` without `MissingGreenlet` exceptions.
