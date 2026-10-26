# Implementation Plan: Fix Workout Data Loss on Completion

## Problem Analysis
When a user completes a workout, the set completion status (`is_completed`) is not being flushed to the server along with weight/reps. The `flushPendingSetEdits()` function in `app.js` only reads and sends `weight_kg` and `reps` from DOM inputs, but the completion state lives in the toggle button's `data-completed` attribute and the session object. This causes a race condition where:
1. User toggles set completion (sends PATCH with `is_completed`)
2. User immediately clicks "Complete workout" 
3. `flushPendingSetEdits` runs, sends only weight/reps
4. Complete endpoint is called
5. If the toggle PATCH hasn't completed, the server marks session complete without the set completions

## Affected Boundaries & Changes

### 1. Fix `flushPendingSetEdits` in `static/js/app.js`
- Extend the function to also read completion status from toggle buttons (`[data-action="toggle-set"]`)
- Send `is_completed` along with `weight_kg` and `reps` in a single PATCH per set
- Ensure we don't double-send if the toggle PATCH is already in flight (use a flag or check)

### 2. Fix `completeWorkoutWithAi` in `static/js/workouts.js`  
- Same fix - ensure `flushPendingSetEdits` sends completion status
- Or create a dedicated `flushPendingSetCompletions` function

### 3. Add logging for debugging
- Log the payload being sent in `flushPendingSetEdits`
- Log the response from the complete endpoint
- Server-side: log received completion payload

### 4. Backend validation (defensive)
- In `complete_workout_session` service, verify all sets have correct `is_completed` status
- Log any discrepancies

## Implementation Details

### Modified `flushPendingSetEdits` logic:
```javascript
async flushPendingSetEdits() {
    const rows = document.querySelectorAll('[data-set-id]');
    const promises = Array.from(rows).map(async row => {
        const setId = parseInt(row.dataset.setId);
        if (isNaN(setId)) return;
        
        const weightInput = row.querySelector('[data-field="weight"]');
        const repsInput = row.querySelector('[data-field="reps"]');
        const toggleBtn = row.querySelector('[data-action="toggle-set"]');
        
        const weight_kg = weightInput ? parseFloat(weightInput.value) : null;
        const reps = repsInput ? parseInt(repsInput.value) : null;
        const is_completed = toggleBtn?.dataset.completed === 'true';
        
        const payload = {};
        if (!isNaN(weight_kg)) payload.weight_kg = weight_kg;
        if (!isNaN(reps)) payload.reps = reps;
        if (is_completed !== undefined) payload.is_completed = is_completed;
        
        if (Object.keys(payload).length > 0) {
            await API.patch(`/workouts/sets/${setId}`, payload, this.state.tokens.access).catch(() => {});
        }
    });
    await Promise.all(promises);
}
```

## Validation Plan
1. Test workout completion with multiple sets toggled quickly before clicking "Complete"
2. Verify all set completions, weights, and reps are persisted correctly
3. Test offline mode - complete workout offline, then sync when online
4. Check server logs for completion payloads