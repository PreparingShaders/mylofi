# Plan: Move Daily Summary to Carousel, Workout AI Loading Overlay, AI Analysis Refinements, FOUC Fix, & E2E Tests

## Goal
1. Move the "Daily Summary" card into the horizontal meals carousel as its first item.
2. Adapt the workout AI start loading overlay to use `Camera.showLoadingOverlay` with fitness hints and dynamic waiting.
3. Fix AI analysis refinements (block/hide "Recalculate AI" when completed, enforce backend `is_premium` check with 403).
4. **Fix FOUC (Flash of Unauthenticated Content):** Add an initial splash screen during app initialization so logged-in users don't see a flash of landing/auth before main app render.
5. **Create Test Users Seed & E2E Tests:** Implement `app/db/seed_test_users.py` and `tests/e2e/test_auth_and_navigation.py` using Playwright/pytest.

---

## Architecture & Changes

### 1. Daily Summary Card & Carousel (Implemented)
- **Files:** `static/js/nutrition.js`, `static/js/components.js`, `static/css/styles.css`

### 2. Workout AI Start Loading Overlay (Implemented/Planned)
- **Files:** `static/js/camera.js`, `static/js/workouts.js`

### 3. Workout AI Analysis Refinements (Implemented/Planned)
- **Files:** `app/api/v1/routes.py`, `static/js/workouts.js`

### 4. FOUC Fix (Auth Flash Prevention)
- **File:** `static/index.html`
  - Add `#app-splash` element inside `#app` with a clean splash/spinner background covering the screen on initial paint.
- **File:** `static/js/app.js`
  - In `init()`:
    - Keep splash visible while validating tokens (`validateToken()`).
    - Once initialization and auth check complete successfully (or fallback to landing/auth on failure), hide/remove `#app-splash` and reveal the correct screen (`main` or `landing`).

### 5. Test Users Seed Script (`app/db/seed_test_users.py`)
- **File:** `app/db/seed_test_users.py`
- **Logic:**
  - Connect to DB asynchronously using app session maker.
  - Check if `free_user@mylofi.test` and `premium_user@mylofi.test` exist.
  - Create them with password hash (`Password123!`), setting `is_premium = False` for free user and `is_premium = True` for premium user.

### 6. E2E Test Suite (`tests/e2e/test_auth_and_navigation.py`)
- **File:** `tests/e2e/test_auth_and_navigation.py`
- **Framework:** Playwright (pytest-playwright)
- **Scenarios:**
  1. Test registration flow for a new user.
  2. Test login flow for `free_user@mylofi.test` and `premium_user@mylofi.test`.
  3. Verify no auth flash occurs on page reload when access token is stored in localStorage.
  4. Verify navigation between tabs ("Питание", "Тренировки", "Профиль").

---

## Validation Plan
1. **Automated Checks:**
   - Run linter/type checks (`ruff check .`, pytest) to ensure no regressions.
   - Run seed script (`python app/db/seed_test_users.py`).
   - Run E2E tests (`pytest tests/e2e/test_auth_and_navigation.py`).
2. **Visual & Functional Verification:**
   - Hard reload with valid token shows instant main app via splash screen without landing/auth flash.



