# Plan: Move Daily Summary to Carousel, Workout AI Loading Overlay, & AI Analysis Refinements

## Goal
1. Move the "Daily Summary" card into the horizontal meals carousel as its first item, with proper styling, initial focus on the "Add Meal" card, and rate-limited regeneration protection.
2. Adapt the workout AI start loading overlay when clicking "+ Старт + ИИ" in `static/js/workouts.js` using `Camera.showLoadingOverlay`, `Camera.markLoadingComplete`, and `Camera.hideLoadingOverlay`, replacing the fixed 3-second timer with dynamic async/await waiting until session creation and AI plan loading complete.
3. Fix 3 issues in completed workout AI analysis:
   - Block/hide the "Recalculate AI" button if the analysis is already completed (`available: true`), showing toast `"Анализ тренировки уже сохранён."`.
   - Protect workout AI generation on backend (`app/api/v1/routes.py`) by checking `user.is_premium` (returning `403 Forbidden` if false), and on frontend checking user tier before calling AI analysis.
   - Add specialized fitness loading hints (`workoutHints`) in `Camera` and use them for the workout AI loading overlay.

---

## Architecture & Changes

### 1. Daily Summary Card & Carousel (Implemented)
- **Files:** `static/js/nutrition.js`, `static/js/components.js`, `static/css/styles.css`
- **Summary:** Summary card in day view carousel, initial focus on `.meal-action-slot`, rate-limited refresh protection.

### 2. Workout AI Start Loading Overlay (`static/js/workouts.js`, `static/js/camera.js`)
- **Files:** `static/js/camera.js`, `static/js/workouts.js`
- **Changes:**
  - Add `workoutHints` array to `Camera` in `camera.js`:
    ```javascript
    workoutHints: [
        'Считаем суммарный тоннаж и рабочий объём...',
        'Оцениваем время отдыха между подходами...',
        'Анализируем прогресс в базовых упражнениях...',
        'Формируем рекомендации по восстановлению мышц...',
    ]
    ```
  - Update `Camera.showLoadingOverlay(container, hints = this.loadingHints)` to support custom hints.
  - In `startTemplateWithAi` & `startQuickWorkoutWithAi` (`workouts.js`), replace countdown with `Camera.showLoadingOverlay(document.body, Camera.workoutHints)`, set hint to `"ИИ подбирает веса и подходы..."`, await API post and `loadAiPlan`, then complete with green checkmark (`markLoadingComplete`), pause 500ms, hide overlay, and transition to active session.

### 3. Workout AI Analysis Refinements (Backend & Frontend)
- **Backend (`app/api/v1/routes.py`):**
  - In `@router.post("/ai/workout-summary/{workout_id}")`, check `if not current_user.is_premium:` -> raise `HTTPException(status_code=403, detail="Анализ тренировок ИИ доступен только по подписке Premium")`.
- **Frontend (`static/js/workouts.js`):**
  - In `mountAiDetailCard` / `aiWorkoutCard` handling:
    - If `payload?.available === true` (analysis already completed), hide or disable the "Пересчитать ИИ" button, or when clicked, show Toast `"Анализ тренировки уже сохранён."` without making an API request.
  - Check `app.state.user?.is_premium` before invoking `analyzeWorkout()` or starting AI workouts, showing Toast / subscription notice if Free tier.

---

## Validation Plan
1. **Automated Checks:**
   - Run linter/type checks (`ruff check .`, pytest) to ensure no regressions.
2. **Visual & Functional Verification:**
   - Verify workout AI start overlay shows fitness hints and waits dynamically for AI plan generation.
   - Verify completed workout AI analysis blocks recalculation/re-analysis and shows `"Анализ тренировки уже сохранён."`.
   - Verify backend enforces `is_premium` check with 403 for Free tier users.



