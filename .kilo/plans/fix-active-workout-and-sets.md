# Fix: Active Workout Persists After Completion & Default Sets for New Exercises & History Deduplication

## Problem 1: Active Workout Block Persists After Completion
When user completes a workout (via "Complete Workout" button), the workout saves to history correctly, but the "Active Workout" block continues to show on the Workouts dashboard.

**Root Cause Analysis**:
- `handleCompleteWorkout` in `app.js` calls `Workouts.clearActiveSessionState(this)` which:
  1. Saves `last_closed_session_id` to localStorage
  2. Removes `active_session_id` and `active_workout` from localStorage
  3. Sets `app.state.currentSessionId = null`
- Then calls `renderPage('workouts')` which triggers `resolveActiveWorkout()`
- `resolveActiveWorkout()` checks `last_closed_session_id` vs `currentSessionId` to block restoration

**Potential Issues**:
1. `clearActiveSessionState` might be called when `app.state.currentSessionId` is already null (timing issue)
2. The fallback at line 2391-2393 calls `clearActiveSessionState` again after the try block, which might overwrite `last_closed_session_id` with null
3. Race condition between localStorage writes and `resolveActiveWorkout` reads

## Problem 2: New Exercises Default to 3 Sets Instead of 1
When adding a second (or any subsequent) exercise in a free-form workout, it creates 3 sets by default instead of 1.

**Root Cause**:
- Exercise catalog model (`app/models/__init__.py` line 302) has `target_sets: default=3`
- Exercise catalog schema (`app/schemas/__init__.py` line 556) has `target_sets: default=3`
- `selectExercise` in `showAddExerciseModal` (workouts.js lines 6773, 6805) uses `ex.target_sets || 1`
- Since `ex.target_sets` is 3 (from catalog), `|| 1` doesn't trigger, creating 3 sets

**Fix**: Override to 1 set for free-form/on-the-fly exercise additions, regardless of catalog default.

## Problem 3: Duplicate History Entries
When viewing history, the same completed workout appears twice - once from localStorage and once from the server response.

**Root Cause**:
- `renderHistory` (workouts.js lines 5049-5054) merges `localSessions` and `serverSessions` by simple concatenation without deduplication
- If a session exists both locally (not yet synced or sync in progress) and on the server, it appears twice
- The merge uses `[...localSessions, ...serverSessions]` which preserves duplicates

**Fix**: Deduplicate by session ID when merging, preferring server sessions (authoritative).

---

## Implementation Plan

### Fix 1: Ensure Active Workout Clears Properly After Completion

**File**: `static/js/app.js` - `handleCompleteWorkout` function

**Changes**:
1. Save `sessionId` to a local variable BEFORE any async operations that might clear app state
2. Ensure `clearActiveSessionState` is called with the correct session ID
3. Remove duplicate `clearActiveSessionState` call at the end of the function (line 2392) which overwrites `last_closed_session_id` with null
4. Add explicit navigation to dashboard after successful completion (already at line 2393 but only runs if try block doesn't return)

```javascript
// At start of handleCompleteWorkout, save the session ID from the event
const sessionId = event.target.closest('[data-session-id]')?.dataset.sessionId;
if (!sessionId) return;

// ... existing code ...

// In the try block success path (around line 2342):
try {
    const resp = await API.post(...);
    console.log('[handleCompleteWorkout] Complete endpoint response:', resp);
    Workouts.forgetAiPlan(sessionId);
    Workouts.clearActiveSessionState(this); // This sets last_closed_session_id correctly
    this.showToast('Тренировка завершена!', 'success');
    // FALL THROUGH to line 2391-2393 which navigates to dashboard
} catch (e) {
    // ... error handling ...
}

// At end of function (lines 2391-2393):
this.state.completingWorkout = false;
// REMOVE the duplicate clearActiveSessionState call here
await this.renderPage('workouts');
```

**File**: `static/js/workouts.js` - `clearActiveSessionState` function

Add defensive check to ensure `last_closed_session_id` is set even if `app.state.currentSessionId` is null:

```javascript
async clearActiveSessionState(app) {
    // Use the session ID from localStorage if app state is already cleared
    const lastClosedId = app?.state?.currentSessionId 
        ?? localStorage.getItem('active_session_id') 
        ?? null;
    
    try {
        if (lastClosedId) {
            localStorage.setItem('last_closed_session_id', String(lastClosedId));
            localStorage.removeItem(`session_${lastClosedId}`);
        }
        localStorage.removeItem('active_session_id');
        localStorage.removeItem('active_workout');
    } catch (e) {}
    this.currentSession = null;
    this.sessionStartTimestamp = null;
    if (app?.state) {
        app.state.currentSessionId = null;
    }
    await new Promise(r => setTimeout(r, 0));
},
```

### Fix 2: Default to 1 Set for On-the-Fly Exercise Additions

**File**: `static/js/workouts.js` - `selectExercise` function in `showAddExerciseModal` (around line 6768)

Change both local and server session paths to use **1 set** for exercises added during an active workout, regardless of catalog default:

```javascript
const selectExercise = async (ex) => {
    closeModal();
    if (isLocal) {
        const newExerciseId = TEMP_EXERCISE_ID_BASE - Math.floor(Math.random() * 10000);
        const maxOrder = Math.max(0, ...session.exercises.map(e => e.order || 0));
        // FORCE 1 set for free-form additions, ignore catalog default
        const targetSets = 1;  // Was: Math.max(1, ex.target_sets || 1)
        let setCounter = 0;
        const newLocalEx = {
            id: newExerciseId,
            name: ex.name,
            order: maxOrder + 1,
            notes: ex.muscle_group ? `${ex.muscle_group} / ${ex.equipment}` : null,
            sets: Array.from({ length: targetSets }, (_, i) => {
                setCounter += 1;
                return {
                    id: TEMP_SET_ID_BASE - setCounter,
                    exercise_id: newExerciseId,
                    set_number: i + 1,
                    weight_kg: 0,
                    reps: 10,
                    rest_seconds: 90,
                    is_completed: false,
                };
            }),
        };
        session.exercises = [...(session.exercises || []), newLocalEx];
        this.exercisesModified = true;
        this.persistLocalSession(session);
        await this.renderWorkoutScreen(app.elements.pageContent, app, sessionKey);
        return;
    }

    // For server sessions: optimistically add to currentSession
    const optimisticEx = {
        id: `temp-${Date.now()}`,
        name: ex.name,
        order: Math.max(0, ...(session.exercises?.map(e => e.order || 0) || [0])) + 1,
        sets: Array.from({ length: 1 }, (_, i) => ({  // Was: ex.target_sets || 1
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
    // ... rest unchanged
};
```

**Also update**: `buildLocalSessionFromTemplate` (line 943) - Keep using template's `target_sets` since templates define their own structure. This is correct as-is.

### Fix 3: Deduplicate History Entries by Session ID

**File**: `static/js/workouts.js` - `renderHistory` function (around line 5048-5054)

Modify the merge logic to deduplicate by session ID, preferring server sessions over local ones:

```javascript
// Get local completed sessions that haven't synced yet
const localSessions = this.getLocalCompletedSessions();

// Merge server sessions with local sessions (local first, newest first)
const serverSessions = (data?.sessions || []).slice();

// DEDUPLICATION: Create a Set of server session IDs for O(1) lookup
const serverSessionIds = new Set(serverSessions.map(s => String(s.id)));

// Filter out local sessions that already exist on the server (by ID)
const uniqueLocalSessions = localSessions.filter(local => {
    const localId = String(local.id || local.key || '');
    return localId && !serverSessionIds.has(localId);
});

// Combine: unique local sessions first, then all server sessions
const allSessions = [...uniqueLocalSessions, ...serverSessions]
    .sort((a, b) => new Date(b.completed_at || b.started_at) - new Date(a.completed_at || a.started_at));

historyState.sessions = allSessions;
historyState.total = (data?.total || 0) + uniqueLocalSessions.length;
historyState.hasLocalSessions = uniqueLocalSessions.length > 0;
```

**Also update**: `getLocalCompletedSessions` (line 5068) - Add optional parameter to exclude already-synced sessions if needed for performance, but the merge logic above handles it.

---

## Testing Checklist

| Scenario | Expected |
|----------|----------|
| Complete local free-form workout | Active workout block disappears from dashboard |
| Complete server workout (online) | Active workout block disappears from dashboard |
| Complete server workout (offline/queued) | Active workout block disappears from dashboard |
| Add first exercise in free-form workout | Creates 1 set |
| Add second exercise in free-form workout | Creates 1 set (not 3) |
| Add exercise from template-based workout | Uses template's target_sets (unchanged) |
| Navigate to dashboard after completion | No "Active Workout" block shown |
| Refresh page after completion | No "Active Workout" block shown |
| **NEW**: Complete workout, sync to server, open History | Workout appears exactly once (not twice) |
| **NEW**: Offline workout completed, then comes online, open History | Workout appears once with server data |
| **NEW**: Multiple rapid completions | No duplicate history entries |

---

## Rollback Plan
1. Revert `handleCompleteWorkout` duplicate `clearActiveSessionState` removal
2. Revert `clearActiveSessionState` fallback to localStorage
3. Revert `selectExercise` targetSets from 1 back to `Math.max(1, ex.target_sets || 1)`
4. Revert history merge deduplication logic to simple concatenation

---

## Out of Scope
- Changing exercise catalog default from 3 to 1 (affects templates)
- Changing template exercise defaults
- Workout type-specific set defaults (cardio vs strength)
- Advanced history filtering by exercise type