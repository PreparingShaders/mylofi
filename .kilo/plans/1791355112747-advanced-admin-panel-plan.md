# Comprehensive Implementation Plan: Admin Responsive UI, Profile Role Display, and Workout Duration Fix

## Goal
Implement three key improvements across the codebase:
1. **Admin Dashboard Mobile Responsiveness (`static/js/admin.js`)**: Responsive grids, stacked filter bars, horizontal scrollable tables, and well-padded modals.
2. **Profile Role Display (`static/js/profile.js`)**: Correctly display admin status / role (`admin` vs `user`).
3. **Workout Duration Timer Fix (`static/js/workouts.js`, backend schemas & services)**: Pass accurate client-measured `duration_seconds` to the complete workout endpoint and persist it directly without timestamp offset conflicts.

---

## Task Breakdown & Implementation Details

### Task 1: Admin Dashboard Mobile Adaptation (`static/js/admin.js`)
- **Stats Cards Grid:**
  ```javascript
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
  ```
- **Filters Bar:**
  ```javascript
  <div class="flex flex-col sm:flex-row gap-3 w-full mb-4">
  ```
- **Users Table Container:**
  ```javascript
  <div class="glass rounded-2xl overflow-hidden">
      <div class="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
          <table class="w-full text-sm">...</table>
      </div>
  </div>
  ```
- **Modals:**
  Ensure modal dialogs use `w-full max-w-lg mx-4 p-4 sm:p-6`.

### Task 2: Profile Role Display Fix (`static/js/profile.js`)
- In `render(container, app)`:
  ```javascript
  <p class="text-sm text-surface-600 dark:text-zinc-300">
      <span class="text-surface-500">Роль:</span> ${user.is_admin ? 'admin' : (user.role || 'user')}
  </p>
  ```

### Task 3: Workout Duration Timer Fix (`static/js/workouts.js`, `app/schemas/`, `app/services/workout.py`)
1. **Frontend (`static/js/workouts.js`):**
   - Track elapsed seconds (`timerSeconds` or active workout timer count).
   - When calling finish/complete workout API (`POST /api/v1/workouts/sessions/{sessionId}/complete`), include `{ duration_seconds: timerSeconds }`.
2. **Backend Schema (`app/schemas/workout.py` or routes):**
   - Accept optional `duration_seconds: Optional[int] = None` in the completion request model / endpoint parameters.
3. **Backend Service (`app/services/workout.py`):**
   - In `complete_workout_session`, if `duration_seconds` is provided in the request payload, assign `session.duration_seconds = duration_seconds`. Otherwise fallback to timestamp difference calculation or 0.

---

## Validation & Testing
1. Verify JavaScript syntax (`node --check static/js/admin.js static/js/profile.js static/js/workouts.js`).
2. Run backend tests or FastAPI checks.
