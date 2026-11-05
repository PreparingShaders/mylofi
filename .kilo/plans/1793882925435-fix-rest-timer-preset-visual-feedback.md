# Fix Rest Timer UI Updates (Mode Toggle, Presets, Progress Bar)

## Problem (from actual HTML output)
User reports:
- Preset buttons (30s, 1m, 1.5m, 2m, 3m) click works internally but **active state not visually updating** (no green background)
- Mode toggle (Timer/Stopwatch) **doesn't visually update on click** - requires page refresh
- Progress bar **stuck at 0%** while timer counts (`style="width: 0%"`)
- Sometimes shows "Таймер отдыха не запущен" incorrectly

## Current HTML State Analysis
```html
<!-- Mode: stopwatch active -->
<span class="... translate-x-full"></span>  <!-- slider position -->
<button data-mode="timer" aria-pressed="false">Таймер</button>
<button data-mode="stopwatch" aria-pressed="true">Секундомер</button>

<!-- Presets: 180s (3m) active -->
<button data-preset="180" aria-pressed="true">3м</button>

<!-- Timer display: stopwatch UI counting up -->
<span id="rest-timer-remaining-468">00:40</span>  <!-- counting UP -->
<span class="w-2 h-2 rounded-full bg-lime-500 animate-pulse"></span>  <!-- pulsing dot = stopwatch -->

<!-- PROBLEM: Progress bar at 0% while timer runs -->
<div id="rest-timer-progress-wrap-468" style="display: block; width: 33.333333%;">
  <div id="rest-timer-progress-468" style="width: 0%"></div>  <!-- STUCK AT 0% -->
</div>
```

## Root Causes Identified

### 1. Mode toggle refreshes wrong container
**File**: `static/js/workouts.js`, `_handleWorkoutClick` (lines ~4462-4468)
- Mode handler calls `saveRestTimerMode(mode)` → `applyRestTimerModeUI()` → `refreshAllTimerPanels(this.app?.elements?.pageContent || document)`
- Preset handler calls `refreshAllTimerPanels(e.currentTarget)` with delegated event's container
- **Containers differ** → mode toggle updates wrong DOM tree

### 2. Progress bar not updating in stopwatch mode
**File**: `static/js/workouts.js`, `updateRestTimerUI()` 
- Stopwatch mode counts UP from 0, no planned duration → progress % calculation fails
- Progress bar only works in timer mode (countdown with known duration)
- Need to either hide progress bar in stopwatch mode or show elapsed % of some reference

### 3. Preset active state classes not applied on click
- `renderTimerPanel` correctly sets `aria-pressed` and conditional classes based on `activePreset`
- But click handler for presets calls `updateTimerDuration` → `refreshAllTimerPanels` which re-renders
- If container mismatch, re-render doesn't hit the visible panel

### 4. "Таймер отдыха не запущен" shows incorrectly
- `renderTimerPanel` line ~1865: `timerActive` check uses `this.activeRestForSetId` or `this.restTimerStartTime`
- If timer was started for different exercise, this exercise shows "not started"

## Affected Files
- `static/js/workouts.js` - Main workout logic with timer panel rendering and updates

## Fix Plan

### 1. Fix mode toggle container mismatch (HIGH PRIORITY)
**File**: `static/js/workouts.js`, `_handleWorkoutClick` lines ~4462-4468

```javascript
// ADD explicit refresh with e.currentTarget (matches preset handler)
const modeBtn = e.target.closest('[data-action="rest-timer-mode"]');
if (modeBtn) {
    e.stopPropagation();
    const mode = modeBtn.dataset.mode;
    this.saveRestTimerMode(mode);
    this.refreshAllTimerPanels(e.currentTarget);  // <-- ADD THIS LINE
    return;
}
```

### 2. Fix progress bar in stopwatch mode
**File**: `static/js/workouts.js`, `updateRestTimerUI()` method

Find where progress bar width is set (search for `rest-timer-progress-`). In stopwatch mode:
- Either hide progress wrap (`display: none`)
- Or calculate progress against a default/max duration (e.g., 10 minutes)
- Current code likely only updates progress in timer mode

### 3. Ensure preset active state renders correctly
**File**: `static/js/workouts.js`, `renderTimerPanel` lines ~1847-1851

Verify the active preset class logic:
```javascript
class="... ${activePreset === sec 
    ? 'bg-primary-600 text-white dark:bg-primary-500 dark:text-zinc-950 shadow-[0_0_0_1px_rgba(132,204,22,0.5)] shadow-sm' 
    : 'bg-white/5 dark:bg-white/10 text-surface-600 dark:text-surface-300 hover:bg-white/10 dark:hover:bg-white/20'}"
```
This looks correct - `activePreset` comes from `currentPreset` which comes from `this.restTimerPresetSeconds` or localStorage.

### 4. Fix "Таймер отдыха не запущен" false positive
**File**: `static/js/workouts.js`, `renderTimerPanel` line ~1816-1817

```javascript
const timerActive = (this.activeRestForSetId != null || this.restTimerStartTime != null) &&
    (activeExId == null || String(activeExId) === String(exercise.id));
```
If timer runs for exercise A, exercise B shows "not started" - this is correct behavior. But if user switches tabs, the panel should update when they switch TO the timer tab.

## Validation Steps
1. Open workout screen with active session
2. Go to Timer tab on any exercise
3. Click Timer/Stopwatch toggle → **slider animates, button colors swap instantly**
4. Click preset buttons (30s, 1m, 1.5m, 2m, 3m) → **green background appears instantly on clicked button**
5. Start timer (complete a set) → **progress bar fills in timer mode**, **hidden or shows elapsed% in stopwatch mode**
6. Switch between exercises → **each shows correct timer state**
7. Hard refresh → **mode/preset persists from localStorage**

## Testing Edge Cases
- Switch modes while timer running → UI updates correctly
- Rapid preset clicks → no flicker, final selection shows
- Multiple exercises with different timer states → each panel independent
- Navigate away/back → state persists