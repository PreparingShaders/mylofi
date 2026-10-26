# Implementation Plan: Rest Timer (Таймер отдыха) в тренировках - Обновленная версия

## Goal
Implement a stopwatch-style rest timer that:
1. **Starts** when user completes a set (taps ✓) - counts UP from 00:00
2. **Stops & saves** when user completes the NEXT set - elapsed time saved as `rest_time_seconds` for the PREVIOUS set
3. **Displays** active timer in fixed bottom bar (bright/accent), completed rest times inline between sets (muted)
4. **No timer** for the last set of an exercise
5. **Persists** to backend via existing `rest_time_seconds` field

## User Requirements Summary
- **Trigger**: Completing a set (not last in exercise) → start count-up timer
- **Stop & Save**: Completing next set → stop timer, save elapsed to `rest_time_seconds` of previous set
- **Active Timer UI**: Fixed bottom bar, bright/accent color, live MM:SS updating
- **Completed Rest UI**: Inline between set rows in exercise card, muted color
- **History**: Visible in completed workout history via `rest_time_seconds`
- **Exceptions**: No timer for last set of exercise

## Affected Boundaries

### 1. `static/js/workouts.js` - Core Logic
**State additions** (in `Workouts` object):
- `restTimerInterval: null` - interval ID for count-up
- `restTimerStartTime: null` - timestamp when current timer started
- `activeRestForSetId: null` - set ID that the CURRENT active timer belongs to (the PREVIOUS completed set)

**New methods**:
- `startRestTimer(completedSet, exercise, session)` - called after `applyToggleState(true)` for non-last sets
- `stopAndSaveRestTimer(completedSet, exercise, session)` - called when NEXT set is completed
- `updateRestTimerUI()` - updates bottom bar display every second
- `renderRestTimerBar(container)` - renders fixed bottom bar HTML
- `renderRestTimeInline(set, exercise)` - renders muted rest time between set rows

**Modifications**:
- In `bindWorkoutScreenEvents` toggle-set handler:
  - When `isCompleted === true`:
    1. If `activeRestForSetId` exists → call `stopAndSaveRestTimer` for that previous set
    2. If this set is NOT the last in exercise → call `startRestTimer` for this set
  - When `isCompleted === false` (unchecking):
    - If this set was the one with active timer → stop timer without saving
    - If previous set had timer saved → clear that saved `rest_time_seconds`
- In `renderWorkoutScreen`:
  - Include rest timer bar HTML
  - Modify exercise card rendering to show inline rest times between sets
- In `stopWorkoutTimer` / cleanup: call `stopAndSaveRestTimer` if active (save on workout end)

### 2. Exercise Card Rendering (in `renderWorkoutScreen`)
- After each set row (except last), if `rest_time_seconds` exists → render muted inline display:
  ```html
  <div class="rest-time-inline muted">
    <span class="timer-icon">⏱</span>
    <span class="rest-duration">MM:SS</span>
    <span class="rest-label">Отдых</span>
  </div>
  ```

### 3. CSS Styles
- Fixed bottom bar: `fixed bottom-16 left-0 right-0 z-50` (above nav)
- Active timer: `text-lime-500 dark:text-lime-400 font-mono text-2xl`
- Inline rest time: `text-surface-500 dark:text-surface-400 text-xs`
- Timer icon: subtle pulse animation when active

## Data Flow

### Starting a Rest Timer (Set N completed, N < total):
1. User taps ✓ on Set N → `toggle-set` handler fires
2. `applyToggleState(true)` updates local session
3. Check: `set.set_number < exercise.sets.length` (not last set)
4. If active timer exists for previous set → `stopAndSaveRestTimer(prevSet)`
5. `startRestTimer(currentSet)`:
   - `restTimerStartTime = Date.now()`
   - `activeRestForSetId = currentSet.id`
   - Start `setInterval` → `updateRestTimerUI()` every 1000ms
   - Show bottom bar (remove `hidden`)

### Stopping & Saving (Set N+1 completed):
1. User taps ✓ on Set N+1 → handler fires
2. `activeRestForSetId` exists (belongs to Set N) → `stopAndSaveRestTimer(Set N)`:
   - `elapsed = Math.floor((Date.now() - restTimerStartTime) / 1000)`
   - Find Set N in session → `set.rest_time_seconds = elapsed`
   - `persistLocalSession(session)` + `recordLocalSetPatch` for offline
   - Clear `activeRestForSetId`, stop interval, hide bottom bar
3. If Set N+1 is not last → `startRestTimer(Set N+1)` (new timer)

### Unchecking a Set:
- If unchecking Set N (which had active timer): stop timer, clear `activeRestForSetId`, hide bar, DON'T save
- If unchecking Set N+1 (which caused Set N's timer to save): clear Set N's `rest_time_seconds`, re-render

### Workout Completion:
- If active timer exists on "Complete Workout" → `stopAndSaveRestTimer` for that set
- Then proceed with normal completion

## Backend Integration
- `rest_time_seconds` field already exists in:
  - `WorkoutSetResponse` schema (line 621 in schemas)
  - `WorkoutSet` model (line 402 in models)
  - `update_set_completion` service (line 467-468)
- No backend changes needed - data flows through existing PATCH `/workouts/sets/{id}`

## Edge Cases
- **Last set of exercise**: Never starts a timer
- **Unchecking completed set**: Stops timer if active, clears saved rest time if was saved
- **Exercise change (swipe)**: Timer continues running (global, not per-exercise)
- **Workout completion**: Saves active timer before completing
- **Offline/local sessions**: Works fully client-side, syncs via existing queue
- **Screen lock/background**: Use `visibilitychange` to pause/resume timer calculation
- **Rapid tapping**: Debounce handled by existing toggle logic

## Failure Modes & Mitigations
- **Timer drift**: Use `Date.now()` delta, not incrementing counter
- **Multiple timers**: Only one global timer at a time (enforced by `activeRestForSetId`)
- **Data loss on crash**: Timer state in memory only; acceptable for rest timer
- **Offline save failure**: Existing `recordLocalSetPatch` queues for sync

## Validation Plan
1. Start workout with 3-set exercise
2. Complete Set 1 → bottom bar appears, counts up from 00:00 (bright lime)
3. Wait 45s, complete Set 2 → timer stops, Set 1 shows "00:45 Отдых" inline (muted)
4. New timer starts for Set 2 rest (bottom bar)
5. Wait 30s, complete Set 3 (last) → timer stops, Set 2 shows "00:30 Отдых" inline
6. NO timer starts after Set 3
7. Check history → both rest times visible in workout detail
8. Test uncheck: complete Set 1, wait, uncheck Set 1 → timer stops, no rest time saved
9. Test offline → timer works, syncs when online
10. Test background/foreground → timer resumes correctly

## Implementation Order
1. Add state properties to `Workouts` object
2. Add `renderRestTimerBar()` and `updateRestTimerUI()` methods
3. Add `renderRestTimeInline(set, exercise)` helper for card rendering
4. Modify `renderWorkoutScreen` to include timer bar + inline rest times
5. Add `startRestTimer()`, `stopAndSaveRestTimer()` methods
6. Hook into `bindWorkoutScreenEvents` toggle-set handler (both complete & uncheck)
7. Add cleanup in `stopWorkoutTimer` / screen unmount / workout completion
8. Add CSS styles for timer bar and inline rest display
9. Test all scenarios