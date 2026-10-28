# Implementation Plan: Active Workout Interface Fixes & Improvements

## Overview
Fix 6 critical issues in the active workout interface (`static/js/workouts.js` + `static/css/styles.css`):

1. **Remove overlapping progress bar** - Old linear progress bar still renders alongside new exercise track circles
2. **Fix rest timer "Готов" button** - Currently calls `dismissRestTimer()` which discards rest time; should call `stopAndSaveRestTimer()` to persist elapsed rest time
3. **Unify circle colors to dark neon design system** - Replace yellow/amber partial state with consistent dark neon palette
3. **Optimize timer presets layout** - Presets don't fit on mobile; add horizontal scroll or compact layout
4. **Fix "Add Set" DOM update** - Button adds to state but doesn't update DOM (already has `insertSetRow` but may have issues)
5. **Move delete button to set row start** - Replace dropdown menu (⋮) with compact delete icon at row start

---

## Issue 1: Remove Overlapping Progress Bar

### Current Problem
The HTML at lines 2939-2948 in `renderWorkoutScreen` still renders:
- `workout-progress-text` (text showing "Сделано X из Y подходов")
- `workout-progress-bar` (linear progress bar)
- THEN calls `this.buildExerciseTrackHtml(session)` which adds circles

### Fix
Remove the progress bar section (lines 2939-2947) entirely. Keep only:
- `workout-progress-text` (optional - could keep for total stats)
- Exercise track circles (via `buildExerciseTrackHtml`)

### Files
- `static/js/workouts.js` - `renderWorkoutScreen` (lines 2939-2948)

---

## Issue 2: Fix Rest Timer "Готов" Button

### Current Problem
Line 3546 in `bindWorkoutScreenEvents`:
```javascript
container.querySelector('[data-action="dismiss-rest-timer"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    this.dismissRestTimer();  // BUG: discards rest time instead of saving
});
```

The `dismissRestTimer()` function (line 1487) only clears state without saving. The correct function is `stopAndSaveRestTimer()` which:
1. Calculates elapsed time from `restTimerStartTime`
2. Saves to `targetSet.rest_time_seconds`
3. Persists to localStorage/IndexedDB or sends to API
4. Updates inline rest time display

### Fix
Change the event handler to call `stopAndSaveRestTimer(session)` instead of `dismissRestTimer()`.

### Files
- `static/js/workouts.js` - `bindWorkoutScreenEvents` (line 3546)

---

## Issue 3: Unify Circle Colors to Dark Neon Design System

### Current Problem
CSS uses inconsistent colors:
- `empty`: `#e4e4e7` / `#3f3f46` (gray/zinc)
- `partial`: `#f59e0b` / `#fbbf24` (amber/yellow) - **stands out wrong**
- `active`: `#84cc16` (lime) with pulse
- `complete`: `#84cc16` / `#4d7c0c` (lime/green)

### Desired Design System
All states should use the **dark neon lime/emerald palette** consistent with the app:
- Primary accent: `#84cc16` (lime-500)
- Dark accent: `#4d7c0c` (lime-800)
- Surface dark: `#18181b` / `#27272a`
- Border: `#3f3f46` (zinc-700)

### New Color Scheme
| State | Background | Border | Text/Icon | Notes |
|-------|------------|--------|-----------|-------|
| **empty** | `#27272a` (zinc-800) | `#3f3f46` (zinc-700) | `#71717a` (zinc-500) | Subtle, receded |
| **partial** | `#1a2e05` (lime-950/80) | `#4d7c0c` (lime-800) | `#84cc16` (lime-500) | Neon lime glow |
| **active** | `#1a2e05` | `#84cc16` (lime-500) | `#84cc16` | Border glow + pulse |
| **complete** | `#4d7c0c` (lime-800) | `#84cc16` | `white` | Filled, checkmark |

### CSS Changes
Update `.exercise-track-circle` base and all state classes in `static/css/styles.css` (lines 3546-3587).

### Files
- `static/css/styles.css` - lines 3546-3587

---

## Issue 4: Optimize Timer Presets Layout

### Current Problem
Presets at lines 2969-2974 render as inline buttons:
```html
<div id="rest-timer-presets" class="rest-timer-presets flex gap-1.5 hidden" data-timer-presets>
    <button ...>30с</button>
    <button ...>1м</button>
    <button ...>1.5м</button>
    <button ...>2м</button>
    <button ...>3м</button>
</div>
```
On mobile (320-375px), 5 buttons + custom input + mode toggle + dismiss button overflow.

### Fix Options
1. **Horizontal scroll** - Add `overflow-x-auto` to presets container
2. **Compact grid** - 2 rows of 3 buttons (30s, 1m, 1.5m / 2m, 3m, custom)
3. **Expandable** - Show 3 presets, "More" button reveals rest

### Recommended: Horizontal Scroll
Simplest, preserves all presets, native mobile behavior.

### CSS Changes
```css
.rest-timer-presets {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px; /* for scrollbar */
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
}
.rest-timer-presets button {
    flex-shrink: 0;
    scroll-snap-align: start;
}
```

### Files
- `static/css/styles.css` - add `.rest-timer-presets` styles
- `static/js/workouts.js` - ensure container has proper classes

---

## Issue 5: Fix "Add Set" DOM Update

### Current State
The add-set handler (lines 3364-3410) already calls `insertSetRow()` for both local and online cases. However, the user reports it doesn't update DOM.

### Potential Issues
1. `insertSetRow` selector for `setsContainer` may fail (line 2628-2630)
2. `buttons` selector may not find the add/remove button container
3. Race condition with `persistLocalSession` or API call

### Fix
1. Add debug logging to `insertSetRow`
2. Make selectors more robust (use `data-set-container` attribute)
3. Ensure `insertSetRow` is called after state mutation

### Files
- `static/js/workouts.js` - `insertSetRow` (lines 2625-2645) and add-set handler (lines 3364-3410)

---

## Issue 6: Move Delete Button to Set Row Start

### Current Problem
Set rows have a dropdown menu (⋮) at the end (lines 2596-2617) with delete action inside. User wants a compact delete icon at row **start** (near set number) to avoid accidental taps near the ✓ toggle button.

### Current Structure (end of row):
```html
<button data-action="toggle-set">✓</button>
<div class="set-row-menu relative flex-shrink-0">
    <button data-action="toggle-set-menu">⋮</button>
    <div class="set-dropdown-menu">...</div>
</div>
```

### New Structure (start of row):
```html
<div class="flex items-center gap-2 glass p-1.5 rounded-2xl relative" data-set-id="...">
    <!-- DELETE ICON AT START -->
    <button data-action="delete-set" data-set-id="..." 
            class="delete-set-btn-start w-7 h-7 rounded-xl glass text-surface-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center transition-colors"
            aria-label="Удалить подход">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.131A2.24 2.24 0 0115.138 21H8.862a2.24 0 01-2.271-2.133L5.867 7M6 7h12M6 7l1-2h10l1 2M10 11v6M14 11v6M9 11l1-9h4l1 9"/>
        </svg>
    </button>
    <span class="font-bold w-6 text-center text-xs ...">${set.set_number}</span>
    ...
    <button data-action="toggle-set">✓</button>
</div>
```

### Behavior
- Click delete icon → show confirmation modal → if confirmed, call existing delete logic
- Remove the dropdown menu (⋮) entirely
- Keep existing `handleSetDelete` logic but trigger from new button

### Files
- `static/js/workouts.js` - `renderSetRowHtml` (lines 2566-2621)
- `static/js/workouts.js` - remove dropdown menu click handlers (lines 3413-3525)
- `static/css/styles.css` - add `.delete-set-btn-start` styles

---

## Validation Plan

### Issue 1: Progress Bar Removed
- [ ] No linear progress bar visible in workout screen
- [ ] Exercise track circles visible and functional
- [ ] Total sets/tonnage text still visible (optional)

### Issue 2: Rest Timer "Готов" Saves Time
- [ ] Complete set 1 → rest timer starts
- [ ] Click "Готов" → timer stops, rest time saved to set 1
- [ ] Inline "⏱ 01:30 Отдых" appears below set 1
- [ ] Works for both local and online sessions

### Issue 3: Circle Colors
- [ ] Empty circles: dark zinc background, subtle border
- [ ] Partial circles: neon lime border/glow, lime text
- [ ] Active circles: lime border + pulse animation
- [ ] Complete circles: filled lime-800, white checkmark
- [ ] Dark/light themes both work

### Issue 4: Timer Presets Scroll
- [ ] All 5 presets accessible on 320px screen
- [ ] Horizontal scroll works smoothly
- [ ] Custom input and mode toggle still accessible

### Issue 5: Add Set Updates DOM
- [ ] Click "+ Добавить подход" → new row appears instantly with animation
- [ ] Set numbering updates correctly
- [ ] Works for local and online sessions

### Issue 6: Delete Button at Row Start
- [ ] Delete icon visible at start of each set row
- [ ] Click → confirmation modal → delete works
- [ ] No dropdown menu (⋮) at row end
- [ ] Set numbering updates after deletion

---

## Implementation Order

1. **Issue 1** - Remove progress bar (simple, visual cleanup)
2. **Issue 2** - Fix rest timer "Готов" (critical data loss bug)
3. **Issue 3** - Circle colors (visual consistency)
4. **Issue 4** - Timer presets scroll (UX improvement)
5. **Issue 5** - Add set DOM update (verify/fix existing logic)
6. **Issue 6** - Move delete button (structural change)

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Progress bar removal breaks metrics display | Low | Keep tonnage/completed text; circles show progress |
| `stopAndSaveRestTimer` called incorrectly | Medium | Test both local/online; verify `session` passed correctly |
| Circle color changes break dark/light themes | Medium | Test both themes; use CSS custom properties |
| Preset scroll breaks on iOS | Low | Use `-webkit-overflow-scrolling: touch` |
| Add set DOM insertion fails silently | Medium | Add error logging; fallback to full re-render |
| Delete button too close to set number | Medium | Add `gap-1` or `pl-1`; test touch targets |

---

## Affected Files Summary

| File | Issues |
|------|--------|
| `static/js/workouts.js` | All 6 issues |
| `static/css/styles.css` | Issues 3, 4 |

---

## Notes for Implementation

- **Issue 2** is the highest priority - data loss bug
- **Issue 6** requires removing dropdown menu event handlers (lines 3413-3525) - ensure no orphaned listeners
- **Issue 5** may already work - verify first before fixing
- All color changes should use the app's existing lime/zinc design tokens