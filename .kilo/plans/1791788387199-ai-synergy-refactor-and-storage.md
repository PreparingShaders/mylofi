# Plan: AI Synergy Modal Implementation & Carousel Slot Geometry Fix

## Goals
1. **Fix Daily Summary & Carousel Slot Drift:**
   - Ensure the first carousel slot (`.ai-synergy-tab-slot` / `.daily-summary-slot`) remains rigidly fixed in the carousel layout (`snap-center shrink-0`, `align-items: flex-start`), preventing any horizontal/diagonal floating or shifting during user interactions or tab switches.
2. **Compact AI Synergy Widget in Carousel:**
   - The widget inside the carousel slot must display only:
     - Header & period switcher (`14 дней`, `30 дней`, `Кастомный`)
     - Status / overall score (e.g. `8.8 / 10`)
     - Short verdict snippet / headline
     - Prominent button **«Открыть полный отчет»** (`data-action="open-ai-synergy-modal"`)
   - **No long report text or scrolling sheet** inside the carousel slot.
3. **Full-Screen Modal Report for AI Synergy:**
   - Clicking "Открыть полный отчет" opens a full-screen responsive modal dialog / overlay.
   - The modal contains the full breakdown: detailed verdict, metrics snapshot, color-coded key findings (emerald for successes, rose for risks, amber for warnings), and nutrition/workout adjustments.

---

## Proposed Changes

### 1. CSS & Layout (`static/css/styles.css`)
- **Carousel Slot Stability:** Ensure `.ai-synergy-tab-card`, `.ai-synergy-tab-slot`, and `.daily-summary-slot` have strict flex sizing, `align-self: start`, and fixed width (`min(85vw, 340px)` / `380px`), with no unintended transform/margin drifts.
- **Modal Overlay:** Add clean full-screen modal styling for `.ai-synergy-modal` with smooth backdrop blur, vertical scrolling inside the modal body, and a sticky close button.

### 2. Frontend Components (`static/js/components.js`, `static/js/nutrition.js`)
- **Compact Widget Render (`aiSynergyWidget`):**
  - Streamline card markup to omit the inline report body in the carousel view, keeping it strictly to controls, status, score, and the "Открыть полный отчет" trigger button.
- **Modal Render (`aiSynergyModal`):**
  - Create template function `aiSynergyModal(result)` that formats findings with color-coded badges (`emerald`, `rose`, `amber`) and displays the full report.
- **Event Binding (`nutrition.js`):**
  - Bind click action `open-ai-synergy-modal` to open the modal and `close-ai-synergy-modal` / backdrop click to close it.

---

## Validation & Verification
1. Run `pytest` to ensure test suite passes.
2. Verify carousel stability (no drifting) and correct modal popup behavior for AI Synergy reports.
