# Plan: AI Synergy UI/UX Polish, Scoring Correction, and Layout Alignment

## Goals
1. **Scroll Stability & Tab Height Sync ("Итог дня" vs "ИИ-Синергия"):**
   - Ensure switching tabs inside the first carousel slot does not cause container jumps or shift neighboring slides.
   - Both tab states dynamically adjust height to content while retaining top alignment (`align-items: flex-start` / `align-self: start`).
2. **AI Scoring & Prompt Calibration:**
   - Fix scoring logic/prompt where severe calorie deficits or macro imbalances resulted in incorrect 10/10 scores.
   - Ensure the score correctly reflects actual diet/training balance and quality (e.g., lower scores like 2/10 or 3/10 for critical deficits or imbalances).
3. **Responsive Header & Typography:**
   - Remove truncation (`truncate` / `whitespace-nowrap`) from the AI Synergy header title.
   - Shorten title to **«ИИ-Синергия»** and place the subtitle *Питание и тренировки* underneath in smaller text, avoiding mobile clipping.
4. **Color-Coded Key Findings (Success / Critical / Warning):**
   - Style key findings, risks, and growth points with distinct semantic color badges/markers:
     - 🟢 Emerald (`text-emerald-400`, `bg-emerald-500/10`) for positive factors and successes.
     - 🔴 Rose (`text-rose-400`, `bg-rose-500/10`) for critical errors, deficits, and risks.
     - 🟡 Amber (`text-amber-400`, `bg-amber-500/10`) for warnings and recommendations.
5. **Persona & Theme Application:**
   - Verify that the user's selected AI persona and theme settings are correctly passed and rendered in synergy reports.

---

## Proposed Changes

### 1. Backend Prompt & Scoring (`app/services/ai_synergy_service.py`)
- **Scoring Instructions:** Update prompt instructions to penalize severe calorie deficits, protein shortfalls, or training imbalances down to low scores (1–4 range), reserving 8–10 only for genuinely balanced execution.

### 2. Frontend Components & Styles (`static/js/components.js`, `static/css/styles.css`)
- **Header & Layout:**
  - Update `aiSynergyWidget` title to **«ИИ-Синергия»** and subtitle to *Питание и тренировки*.
  - Ensure `.ai-synergy-tab-card` and `.ai-synergy-tab-slot` maintain strict top alignment and smooth tab switching without height jitter.
- **Finding Indicators:**
  - Render color-coded bullet/badge styles for findings (emerald for successes, rose for risks, amber for warnings).

---

## Validation & Verification
1. Run `pytest` to ensure test suite passes.
2. Verify visual rendering, scoring correctness, and mobile responsiveness.
