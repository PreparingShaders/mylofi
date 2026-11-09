# Redesign Workouts Tab: Simplify Quick Start to Free-Form Workout

## Goal
Replace the "Quick Start" modal (goal-based preset generator: Strength 3×5, Hypertrophy 3×10, Endurance 2×15) with a direct "Free-form Workout" flow:
- Single "Start Workout" button → opens empty active session ("Blank Slate")
- User adds exercises on-the-fly during workout
- On completion, offer to save as new template (appears in "My Workouts")

## Current Architecture (to be modified)

### Files Involved
- `static/js/workouts.js` - Main workout logic (render, quick start, session creation, templates)
- `static/js/app.js` - App-level completion handler with template update prompt

### Key Functions to Modify/Remove
| Function | Lines | Action |
|----------|-------|--------|
| `showQuickStartModal` | 5239-5315 | **REMOVE** - goal selection modal |
| `startQuickWorkout` | 5317-5338 | **REMOVE** - API call to `/workouts/sessions/quick-start` |
| `startQuickWorkoutWithAi` | (not found, likely in same area) | **REMOVE** |
| `render` (dashboard) | 1105-1309 | **MODIFY** - replace Quick Start card with "Start Workout" button |
| `buildLocalSessionFromTemplate` | 861-901 | **REFERENCE** - pattern for empty session creation |
| `promptTemplateUpdateIfNeeded` | 2819-2866 | **EXTEND** - add "Save as new template" for non-template sessions |
| `renderWorkoutScreen` | 3273-3322 | **FIX** - allow empty exercises for local free-form sessions |

---

## Implementation Plan

### 1. Add Empty Local Session Creation ✅ (Already implemented)
**File**: `static/js/workouts.js` - `buildEmptyLocalSession()` at line 902

### 2. Add "Start Empty Workout" Handler ✅ (Already implemented)
**File**: `static/js/workouts.js` - `startEmptyWorkout()` at line 5171

### 3. **CRITICAL FIX: Allow Empty Exercises in renderWorkoutScreen**
**File**: `static/js/workouts.js` - In `renderWorkoutScreen()` method (~lines 3273-3322)

**Problem**: The validation at lines 3273-3322 blocks rendering when `session.exercises` is empty, showing "Ошибка: в тренировке нет упражнений". This prevents free-form workouts from opening.

**Fix**: Allow empty exercises for local sessions (`isLocal === true`) that don't have a `template_id`. These are free-form "blank slate" workouts where user adds exercises on the fly.

**Change from (lines 3273-3322):**
```javascript
// CRITICAL FIX: Ensure session has exercises — recover from template or
// local session when the server returns an active session without them.
if (!session.exercises || session.exercises.length === 0) {
    console.warn('[Workouts] Session has no exercises, attempting recovery...');

    // Try to get exercises from local session if this is a local session
    if (this.isLocalSession(session)) {
        const localSession = this.getActiveLocalSession();
        if (localSession && localSession.exercises && localSession.exercises.length > 0) {
            session.exercises = localSession.exercises;
        }
    }

    // If still no exercises and session has template_id, load from template
    if ((!session.exercises || session.exercises.length === 0) && session.template_id) {
        try {
            const template = await API.get(`/workouts/templates/${session.template_id}`, app.state.tokens.access);
            if (template && template.exercises && template.exercises.length > 0) {
                session.exercises = template.exercises.map((ex, index) => {
                    const targetSets = Math.max(1, ex.target_sets || 3);
                    return {
                        id: ex.id || `temp-${index}`,
                        name: ex.name,
                        order: ex.order ?? index,
                        target_sets: ex.target_sets || targetSets,
                        target_reps: ex.target_reps || 10,
                        target_weight_kg: ex.target_weight_kg || 0,
                        rest_seconds: ex.rest_seconds || 90,
                        notes: ex.notes ?? null,
                        sets: Array.from({ length: targetSets }, (_, i) => ({
                            id: `temp-set-${index}-${i}`,
                            exercise_id: ex.id || `temp-${index}`,
                            set_number: i + 1,
                            weight_kg: i === 0 ? (ex.target_weight_kg || 0) : 0,
                            reps: ex.target_reps || 10,
                            rest_seconds: ex.rest_seconds || 90,
                            is_completed: false,
                        })),
                    };
                });
            }
        } catch (e) {
            console.warn('[Workouts] Failed to load template exercises:', e);
        }
    }

    // Final fallback — if still empty, show error
    if (!session.exercises || session.exercises.length === 0) {
        app.showToast('Ошибка: в тренировке нет упражнений', 'error');
        return;
    }
}
```

**To (allow empty for free-form local sessions):**
```javascript
// CRITICAL FIX: Ensure session has exercises — recover from template or
// local session when the server returns an active session without them.
// BUT: Allow empty exercises for LOCAL free-form sessions (no template_id)
// where user adds exercises on the fly.
const isFreeFormLocal = this.isLocalSession(session) && !session.template_id;
if ((!session.exercises || session.exercises.length === 0) && !isFreeFormLocal) {
    console.warn('[Workouts] Session has no exercises, attempting recovery...');

    // Try to get exercises from local session if this is a local session
    if (this.isLocalSession(session)) {
        const localSession = this.getActiveLocalSession();
        if (localSession && localSession.exercises && localSession.exercises.length > 0) {
            session.exercises = localSession.exercises;
        }
    }

    // If still no exercises and session has template_id, load from template
    if ((!session.exercises || session.exercises.length === 0) && session.template_id) {
        try {
            const template = await API.get(`/workouts/templates/${session.template_id}`, app.state.tokens.access);
            if (template && template.exercises && template.exercises.length > 0) {
                session.exercises = template.exercises.map((ex, index) => {
                    const targetSets = Math.max(1, ex.target_sets || 3);
                    return {
                        id: ex.id || `temp-${index}`,
                        name: ex.name,
                        order: ex.order ?? index,
                        target_sets: ex.target_sets || targetSets,
                        target_reps: ex.target_reps || 10,
                        target_weight_kg: ex.target_weight_kg || 0,
                        rest_seconds: ex.rest_seconds || 90,
                        notes: ex.notes ?? null,
                        sets: Array.from({ length: targetSets }, (_, i) => ({
                            id: `temp-set-${index}-${i}`,
                            exercise_id: ex.id || `temp-${index}`,
                            set_number: i + 1,
                            weight_kg: i === 0 ? (ex.target_weight_kg || 0) : 0,
                            reps: ex.target_reps || 10,
                            rest_seconds: ex.rest_seconds || 90,
                            is_completed: false,
                        })),
                    };
                });
            }
        } catch (e) {
            console.warn('[Workouts] Failed to load template exercises:', e);
        }
    }

    // Final fallback — if still empty (and not free-form), show error
    if (!session.exercises || session.exercises.length === 0) {
        app.showToast('Ошибка: в тренировке нет упражнений', 'error');
        return;
    }
}

// For free-form local sessions, ensure exercises array exists (empty is OK)
if (isFreeFormLocal && !session.exercises) {
    session.exercises = [];
}
```

### 4. Update Dashboard Render - Replace Quick Start Card
**File**: `static/js/workouts.js` - In `render()` method (~lines 1254-1306)

**Replace the entire "Быстрый старт" section (lines 1254-1306) with:**

```javascript
// Main Action: Start Free-form Workout
<div class="mb-6">
    <button data-action="start-empty-workout" 
            class="w-full py-4 glass-strong border border-primary-500/30 rounded-2xl flex items-center justify-center gap-3 shadow-lg ${hasActiveSession ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer btn-press hover:border-primary-500'}">
        <svg class="w-6 h-6 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        <span class="text-lg font-bold ${hasActiveSession ? 'text-surface-400 dark:text-surface-500' : 'text-primary-600 dark:text-primary-400'}">
            ${hasActiveSession ? 'Активная тренировка' : 'Начать тренировку'}
        </span>
    </button>
</div>

// Secondary actions row (History, Build Template, Records)
<div class="grid grid-cols-2 gap-3 mb-6">
    <button data-action="view-history" class="glass rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer btn-press">
        <div class="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <span class="text-sm font-semibold">История</span>
        <span class="text-[11px] text-surface-500">${recentSessions.length > 0 ? `${recentSessions.length} тренировок` : 'Пусто'}</span>
    </button>
    <button data-action="show-build-workout" class="glass rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer btn-press">
        <div class="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        </div>
        <span class="text-sm font-semibold">Собрать шаблон</span>
        <span class="text-[11px] text-surface-500">Каталог 220+ упр.</span>
    </button>
</div>
```

### 5. Update Event Bindings in `render()`
**File**: `static/js/workouts.js` - After HTML injection (~line 1319)

**Replace lines 1319-1327 with:**

```javascript
container.querySelector('[data-action="start-empty-workout"]')?.addEventListener('click', (e) => {
    if (hasActiveSession) return; // Disabled state handled by CSS
    e.stopPropagation();
    this.startEmptyWorkout(app);
});
container.querySelector('[data-action="show-build-workout"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    this.showBuildWorkout(app);
});
container.querySelector('[data-action="view-history"]')?.addEventListener('click', () => 
    this.renderHistoryScreen(container, app));
// ... keep existing view-records, view-templates, resume-workout handlers
```

### 6. Extend Template Save for Free-form Workouts
**File**: `static/js/workouts.js` - Modify `promptTemplateUpdateIfNeeded` (~line 2819)

**Change logic to:**
- If session has `template_id` → offer to **update existing template** (current behavior)
- If session is free-form (no `template_id`) → offer to **save as NEW template**

```javascript
async promptTemplateUpdateIfNeeded(app, session) {
    if (!session || !this.exercisesModified) {
        return true;
    }

    const hasTemplateId = !!session.template_id;
    const title = hasTemplateId ? 'Состав подходов изменен' : 'Сохранить тренировку как шаблон?';
    const message = hasTemplateId 
        ? 'Вы изменяли структуру подходов. Сохранить новую схему в шаблон?'
        : 'Эта тренировка не привязана к шаблону. Сохранить её как новый шаблон для повторного использования?';
    const confirmText = hasTemplateId ? 'Обновить шаблон' : 'Сохранить как шаблон';

    const updated = await Components.confirmModal({
        title,
        message,
        confirmText,
        confirmClass: 'bg-primary-600 hover:bg-primary-700 text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 font-semibold shadow-md',
        cancelText: hasTemplateId ? 'Только для этой тренировки' : 'Не сохранять',
    });

    if (!updated) return true;

    // Build exercises payload from current session
    const exercises = session.exercises.map(ex => {
        const firstSet = ex.sets?.[0];
        const completedSet = ex.sets?.find(s => s.is_completed && s.reps !== null && s.reps !== undefined);
        const useSet = completedSet || firstSet;
        return {
            name: ex.name,
            order: ex.order ?? 0,
            target_sets: ex.sets?.length ?? 3,
            target_reps: useSet?.reps ?? useSet?.target_reps ?? 10,
            target_weight_kg: useSet?.weight_kg ?? firstSet?.target_weight_kg ?? null,
            rest_seconds: useSet?.rest_seconds ?? firstSet?.rest_seconds ?? 90,
            notes: ex.notes ?? null,
        };
    });

    try {
        if (hasTemplateId) {
            // Update existing template
            await API.patch(`/workouts/templates/${session.template_id}`, { exercises }, app.state.tokens.access);
            app.showToast('Шаблон обновлён', 'success');
        } else {
            // Create NEW template from free-form workout
            const templateName = session.name || 'Моя тренировка';
            const resp = await API.post('/workouts/templates', { name: templateName, exercises }, app.state.tokens.access);
            app.showToast(`Шаблон "${templateName}" сохранён`, 'success');
        }
    } catch (e) {
        app.showToast(e?.offlineQueued ? 'Сохранится при появлении связи' : (e.message || 'Ошибка сохранения'), e?.offlineQueued ? 'info' : 'error');
    }
    return true;
}
```

### 7. Remove Dead Code
**File**: `static/js/workouts.js`
- Delete `showQuickStartModal` (lines 5239-5315)
- Delete `startQuickWorkout` (lines 5317-5338)
- Delete `startQuickWorkoutWithAi` (if exists, search for it)
- Delete `QUICK_GOALS` constant (line 19-23) if only used by quick start

### 8. Verify "Add Exercise on the Fly" Works
The existing `showAddExerciseModal` (line 6372) and `add-exercise` button in workout screen (line 4488) should already support adding exercises to empty sessions. Verify:
- Empty session renders correctly in `renderWorkoutScreen`
- "Add Exercise" button appears and works
- Added exercises persist in local session

---

## Testing Checklist

| Scenario | Expected |
|----------|----------|
| Tap "Начать тренировку" on dashboard | Opens empty workout screen immediately (no modal) |
| Empty workout screen shows | "Add Exercise" button, no pre-filled exercises |
| Add 2-3 exercises during workout | Exercises appear, sets editable |
| Complete workout | Shows "Сохранить как шаблон?" prompt |
| Save as template | Template appears in "Собрать тренировку" / Templates page |
| Start workout from new template | Pre-fills exercises from template |
| Offline mode | Empty workout works fully offline |
| Active session exists | Dashboard shows "Активная тренировка" disabled button + "Продолжить" |

---

## Rollback Plan
If issues arise:
1. Revert `render()` dashboard HTML to previous version (4 cards)
2. Restore `showQuickStartModal`, `startQuickWorkout` methods
3. Revert `promptTemplateUpdateIfNeeded` to template-only logic
4. Revert `renderWorkoutScreen` validation to original (block empty exercises)

---

## Out of Scope
- AI Coach integration for free-form workouts (can be added later)
- Exercise library search/filter improvements
- Workout history UI changes beyond dashboard simplification