# Plan: AI Synergy Carousel Integration & Layout Restoration

## Goals
1. **Carousel Stability & Mobile Layout:**
   - Ensure the carousel maintains proper snap alignment (`snap-center shrink-0`), fixed width (`min(85vw, 340px)` / `380px`), and smooth swiping on mobile devices (iOS/Android) matching the reference stable geometry.
2. **Carousel Slot Integration ("Итог дня" / "ИИ-Синергия" Tabs):**
   - Inside the first carousel slot, provide a clean header switcher/tabs between **«Итог дня»** and **«ИИ-Синергия»**.
   - Switching to "ИИ-Синергия" displays the AI Synergy widget interface (`14 дней`, `30 дней`, `Кастомный`, launch button, and report) directly inside the slot.
3. **Data Persistence & Rate Limiting:**
   - Persist AI Synergy reports in the backend database (`period_summaries`) upon successful generation.
   - Load the saved report on page load or tab switch so state survives `F5` page reloads.
   - Enforce 7-day rate limiting per period type with clear error notification.
4. **Visual & Design Consistency:**
   - Clean up typography and styles (no `✨` emojis, clean `ии ✦` badges, dark glass surfaces).

---

## Proposed Changes

### 1. Backend & Database (`app/services/ai_synergy_service.py`, `app/api/v1/routes.py`)
- **Persistence & Retrieval:** Fetch and return existing stored synergy reports from `period_summaries` when requested.
- **7-Day Rate Limiting:** Prevent re-generation within 7 days of the last synergy report for the same period type, returning a descriptive error.

### 2. Frontend Layout & Components (`static/js/nutrition.js`, `static/js/components.js`, `static/css/styles.css`)
- **Carousel & Slot Render:**
  - Render the combined tab card (`ai-synergy-tab-card`) in the first slot of the nutrition carousel.
  - Implement instant tab switching between Daily Summary and AI Synergy views without losing DOM state or breaking swipe gestures.
- **CSS Geometries:** Ensure `.ai-synergy-tab-slot`, `.meal-card-slot`, `.daily-summary-slot`, and carousel wrappers preserve mobile touch targets and width constraints (`min(85vw, 340px)`).

---

## Validation & Verification
1. Run `pytest` to verify backend and rule tests pass.
2. Check Alembic migration status (`alembic current`).
3. Verify mobile carousel swiping and tab toggling between Daily Summary and AI Synergy.
