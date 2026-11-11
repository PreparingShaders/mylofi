# Bug Fix Plan: mealCard.js TypeError - undefined is not a function

## Problem
Browser console error:
```
TypeError: undefined is not a function
    at Array.map (<anonymous>)
    at MealCard.render (mealCard.js:30:14)
    at nutrition.js:1114:60
```

## Root Cause
In `mealCard.js`, the code calls `Components.escapeHtml` but `escapeHtml` is exported as a **standalone function** from `components.js` (line 9), not as a property of the `Components` object (exported at line 118).

The import in `mealCard.js:3` only imports `Components`, not `escapeHtml`.

## Affected Files
- `static/js/mealCard.js` - Line 3 (import) and lines 30, 53, 80, 88, 89, 115, 117 (7 usages)

## Fix Required

### 1. Fix Import in mealCard.js
```javascript
// Current (line 3):
import { Components } from './components.js';

// Fixed:
import { Components, escapeHtml } from './components.js';
```

### 2. Replace All `Components.escapeHtml` → `escapeHtml` (7 occurrences)
- Line 30: `.map(Components.escapeHtml)` → `.map(escapeHtml)`
- Line 53: `Components.escapeHtml(dishName)` → `escapeHtml(dishName)`
- Line 80: `Components.escapeHtml(String(breakdown.portion))` → `escapeHtml(String(breakdown.portion))`
- Line 88: `Components.escapeHtml(String(value))` → `escapeHtml(String(value))`
- Line 89: `Components.escapeHtml(label)` → `escapeHtml(label)`
- Line 115: `Components.escapeHtml(meal.quality_reason...` → `escapeHtml(meal.quality_reason...`
- Line 117: `Components.escapeHtml(insight)` → `escapeHtml(insight)`

### 3. Add Defensive Fallbacks for `.map()` Calls
The error message also suggests protecting against undefined arrays. Check `Components.mealBreakdown` in components.js for similar issues with `meal.ingredients`, `meal.tags`, etc.

In `components.js` `mealBreakdown()` method (around line 986):
- `meal.ingredients` should be guarded: `(meal.ingredients || []).map(...)`
- `meal.tags` should be guarded: `(meal.tags || []).map(...)`

### 4. Run Tests
Execute Python test suite to verify no regressions:
```bash
python -m pytest tests/ -v --tb=short
```

## Validation Steps
1. ✅ Fix import and all 7 usages in mealCard.js
2. ✅ Add `|| []` fallbacks in components.js mealBreakdown for ingredients/tags
3. ✅ Run pytest test suite
4. ✅ Verify nutrition page loads without console errors

## Risk Assessment
- **Low risk**: Simple import fix and find/replace
- **No API changes**: Only internal module references
- **Backward compatible**: escapeHtml function signature unchanged

## Out of Scope
- Other potential undefined property accesses (separate audit needed)
- Full refactor of mealCard rendering logic