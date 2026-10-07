# Implementation Plan: Fix AI Analysis Trigger and Add Rate Limiting

## Goal
1. **Eliminate Auto-Triggering AI Analysis**: Remove automatic polling and background AI requests upon opening workout history details in `static/js/workouts.js`.
2. **On-Demand Manual Trigger**: Render an explicit "Сформировать ИИ-разбор" (or "Пересчитать ИИ") action button when AI analysis is absent or stored.
3. **Client-Side Anti-Spam / Rate Limiting**: Implement button disabling, spinner loading state, and a strict 30-second cooldown timer per workout ID in `static/js/workouts.js`.
4. **Backend Duplicate Request Guard**: Ensure `analyze_workout_session` returns cached analysis if already generated unless `force=true` is explicitly requested, preventing redundant LLM calls.

---

## Task Breakdown & Implementation Details

### Task 1: Remove Auto-Triggering / Polling in History Detail (`static/js/workouts.js`)
- Inspect `mountAiDetailCard(container, app, sessionId)`.
- Remove the automatic loading skeleton state ("ИИ-тренер формирует разбор...") and the `for (let attempt = 1; attempt <= MAX_AI_POLL_ATTEMPTS; attempt++)` polling loop when `!payload.available`.
- Instead, render a clean card with a manual action button "Сформировать ИИ-разбор" if `!payload.available`, or "Пересчитать ИИ" if already analyzed.

### Task 2: Client-Side Cooldown & Button Lock (`static/js/workouts.js`)
- Track AI generation cooldowns/timestamps per `sessionId` (e.g., using `sessionStorage` or an in-memory Map `aiCooldowns = new Map()`).
- When "Сформировать ИИ-разбор" / "Пересчитать ИИ" is clicked:
  - Check if 30 seconds have passed since last request for this workout. If not, show toast ("Подождите перед повторным запросом").
  - Immediately disable the button (`button.disabled = true`), display loading spinner state.
  - On API response, update card content and manage cooldown.

### Task 3: Backend Duplicate Request Guard (`app/services/ai_workout_service.py`)
- Verify `analyze_workout_session` checks `stored = load_stored_analysis(session)` and returns cached verdict when `not force`.
- Ensure quota checks and duplicate execution guards prevent multiple concurrent LLM requests for the same workout session.

---

## Validation & Testing
1. Open any completed workout from history: verify that no network request to `/ai/workout-summary/...` is polled automatically and no loading skeleton appears.
2. Click "Сформировать ИИ-разбор": verify that the API request is fired, button locks, and spinner shows.
3. Rapidly click again: verify that the 30-second cooldown prevents spamming.
