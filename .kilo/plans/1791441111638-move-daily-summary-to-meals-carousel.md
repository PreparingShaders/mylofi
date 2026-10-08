# Plan: Move Daily Summary Card to Meals Carousel & Workout AI Loading Overlay

## Goal
1. Move the "Daily Summary" card into the horizontal meals carousel as its first item, with proper styling, initial focus on the "Add Meal" card, and rate-limited regeneration protection.
2. Adapt the workout AI start loading overlay when clicking "+ Старт + ИИ" in `static/js/workouts.js` by reusing `Camera.showLoadingOverlay`, `Camera.markLoadingComplete`, and `Camera.hideLoadingOverlay`, replacing the fixed 3-second timer with dynamic async/await waiting until the API and AI plan generation complete.

---

## Architecture & Changes

### 1. Daily Summary Card & Carousel (Already Implemented)
- **Files:** `static/js/nutrition.js`, `static/js/components.js`, `static/css/styles.css`
- **Summary of changes:** Removed separate vertical summary block, embedded summary card in day view carousel as first item, set initial scroll focus on `.meal-action-slot` (`instant`), and added rate-limit cooldown check on refresh click.

### 2. Workout AI Start Loading Overlay (`static/js/workouts.js`)
- **File:** `static/js/workouts.js`
- **Import:** Import `Camera` from `./camera.js`.
- **Changes in `startTemplateWithAi` & `startQuickWorkoutWithAi`:**
  - Replace `this.renderCountdown(...)` with `const overlayState = Camera.showLoadingOverlay(document.body);`.
  - Update loading hint text element `#camera-loading-hint` to `"ИИ подбирает веса и подходы..."`.
  - Await API session creation and AI plan loading (`loadAiPlan`).
  - Upon successful completion:
    1. Call `Camera.markLoadingComplete(overlayState)`.
    2. Await 500ms delay (`new Promise(r => setTimeout(r, 500))`).
    3. Call `Camera.hideLoadingOverlay(overlayState)`.
    4. Transition to active workout screen (`renderWorkoutScreen`).
  - In `catch` block:
    - Ensure `Camera.hideLoadingOverlay(overlayState)` is called.
    - Display error toast and re-render workouts screen.

---

## Validation Plan
1. **Automated Checks:**
   - Run linter/type checks (`ruff check .`, pytest) to ensure no regressions.
2. **Visual & Functional Verification:**
   - Verify day view: Daily summary card in carousel, initial focus on "Add Meal" card.
   - Verify workout "+ Старт + ИИ": Shows loading overlay with spinner and hint "ИИ подбирает веса и подходы...", waits dynamically for server/AI response, shows green checkmark on completion, pauses 500ms, hides overlay, and transitions to active workout screen.


