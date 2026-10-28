# Implementation Plan: Active Workout Interface Fixes & Redesign

## Overview
Comprehensive fixes and redesign of the active workout interface (`static/js/workouts.js` + `static/css/styles.css`) based on detailed user review. Addresses 6 critical areas:

1. **Reduce top padding** - Move header and track circles higher
2. **Clean up header** - Remove "Суммарный тоннаж", keep only progress text
3. **Fix "Add Set" DOM update** - Ensure instant DOM re-render
4. **Fix rest timer modal** - Compact layout, fix "Готов" button
5. **Add exercise via track circles** - Replace bottom card with "+" circle in track
6. **Fix add workout modal** - Add close button, fix fullscreen issue

---

## 1. Reduce Top Padding (Header & Track)

### Current Problem
The workout container has excessive top padding (`pt-12` on line 2932), pushing the header and exercise track circles too low.

### Fix
**File**: `static/js/workouts.js` - `renderWorkoutScreen` (line ~2932)
- Change `pt-12` to `pt-6` or `pt-4` on the `#workout-container` div
- Reduce `mb-3` on header to `mb-2`
- Reduce `mb-4` on progress section to `mb-2`
- Ensure exercise track circles sit directly below progress text with minimal gap

### CSS Alternative
Add to `static/css/styles.css`:
```css
#workout-container { padding-top: 1.5rem; } /* was 3rem */
```

---

## 2. Clean Up Header (Remove "Суммарный тоннаж")

### Current Problem
Header (lines 2940-2947) shows:
- "Сделано X из Y подходов (Z%)" 
- "Суммарный тоннаж: N кг" 
These overlap with exercise track circles below.

### Fix
**File**: `static/js/workouts.js` - `renderWorkoutScreen` (lines 2940-2947)
- Remove the tonnage `<span id="workout-total-tonnage">` entirely
- Keep only `<span id="workout-progress-text">` 
- Add comfortable gap (`mb-3` → `mb-4`) between progress text and exercise track circles
- The tonnage is available in the workout summary/analysis; no need in active header

---

## 3. Fix "Add Set" DOM Update

### Current Problem
The add-set handler (lines 3364-3410) calls `insertSetRow()` but user reports DOM doesn't update. The function exists but may have selector issues.

### Root Cause Investigation
In `insertSetRow` (lines 2625-2645):
- `setsContainer` selector uses `.space-y-1\.5` which may not match
- `buttons` selector is fragile

### Fix
**File**: `static/js/workouts.js`

1. **Add data attribute** to sets container in `renderSetRowHtml` / exercise card:
   ```html
   <div class="space-y-1.5" data-set-container>...</div>
   ```

2. **Simplify `insertSetRow` selectors**:
   ```javascript
   const setsContainer = card.querySelector('[data-set-container]');
   const buttons = setsContainer.querySelector('[data-add-set-buttons]');
   ```

3. **Add data attribute** to the add/remove buttons container in exercise card template (line ~2884):
   ```html
   <div class="flex items-center justify-between gap-2 pt-1.5" data-add-set-buttons>...</div>
   ```

3. **Ensure `insertSetRow` is called** after state mutation in both local and online paths (already done, but verify).

4. **Add fallback**: If DOM insertion fails, fall back to `renderWorkoutScreen` re-render.

---

## 4. Fix Rest Timer Modal & "Готов" Button

### 4a. Compact Timer Layout

**Current Problem**: Timer bar (lines 2954-2999) has:
- Preset chips (5 buttons) - overflow on mobile
- Custom input
- Mode toggle (Timer/Stopwatch)
- Dismiss button
All in a fixed-width bar that overflows on mobile.

**Fix**: `static/js/workouts.js` (timer bar HTML, lines 2954-2999) + `static/css/styles.css`

1. **Reduce width**: Use `max-w-[90vw]` or `w-full max-w-sm` with side margins
2. **Stack on small screens**: Use `flex-col sm:flex-row` for presets + custom input
3. **Compact presets**: Reduce padding, use `px-2 py-1 text-xs`
4. **Mode toggle**: Make it a compact segmented control
4. **Reduce height**: Reduce `py-2` to `py-1.5`, `gap-2` to `gap-1.5`

**CSS**:
```css
.rest-timer-bar__inner {
    max-width: 90vw;
    padding: 0.75rem 1rem;
}
.rest-timer-presets {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 4px;
}
.rest-timer-presets button {
    flex-shrink: 0;
    scroll-snap-align: start;
    padding: 4px 10px;
    font-size: 11px;
}
```

### 4b. Fix "Готов" Button

**Current Problem** (line 3546):
```javascript
this.dismissRestTimer(); // Discards rest time!
```

**Fix**: Change to call `stopAndSaveRestTimer(session)` which:
1. Calculates elapsed time from `restTimerStartTime`
2. Saves to `targetSet.rest_time_seconds` 
3. Persists to localStorage/IndexedDB or API
4. Updates inline rest time display via `applyRestTimeInline`
5. Stops timer and hides bar

**File**: `static/js/workouts.js` - `bindWorkoutScreenEvents` (line ~3546)
```javascript
container.querySelector('[data-action="dismiss-rest-timer"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    this.stopAndSaveRestTimer(session); // FIXED
});
```

---

## 5. Add Exercise via Track Circles (Replace Bottom Card)

### Current Problem
- "Add Exercise" card at bottom of carousel (lines 2916-2922) takes full card space
- User wants it as a "+" circle at the end of the exercise track

### Fix

**File**: `static/js/workouts.js`

1. **Modify `buildExerciseTrackCircles`** (lines 3129-3174) to append a "+" circle:
   ```javascript
   // After mapping exercises, add:
   circles.push(`
       <button type="button"
               data-action="add-exercise-from-track"
               role="tab"
               aria-label="Добавить упражнение"
               class="exercise-track-circle add-exercise-circle">
           <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
           </svg>
       </button>
   `);
   ```

2. **Add click handler** in `updateExerciseTrack` (line ~3184):
   ```javascript
   container.querySelector('[data-action="add-exercise-from-track"]')?.addEventListener('click', async (e) => {
       e.stopPropagation();
       await this.showAddExerciseModal(app, session, sessionId);
   });
   ```

3. **Remove "Add Exercise" card** from carousel (remove lines 2916-2922, and from `allCards` array line 2924)

4. **Add CSS** for the add circle:
   ```css
   .exercise-track-circle.add-exercise-circle {
       background: transparent;
       border: 2px dashed #3f3f46;
       color: #71717a;
   }
   .dark .exercise-track-circle.add-exercise-circle {
       border-color: #52525b;
       color: #71717a;
   }
   .exercise-track-circle.add-exercise-circle:hover {
       border-color: #84cc16;
       color: #84cc16;
   }
   ```

---

## 6. Fix Add Workout Modal (Close Button + Fullscreen)

### Current Problem
- `showAddExerciseModal` (line ~4692) creates modal without visible close button
- Modal takes 100% screen height (`h-[100dvh] sm:h-[90vh]`)
- No way to close except Escape or backdrop click

### Fix

**File**: `static/js/workouts.js` - `showAddExerciseModal` (lines 4692-4866)

1. **Add close button** in modal header (after line 4746):
   ```html
   <button type="button" data-action="close-add-exercise-modal" 
           class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0"
           aria-label="Закрыть">✕</button>
   ```

2. **Add click handler** in event binding section:
   ```javascript
   modal.querySelector('[data-action="close-add-exercise-modal"]')?.addEventListener('click', closeModal);
   ```

3. **Fix fullscreen issue**: Change modal height from `h-[100dvh]` to `max-h-[90vh]` with `overflow-y-auto` on content area, ensuring close button stays visible.

4. **Ensure backdrop click closes**: Already implemented (line 4770-4772), verify it works.

---

## Affected Files Summary

| File | Issues |
|------|--------|
| `static/js/workouts.js` | All 6 issues |
| `static/css/styles.css` | Issues 1, 3, 4, 5 (colors, spacing, timer layout) |

---

## Validation Plan

### 1. Top Padding & Header
- [ ] Header ("Присяд") and exercise track circles visible without scrolling on mobile
- [ ] No "Суммарный тоннаж" text in header
- [ ] Progress text "Сделано X из Y подходов" visible with comfortable gap to circles

### 2. Add Set DOM Update
- [ ] Click "+ Добавить подход" → new row appears instantly with slide-down animation
- [ ] Set numbering updates correctly
- [ ] Works for local and online sessions
- [ ] No full page re-render needed

### 3. Rest Timer Modal
- [ ] Timer bar fits on 320px screen without horizontal overflow
- [ ] Presets horizontally scrollable
- [ ] "Готов" button saves rest time to previous set
- [ ] Inline "⏱ MM:SS Отдых" appears below completed set
- [ ] Timer bar hides after saving

### 4. Exercise Track Circles
- [ ] Circles render with new dark neon color scheme
- [ ] Active exercise circle highlighted with pulse
- [ ] Click circle → smooth scroll to exercise card
- [ ] "+" circle at end opens add exercise modal
- [ ] Circles update dynamically when exercises added/removed

### 5. Add Exercise via Track
- [ ] "+" circle visible at end of track
- [ ] Tap opens add exercise modal
- [ ] No "Add Exercise" card at bottom of carousel

### 5. Add Exercise Modal
- [ ] Visible "✕" close button in header
- [ ] Click close button → modal closes
- [ ] Click backdrop → modal closes
- [ ] Escape key → modal closes
- [ ] Modal doesn't take full screen (max-h-[90vh])
- [ ] Search, filter, selection all work

### 6. Circle Colors (Dark Neon)
- [ ] Empty: dark zinc bg, subtle border, zinc-500 text
- [ ] Partial: lime-950 bg, lime-800 border, lime-500 text
- [ ] Active: lime-950 bg, lime-500 border + pulse
- [ ] Complete: lime-800 filled, white checkmark
- [ ] Both light/dark themes work

---

## Implementation Order

1. **Issue 4b** - Fix "Готов" button (critical data loss)
2. **Issue 6** - Fix add exercise modal (usability blocker)
3. **Issue 1** - Reduce top padding (visual cleanup)
4. **Issue 2** - Clean header (visual cleanup)
5. **Issue 3** - Fix Add Set DOM update (core functionality)
6. **Issue 4a** - Compact timer layout (UX)
7. **Issue 5** - Add exercise via track (structural change)
8. **Issue 3 (colors)** - Circle color redesign (visual polish)

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| "Готов" button fix breaks timer state | Medium | Test local/online; verify `session` passed correctly |
| Modal close button conflicts with existing handlers | Low | Use unique `data-action`; test all close paths |
| "+" circle breaks track click handlers | Low | Use unique `data-action`; test click delegation |
| Top padding too small for notch/Dynamic Island | Medium | Test on iOS; use `safe-area-inset-top` |
| Add Set DOM insertion fails | Medium | Fallback to full re-render; add error logging |
| Timer bar still overflows on very small screens | Low | Test at 320px; use `max-w-[90vw]` |

---

## Notes

- **Priority 1**: Issues 4b (data loss) and 6 (usability blocker)
- **Issue 5** (add via track) is a nice-to-have structural improvement
- All color changes should use the app's existing lime/zinc design tokens
- Test on both iOS Safari and Android Chrome