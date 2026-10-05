# Comprehensive Workout AI Analysis, Duration, UI/UX, and Rest Timer Plan

## Overview
This plan outlines all necessary backend and frontend changes for the MyLofi workout system:
1. **Duration Bug Fix**: Absolute time difference and UTC normalization (`-177 min` fix).
2. **Progressive Overload Guard**: Prevent weight increases when reps drop below target range.
3. **Report Specificity**: Rich historical context and strict ban on abstract/metaphorical language.
4. **Unified UI/UX (Mobile & Desktop)**: Consistent card display, desktop AI tip visibility, and 12–15 word limit on exercise tips.
5. **Top AI Comment Removal**: Remove the top AI motivator block under the progress bar.
6. **Push Notification / Start Overlay**: Ensure push notifications render above the blurred start overlay (`z-index` adjustment).
7. **"Finish & Analyze with AI" Modal UX**: Loading state, spinner, text ("ИИ анализирует тренировку..."), smooth fade-in/scale-up animation, and consistent design.
8. **Rest Timer & Data Schema**: `rest_time_seconds` column in `WorkoutSet`, automatic rest timer on set completion, and target rest time tracking (`target_rest_seconds`).

---

## Detailed Task Breakdown

### 1. Negative Workout Duration Bug Fix (`app/services/workout.py`)
- Normalize `started_at` and `completed_at` to UTC via `as_utc()`.
- Wrap duration calculation in `abs()` to prevent negative durations if timestamps drift.
- Update SQL aggregation in `ai_workout_service.py` to ensure non-negative duration epochs.

### 2. Progressive Overload Guard (`app/services/ai_workout_service.py`)
- Update AI summary and preview prompts with a strict rule: do not recommend weight increases if reps dropped below target range; recommend consolidating weight and hitting target reps instead.

### 3. Report Specificity & Historical Context (`app/services/ai_workout_service.py`)
- Pass past 2–3 workouts' weight × reps history into prompt context.
- Add strict prompt ban against abstract/poetic metaphors ("созерцание тренажера", "виток Вселенной") in favor of strict sports metrics (tonnage, intensity, progression).

### 4. Unified UI/UX for Mobile & Desktop (`static/js/workouts.js`, CSS)
- Ensure exercise carousel and cards render consistently across viewports (`max-w-[500px]` or responsive grid).
- Verify AI tip (`aiWorkoutPlanBadge`) visibility on desktop viewports.
- Restrict AI tips/focus sentences to a concise 12–15 word limit.

### 5. Removal of Top AI Comment (`static/js/workouts.js`)
- Remove `${this.renderAiPlanNote()}` from the header section right below the workout progress bar.

### 6. Push Notification & Start Overlay Fix (`static/js/workouts.js`, CSS)
- Elevate toast / push notification container `z-index` above the blur overlay (`backdrop-blur` / start countdown overlay).

### 7. "Finish & Analyze with AI" UX (`static/js/workouts.js`, CSS)
- On click of "Завершить и разобрать с ИИ": disable button, show spinner loader and "ИИ анализирует тренировку..." text.
- Implement smooth fade-in / scale-up modal animation with app-consistent styling.

### 8. Rest Timer between Sets + Data Schema (`app/models/__init__.py`, `static/js/workouts.js`, DB migration)
- **Database & Schemas**: Add `rest_time_seconds: Optional[int]` to `WorkoutSet` model and schema. Create Alembic migration.
- **Frontend**: 
  - Trigger rest timer when a set is completed (`is_completed = true`).
  - Display timer in `MM:SS` format within the exercise card or bottom floating bar.
  - Reset and record actual rest duration when the next set is checked or interacted with.
  - Compare against `target_rest_seconds` (default 90–120s) for visual threshold indicators.

---

## Validation Plan
1. **Unit Tests**:
   - Verify duration calculation with aware/naive timestamps.
   - Test rest time persistence and AI prompt guard assertions.
2. **Linting & Type Checking**:
   - Run `ruff check .` for Python changes.
