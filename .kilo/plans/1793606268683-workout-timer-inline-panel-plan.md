# Inline Timer Panel UI Improvements - Implementation Plan

## Overview
Enhance the inline timer panel in workout exercise cards with 8 key improvements:
1. Single-row preset layout (no wrapping)
2. Compact timer block (reduced height/padding)
3. High-contrast active preset indication
4. "Готов / Сохранить" button saves rest time inline
5. Clear visual mode toggle indicator (Timer/Stopwatch)
6. **Event delegation for Timer/Stopwatch tabs** - fix tab switching breaking after re-renders
7. **Preset highlighting sync with input value** - 120s highlights "2м", custom values clear preset highlights
8. **Maximum compactness** - further reduce vertical padding, smaller timer font, less bulky button

## Current State Analysis

### Timer Panel Structure (`renderTimerPanel`, lines 1806-1885)
- **Mode toggle**: Two buttons with sliding indicator (`.translate-x-full` / `.translate-x-0`)
- **Timer mode controls**: Presets row (flex-wrap) + custom input row (separate)
- **Active timer display**: Large timer with progress bar + "Готов / Сохранить" button
- **Inactive state**: "Таймер отдыха не запущен"

### Key Issues to Fix
1. **Presets wrap to multiple lines** - `flex-wrap` on presets container + separate custom input row
2. **Too much vertical space** - `space-y-2`, `p-2`, `py-2`, large font sizes
3. **Weak active preset styling** - Only `border-primary-500` + `bg-primary-500/10`
4. **"Готов / Сохранить" doesn't show inline rest time** - `stopAndSaveRestTimer` saves but comment says "No longer rendering inline rest-time"
5. **Mode toggle indicator** - Works but could be more prominent
6. **Tab handlers break after re-renders** - `rest-timer-mode` click handlers are attached inline in `renderTimerPanel` but not re-bound after `refreshAllTimerPanels` or `updateTimerPanel` re-renders the panel
7. **Preset highlighting out of sync with input** - When user types custom value in input, preset buttons don't update; preset selection doesn't always match input value precisely
8. **Timer block still too tall** - Vertical padding (`p-1.5`, `space-y-1`), font size (`text-xl`), button height (`py-1.5`) can be reduced further for maximum compactness

## Implementation Plan

### 1. Single-Row Presets Layout

**File**: `static/js/workouts.js`
**Function**: `renderTimerPanel` (lines 1833-1852)

**Changes**:
- Combine presets and custom input into single flex row
- Use `flex-nowrap` with horizontal scroll for presets
- Custom input as fixed-width element at end

```javascript
if (mode === 'timer') {
    const presets = [30, 60, 90, 120, 180];
    const presetLabels = { 30: '30с', 60: '1м', 90: '1.5м', 120: '2м', 180: '3м' };
    html += `
        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1" data-timer-presets>
            ${presets.map(sec => `
                <button type="button" data-action="rest-timer-preset" data-preset="${sec}"
                        class="flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${currentPreset === sec 
                            ? 'bg-primary-600 text-white dark:bg-primary-500 dark:text-zinc-950 shadow-sm' 
                            : 'bg-white/5 dark:bg-white/10 text-surface-600 dark:text-surface-300 hover:bg-white/10 dark:hover:bg-white/20'}"
                        aria-pressed="${currentPreset === sec}">
                    ${presetLabels[sec] || (sec + 'с')}
                </button>
            `).join('')}
            <div class="flex-shrink-0 flex items-center gap-1" data-timer-custom>
                <input type="number" min="1" max="600" data-action="rest-timer-custom"
                       value="${currentPreset}" placeholder="Сек"
                       class="w-14 glass-input rounded-md px-2 py-1 text-[10px] font-mono tabular-nums text-center">
                <span class="text-[10px] text-surface-500 whitespace-nowrap">сек</span>
            </div>
        </div>
    `;
}
```

**CSS Addition** (`static/css/styles.css`):
```css
.scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
    display: none;
}
```

### 2. Compact Timer Block

**File**: `static/js/workouts.js`
**Function**: `renderTimerPanel`

**Changes** - Reduce spacing and sizing throughout:

```javascript
// Outer container: space-y-2 → space-y-1.5, reduce padding
let html = `
    <div class="space-y-1.5 p-1.5">
        // Mode toggle: smaller, tighter
        <div class="relative flex rounded-md glass p-0.5 gap-0.5">
            <span class="absolute inset-y-0.5 w-[calc(50%-2px)] bg-primary-600 rounded-[6px] shadow-sm transition-transform duration-200 ${mode === 'stopwatch' ? 'translate-x-full' : 'translate-x-0'}"></span>
            <button type="button" data-action="rest-timer-mode" data-mode="timer"
                    class="relative flex-1 py-1 px-1.5 rounded-[6px] text-[10px] font-semibold transition-colors ${mode === 'timer' ? 'text-white' : 'text-surface-600 dark:text-surface-300'}"
                    aria-pressed="${mode === 'timer'}">
                Таймер
            </button>
            <button type="button" data-action="rest-timer-mode" data-mode="stopwatch"
                    class="relative flex-1 py-1 px-1.5 rounded-[6px] text-[10px] font-semibold transition-colors ${mode === 'stopwatch' ? 'text-white' : 'text-surface-600 dark:text-surface-300'}"
                    aria-pressed="${mode === 'stopwatch'}">
                Секундомер
            </button>
        </div>
        
        // Presets row (from change #1 above)
        
        // Active timer display: smaller padding, smaller text
        ${timerActive ? `
            <div class="p-1.5 rounded-lg glass flex flex-col items-center justify-center space-y-1">
                <div class="flex items-baseline gap-0.5 font-mono text-xl font-bold tabular-nums ${isOvertime ? 'text-rose-500 dark:text-rose-400 animate-pulse' : 'text-lime-400 dark:text-lime-300'}">
                    <span id="rest-timer-remaining-${exercise.id}">00:00</span>
                    <span class="text-[9px] font-normal text-surface-400" id="rest-timer-ms-${exercise.id}">00</span>
                </div>
                <div class="w-full bg-surface-200 dark:bg-zinc-800 h-1 rounded-full overflow-hidden" id="rest-timer-progress-wrap-${exercise.id}">
                    <div class="h-full bg-lime-400 dark:bg-lime-300 transition-all duration-100" id="rest-timer-progress-${exercise.id}" style="width: 0%"></div>
                </div>
                <button type="button" data-action="dismiss-rest-timer"
                        class="w-full py-1.5 bg-primary-600 hover:bg-primary-700 text-white dark:bg-primary-500 dark:hover:bg-primary-600 rounded-md font-semibold text-[10px] transition-colors">
                    Готов / Сохранить
                </button>
            </div>
        ` : `
            <div class="text-center py-1.5 text-[10px] text-surface-500">
                Таймер отдыха не запущен
            </div>
        `}
    </div>
`;
```

### 3. High-Contrast Active Preset Indication

**File**: `static/js/workouts.js`
**Function**: `renderTimerPanel` (preset button classes)

**Changes** - Use strong visual distinction:
```javascript
// Active preset: solid primary background, white text, shadow
// Inactive preset: subtle glass background, hover state
class="${currentPreset === sec 
    ? 'bg-primary-600 text-white dark:bg-primary-500 dark:text-zinc-950 shadow-[0_0_0_1px_rgba(132,204,22,0.5)] shadow-sm' 
    : 'bg-white/5 dark:bg-white/10 text-surface-600 dark:text-surface-300 hover:bg-white/10 dark:hover:bg-white/20'}"
```

### 4. "Готов / Сохранить" Saves Rest Time Inline

**File**: `static/js/workouts.js`
**Function**: `stopAndSaveRestTimer` (lines 1593-1644)

**Current Issue**: Line 1613 says "No longer rendering inline rest-time" but the requirement is TO show it inline.

**Changes**:
1. Uncomment/call `applyRestTimeInline` after saving
2. Ensure the saved rest time appears between the completed set and the next set

```javascript
async stopAndSaveRestTimer(session) {
    const sess = session || this.currentSession;
    if (!sess || this.restTimerStartTime == null) {
        this.stopRestTimer();
        return;
    }
    const elapsed = Math.max(0, Math.floor((Date.now() - this.restTimerStartTime) / 1000));
    
    let setId = this.activeRestForSetId;
    if (!setId && this.activeRestExerciseId) {
        const exercise = sess.exercises?.find(ex => String(ex.id) === String(this.activeRestExerciseId));
        const lastSet = exercise?.sets?.filter(s => s.is_completed).pop();
        setId = lastSet?.id;
    }

    if (setId) {
        const targetSet = this.findSetInSession(sess, setId);
        if (targetSet) {
            targetSet.rest_time_seconds = elapsed;
            // ADD: Show inline rest time after the completed set
            this.applyRestTimeInline(setId, elapsed);
        }
        this.lastSavedRestSetId = setId;
    }

    const ownerEx = setId ? this.findExerciseOfSet(sess, setId)?.exercise : 
                    (this.activeRestExerciseId ? sess.exercises?.find(ex => String(ex.id) === String(this.activeRestExerciseId)) : null);

    this.stopRestTimer();
    this.activeRestForSetId = null;
    this.activeRestExerciseId = null;
    this.restTimerStartTime = null;
    this.restTimerTargetTimestamp = null;
    this.restTimerPlannedDuration = null;
    this.restTimerOvertime = false;
    this.updateRestTimerUI();

    if (ownerEx?.id) {
        this.updateTimerPanel(ownerEx.id, ownerEx, this.app?.elements?.pageContent || document);
    }

    if (setId && !this.isLocalSession(sess)) {
        const token = this.app?.state?.tokens?.access;
        if (token) {
            API.patch(`/workouts/sets/${setId}`, { rest_time_seconds: elapsed }, token).catch(() => {});
        }
    }
    if (this.isLocalSession(sess)) {
        this.persistLocalSession(sess);
        if (setId) this.recordLocalSetPatch(sess.key, setId, { rest_time_seconds: elapsed });
    }
}
```

### 5. Enhanced Mode Toggle Visual Indicator

**File**: `static/js/workouts.js`
**Function**: `renderTimerPanel` (mode toggle, lines 1818-1830)

**Current**: Sliding span with `translate-x-full` / `translate-x-0`

**Enhancement**: Make indicator more prominent with:
- Better contrast
- Clearer animation
- Active button gets white text, inactive gets muted

```javascript
<div class="relative flex rounded-md glass p-0.5 gap-0.5">
    <!-- Enhanced sliding indicator with stronger visual -->
    <span class="absolute inset-y-0.5 w-[calc(50%-2px)] bg-primary-600 rounded-[6px] shadow-[0_2px_4px_rgba(132,204,22,0.4)] transition-transform duration-200 ease-out ${mode === 'stopwatch' ? 'translate-x-full' : 'translate-x-0'}"></span>
    <button type="button" data-action="rest-timer-mode" data-mode="timer"
            class="relative z-10 flex-1 py-1 px-1.5 rounded-[6px] text-[10px] font-semibold transition-all duration-200 ${mode === 'timer' 
                ? 'text-white shadow-sm' 
                : 'text-surface-600 dark:text-surface-300'}"
            aria-pressed="${mode === 'timer'}">
        Таймер
    </button>
    <button type="button" data-action="rest-timer-mode" data-mode="stopwatch"
            class="relative z-10 flex-1 py-1 px-1.5 rounded-[6px] text-[10px] font-semibold transition-all duration-200 ${mode === 'stopwatch' 
                ? 'text-white shadow-sm' 
                : 'text-surface-600 dark:text-surface-300'}"
            aria-pressed="${mode === 'stopwatch'}">
        Секундомер
    </button>
</div>
```

**CSS Addition** for smoother animation:
```css
/* Timer mode toggle indicator */
.exercise-tab-panel [data-timer-presets] .transition-transform {
    transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

## Additional Implementation Plan

### 6. Event Delegation for Timer/Stopwatch Tabs

**Problem**: Mode toggle buttons (`data-action="rest-timer-mode"`) are rendered inside `renderTimerPanel` with inline click handlers. When `refreshAllTimerPanels` or `updateTimerPanel` re-renders the panel content, the handlers are lost because they were attached to the old DOM elements.

**Solution**: Use event delegation on a stable parent container (the workout container or document) instead of inline handlers.

**File**: `static/js/workouts.js`
**Function**: `bindWorkoutScreenEvents` (around line 4116) - add delegation handler

**Changes**:
```javascript
// In bindWorkoutScreenEvents, add this delegation handler (once per container):
container.addEventListener('click', (e) => {
    const modeBtn = e.target.closest('[data-action="rest-timer-mode"]');
    if (modeBtn) {
        e.stopPropagation();
        const mode = modeBtn.dataset.mode;
        this.saveRestTimerMode(mode);
        this.refreshAllTimerPanels(container);
        return;
    }
    
    const presetBtn = e.target.closest('[data-action="rest-timer-preset"]');
    if (presetBtn) {
        e.stopPropagation();
        const seconds = parseInt(presetBtn.dataset.preset);
        if (!isNaN(seconds)) {
            this.saveRestTimerPreset(seconds);
            if (this.restTimerMode === 'timer' && this.restTimerStartTime != null) {
                this.restTimerPlannedDuration = seconds * 1000;
                this.restTimerTargetTimestamp = this.restTimerStartTime + this.restTimerPlannedDuration;
                this.restTimerOvertime = false;
                this.updateRestTimerUI();
            }
            this.refreshAllTimerPanels(container);
        }
        return;
    }
    
    const dismissBtn = e.target.closest('[data-action="dismiss-rest-timer"]');
    if (dismissBtn) {
        e.stopPropagation();
        this.stopAndSaveRestTimer(session);
        return;
    }
});

// Also handle custom input change via delegation:
container.addEventListener('change', (e) => {
    const customInput = e.target.closest('[data-action="rest-timer-custom"]');
    if (customInput) {
        const seconds = parseInt(customInput.value);
        if (isNaN(seconds) || seconds < 1) return;
        this.saveRestTimerPreset(seconds);
        if (this.restTimerMode === 'timer' && this.restTimerStartTime != null) {
            this.restTimerPlannedDuration = seconds * 1000;
            this.restTimerTargetTimestamp = this.restTimerStartTime + this.restTimerPlannedDuration;
            this.restTimerOvertime = false;
            this.updateRestTimerUI();
        }
        this.refreshAllTimerPanels(container);
    }
});
```

**Note**: Remove the inline `onclick` or event attachment from `renderTimerPanel` - the delegation handles it. The `data-action` attributes remain for the delegation to work.

### 7. Preset Highlighting Sync with Input Value

**Problem**: 
- When user types a value matching a preset (e.g., 120), that preset should highlight
- When user types a custom value (e.g., 45), all presets should be unhighlighted
- When user clicks a preset, input should update and that preset should highlight

**Solution**: In `refreshAllTimerPanels` / `updateTimerPanel`, compute the active preset from `restTimerPresetSeconds` and pass it to `renderTimerPanel`. Also add an `input` event listener on the custom input to update highlighting in real-time.

**File**: `static/js/workouts.js`
**Function**: `renderTimerPanel` and `refreshAllTimerPanels`

**Changes**:

1. **In `renderTimerPanel`** - compute active preset dynamically based on current input value:
```javascript
// At the start of renderTimerPanel, compute which preset matches current value:
const currentPreset = this.restTimerPresetSeconds || this.getStoredRestTimerPreset();
// Determine if current value matches a preset exactly
const presetValues = [30, 60, 90, 120, 180];
const activePreset = presetValues.includes(currentPreset) ? currentPreset : null;

// In the presets map, use activePreset for comparison:
${presets.map(sec => `
    <button type="button" data-action="rest-timer-preset" data-preset="${sec}"
            class="flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${activePreset === sec 
                ? 'bg-primary-600 text-white dark:bg-primary-500 dark:text-zinc-950 shadow-sm' 
                : 'bg-white/5 dark:bg-white/10 text-surface-600 dark:text-surface-300 hover:bg-white/10 dark:hover:bg-white/20'}"
            aria-pressed="${activePreset === sec}">
        ${presetLabels[sec] || (sec + 'с')}
    </button>
`).join('')}
```

2. **Add real-time input handler** in `bindWorkoutScreenEvents` (or via delegation):
```javascript
// In the delegation change handler, also handle input event for real-time preset sync:
container.addEventListener('input', (e) => {
    const customInput = e.target.closest('[data-action="rest-timer-custom"]');
    if (customInput) {
        const value = parseInt(customInput.value);
        const presetValues = [30, 60, 90, 120, 180];
        // Update preset button highlights in real-time without full re-render
        const panel = customInput.closest('[data-tab-panel="timer"]');
        if (panel) {
            panel.querySelectorAll('[data-action="rest-timer-preset"]').forEach(btn => {
                const presetSec = parseInt(btn.dataset.preset);
                const isActive = !isNaN(value) && presetSec === value;
                if (isActive) {
                    btn.className = 'flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors bg-primary-600 text-white dark:bg-primary-500 dark:text-zinc-950 shadow-sm';
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.className = 'flex-shrink-0 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors bg-white/5 dark:bg-white/10 text-surface-600 dark:text-surface-300 hover:bg-white/10 dark:hover:bg-white/20';
                    btn.setAttribute('aria-pressed', 'false');
                }
            });
        }
        // Note: Don't save preset on input - only on change/blur to avoid excessive writes
    }
});
```

3. **On change/blur of custom input**, save the preset and trigger full panel refresh:
```javascript
container.addEventListener('change', (e) => {
    const customInput = e.target.closest('[data-action="rest-timer-custom"]');
    if (customInput) {
        const seconds = parseInt(customInput.value);
        if (isNaN(seconds) || seconds < 1) return;
        this.saveRestTimerPreset(seconds);
        if (this.restTimerMode === 'timer' && this.restTimerStartTime != null) {
            this.restTimerPlannedDuration = seconds * 1000;
            this.restTimerTargetTimestamp = this.restTimerStartTime + this.restTimerPlannedDuration;
            this.restTimerOvertime = false;
            this.updateRestTimerUI();
        }
        this.refreshAllTimerPanels(container); // Full refresh to sync everything
    }
});
```

### 8. Maximum Compactness for Timer/Stopwatch Block

**File**: `static/js/workouts.js`
**Function**: `renderTimerPanel` (active timer display section)

**Changes** - Further reduce vertical space:

```javascript
// Active timer display: ultra-compact
${timerActive ? `
    <div class="p-1 rounded-md glass flex flex-col items-center justify-center space-y-0.5">
        <div class="flex items-baseline gap-0.5 font-mono text-lg font-bold tabular-nums ${isOvertime ? 'text-rose-500 dark:text-rose-400 animate-pulse' : 'text-lime-400 dark:text-lime-300'}">
            <span id="rest-timer-remaining-${exercise.id}">00:00</span>
            <span class="text-[8px] font-normal text-surface-400" id="rest-timer-ms-${exercise.id}">00</span>
        </div>
        <div class="w-full bg-surface-200 dark:bg-zinc-800 h-1 rounded-full overflow-hidden" id="rest-timer-progress-wrap-${exercise.id}">
            <div class="h-full bg-lime-400 dark:bg-lime-300 transition-all duration-100" id="rest-timer-progress-${exercise.id}" style="width: 0%"></div>
        </div>
        <button type="button" data-action="dismiss-rest-timer"
                class="w-full py-1 bg-primary-600 hover:bg-primary-700 text-white dark:bg-primary-500 dark:hover:bg-primary-600 rounded-md font-semibold text-[10px] transition-colors">
            Готов / Сохранить
        </button>
    </div>
` : `
    <div class="text-center py-1 text-[10px] text-surface-500">
        Таймер отдыха не запущен
    </div>
`}

// Also reduce outer container spacing:
<div class="space-y-1 p-1">
    // ... mode toggle (already compact)
    // ... presets row (already compact)
    // ... timer display (updated above)
</div>
```

**Specific reductions**:
- Outer padding: `p-1.5` → `p-1`
- Vertical spacing: `space-y-1.5` → `space-y-1`
- Timer display padding: `p-1.5` → `p-1`
- Timer display gap: `space-y-1` → `space-y-0.5`
- Timer font: `text-xl` → `text-lg`
- Milliseconds font: `text-[9px]` → `text-[8px]`
- Button padding: `py-1.5` → `py-1`
- Progress bar height: `h-1.5` → `h-1` (already `h-1` in plan)
- Border radius: `rounded-lg` → `rounded-md`

## Additional Considerations

### updateRestTimerUI Compatibility
The existing `updateRestTimerUI` (lines 1672-1792) uses `[id^="rest-timer-remaining-"]` selectors which will work with the new compact layout since IDs remain the same.

### refreshAllTimerPanels
Called when mode/preset changes - will re-render with new compact layout automatically.

### Inline Rest Time Styling
Current `renderRestTimeInline` (line 1976-1982) and `applyRestTimeInline` (line 1985-1999) produce:
```html
<div class="rest-time-inline flex items-center gap-1 ml-4 mt-0.5 text-[10px] text-surface-500 dark:text-surface-400 font-mono tabular-nums">
    <span aria-hidden="true">⏱</span>
    <span class="font-semibold text-surface-600 dark:text-surface-300">Отдых:</span>
    <span class="font-mono tabular-nums">00:45</span>
</div>
```
This is already compact and appropriate.

### Event Delegation Benefits
- Handlers survive all re-renders (no need to re-bind after `refreshAllTimerPanels`)
- Single listener on container instead of many per-panel
- Automatically works for dynamically added exercise cards

### Preset Sync Strategy
- Real-time visual feedback on `input` event (no save, just highlight update)
- Persistent save on `change`/`blur` event (triggers `refreshAllTimerPanels`)
- `renderTimerPanel` computes active preset from `restTimerPresetSeconds` for initial render correctness

## Files to Modify

1. **`static/js/workouts.js`**:
   - `renderTimerPanel` (lines 1806-1885) - Major rewrite for compact layout, single-row presets, dynamic preset highlighting
   - `stopAndSaveRestTimer` (lines 1593-1644) - Enable inline rest time display
   - `bindWorkoutScreenEvents` (lines 4116+) - Add event delegation for mode toggle, presets, custom input, dismiss button

2. **`static/css/styles.css`**:
   - Add `.scrollbar-hide` utility class
   - Optional: Enhanced transition for mode toggle indicator

## Validation Steps

1. **Single-row presets**: Open timer panel in timer mode → verify all 5 presets + custom input fit in one scrollable row
2. **Compact height**: Compare timer panel height vs Dynamics tab → should be similar or smaller
3. **Active preset contrast**: Select different presets → active should be clearly highlighted (primary bg, white text)
4. **Save rest time**: Complete a set → timer starts → click "Готов / Сохранить" → verify rest time appears inline between sets
5. **Mode toggle**: Switch between Timer/Stopwatch → sliding indicator moves smoothly, active button has white text
6. **Cross-exercise sync**: Open timer tab on multiple exercises → all show live timer
7. **Responsive**: Test on narrow screens → presets scroll horizontally, custom input stays accessible
8. **Tab handlers persist**: Switch modes, trigger re-render (e.g., complete a set), switch modes again → should work without page reload
9. **Preset-input sync**: 
   - Type 120 in custom input → "2м" preset highlights
   - Type 45 in custom input → all presets unhighlighted
   - Click "1.5м" preset → input shows 90, "1.5м" highlights
   - Blur input after custom value → panel refreshes, preset state correct
10. **Ultra-compact timer**: Active timer block height minimized, font smaller, button less tall

## Risk Assessment

**Low Risk**:
- Changes are confined to UI rendering functions and event binding
- No changes to timer logic, persistence, or API calls
- Existing `updateRestTimerUI` selectors remain compatible
- Inline rest time feature was previously implemented (just disabled)
- Event delegation is a safer pattern than inline handlers

**Medium Risk**:
- Event delegation changes handler attachment pattern - must ensure all timer actions are covered
- Real-time preset sync on `input` event adds DOM manipulation during typing - must be performant
- Further compactness reductions may affect touch target sizes on mobile

**Testing Required**:
- Verify horizontal scroll works on mobile for presets row
- Verify timer display updates correctly in all open panels
- Verify inline rest time appears at correct position (after completed set, before next)
- Verify mode toggle persistence across re-renders
- Verify event delegation works for all timer actions (mode, preset, custom input, dismiss)
- Verify preset highlighting syncs correctly in all scenarios (click preset, type matching value, type custom value, blur)
- Verify compact timer block still usable on small screens