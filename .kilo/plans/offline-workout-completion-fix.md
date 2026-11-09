# Fix Offline Workout Completion - Reliable Local Persistence

## Problem
When completing a workout (especially free-form "blank slate" workouts) in offline mode or with network failures:
- Workout fails to save locally
- User sees "Сеть недоступна, данные будут синхронизированы" but workout doesn't complete
- Dynamically added exercises in server sessions aren't captured when completed offline
- No validation prevents completing empty workouts

## Root Cause Analysis

### 1. Server Sessions with Offline Exercise Addition
When adding exercises to a **server session** while offline (line 6325-6334):
```javascript
const resp = await API.post(`/workouts/sessions/${sessionId}/exercises`, {...}, token);
```
- If `offlineQueued`, the exercise is queued but `this.currentSession` is NOT updated
- `renderWorkoutScreen` is called but server returns stale session (without new exercise)
- On completion: `syncSessionFromDOM()` reads DOM (has exercise) but `persistCompletedSessionLocally` uses stale `currentSession`

### 2. Free-form Local Sessions
`completeLocalSession` (line 1077) correctly saves local session, but:
- No validation that exercises exist before completion
- `renderWorkoutScreen` allows empty exercises for free-form (line 3276), but completion doesn't check

### 3. Completion Flow Gap
In `handleCompleteWorkout` (app.js line 2252):
- `syncSessionFromDOM()` updates `currentSession` from DOM
- But for server sessions, the session ID might be numeric while local storage uses string keys
- `persistCompletedSessionLocally` saves with `sessionId` but retrieval might use different key format

## Affected Files
- `static/js/workouts.js` - Core workout logic
- `static/js/app.js` - App-level completion handler

## Implementation Plan

### Fix 1: Update `syncSessionFromDOM` to Capture All Exercises from DOM
**File**: `static/js/workouts.js`, function `syncSessionFromDOM` (line 1042)

The current implementation only updates weight/reps/completed for existing sets. It doesn't handle:
- New exercises added to DOM but not in `currentSession.exercises`
- Exercise order changes

**Change**: Rebuild `currentSession.exercises` entirely from DOM structure:
```javascript
syncSessionFromDOM() {
    if (!this.currentSession) return;
    
    // Get all exercise cards from DOM
    const exerciseCards = document.querySelectorAll('[data-exercise-id]');
    const newExercises = [];
    
    exerciseCards.forEach(card => {
        const exId = card.dataset.exerciseId;
        const nameEl = card.querySelector('[data-exercise-name]') || card.querySelector('h3, h4');
        const name = nameEl?.textContent?.trim() || '';
        
        // Get all sets for this exercise
        const setRows = card.querySelectorAll('[data-set-id]');
        const sets = [];
        setRows.forEach(row => {
            const setId = parseInt(row.dataset.setId, 10);
            if (isNaN(setId)) return;
            const weightInput = row.querySelector('[data-field="weight"]');
            const repsInput = row.querySelector('[data-field="reps"]');
            const durationInput = row.querySelector('[data-field="duration"]');
            const distanceInput = row.querySelector('[data-field="distance"]');
            const toggleBtn = row.querySelector('[data-action="toggle-set"]');
            
            const weight_kg = weightInput ? parseFloat(weightInput.value) : null;
            const reps = repsInput ? parseInt(repsInput.value, 10) : null;
            const duration = durationInput ? parseInt(durationInput.value, 10) : null;
            const distance = distanceInput ? parseFloat(distanceInput.value) : null;
            const is_completed = toggleBtn?.dataset.completed === 'true';
            
            sets.push({ id: setId, weight_kg, reps, duration, distance, is_completed });
        });
        
        if (sets.length > 0) {
            // Find existing exercise to preserve metadata
            const existingEx = this.currentSession.exercises?.find(e => String(e.id) === String(exId));
            newExercises.push({
                id: existingEx?.id || exId,
                name: existingEx?.name || name,
                order: existingEx?.order || newExercises.length,
                notes: existingEx?.notes,
                sets,
                exercise_type: existingEx?.exercise_type || 'weight_reps',
            });
        }
    });
    
    if (newExercises.length > 0) {
        this.currentSession.exercises = newExercises;
    }
    
    // Persist to localStorage
    try {
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(this.currentSession));
        const sessionId = this.currentSession.isLocal ? this.currentSession.key : String(this.currentSession.id);
        if (sessionId) {
            localStorage.setItem(`session_${sessionId}`, JSON.stringify(this.currentSession));
        }
    } catch (error) {
        console.error('[Workouts] Failed to persist synced session:', error);
    }
}
```

### Fix 2: Add Validation Before Workout Completion
**File**: `static/js/app.js`, function `handleCompleteWorkout` (line 2252)

Add check before confirmation modal:
```javascript
async handleCompleteWorkout(event) {
    // ... existing code ...
    
    // Validate workout has exercises with completed sets
    const session = Workouts.currentSession;
    if (session) {
        const hasValidExercises = session.exercises?.some(ex => 
            ex.sets?.some(s => s.is_completed && (s.weight_kg > 0 || s.reps > 0 || s.duration > 0 || s.distance > 0))
        );
        
        if (!hasValidExercises) {
            if (!await Components.confirmModal({
                title: 'Пустая тренировка',
                message: 'В тренировке нет выполненных подходов. Завершить всё равно?',
                confirmText: 'Да, завершить',
                confirmClass: 'bg-primary-600...',
                cancelText: 'Добавить подходы',
            })) {
                this.state.completingWorkout = false;
                return;
            }
        }
    }
    
    // ... rest of function ...
}
```

### Fix 3: Ensure Offline Completion Persists Correctly for Server Sessions
**File**: `static/js/workouts.js`, function `persistCompletedSessionLocally` (line 716)

The issue: `sessionId` for server sessions is numeric, but localStorage keys use string format. Also, the session object might not have the latest exercises.

**Change**: Use consistent key format and ensure session has latest exercises:
```javascript
persistCompletedSessionLocally(sessionId, session) {
    if (!sessionId || !session) return;
    try {
        // Ensure we have the latest exercises from DOM
        this.syncSessionFromDOM();
        
        const payload = { ...this.currentSession }; // Use currentSession which has DOM-synced data
        payload.status = 'completed';
        payload.completed_at = new Date().toISOString();
        payload.duration_seconds = this.getElapsedSeconds(payload);
        
        // Use consistent string key for both local and server sessions
        const storageKey = `completed_session_${String(sessionId)}`;
        localStorage.setItem(storageKey, JSON.stringify(payload));
        this.markSessionClosedLocally(sessionId);
    } catch (error) {
        console.error('[Workouts] Failed to persist completed session locally:', error);
    }
},
```

### Fix 4: Handle Free-form Local Session Completion Properly
**File**: `static/js/workouts.js`, function `completeLocalSession` (line 1077)

Add validation that at least one exercise exists:
```javascript
completeLocalSession(app) {
    const session = this.getActiveLocalSession();
    if (!session) return false;
    
    // Mirror DOM into session
    if (this.currentSession && this.currentSession.key === session.key) {
        session.exercises = this.currentSession.exercises;
    }
    
    // Validate: free-form workout must have at least one exercise
    if (!session.exercises || session.exercises.length === 0) {
        app?.showToast('Добавьте хотя бы одно упражнение перед завершением', 'error');
        return false;
    }
    
    const token = app?.state?.tokens?.access || null;
    session.status = 'completed';
    session.completed_at = new Date().toISOString();
    session.duration_seconds = this.getElapsedSeconds(session);
    this.saveLocalSession(session);
    
    API.enqueueRequest(...);
    app?.showToast(OFFLINE_COMPLETE_MESSAGE, 'info');
    return true;
},
```

### Fix 5: Ensure Exercise Addition Updates CurrentSession for Server Sessions (Offline)
**File**: `static/js/workouts.js`, function `selectExercise` in `showAddExerciseModal` (line 6287)

When adding exercise to server session and it's queued offline, also update local session immediately:
```javascript
const selectExercise = async (ex) => {
    closeModal();
    if (isLocal) {
        // ... existing local session logic ...
        return;
    }
    
    // For server sessions: optimistically add to currentSession
    const optimisticEx = {
        id: `temp-${Date.now()}`,
        name: ex.name,
        order: Math.max(0, ...(session.exercises?.map(e => e.order || 0) || [0])) + 1,
        sets: Array.from({ length: ex.target_sets || 3 }, (_, i) => ({
            id: `temp-set-${Date.now()}-${i}`,
            exercise_id: `temp-${Date.now()}`,
            set_number: i + 1,
            weight_kg: 0,
            reps: 10,
            rest_seconds: 90,
            is_completed: false,
        })),
        exercise_type: ex.exercise_type || 'weight_reps',
    };
    
    session.exercises = [...(session.exercises || []), optimisticEx];
    this.exercisesModified = true;
    this.persistLocalSession(session); // Save optimistically
    
    try {
        await app.ensureFreshToken();
        const resp = await API.post(`/workouts/sessions/${sessionId}/exercises`, {
            exercise_id: ex.id,
        }, token);
        app.showToast('Упражнение добавлено!', 'success');
        // Re-render will fetch fresh session from server
        await this.renderWorkoutScreen(app.elements.pageContent, app, sessionId);
    } catch (err) {
        if (!err?.offlineQueued) {
            app.showToast(err.message || 'Ошибка добавления упражнения', 'error');
            // Rollback optimistic add on non-network error
            session.exercises = session.exercises.filter(e => e.id !== optimisticEx.id);
            this.persistLocalSession(session);
        } else {
            // Offline: keep optimistic add, will sync when online
            await this.renderWorkoutScreen(app.elements.pageContent, app, sessionId);
        }
    }
};
```

### Fix 6: Recovery of Completed Sessions on App Start
**File**: `static/js/workouts.js`, function `render` (line 1105)

Add logic to detect and sync completed sessions from localStorage on app load:
```javascript
async render(container, app) {
    // ... existing code ...
    
    // Check for completed sessions in localStorage that need syncing
    this.recoverCompletedSessions(app);
    
    // ... rest of render ...
},

recoverCompletedSessions(app) {
    try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith('completed_session_'));
        keys.forEach(async key => {
            const sessionId = key.replace('completed_session_', '');
            const session = JSON.parse(localStorage.getItem(key));
            if (session && session.status === 'completed') {
                // Try to sync to server
                const token = app?.state?.tokens?.access;
                if (token && navigator.onLine) {
                    try {
                        await API.post(`/workouts/sessions/${sessionId}/sync-completed`, session, token);
                        localStorage.removeItem(key);
                        Workouts.forgetLocallyClosedSession(sessionId);
                    } catch (err) {
                        console.log('[Workouts] Will retry sync later:', err);
                    }
                }
            }
        });
    } catch (err) {
        console.warn('[Workouts] Failed to recover completed sessions:', err);
    }
},
```

## Testing Checklist

| Scenario | Expected |
|----------|----------|
| Free-form workout: add 2 exercises, complete offline | Saves locally, shows success toast, redirects to dashboard |
| Free-form workout: complete with NO exercises | Shows validation error "Добавьте хотя бы одно упражнение" |
| Server workout: add exercise offline, complete offline | Optimistic add works, saves locally with exercise, queues sync |
| Server workout: complete with network error | Persists locally, shows "Тренировка завершена локально!", queues retry |
| App restart after offline completion | Recovers completed sessions, syncs when online |
| Complete workout with only empty sets (no weight/reps) | Shows confirmation "Пустая тренировка" |

## Rollback Plan
1. Revert `syncSessionFromDOM` to previous implementation
2. Revert `persistCompletedSessionLocally` to use passed session parameter
3. Remove validation in `completeLocalSession` and `handleCompleteWorkout`
4. Remove optimistic add in `selectExercise`
5. Remove `recoverCompletedSessions`

## Out of Scope
- Full background sync service (requires Service Worker enhancement)
- Conflict resolution for simultaneous online/offline edits
- Exercise type-specific validation (cardio vs strength)