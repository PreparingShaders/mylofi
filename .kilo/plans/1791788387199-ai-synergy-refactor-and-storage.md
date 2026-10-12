# Plan: AI Synergy Widget Refactoring, 7-Day Rate Limiting, and History Storage

## Goals
1. **Layout & Grid Structure:** Remove AI Synergy widget from carousel slides (restoring 3 elements in carousel) and place it strictly under the "Итог дня" card in the left column with matching width and padding.
2. **UI Design & Styling:** Align AI Synergy card with "Итог дня" styling (remove `✨` emojis, use clean `ии ✦` purple badges, dark glass surfaces, thin borders, muted gradient buttons).
3. **Backend Storage & Rate Limiting:**
   - Enforce a 7-day rate limit per period type (week/month). If requested earlier, return a clear error: *«С момента последнего анализа прошло меньше 7 дней. Новый анализ станет доступен [Дата]»*.
   - Separate storage by period type (`week`, `month`, etc.).
   - Persist history without overwriting previous analyses.
4. **Migration & DB Consistency:** Ensure Alembic migration graph is linear and `PeriodSummary` / synergy tables support the required history storage.

---

## Proposed Changes

### 1. Backend & Database
- **Model (`PeriodSummary` / Synergy Storage):**
  - Adjust table constraints (e.g., relax or update `uq_period_summaries_user_range` if necessary) to allow multiple entries over time per period type while ensuring fast lookups of the latest report and maintaining full history.
  - Store serialized JSON or structured columns for synergy verdict payload, metrics snapshot, and period type.
- **Service & Rate Limiting (`run_ai_synergy`):**
  - Check the latest synergy record for the user and requested `period_type`.
  - Calculate `time_diff = now - latest_record.created_at`.
  - If `time_diff < timedelta(days=7)`, raise `HTTPException(400, detail=...)` specifying the exact date when the next analysis becomes available (`latest_record.created_at + timedelta(days=7)`).
  - On successful run, persist the new result to DB instead of overwriting.

### 2. Frontend Layout & Components (`static/js/nutrition.js` & `static/js/components.js`)
- **Carousel:**
  - Remove `aiSynergyWidgetSlot` from the carousel slide render logic in `static/js/nutrition.js`.
- **Left Column Placement:**
  - Render the AI Synergy widget in the container section directly below the `.daily-summary` card.
- **Component Styling (`aiSynergyWidget` & `aiSynergyReport`):**
  - Remove all `✨` emojis from headers, subtitles, and buttons.
  - Update badge to clean `ии ✦` pill matching "Итог дня".
  - Apply standard glassmorphism classes (`glass rounded-3xl p-4`), consistent border radii, font sizes, and button styles.

---

## Validation & Verification
1. Run `pytest` to ensure all existing test suites pass successfully.
2. Verify Alembic migration status with `python -m alembic current` and history graph via `python -m alembic history`.
3. Test 7-day rate-limiting rule with unit/integration checks or API calls.
