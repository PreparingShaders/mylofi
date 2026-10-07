# Implementation Plan: AI Features Refinement, Styling Standardization, and Rate Limiting

## Goal
1. **Eliminate Auto-Triggering AI Analysis**: Remove automatic polling and background AI requests upon opening workout history details in `static/js/workouts.js`.
2. **On-Demand Manual Trigger & Rate Limiting**: Implement explicit manual buttons with 30-second cooldown / button lock.
3. **Unified AI Styling System**: Standardize all AI badges, scores, and buttons across the app using Tailwind classes (`bg-purple-950/60 text-purple-300 border border-purple-500/40 hover:bg-purple-900/80 transition-all font-medium`) with `✦ ИИ` / `✦ Старт + ИИ`.
4. **Enhanced Quick Start AI Generation**: Pass user profile context (`weight`, `goal`, history) in Quick Start AI generation (`static/js/workouts.js` & Backend) to select 3-4 optimal exercises at 70-80% of last 1RM.

---

## Task Breakdown & Implementation Details

### Task 1: Remove Auto-Triggering / Polling in History Detail (`static/js/workouts.js`)
- Remove automatic loading skeleton and `MAX_AI_POLL_ATTEMPTS` polling loop when `!payload.available`.
- Render manual action buttons ("Сформировать ИИ-разбор" / "Пересчитать ИИ").

### Task 2: Client-Side Cooldown & Button Lock (`static/js/workouts.js`)
- Track cooldowns (30s) per workout ID to prevent spamming AI requests.
- Lock button and display loading spinner immediately upon click.

### Task 3: Backend Duplicate Request Guard (`app/services/ai_workout_service.py`)
- Ensure `analyze_workout_session` returns cached analysis unless `force=true`.

### Task 4: Unified AI Styling System (`static/js/nutrition.js` & `static/js/workouts.js`)
- Meal Cards (`static/js/nutrition.js`): Update "ВЕРДИКТ НУТРИЦИОЛОГА" badge to use `✦ ИИ 5/10` formatting with unified purple AI badge classes.
- Workout Template & Quick Start Modals (`static/js/workouts.js`): Replace "Старт + AI" buttons with `✦ Старт + ИИ` using the standardized Tailwind classes (`bg-purple-950/70 text-purple-200 border border-purple-500/40 hover:bg-purple-900/80 text-xs font-semibold flex items-center gap-1.5`).

### Task 5: Enhance Quick Start AI Generation Payload (`static/js/workouts.js` & Backend)
- In `startQuickWorkoutWithAi` / quick start modal handler, pass user profile context (`weight`, `goal`, recent performance/fatigue history).
- Update backend quick-start prompt / service to instruct the AI to select 3-4 optimal exercises with personalized weights (70-80% of last 1RM).

---

## Validation & Testing
1. Verify no auto-polling or loading skeletons on history detail open.
2. Verify manual trigger fires correctly with 30s cooldown protection.
3. Verify meal cards and workout template/quick start buttons use consistent `✦ ИИ` styling.
4. Verify Quick Start with AI generates personalized exercises with appropriate weights.
