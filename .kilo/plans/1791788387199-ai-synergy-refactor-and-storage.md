# Plan: Theme Switcher Fix & Auth/Register Modal Refactor

## Goals
1. **Fix Theme Switcher Chip:**
   - Modify the CSS and/or JS to ensure the active theme chip has an appropriate background color (e.g., `bg-zinc-800` in dark mode, white in light mode) and that icons remain readable.
2. **Refactor Auth/Register to Modals:**
   - Move Auth (`/login`) and Register (`/register`) flows from full pages into modal overlays (popups).
   - Implement modal logic:
     - Backdrop fading/closing.
     - Close button (`✕`) in top-right.
     - Escape key listener to close modal.
     - Smooth opening from "Войти" and "Создать дневник" buttons without page reload/navigation.
   - Reuse the existing `#modals` host pattern observed in the codebase for modal rendering.

---

## Proposed Changes

### 1. Theme Switcher CSS (`static/css/styles.css`)
- Update `.landing-theme-btn.is-active` (or equivalent class applied by `set-theme`) styles to ensure proper contrast in both `light` and `dark` themes.

### 2. Auth Modal Implementation (`static/js/app.js` or a new auth-modal component)
- **Modal Logic:** Use the shared `#modals` pattern: create a fixed overlay div, add click/Esc listeners, and inject the Auth/Register form HTML inside.
- **Trigger:** Update `show-register` / `show-login` (if it exists) actions in `app.js` to trigger modal rendering instead of page navigation.

---

## Validation & Verification
1. Verify theme switcher chip renders correctly in both modes.
2. Verify Auth/Register modals open, close (backdrop, Escape, close button), and function correctly without full page reloads.
