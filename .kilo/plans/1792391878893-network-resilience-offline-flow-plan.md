# Implementation Plan: Workout Management Fixes (AI Advice Persistence, Cancellation Cleanup, & Session Deletion)

## Goal
Fix three critical workout management bugs in MyLofi:
1. **AI Workout Advice Persistence**: Cache AI-generated feedback and tips locally (IndexedDB/localStorage) during workout sessions so they persist across reconnections, backgrounding, and screen locks.
2. **Proper Cancellation Cleanup**: Update session cancellation (`cancel_workout_session` / history queries) to perform a hard delete or strictly filter out cancelled sessions from history and statistics to eliminate zombie entries.
3. **Workout Deletion from History**: Implement a backend `DELETE /api/v1/workouts/sessions/{session_id}` endpoint and a frontend UI delete button with confirmation modal in `workouts.js` to allow users to remove completed workout sessions.

## Affected Boundaries & Changes
- **AI Advice Persistence (`static/js/workouts.js`)**:
  - Save received AI feedback/tips to local storage/IndexedDB tied to the session ID.
  - Re-hydrate AI tips state upon view re-render, reconnection, or app resume from background.
- **Session Cancellation & History Filtering (`app/services/workout.py`, `app/api/v1/routes.py`)**:
  - Update `cancel_workout_session` to perform a cascade delete of the session and its exercises/sets (or filter `status != 'cancelled'` in `get_workout_history`, statistics, and tonnage).
- **Session Deletion Endpoint & UI (`app/services/workout.py`, `app/api/v1/routes.py`, `static/js/workouts.js`)**:
  - Add DELETE endpoint for completed sessions.
  - Add delete button and confirmation modal in the workout history detail/list views in `workouts.js`.

## Validation Plan
1. Test AI advice persistence across simulated app backgrounding and reconnection.
2. Test session cancellation: verify cancelled sessions do not leave zombie entries in history.
3. Test history session deletion: verify completed sessions and their sets are successfully removed and statistics update correctly.
