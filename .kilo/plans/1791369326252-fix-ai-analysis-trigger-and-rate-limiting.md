# Implementation Plan: Exact AI CSS Styling and Quick Start Modal Redesign

## Goal
1. **Eliminate Auto-Triggering AI Analysis**: Remove automatic polling and background AI requests upon opening workout history details in `static/js/workouts.js`.
2. **On-Demand Manual Trigger & Rate Limiting**: Implement explicit manual buttons with 30-second cooldown / button lock.
3. **Exact AI CSS Styling**: Standardize all AI elements (`nutrition-ring__score`, "ВЕРДИКТ НУТРИЦИОЛОГА", workout AI score tags) using exact DevTools inspector classes:
   - Text color: `text-purple-600 dark:text-purple-300`
   - Background & border: `bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30`
   - Prefix: `✦ ИИ`
4. **Redesign "Быстрый старт" Modal Layout (`static/js/workouts.js`)**:
   - Fix broken button sizing by removing restrictive `w-10 h-10` from `data-goal-ai`.
   - Use clean, spacious card layout for each goal (Сила, Набор массы, Выносливость) with side-by-side "Старт" and "✦ Старт + ИИ" buttons (`px-3.5 py-2 text-xs font-semibold whitespace-nowrap rounded-xl`).

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

### Task 4: Exact AI CSS Style Match (`static/js/components.js` & `static/js/nutrition.js`)
- Update `nutrition-ring__score`, nutrition verdict badge, and workout AI score tags with:
  `bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-300 font-medium` and `✦ ИИ` formatting.

### Task 5: Quick Start Modal Layout Redesign (`static/js/workouts.js`)
- Replace quick start goal cards and buttons with clean, flex-based spacious layout featuring separate "Старт" and "✦ Старт + ИИ" action buttons without fixed-size constraints.

---

## Validation & Testing
1. Verify no auto-polling or loading skeletons on history detail open.
2. Verify manual trigger fires correctly with 30s cooldown protection.
3. Verify all AI badges across nutrition and workouts match exact purple styling and `✦ ИИ` prefix.
4. Verify Quick Start modal renders cleanly with correctly proportioned buttons.
