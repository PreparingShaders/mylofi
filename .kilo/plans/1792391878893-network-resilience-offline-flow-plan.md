# Implementation Plan: Active Workout Interface Fixes & Polish

## Overview
Fix 5 critical issues in the active workout interface (`static/js/workouts.js` + `static/css/styles.css`). These are immediate fixes for UI problems observed in the browser:

1. Remove left cancel tile ("менять тренировку") — cancel is now via red circle in track
2. Fix "Set not found" error on set deletion — modal closes instantly, DOM row removed without re-requests
3. Rest timer redesign — no emojis, clean layout, milliseconds, `inputmode="numeric"`
4. Timer auto-start toggle in exercise card header
5. Liquid fill circles — bigger wave amplitude, track padding fix so glow isn't cut off

---

## Issue 1: Remove Left "Менять тренировку" Tile

### Current Problem
The leftmost card in the carousel (`cancelCard`, lines ~2896-2902) is a dashed-border card with "Отменить тренировку" text. This is redundant — cancellation is now handled by the red circle with `×` icon in the exercise track at the top. The tile clutters the interface and takes space.

### Fix
**File**: `static/js/workouts.js` — `renderWorkoutScreen`

1. **Remove the `cancelCard` variable** (lines ~2896-2902)
2. **Remove it from `allCards` array** — change from `[cancelCard, ...exerciseCards, addExerciseCard, completeCard]` to `[...exerciseCards, addExerciseCard, completeCard]`
3. **Verify carousel still works** — `scrollToExerciseCard` uses index-based selection; removing cancel card shifts exercise indices by -1

### Secondary Fix: Track Carousel Index
If `scrollToExerciseCard` was accounting for cancel card at index 0, update:
```javascript
// Exercise at index `exerciseIndex` is at position exerciseIndex in carousel
// (no longer offset by cancelCard)
```

### Files
- `static/js/workouts.js` — `renderWorkoutScreen`

---

## Issue 2: Fix "Set not found" Error on Set Deletion

### Current Problem
When deleting a set:
1. Confirmation modal opens
2. After confirmation, `API.delete` is called
3. Then `removeSetRow` is called
4. But if there's a race condition or the DOM element isn't found, backend throws "Set not found" — possibly because the set row was already removed or the wrong set ID was sent

### Root Cause Hypothesis
Looking at `handleSetDelete` (lines ~3440-3511):
- `exercise.sets = exercise.sets.filter((s, i) => i !== setIndex)` — removes from state
- Then calls `API.delete(`/workouts/sets/${removedSet.id}`, token)` — sends to backend
- Then calls `removeSetRow(card, row, removedSet, exercise)` — removes from DOM
- But `removeSetRow` re-renders/renumbers sets which may cause a mismatch

Also, `closeAllSetDropdowns()` is called before confirmation, but the modal itself may not close instantly — user says modal stays open after confirmation.

### Fix

**File**: `static/js/workouts.js` — `handleSetDelete`

1. **Close modal immediately** on confirmation (before API call)
2. **Remove DOM row instantly** before/alongside API call
3. **Handle API failure gracefully** — if "Set not found", the set is already gone from DOM and state, so just log and continue

```javascript
const handleSetDelete = async (e) => {
    const btn = e.target.closest('[data-action="delete-set"]');
    if (!btn) return;
    e.stopPropagation();
    const setId = parseInt(btn.dataset.setId);
    if (isNaN(setId)) return;
    
    const card = btn.closest('[data-exercise-id]');
    const exId = parseInt(card?.dataset.exerciseId);
    const exercise = (session.exercises || []).find(ex => ex.id === exId);
    if (!exercise || !exercise.sets || exercise.sets.length === 0) return;

    const removedSet = exercise.sets.find(s => s.id === setId);
    if (!removedSet) return;
    const setIndex = exercise.sets.indexOf(removedSet);

    if (isLocal && exercise.sets.length <= 1) {
        app.showToast('Нужен минимум один подход', 'info');
        return;
    }

    const confirmed = await Components.confirmModal({
        title: 'Удалить подход?',
        message: 'Это действие необратимо. Вы уверены, что хотите удалить подход?',
        confirmText: 'Удалить',
        confirmClass: 'bg-red-600 hover:bg-red-700 text-white font-semibold shadow-md',
        cancelText: 'Отмена',
    });
    if (!confirmed) return;

    // Close modal instantly by removing from DOM
    closeAllSetDropdowns();

    // Remove from state immediately
    exercise.sets = exercise.sets.filter((s, i) => i !== setIndex);
    exercise.sets.forEach((s, i) => { s.set_number = i + 1; });
    this.exercisesModified = true;

    // Remove DOM row immediately
    const row = card.querySelector(`[data-set-id="${removedSet.id}"]`);
    const prevSet = setIndex > 0 ? exercise.sets[setIndex - 1] : null;
    if (removedSet.is_completed && prevSet && prevSet.rest_time_seconds != null) {
        prevSet.rest_time_seconds = null;
        this.applyRestTimeInline(prevSet.id, null);
    }
    if (row) {
        row.classList.add('set-row-exit');
        row.addEventListener('transitionend', () => row.remove(), { once: true });
        setTimeout(() => row.remove(), 300); // fallback
    }

    // Clear rest time on preceding set if needed
    this.renumberSetRows(card);
    this.updateWorkoutMetricsUI(session);

    // Persist/deleting via API — fire and forget, ignore "not found"
    if (isLocal) {
        this.persistLocalSession(session);
        this.recordLocalSetPatch(session.key, removedSet.id, { _deleted: true });
    } else if (token) {
        API.delete(`/workouts/sets/${removedSet.id}`, token)
            .catch(err => {
                if (err?.message?.includes('not found') || err?.status === 404) {
                    // Already gone — no action needed
                    return;
                }
                app.showToast(err.message || 'Ошибка удаления подхода', 'error');
                // Restore on error
                exercise.sets.splice(setIndex, 0, removedSet);
                exercise.sets.forEach((s, i) => { s.set_number = i + 1; });
                this.renderWorkoutScreen(container, app, sessionId);
            });
    }
};
```

### Files
- `static/js/workouts.js` — `handleSetDelete` (lines ~3440-3511)

---

## Issue 3: Rest Timer Redesign

### Current Problems
1. Emojis (⏱) in timer bar — user wants them removed
2. Layout is chaotic — presets, input, mode toggle, dismiss button are jumbled
3. Custom input doesn't use `inputmode="numeric"` for mobile digital keyboard
4. No milliseconds display for dynamic running numbers effect

### New Design

#### Layout Structure
```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────────────┐    ┌──────────┐ ┌──────┐ ┌──────┐        │
│  │   00:00.00   │    │ 30с      │ │ 1м   │ │ 1.5м │        │
│  │   (large)    │    └──────────┘ └──────┘ └──────┘        │
│  │   Отдых      │    ┌──────┐ [90 сек]                      │
│  │   (label)    │    │Секундомер│                           │
│  └──────────────┘    └────────┘                             │
│  [Готов]                                                      │
└─────────────────────────────────────────────────────────────┘
```

- **Left**: Large time display (MM:SS.ms) with state label below
- **Right**: Preset chips (horizontally scrollable) + custom input + mode toggle
- **Bottom**: "Готов" button full width

### HTML Changes (`renderWorkoutScreen`)

Replace the timer bar inner HTML (lines ~2954-2999):

```html
<div id="rest-timer-bar" class="hidden fixed bottom-16 left-0 right-0 z-50 rest-timer-bar"
     role="timer" aria-live="polite" aria-label="Таймер отдыха">
    <div class="rest-timer-bar__inner glass rounded-2xl w-full max-w-[92vw] mx-auto">
        <div class="rest-timer-main flex items-center gap-4 p-3">
            <!-- Left: Time + label -->
            <div class="rest-timer-time flex flex-col items-center gap-1">
                <span id="rest-timer-remaining" class="font-mono text-2xl font-bold text-lime-600 dark:text-lime-400 tabular-nums">00:00</span>
                <span id="rest-timer-ms" class="text-xs text-lime-600 dark:text-lime-400 tabular-nums">00</span>
                <span id="rest-timer-state" class="text-[10px] font-semibold text-surface-500 dark:text-surface-400 uppercase">Отдых</span>
            </div>
            
            <!-- Right: Presets + controls -->
            <div class="rest-timer-controls flex-1 flex flex-col gap-2">
                <!-- Mode toggle -->
                <div class="rest-timer-mode-toggle flex gap-1">
                    <button type="button" data-action="rest-timer-mode" data-mode="timer"
                            class="mode-btn flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors">Таймер</button>
                    <button type="button" data-action="rest-timer-mode" data-mode="stopwatch"
                            class="mode-btn flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors">Секундомер</button>
                </div>
                
                <!-- Presets (timer mode only) -->
                <div id="rest-timer-presets" class="rest-timer-presets flex gap-1.5 overflow-x-auto pb-1" data-timer-presets>
                    ${REST_TIMER_PRESETS.map(sec => `
                        <button type="button" data-action="rest-timer-preset" data-preset="${sec}"
                                class="preset-btn flex-shrink-0 px-2 py-1 rounded-lg text-xs font-semibold glass text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-white/10 transition-colors snap-start">
                            ${sec >= 60 ? `${sec / 60}м` : `${sec}с`}
                        </button>
                    `).join('')}
                </div>
                
                <!-- Custom input (timer mode only) -->
                <div id="rest-timer-custom" class="rest-timer-custom flex items-center gap-1" data-timer-custom>
                    <input type="number" min="1" max="600" inputmode="numeric" data-action="rest-timer-custom"
                           class="w-20 h-7 text-center text-xs font-mono rounded-lg glass-input focus:outline-none focus:border-primary-500"
                           placeholder="90">
                    <span class="text-[10px] text-surface-500 dark:text-surface-400">сек</span>
                </div>
            </div>
        </div>
        
        <!-- Bottom: Dismiss button -->
        <button id="rest-timer-dismiss" data-action="dismiss-rest-timer" type="button"
                class="rest-timer-dismiss w-full py-2 rounded-xl bg-lime-600 dark:bg-lime-500 text-white font-bold text-sm transition-colors hover:bg-lime-700 dark:hover:bg-lime-400"
                aria-label="Готов">
            Готов
        </button>
    </div>
</div>
```

### CSS Changes (`static/css/styles.css`)

```css
/* Rest timer bar — adaptive width, no overflow */
#rest-timer-bar.rest-timer-bar {
    bottom: calc(4rem + env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    pointer-events: none;
}

.rest-timer-bar__inner {
    pointer-events: auto;
    width: 100%;
    max-width: 92vw;
    margin: 0 auto;
    box-sizing: border-box;
}

/* Main layout: time left, controls right */
.rest-timer-main {
    display: flex;
    align-items: center;
    gap: 12px;
}

/* Time display: large, centered left */
.rest-timer-time {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 120px;
}

#rest-timer-remaining {
    font-size: 2rem; /* dynamic, grows with milliseconds */
}

#rest-timer-ms {
    font-size: 0.875rem;
    opacity: 0.8;
}

#rest-timer-state {
    opacity: 0.7;
}

/* Controls: flex column */
.rest-timer-controls {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

/* Mode toggle */
.rest-timer-mode-toggle {
    display: flex;
    gap: 2px;
}

.mode-btn {
    flex: 1;
    height: 32px;
}

.mode-btn[data-active="true"] {
    background: #1a2e05; /* lime-950/80 */
    color: #84cc16;
}

/* Presets — horizontal scroll */
.rest-timer-presets {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
    scrollbar-width: none;
}

.rest-timer-presets::-webkit-scrollbar {
    display: none;
}

.preset-btn {
    flex-shrink: 0;
    height: 32px;
    padding: 0 10px;
    scroll-snap-align: start;
}

/* Custom input */
.rest-timer-custom {
    display: flex;
    align-items: center;
    gap: 4px;
}

/* Dismiss button — full width bottom */
.rest-timer-dismiss {
    width: 100%;
    height: 40px;
}

/* Milliseconds animation */
@keyframes ms-tick {
    from { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
}

#rest-timer-ms {
    animation: ms-tick 1s infinite;
}
```

### Files
- `static/js/workouts.js` — `renderWorkoutScreen` timer HTML
- `static/css/styles.css` — rest timer styles

---

## Issue 4: Timer Auto-Start Toggle in Exercise Card Header

### Current Problem
Users cannot disable auto-start of rest timer after completing a set. The timer always starts automatically.

### Fix
Add a compact toggle switch in the exercise card header (right side, near name and up/down arrows).

### HTML Changes (in exercise card template, lines ~2852-2858)

Add toggle button after the up/down arrows:
```html
<button type="button"
        data-action="toggle-rest-auto"
        data-ex-id="${ex.id}"
        class="rest-auto-toggle w-6 h-6 rounded-lg glass text-surface-400 dark:text-surface-500 hover:text-surface-900 dark:hover:text-surface-100 flex items-center justify-center text-xs transition-colors"
        aria-label="Автозапуск таймера отдыха"
        aria-pressed="true">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
    </svg>
</svg>
```

### State Management
- Store per-exercise auto-start preference: `this.restAutoStart = {}` (Map<exerciseId, boolean>)
- Default: `true` (auto-start enabled)
- Toggle in `bindWorkoutScreenEvents`:
  ```javascript
  container.querySelectorAll('[data-action="toggle-rest-auto"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
          const exId = parseInt(e.currentTarget.dataset.exId);
          const isOn = e.currentTarget.getAttribute('aria-pressed') === 'true';
          e.currentTarget.setAttribute('aria-pressed', String(!isOn));
          e.currentTarget.classList.toggle('text-lime-600', !isOn);
          e.currentTarget.classList.toggle('dark:text-lime-400', !isOn);
          e.currentTarget.classList.toggle('text-surface-400', isOn);
          e.currentTarget.classList.toggle('dark:text-surface-500', isOn);
          this.restAutoStart[exId] = !isOn;
      });
  });
  ```

### Check Before Starting Timer
In the set completion handler where timer starts:
```javascript
const exId = set.exercise_id;
if (this.restAutoStart[exId] === false) return; // skip auto-start
```

### Files
- `static/js/workouts.js` — exercise card template + event binding + timer start logic
- `static/css/styles.css` — `.rest-auto-toggle` styles

---

## Issue 5: Liquid Fill Circles — Wave Amplitude & Padding

### Current Problems
1. Wave amplitude too small — liquid fill looks static, not alive
2. Top padding on track circles cuts off the glow/halo of active circle

### Fix

#### Wave Amplitude — Add CSS Animation
Add a subtle wave animation to the liquid fill:
```css
@keyframes liquid-wave {
    0%, 100% { clip-path: inset(calc(100% - var(--fill-percent)) 0 0 0); }
    50% { clip-path: inset(calc(100% - var(--fill-percent) + 3%) 0 0 0); }
}

.exercise-track-circle::before {
    animation: 
        liquid-rise 0.5s ease-out forwards,
        liquid-wave 3s ease-in-out infinite;
}
```

#### Padding Fix — Add Top Padding to Track Container
The track container needs more top padding so the active circle's glow doesn't get cut off by the progress text above:
```css
.exercise-track-indicator {
    padding-top: 8px; /* was probably 0 or minimal */
    padding-bottom: 4px;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    overflow-x: auto;
    overflow-y: hidden;
}
```

Also add padding to the header section above the track so there's breathing room:
```css
#workout-container {
    padding-top: 1.5rem; /* was 3rem */
}
```

### Files
- `static/css/styles.css` — liquid fill animation + track padding
- `static/js/workouts.js` — container padding (if inline)

---

## Affected Files Summary

| File | Issues |
|------|--------|
| `static/js/workouts.js` | All 5 issues |
| `static/css/styles.css` | Issues 3, 5 |

---

## Implementation Order

1. **Issue 2** — Fix set deletion (critical data error)
2. **Issue 3** — Rest timer redesign (major UX)
3. **Issue 1** — Remove left tile (visual cleanup)
4. **Issue 4** — Timer toggle (feature addition)
5. **Issue 5** — Liquid fill polish (visual refinement)

---

## Validation Plan

### 1. Remove Left Tile
- [ ] No dashed "Отменить тренировку" card visible on left
- [ ] Exercise track circles start at left edge
- [ ] Carousel scroll works correctly (no missing exercise index)

### 2. Set Deletion
- [ ] Click delete icon → confirmation modal appears
- [ ] Click "Удалить" → modal closes instantly, row slides out, DOM updated
- [ ] No "Set not found" backend error
- [ ] Set numbering updates correctly
- [ ] Works for local and online sessions

### 3. Rest Timer Redesign
- [ ] No emojis visible in timer bar
- [ ] Time display on left (large, MM:SS.ms)
- [ ] Presets on right with horizontal scroll
- [ ] Custom input shows numeric keyboard on mobile (`inputmode="numeric"`)
- [ ] "Готов" button full width at bottom
- [ ] Mode toggle (Таймер/Секундомер) organized
- [ ] Milliseconds animate dynamically

### 4. Timer Toggle
- [ ] Toggle button visible in exercise card header
- [ ] Click toggles aria-pressed state
- [ ] When disabled, set completion does NOT start rest timer
- [ ] Default state is enabled

### 5. Liquid Fill Circles
- [ ] Wave animation visible (subtle pulsing)
- [ ] Fill amplitude is more noticeable
- [ ] Top padding prevents glow clipping
- [ ] Active circle glow visible fully
- [ ] Both themes work

---

## Implementation Order

1. **Issue 2** — Fix set deletion (critical data error)
2. **Issue 3** — Rest timer redesign (major UX)
3. **Issue 1** — Remove left tile (visual cleanup)
4. **Issue 4** — Timer toggle (feature addition)
5. **Issue 5** — Liquid fill polish (visual refinement)

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Set deletion breaks state sync | Medium | Fire-and-forget API, ignore 404, restore on other errors |
| Timer bar still overflows on very small screens | Low | Test at 320px; `max-w-[92vw]` |
| Liquid fill wave too distracting | Low | Subtle 3s animation, can be reduced |
| Toggle state lost on re-render | Medium | Store in `this.restAutoStart` Map, restore per-exercise |
| Track padding breaks mobile layout | Low | Test at 320px width |

---

## Notes

- **Priority 1**: Issues 2 (data error) and 3 (timer redesign)
- **Priority 2**: Issues 1, 4, 5 (visual/feature)
- All colors use existing lime/zinc design tokens
- Test on iOS Safari (Dynamic Island, safe areas) and Android Chrome
- Milliseconds animation uses CSS-only `@keyframes ms-tick` for performance