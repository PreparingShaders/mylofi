# Plan: AI Synergy Modal Final Polish (Deduplication, Scoring, and Finding Colors)

## Goals
1. **Remove Verdict Duplication:**
   - Eliminate redundant rendering of the verdict headline inside the modal report card so it appears exactly once.
2. **Calibrate AI Scoring Formula & Prompt:**
   - Update the LLM prompt in `ai_synergy_service.py` to strictly penalize severe calorie deficits, macro imbalances, and insufficient protein shortfalls (yielding scores in the `2–4 / 10` range), reserving `8–10` exclusively for balanced nutrition and training execution.
3. **Semantic Color Coding & Icons for Key Findings:**
   - Implement classification or heuristic detection for key findings to dynamically assign semantic styles:
     - 🔴 **Risks / Deficits / Errors:** Rose (`text-rose-400`, `bg-rose-500/10`) with cross/warning icon.
     - 🟢 **Successes / Positives:** Emerald (`text-emerald-400`, `bg-emerald-500/10`) with checkmark icon.
     - 🟡 **Warnings / Advisories:** Amber (`text-amber-400`, `bg-amber-500/10`) with warning icon.

---

## Proposed Changes

### 1. Backend AI Prompt (`app/services/ai_synergy_service.py`)
- Refine prompt instructions: explicitly mandate strict scoring guidelines (e.g. extreme deficits or severe protein misses must score ≤ 4).

### 2. Frontend Components (`static/js/components.js`)
- **Modal Report Render (`aiSynergyModal` / `aiSynergyResultCard`):**
  - Remove duplicate verdict text rendering.
  - Add helper function `renderFindingItem(text)` that inspects text content or categorizes findings to apply appropriate emerald, rose, or amber icon and badge styling.

---

## Validation & Verification
1. Run `pytest` to verify test suite.
2. Check score range calculation and visual rendering of findings in the AI Synergy modal report.
