# Workout Timer Inline Panel - Implementation Plan

## Overview
Enhance the rest timer functionality in the workout screen to:
1. Auto-start timer on set confirmation (already implemented)
2. Dynamically render live timer in ALL open inline timer panels across exercise cards
3. Synchronize timer state immediately when user opens the Timer tab

## Current State Analysis

### Already Working (Task 1)
- **Auto-start on set completion**: In `bindSetRowEvents` (lines 2214-2233), when a set is completed and it's not the last set of an exercise, `startRestTimer()` is called if `restAutoStart` is not disabled for that exercise.
- **Timer state persistence**: `restTimerStartTime`, `restTimerTargetTimestamp`, `restTimerMode`, etc. are stored on the `Workouts` instance and survive re-renders.
- **Timer interval**: `restTimerInterval` runs every 100ms calling `updateRestTimerUI()`.

### Needs Enhancement (Tasks 2 & 3)

#### Task 2: Dynamic Render in All Open Timer Panels
**Current behavior** (`updateRestTimerUI`, lines 1670-1745):
- Only updates elements for the exercise that owns the active timer (`exId` from `findExerciseOfSet`)
- Uses specific element IDs: `rest-timer-remaining-${exId}`, `rest-timer-ms-${exId}`, etc.
- Other exercise cards with open timer tabs show stale data until re-rendered

**Required behavior**:
- Find ALL visible exercise cards with open timer panels (`[data-tab-panel="timer"]:not(.hidden)`)
- Update timer display in ALL of them simultaneously
- Keep the 100ms interval for smooth milliseconds display

#### Task 3: Sync on Tab Open
**Current behavior** (`switchExerciseTab`, lines 1912-1917):
- When timer tab is opened, calls `updateTimerPanel()` which re-renders entire panel content
- This causes flicker and doesn't show live milliseconds immediately

**Required behavior**:
- When timer tab is opened, immediately populate with current timer state
- Start live updates without full panel re-render
- Show "Timer not started" only when no timer is active

## Implementation Plan

### 1. Modify `updateRestTimerUI()` to Update All Open Timer Panels

**File**: `static/js/workouts.js`
**Function**: `updateRestTimerUI` (lines 1670-1745)

**Changes**:
```javascript
updateRestTimerUI() {
    const sess = this.currentSession;
    const activeSetId = this.activeRestForSetId;
    if (activeSetId == null || !sess) return;
    
    // Find ALL visible timer panels (not just the owning exercise)
    const timerPanels = document.querySelectorAll('[data-tab-panel="timer"]:not(.hidden)');
    if (!timerPanels.length) return;
    
    const mode = this.restTimerMode || 'timer';
    const now = Date.now();
    
    // Compute timer values once
    let displayValue, displayMs, cssClass, stateText, showProgress, progressPercent;
    
    if (mode === 'stopwatch') {
        // Stopwatch mode logic
        const elapsedMs = this.restTimerStartTime ? Math.max(0, now - this.restTimerStartTime) : 0;
        const elapsed = Math.floor(elapsedMs / 1000);
        displayValue = this.formatTimer(elapsed);
        displayMs = Math.floor(elapsedMs / 10) % 100;
        cssClass = 'font-mono text-3xl font-bold tabular-nums text-lime-600 dark:text-lime-400';
        stateText = 'Секундомер';
        showProgress = false;
    } else {
        // Timer mode logic
        if (this.restTimerTargetTimestamp == null) {
            displayValue = '00:00';
            displayMs = '00';
            cssClass = 'font-mono text-3xl font-bold tabular-nums text-lime-600 dark:text-lime-400';
            stateText = 'Отдых';
            showProgress = false;
        } else {
            const remaining = Math.max(0, Math.ceil((this.restTimerTargetTimestamp - now) / 1000));
            const elapsed = Math.max(0, Math.floor((now - this.restTimerStartTime) / 1000));
            
            if (remaining <= 0) {
                this.restTimerOvertime = true;
                const overtimeDisplay = elapsed;
                displayValue = this.formatTimer(overtimeDisplay);
                displayMs = Math.floor((now - this.restTimerStartTime) / 10) % 100;
                cssClass = 'font-mono text-3xl font-bold tabular-nums text-rose-500 dark:text-rose-400 animate-pulse';
                stateText = 'Перерыв просрочен';
                showProgress = false;
            } else {
                this.restTimerOvertime = false;
                displayValue = this.formatTimer(remaining);
                displayMs = Math.floor((this.restTimerTargetTimestamp - now) / 10) % 100;
                cssClass = 'font-mono text-3xl font-bold tabular-nums text-lime-600 dark:text-lime-400';
                stateText = 'Отдых';
                showProgress = true;
                const totalSeconds = this.restTimerPlannedDuration ? this.restTimerPlannedDuration / 1000 : 90;
                progressPercent = Math.min(100, (elapsed / totalSeconds) * 100);
            }
        }
    }
    
    // Update ALL open timer panels
    timerPanels.forEach(panel => {
        const remainingEl = panel.querySelector('[id^="rest-timer-remaining-"]');
        const msEl = panel.querySelector('[id^="rest-timer-ms-"]');
        const stateEl = panel.querySelector('[id^="rest-timer-state-"]');
        const progressEl = panel.querySelector('[id^="rest-timer-progress-"]');
        const progressWrapEl = panel.querySelector('[id^="rest-timer-progress-wrap-"]');
        
        if (remainingEl) {
            remainingEl.textContent = displayValue;
            remainingEl.className = cssClass;
        }
        if (msEl) msEl.textContent = String(displayMs).padStart(2, '0');
        if (stateEl) stateEl.textContent = stateText;
        if (progressWrapEl) progressWrapEl.style.display = showProgress ? 'block' : 'none';
        if (progressEl && showProgress) progressEl.style.width = `${progressPercent}%`;
    });
}
```

**Key changes**:
- Use `document.querySelectorAll('[data-tab-panel="timer"]:not(.hidden)')` to find all visible timer panels
- Compute timer values once, then apply to all panels
- Use attribute selectors `[id^="rest-timer-remaining-"]` instead of specific IDs
- Remove the `findExerciseOfSet` call since we're updating all panels

### 2. Modify `switchExerciseTab()` for Timer Tab Sync

**File**: `static/js/workouts.js`
**Function**: `switchExerciseTab` (lines 1878-1918)

**Changes**: In the `targetTab === 'timer'` block (lines 1912-1917), replace the `updateTimerPanel` call with immediate timer state population:

```javascript
if (targetTab === 'timer') {
    const exercise = this.currentSession?.exercises?.find(ex => String(ex.id) === String(exerciseId));
    if (exercise) {
        // If timer is active, immediately populate the panel with live data
        // instead of full re-render which causes flicker
        if (this.activeRestForSetId != null || this.restTimerStartTime != null) {
            // Timer is running - update live elements directly
            this.updateRestTimerUI();
        } else {
            // No active timer - render the static panel
            this.updateTimerPanel(exerciseId, exercise, rootContainer);
        }
    }
}
```

### 3. Ensure Timer Panel Has Correct Selectors for Live Updates

**File**: `static/js/workouts.js`
**Function**: `renderTimerPanel` (lines 1758-1851)

**Current issue**: The timer panel uses IDs like `rest-timer-remaining-${exercise.id}` which are specific to each exercise. For the multi-panel update to work, we need consistent selectors.

**Solution**: Keep the exercise-specific IDs for the initial render, but in `updateRestTimerUI` use attribute-start selectors (`[id^="rest-timer-remaining-"]`) to find all timer displays regardless of exercise ID.

The current `renderTimerPanel` already generates unique IDs per exercise, which is fine. The `updateRestTimerUI` modification using `[id^="..."]` selectors will find all of them.

### 4. Handle Timer Mode/Preset Changes Across All Panels

**File**: `static/js/workouts.js`
**Function**: `refreshAllTimerPanels` (lines 1930-1936)

**Current behavior**: Re-renders all timer panels completely when mode/preset changes.

**Required**: Keep this for mode/preset changes (they change the panel structure), but for live timer updates use the new `updateRestTimerUI` approach.

No code change needed here - `refreshAllTimerPanels` is called from `saveRestTimerMode`, `saveRestTimerPreset`, and `applyRestTimerModeUI` which are triggered by user interaction, not the timer interval.

## Edge Cases & Considerations

1. **Multiple exercise cards with timer tab open**: All will show the same running timer (the one for the recently completed set). This is the intended behavior per the task description.

2. **Timer tab closed then reopened**: `switchExerciseTab` will call `updateRestTimerUI()` which finds the newly visible panel and updates it.

3. **Background/foreground tab**: `rearmRestTimer()` (line 1654) already handles resuming the interval. The 100ms interval will call `updateRestTimerUI()` which updates all visible panels.

4. **No active timer**: `updateRestTimerUI` returns early if `activeRestForSetId == null`. The panels will show "Таймер отдыха не запущен" from the initial render.

5. **Performance**: Updating multiple panels every 100ms is lightweight (just textContent and className changes on a few elements).

## Validation Steps

1. Start a workout with multiple exercises
2. Complete a set (not the last one) in Exercise 1
3. Verify timer starts automatically
4. Open Timer tab in Exercise 1 - should show live countdown/stopwatch
5. Swipe to Exercise 2, open Timer tab - should show SAME live timer
6. Switch between exercises with Timer tabs open - all should update in sync
7. Change timer mode (Timer ↔ Stopwatch) - all panels should re-render with new mode
8. Change preset - all panels should update
9. Complete next set - timer should save rest time and start new one
10. Background the tab, return - timer should resume correctly

## Files to Modify

1. `static/js/workouts.js`:
   - `updateRestTimerUI()` (lines 1670-1745) - Major rewrite to update all visible panels
   - `switchExerciseTab()` (lines 1912-1917) - Modify timer tab handling

## Risk Assessment

**Low Risk**: 
- Changes are confined to two functions
- No changes to data persistence or API calls
- Timer logic (countdown/stopwatch) remains unchanged
- Only the UI update mechanism changes

**Testing Required**:
- Verify timer displays correctly in multiple exercise cards simultaneously
- Verify no memory leaks from interval (existing `stopRestTimer`/`rearmRestTimer` handles this)
- Verify tab switching doesn't cause flicker
- Verify offline/local session behavior unchanged