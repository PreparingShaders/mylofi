# Implementation Plan: Tonnage Aggregation, AI vs Manual Workout Flow, and On-Demand AI Analysis

## Goal
1. **Fix Tonnage Calculation (`app/services/workout.py`)**: Ensure `get_filtered_tonnage()` includes all completed workouts regardless of AI analysis status, and correctly computes volume with robust date range filtering for today (`07.10.2026`) and selected periods.
2. **Differentiate "Старт" vs "Старт + AI" (`static/js/workouts.js`)**:
   - "Старт": Sets `use_ai = false`. Completes workout without automatic AI analysis API call.
   - "Старт + AI": Sets `use_ai = true`. Automatically triggers AI analysis upon completion.
3. **Disable Auto-AI & On-Demand History Actions**: Remove automatic background AI analysis requests on session load/open. Provide explicit buttons in workout history ("Раззобрать с ИИ" / "Пересчитать ИИ") so AI API requests occur strictly on user click.

---

## Task Breakdown & Implementation Details

### Task 1: Backend Tonnage Aggregation (`app/services/workout.py`)
- Review SQL/ORM query in `get_filtered_tonnage()`.
- Ensure status check `status == 'completed'` is inclusive of both AI and non-AI completed sessions.
- Fix date range handling to correctly include today's sessions (`00:00:00` to `23:59:59` UTC/local).

### Task 2: Frontend Workflow Split ("Старт" vs "Старт + AI")
- **Manual Mode ("Старт"):**
  - Payload sets `use_ai: false`.
  - On finish, saves session and displays completion summary without invoking AI analysis endpoint.
- **AI Mode ("Старт + AI"):**
  - Payload sets `use_ai: true`.
  - On finish, saves session and triggers `fetchAiWorkoutAnalysis()`.

### Task 3: On-Demand AI Analysis in History
- Remove any automatic AI analysis triggers on history detail render.
- Render explicit action buttons:
  - "Раззобрать с ИИ" (if unanalyzed).
  - "Пересчитать ИИ" (if already analyzed).
- Invoke AI analysis endpoint only when the user explicitly clicks the button.

---

## Validation & Testing
1. Review code changes against existing architecture conventions.
2. Verify that manual workouts complete instantly without network calls to AI endpoints.
3. Verify tonnage stats correctly reflect all completed sessions.
