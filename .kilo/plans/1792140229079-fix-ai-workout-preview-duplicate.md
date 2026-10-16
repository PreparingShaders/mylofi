# Plan: Fix AI Workout Preview Duplicate Requests, Polling Stale State, and Background Task Sessions

## Goal
Audit and debug the AI workout preview generation and background task flow to eliminate duplicate model calls, fix the polling timeout issue where finished background tasks were not recognized, and ensure robust session handling and debug logging.

## Root Cause Diagnosis
1. **Stale Session State in Polling (`wait_for_stored_ai_plan`)**:
   - When `wait_for_stored_ai_plan` polls `get_workout_session(db, session_id, user_id)` inside the `while` loop using the same request `db` session, SQLAlchemy's identity map returns the cached Python `WorkoutSession` object instance. Because this cached instance was first loaded when status was `PENDING` and `ai_plan_json` was `None`, subsequent queries return the stale cached object without reflecting updates committed by the background task. Consequently, polling times out or falsely proceeds to re-trigger model generation.
2. **Background Task Session Lifecycle**:
   - Passing the request-scoped `db` session to background tasks (`background_tasks.add_task(build_workout_preview_and_store, db, ...)`) risks session closure/conflict upon request completion. Background tasks should instantiate their own session via `async_session_maker()`.

## Detailed Implementation Steps

1. **Fix Polling Stale State in `wait_for_stored_ai_plan` (`app/services/ai_workout_service.py`)**:
   - Inside `wait_for_stored_ai_plan`, ensure each polling iteration either expires/refreshes the session object (`await db.refresh(session)` or `db.expire(session)` or executing a fresh query / using a dedicated session reader) so that newly committed database values from the background task are correctly fetched.

2. **Isolate Background Task Database Session**:
   - Update background task registration in `app/api/v1/routes.py` (for template start and quick start) and `build_workout_preview_and_store` to open a fresh session via `async_session_maker()` rather than sharing the request-scoped `db` session.

3. **Add Comprehensive Debug Logging**:
   - Add structured log statements across:
     - Background task start, successful plan storage, and failure handling (including `session_id` and `ai_plan_status`).
     - Each iteration of `wait_for_stored_ai_plan` showing current `ai_plan_status` and whether a stored plan was found.
     - `_get_ai_preview_lock` acquisition and release for concurrent requests.

4. **Frontend Double-Click & Re-entry Protection**:
   - Ensure UI trigger buttons (`[data-action="start-template-ai"]`, `[data-goal-ai]`) use guard flags and `disabled = true` to prevent double submissions.

## Validation Plan
- Verify via unit tests and logs that a background-generated plan is correctly picked up by `wait_for_stored_ai_plan` within milliseconds without triggering a duplicate model call.
- Verify that timeout/failure paths fall back gracefully without raising unhandled exceptions.
