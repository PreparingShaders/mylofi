# Implementation Plan: Fix Rest Time Assignment in Backend (measured_rest_times)

## Problem
For a 3-set exercise, only 1 rest block shows in history (under 2nd set) instead of 2 (under 1st and 2nd sets).

**Root Cause**: Mismatch between frontend and backend rest time semantics:
- **Frontend**: Saves rest time to the set that was JUST COMPLETED (the one whose rest period ended)
  - Complete Set 1 → rest timer starts → Complete Set 2 → save rest to Set 1
  - Complete Set 2 → rest timer starts → Complete Set 3 → save rest to Set 2
- **Backend `measured_rest_times`**: Assigns rest to the set based on gap from PREVIOUS set
  - Set 1: no previous → rest = None
  - Set 2: gap from Set 1 → rest = gap(1→2)  ← This is Set 1's rest!
  - Set 3: gap from Set 2 → rest = gap(2→3)  ← This is Set 2's rest!

Result: Backend assigns rest times one set "forward" vs frontend.

## Fix
Modify `measured_rest_times` in `app/services/workout.py` (line 1045) to assign rest to the PREVIOUS set instead of the current set.

**Current logic** (simplified):
```python
for exercise_id, completed_at, measured in sets:
    stamp = as_utc(completed_at)
    if stamp and previous_stamp and previous_exercise == exercise_id:
        gap = (stamp - previous_stamp).total_seconds()
        rest = gap  # assigned to CURRENT set
    rests.append(rest)
    previous_stamp = stamp
    previous_exercise = exercise_id
```

**Fixed logic**: Calculate gap, but assign it to the PREVIOUS set in the sequence.

## Affected Files
- `app/services/workout.py` - `measured_rest_times` function (line 1045)

## Validation
1. Start workout with 3-set exercise
2. Complete Set 1 → wait → Complete Set 2 → wait → Complete Set 3
3. Check history detail: should see 2 rest blocks (under Set 1 and Set 2)
4. Verify rest times match what was measured on the frontend
5. Test with 2 sets (1 rest block), 4 sets (3 rest blocks), etc.

## Risk Assessment
- Low risk: Only affects rest time calculation, not other workout data
- Need to ensure offline/replayed sessions still work (they use `measured` client value when `measured > gap`)
- The change only reassigns which set gets the rest value, not the calculation itself