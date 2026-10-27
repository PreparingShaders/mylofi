# Implementation Plan: Fix Critical Workout Tracker Issues

## Issue 1: UniqueViolationError on Set Creation (Backend)

### Root Cause
The `create_session_set` function in `app/services/workout.py` only auto-calculates `set_number` when it's `None`. The frontend always sends a `set_number` (calculated as `lastSet.set_number + 1`), but this can become stale due to:
- Race conditions between rapid clicks
- State mismatch between frontend and backend
- Offline queue replays with outdated set numbers

The database has a unique constraint on `(exercise_id, set_number)`, causing `UniqueViolationError` when duplicates occur.

### Fix: Backend (`app/services/workout.py`)
Modify `create_session_set` to **always** compute the correct `set_number` server-side, ignoring the frontend-provided value:

```python
# In create_session_set, after loading exercise with sets:
existing_numbers = [s.set_number for s in (exercise.sets or [])]
set_number = (max(existing_numbers) + 1) if existing_numbers else 1
# Ignore the incoming set_number parameter entirely
```

Also add a fallback reps default (from previous set or template) as mentioned in the original task.

---

## Issue 2: Modal Overlay Not Closing (Frontend)

### Root Cause
The `closeModal` function in `showAddExerciseModal` (`static/js/workouts.js` ~line 4737) has a race condition:
- The `finally` block schedules `existing.remove()` after 200ms
- If `closeModal` is called again before the timeout fires (e.g., rapid open/close or Escape key during animation), `this.addExerciseModalOpen` is already `false` so it returns early
- The original modal element remains in DOM with `opacity-0` but still blocks pointer events

### Fix: Frontend (`static/js/workouts.js`)
1. **Immediate cleanup**: Remove the modal element synchronously in `closeModal` before starting animation, or use a unique modal ID to track the current modal
2. **Force cleanup on open**: At the start of `showAddExerciseModal`, aggressively remove any existing `#add-exercise-modal` elements
3. **Reset body styles**: Ensure `document.body.style.overflow = ''` and `document.body.style.pointerEvents = ''` on close

```javascript
// At start of showAddExerciseModal:
const existing = document.getElementById('add-exercise-modal');
if (existing) existing.remove(); // Force clean slate

// In closeModal:
const m = document.getElementById('add-exercise-modal');
if (m) m.remove(); // Remove immediately, don't wait for animation
this.addExerciseModalOpen = false;
document.body.style.overflow = '';
document.body.style.pointerEvents = '';
```

---

## Issue 3: Smooth Animations for Add/Remove Sets (Frontend)

### Current State
The `insertSetRow` and `removeSetRow` functions already exist with CSS animations (`.set-row-enter`, `.set-row-exit`). However:
- The online session path in `add-set` handler calls `insertSetRow` correctly
- The `remove-set` handler calls `removeSetRow` correctly
- **But**: The `insertSetRow` animation may not be smooth due to:
  - Missing `will-change` CSS property
  - Layout thrashing from reading DOM during animation
  - The `requestAnimationFrame` + `classList.add('active')` pattern may not trigger correctly

### Fix: Frontend (`static/js/workouts.js` + `static/css/styles.css`)

#### CSS Improvements (`static/css/styles.css`)
```css
.set-row-enter,
.set-row-exit {
    will-change: opacity, transform;
    /* Ensure animation runs on compositor */
}
```

#### JS Improvements (`static/js/workouts.js`)
1. **Add set**: Ensure the animation trigger is reliable:
   ```javascript
   rowEl.classList.add('set-row-enter');
   buttons.parentNode.insertBefore(rowEl, buttons);
   // Force reflow before adding 'active'
   rowEl.offsetHeight; // Force reflow
   rowEl.classList.add('active');
   ```

2. **Remove set**: Ensure transitionend is properly awaited:
   - Current implementation looks correct with `transitionend` listener

3. **Add CSS for smooth height animation**:
   ```css
   .set-row-enter,
   .set-row-exit {
       overflow: hidden; /* Prevent content overflow during animation */
   }
   ```

---

## Validation Plan

### Issue 1: UniqueViolationError
1. Start workout → rapidly click "+ Добавить подход" 5 times
2. Verify no UniqueViolationError in backend logs
3. Verify all 5 sets created with sequential set_numbers (1,2,3,4,5)
4. Test offline queue replay with added sets

### Issue 2: Modal Overlay
1. Open "+ Добавить упражнение" → close via Escape → verify no overlay remains
2. Open → click exercise → verify modal closes, no overlay
4. Rapid open/close 10 times → verify no stuck overlays
5. Click backdrop → verify clean close
6. Check `document.body.style.overflow` is empty after close

### Issue 3: Smooth Animations
1. Click "+ Добавить подход" → verify slide-down animation (200ms)
2. Click "− Удалить подход" → verify slide-up animation (200ms)
3. Rapid add/remove → no layout thrashing, no flickering
4. Verify set numbering updates correctly after animations
5. Verify rest time inline updates correctly

---

## Affected Files

| File | Changes |
|------|---------|
| `app/services/workout.py` | `create_session_set`: always compute set_number server-side; default reps from previous set/template |
| `static/js/workouts.js` | `showAddExerciseModal`: force cleanup on open; synchronous remove in closeModal; reset body styles |
| `static/js/workouts.js` | `insertSetRow`: force reflow before animation trigger |
| `static/css/styles.css` | Add `will-change` and `overflow: hidden` to animation classes |

---

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Backend set_number change breaks existing clients | Low | Only affects POST /workouts/sets; frontend doesn't rely on returned set_number |
| Modal cleanup breaks animation | Low | Animation is cosmetic; removal is critical for UX |
| Animation changes cause flicker on low-end devices | Medium | Test on mobile; `will-change` helps but use sparingly |