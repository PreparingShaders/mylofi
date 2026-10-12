# Plan: AI Synergy Carousel Integration, Persistence, and Dynamic Card Growth

## Goals
1. **Carousel Stability & Mobile Layout:**
   - Ensure the carousel maintains proper snap alignment (`snap-center shrink-0`), fixed width (`min(85vw, 340px)` / `380px`), and smooth horizontal swiping on mobile devices.
2. **Carousel Slot Integration ("Итог дня" / "ИИ-Синергия" Tabs):**
   - Inside the first carousel slot, provide clean header switcher/tabs between **«Итог дня»** and **«ИИ-Синергия»**.
   - Switching to "ИИ-Синергия" displays the AI Synergy widget interface inside the slot.
3. **Dynamic Card Height (No Internal Scroll / No Max Height):**
   - **Remove** any rigid `max-height` and internal `overflow-y: auto` from `.ai-synergy__report-body` or widget containers.
   - Allow the AI Synergy card to **grow dynamically in height** based on the generated text volume (verdict and findings), exactly like meal cards in the carousel.
   - Ensure parent carousel wrappers and containers do not clip content vertically (`overflow: visible` or correct flex flow) so the entire page scrolls naturally when a long report is expanded.
4. **Data Persistence & Rate Limiting:**
   - Persist AI Synergy reports in backend database (`period_summaries`) and load them on page load/tab switch.
   - Enforce 7-day rate limiting per period type.

---

## Proposed Changes

### 1. Backend & Database
- **Persistence & Retrieval:** Store and retrieve synergy reports from `period_summaries`.
- **7-Day Rate Limiting:** Enforce cooldown between generations.

### 2. Frontend Layout & CSS (`static/css/styles.css`, `static/js/components.js`, `static/js/nutrition.js`)
- **Report Container (`.ai-synergy__report-body`):**
   - Remove fixed `max-height` and `overflow: hidden` restrictions on expanded state. Let it expand naturally (`max-height: none`, `overflow: visible`).
- **Carousel Flow & Containers:**
   - Ensure `.ai-synergy-tab-card`, `.ai-synergy-tab-slot`, and `.meal-carousel` allow vertical expansion and natural page scrolling (`overflow-y: visible` where appropriate), keeping horizontal snap swiping fully operational.
   - Verify top alignment (`align-self: start`) so top borders remain aligned across carousel items.

---

## Validation & Verification
1. Run `pytest` to verify test suite passes.
2. Verify carousel horizontal swiping and natural vertical page scrolling upon expanding long AI Synergy reports on mobile viewports.
