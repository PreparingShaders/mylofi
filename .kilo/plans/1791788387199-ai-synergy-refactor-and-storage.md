# Plan: Auth Modal Post-Login Redirect & Theme Switcher Fix

## Goals
1. **Fix Post-Login / Post-Register Redirect:**
   - Ensure that when `handleLogin` or `handleRegister` successfully completes in `auth.js`, the auth modal closes and the app transitions cleanly to the dashboard via `app.showScreen('main')` and `app.showPage('nutrition')`.
   - Prevent any race conditions between modal closing animation and screen transition.
2. **Fix Theme Switcher Chip Contrast:**
   - Ensure active theme chip background and text/icon contrast work correctly in both light and dark modes (avoiding glaring white backgrounds in dark mode).

---

## Proposed Changes (`static/js/auth.js`, `static/js/app.js`, `static/css/styles.css`)
- **`auth.js` / `app.js`:** Ensure screen navigation (`showScreen('main')`, `showPage('nutrition')`) executes reliably after closing the auth modal.
- **`styles.css`:** Refine theme switcher active chip background classes for dark mode.

---

## Validation & Verification
1. Run `pytest` to verify test suite.
2. Test auth modal login/register flow and verify transition to the main application interface.
