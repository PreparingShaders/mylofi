# Plan: AI Synergy Carousel Integration & Data Persistence

## Goals
1. **Carousel Slot Integration:**
   - Remove the separate bottom block for AI Synergy.
   - Inside the first carousel slot (housing "Итог дня"), introduce a card-header mode toggle/tabs: **«Итог дня» / «ИИ-Синергия»**.
   - Selecting "ИИ-Синергия" switches the card view smoothly to the synergy interface (`14 дней`, `30 дней`, `Кастомный`, launch button, and report).
2. **Data Persistence & Recovery:**
   - On page load or switching to the AI Synergy tab, fetch the latest saved report from the backend so state survives page reloads (`F5`).
3. **Backend & Database Storage:**
   - Persist synergy reports upon successful generation into database (`period_summaries` or dedicated storage).
   - Implement 7-day rate limiting per period type with clear error messages.
4. **Styling Consistency:**
   - Remove `✨` emojis, use clean `ии ✦` purple badges, dark glass surfaces, and strict styling matching "Итог дня".

---

## Proposed Changes

### 1. Backend & Database
- **Storage (`PeriodSummary` / DB):**
  - Store generated synergy results tied to user, period type, and date range.
  - Return existing report on fetch requests if available.
- **Rate Limiting (7 Days):**
  - Reject generation if last analysis for the period type was created less than 7 days ago, returning a clear error message with the available date.

### 2. Frontend (`static/js/nutrition.js` & `static/js/components.js`)
- **Carousel Slot & Tabs:**
  - Update `renderNutritionSlide` or container rendering in `nutrition.js` to embed the AI Synergy view inside the first slot via a tab switch (`daily` vs `synergy`).
- **Persistence State:**
  - Load cached/stored synergy report from backend on initialization.
- **Component Redesign:**
  - Clean up styles, remove emojis, ensure pixel-perfect alignment with the "Итог дня" card aesthetics.

---

## Validation & Verification
1. Run `pytest` to verify test suite passes.
2. Check Alembic migration status.
3. Validate persistence after F5 and tab switching.
