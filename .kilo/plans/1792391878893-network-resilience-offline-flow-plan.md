# Implementation Plan: Rest Timer (Таймер отдыха) в тренировках

## Goal
Add a visual rest timer that starts automatically after completing a set (except the last set of an exercise), counting down from the exercise's `rest_seconds` value, displayed in a fixed bottom bar above the navigation.

## User Requirements Summary
- **Position**: Fixed bottom bar above navigation
- **Trigger**: After completing any set except the last set of an exercise
- **Duration**: Use `rest_seconds` from the set/exercise data (default 90s if not available)
- **End behavior**: Vibration + sound (if permitted) + timer stays at 00:00 until dismissed
- **Navigation**: Timer keeps running in background when swiping between exercises

## Affected Boundaries

### 1. `static/js/workouts.js` - Core Logic
- **State additions** (in `Workouts` object):
  - `restTimerInterval: null` - interval ID for countdown
  - `restTimerEndTime: null` - timestamp when current timer ends
  - `restTimerTotalDuration: 0` - total duration of current rest period
  - `currentRestSetId: null` - set ID that triggered the timer

- **New methods**:
  - `startRestTimer(set, exercise, session)` - called from `bindWorkoutScreenEvents` after set completion
  - `stopRestTimer()` - clears interval, resets state
  - `dismissRestTimer()` - user manually dismisses timer
  - `updateRestTimerUI()` - updates the bottom bar display
  - `renderRestTimerBar(container)` - renders the fixed bottom bar HTML

- **Modifications**:
  - In `bindWorkoutScreenEvents`: after `applyToggleState(isCompleted)` when `isCompleted === true`, check if this is NOT the last set of the exercise → call `startRestTimer(set, exercise, session)`
  - In `renderWorkoutScreen`: include rest timer bar HTML in the container
  - In `stopWorkoutTimer` / screen cleanup: call `stopRestTimer()`

### 2. `static/js/components.js` - UI Components (if needed)
- Add helper for rendering rest timer bar if complex

### 3. CSS (`static/css/styles.css` or inline styles)
- Styles for fixed bottom bar: `fixed bottom-16 left-0 right-0` (above nav which is typically `bottom-0`)
- Timer display: large mono font, lime accent color
- Dismiss button: subtle, accessible
- Progress ring or bar visualization

## Data Flow
1. User completes a set → `toggle-set` click handler fires
2. `applyToggleState(true)` updates local session state
3. Check: `set.set_number < exercise.sets.length` (not last set)
4. If not last set: `startRestTimer(set, exercise, session)`
5. `startRestTimer`:
   - Reads `set.rest_seconds` (fallback: `exercise.rest_seconds` or 90)
   - Sets `restTimerEndTime = Date.now() + duration * 1000`
   - Starts `setInterval` updating UI every second
   - Shows bottom bar (remove `hidden` class)
6. Each tick: `updateRestTimerUI()` calculates remaining, formats MM:SS
7. When remaining ≤ 0:
   - Vibrate (if `navigator.vibrate`)
   - Play subtle sound (optional, using `AudioContext`)
   - Timer stays at 00:00, shows "Отдых завершен"
7. User taps "Готов" (dismiss) → `dismissRestTimer()` hides bar, clears interval
8. If user completes next set before dismissing → new timer starts (replaces old)

## Edge Cases
- **Last set of exercise**: No timer started
- **Unchecking a set**: If timer was running for that set, stop it
- **Exercise change (swipe)**: Timer continues running (per requirement)
- **Workout completion/cancel**: `stopRestTimer()` called
- **Offline/local sessions**: Timer works purely client-side
- **Screen lock/background**: Timer pauses (use `visibilitychange` to sync on resume)

## Failure Modes & Mitigations
- **No `rest_seconds` in data**: Default to 90 seconds
- **Timer drift**: Use `Date.now()` based calculation, not incrementing counter
- **Multiple timers**: Only one timer active at a time (new set completion replaces)
- **Vibration not supported**: Graceful degradation (visual only)

## Validation Plan
1. Start workout with template that has `rest_seconds` defined
2. Complete set 1 of 3 → timer appears, counts down from rest_seconds
3. Wait for timer to reach 0 → vibration + stays at 00:00
4. Tap "Готов" → timer dismisses
5. Complete set 2 of 3 → new timer starts
6. Complete set 3 of 3 (last) → NO timer starts
6. Swipe to another exercise during rest → timer continues
7. Complete workout → timer cleaned up
8. Test offline/local session → timer works without network

## Implementation Order
1. Add state properties to `Workouts` object
2. Add `renderRestTimerBar()` and `updateRestTimerUI()` methods
3. Modify `renderWorkoutScreen` to include timer bar HTML
4. Add `startRestTimer()`, `stopRestTimer()`, `dismissRestTimer()` methods
5. Hook into `bindWorkoutScreenEvents` toggle-set handler
6. Add cleanup in `stopWorkoutTimer` / screen unmount
7. Add CSS styles for timer bar
8. Test all scenarios