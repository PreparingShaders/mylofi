# Fix Workout Completion Flow - Template Save & History Persistence

## Problem
When completing a workout:
1. User clicks "Завершить тренировку"
2. App prompts "Сохранить как шаблон?" but **template is not saved**
3. Workout may not be saved to history properly
4. Error or silent failure occurs

## Root Cause
**Wrong order of operations in `handleCompleteWorkout` (app.js lines 2290-2293):**

```javascript
Workouts.markSessionClosedLocally(sessionId);
Workouts.clearActiveSessionState(this);  // Line 2291: CLEARS Workouts.currentSession = null

await Workouts.promptTemplateUpdateIfNeeded(this, Workouts.currentSession);  // Line 2293: PASSES NULL!
```

`clearActiveSessionState` (workouts.js line 811) sets `this.currentSession = null`, but `promptTemplateUpdateIfNeeded` is called AFTER with the now-null `Workouts.currentSession`. The function returns early at line 2818-2819:

```javascript
if (!session || !this.exercisesModified) {
    return true;  // Silently skips template save
}
```

## Affected Files
- `static/js/app.js` - `handleCompleteWorkout` function (lines 2290-2293)
- `static/js/workouts.js` - `promptTemplateUpdateIfNeeded` (line 2817), `clearActiveSessionState` (line 799)

## Fix Plan

### Fix 1: Reorder Operations in `handleCompleteWorkout`
**File**: `static/js/app.js`, function `handleCompleteWorkout` (around line 2288-2295)

**Change from:**
```javascript
// Мгновенный сброс активной сессии — плашка «Активная тренировка»
// должна исчезнуть сразу после клика, не дожидаясь ответа сервера.
Workouts.markSessionClosedLocally(sessionId);
Workouts.clearActiveSessionState(this);

await Workouts.promptTemplateUpdateIfNeeded(this, Workouts.currentSession);
```

**To:**
```javascript
// Save session reference BEFORE clearing state
const sessionToComplete = Workouts.currentSession;

// Мгновенный сброс активной сессии — плашка «Активная тренировка»
// должна исчезнуть сразу после клика, не дожидаясь ответа сервера.
Workouts.markSessionClosedLocally(sessionId);

// Prompt for template update BEFORE clearing session state
await Workouts.promptTemplateUpdateIfNeeded(this, sessionToComplete);

Workouts.clearActiveSessionState(this);
```

### Fix 2: Ensure `promptTemplateUpdateIfNeeded` Handles Local Sessions
**File**: `static/js/workouts.js`, function `promptTemplateUpdateIfNeeded` (line 2817)

The function already supports creating new templates for sessions without `template_id` (free-form workouts). But it needs the session object to have exercises. Ensure the passed session has the latest exercises from DOM.

**Add at start of function (line 2817):**
```javascript
async promptTemplateUpdateIfNeeded(app, session) {
    if (!session) {
        console.warn('[Workouts] promptTemplateUpdateIfNeeded called with null session');
        return true;
    }
    if (!this.exercisesModified) {
        return true;
    }
    
    // Ensure we have latest exercises from DOM for server sessions
    if (!session.isLocal) {
        this.syncSessionFromDOM();
    }
    
    // ... rest of function
}
```

### Fix 3: Fix `completeLocalSession` to Also Prompt for Template
**File**: `static/js/workouts.js`, function `completeLocalSession` (line 1143)

Currently, for local sessions, `handleCompleteWorkout` calls `promptTemplateUpdateIfNeeded` BEFORE `completeLocalSession`, but `completeLocalSession` doesn't create a template. The template prompt happens in the main flow, but for local sessions the flow returns early at line 2300-2305.

Actually, looking at the flow again:
- Line 2293: `promptTemplateUpdateIfNeeded` is called (but with null session due to bug)
- Line 2300: `if (Workouts.completeLocalSession(this))` - if true, returns early

So for local sessions, the template prompt IS called but with null session. After Fix 1, it will work.

But `completeLocalSession` should also ensure the session is saved with completed status. Let me verify it does that.

Looking at line 1158-1162:
```javascript
session.status = 'completed';
session.completed_at = new Date().toISOString();
session.duration_seconds = this.getElapsedSeconds(session);
this.saveLocalSession(session);
```

Yes, it saves as completed. Good.

### Fix 4: Ensure Local Session Template Creation Works
**File**: `static/js/workouts.js`, function `promptTemplateUpdateIfNeeded` (line 2864-2868)

The template creation for free-form workouts (line 2864-2868):
```javascript
} else {
    // Create NEW template from free-form workout
    const templateName = session.name || 'Моя тренировка';
    const resp = await API.post('/workouts/templates', { name: templateName, exercises }, app.state.tokens.access);
    app.showToast(`Шаблон "${templateName}" сохранён`, 'success');
}
```

This should work after Fix 1 passes the correct session. But need to ensure:
1. `session.name` exists for local sessions (it's set to 'Свободная тренировка' in `buildEmptyLocalSession`)
2. `exercises` array is built correctly from session.exercises
3. API endpoint `/workouts/templates` accepts the payload format

### Fix 5: Add Validation for Template Creation
**File**: `static/js/workouts.js`, in `promptTemplateUpdateIfNeeded` before API call

Add check that session has exercises:
```javascript
if (!session.exercises || session.exercises.length === 0) {
    app.showToast('Нет упражнений для сохранения в шаблон', 'error');
    return true;
}
```

## Testing Checklist

| Scenario | Expected |
|----------|----------|
| Server workout with template_id, complete online | Updates existing template |
| Server workout without template_id, complete online | Creates new template |
| Local free-form workout, complete online | Creates new template |
| Local free-form workout, complete offline | Queues template creation, saves locally |
| Complete workout with NO exercises | Shows validation error or skips template |
| Network error during template save | Shows "Сохранится при появлении связи", queues request |
| 401/404 error during template save | Shows appropriate error, preserves local data |

## Rollback Plan
1. Revert `handleCompleteWorkout` operation order
2. Revert `promptTemplateUpdateIfNeeded` early return logic
3. Remove `syncSessionFromDOM` call in template function

## Out of Scope
- Background sync service for queued template creation
- Conflict resolution for template updates
- Exercise type-specific template fields