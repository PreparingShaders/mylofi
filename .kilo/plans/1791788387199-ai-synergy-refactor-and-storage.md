# Plan: AI Synergy Modal Footer Buttons Final Polish

## Goals
1. **Compact Footer Button Sizing:**
   - Reduce height and vertical padding (`py-2` or smaller) for modal footer buttons ("Закрыть" and "Пересчитать") to make them sleek, compact, and balanced.
2. **"Пересчитать" Button Text Cleanup:**
   - Remove any icons, arrows, or emojis from the "Пересчитать" button, leaving pure text.
   - Ensure both buttons have identical compact sizing, rounded corners, and clean styling matching Profile page aesthetics.

---

## Proposed Changes (`static/js/components.js`, `static/css/styles.css`)
- Update modal footer button classes in `aiSynergyModal` to use compact padding (`py-2 px-4 text-xs` or similar) and clean text markup.

---

## Validation & Verification
1. Run `pytest` to verify test suite passes.
2. Verify visual rendering of modal footer buttons.
