# Plan: AI Synergy Modal Final UI/UX Bug Fixes

## Goals
1. **Simplified Findings Indicators:**
   - Replace complex SVG vector icons in `renderFindingItem` with clean, minimalist colored indicator dots/markers matching their tone (`emerald` for success, `amber` for warning, `rose` for risk).
2. **Recalculate Button Styling & Cleanup:**
   - Remove broken emoji/symbol artifacts from the "Пересчитать" button.
   - Align its styling with the "Закрыть" button (dark background `bg-zinc-900`/`bg-zinc-800`, thin `border-zinc-700`, high-contrast clean text).
3. **Modal Header Responsiveness:**
   - Fix title truncation on narrow screens ("ИИ-Синергия (Питание + Спорт)") by using `flex-wrap` or wrapping the subtitle on a second line with smaller font size.

---

## Proposed Changes (`static/js/components.js`, `static/css/styles.css`)
- **Findings Markers:** Update `renderFindingItem` in `components.js` to render clean colored dots/badges.
- **Footer Buttons:** Clean up recalculate button markup and match profile/close button styling.
- **Modal Header:** Refactor modal header layout for mobile wrapping.

---

## Validation & Verification
1. Run `pytest` to verify test suite passes.
2. Verify visual rendering of modal header, findings dots, and footer buttons on narrow viewports.
