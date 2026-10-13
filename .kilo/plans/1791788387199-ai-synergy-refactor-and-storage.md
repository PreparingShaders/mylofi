# Plan: AI Synergy Widget Final DOM Layout Redesign

## Goals
1. **Header Redesign (`.ai-synergy__head`):**
   - Remove the `ии` badge icon on the left.
   - Keep title text `ИИ-Синергия`.
   - Remove subtitle `Питание и тренировки`.
   - Add score badge on the right using `daily-summary__score` classes (`<span class="daily-summary__score ..."><span class="opacity-60">✦ ИИ</span> ${scoreFormatted} <span class="opacity-60">/10</span></span>`).
2. **Body Redesign (`.ai-synergy__body`):**
   - Remove old score box (`ai-synergy__score-box`).
   - Allow verdict/error text to take full width.
3. **Action Button:**
   - Remove `👀` icon/emoji. Keep clean text **«Посмотреть отчёт»** (or «Запустить анализ»).
4. **Backend Scoring Validation:**
   - Verify backend `_synergy_score_ceiling` implementation correctly caps scores under severe calorie/protein deficits.

---

## Proposed Changes (`static/js/components.js`)
- Update `aiSynergyWidget` method to match the precise DOM structure requested.

---

## Validation & Verification
1. Run `pytest` to verify tests.
2. Check browser rendering of `aiSynergyWidget` in the carousel.
