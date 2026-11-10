# Nutrition Page Audit & Refactoring Plan

## Executive Summary
The nutrition page (`static/js/nutrition.js`, 2269 lines) and related components (`static/js/components.js`, 2400+ lines) have accumulated significant technical debt over multiple iterations. Key issues: full-page re-renders on every poll tick, duplicated logic across components, excessive state in module scope, blocking async patterns, and dead code branches.

---

## Critical Issues Found

### 1. **Full-Page Re-render on Every Poll Tick** (Performance)
**Location:** `nutrition.js:1181-1423` (render method)
- Entire page content replaced via `container.innerHTML = html` every 3s during analysis
- Carousel rebuilt from scratch, losing scroll position (partially recovered via `settleCarouselScroll`)
- Daily summary, AI Synergy widget, and all meal cards reconstructed on every tick

**Impact:** Jank on mobile, scroll position flicker, wasted DOM work

### 2. **Duplicate Meal Card Logic** (Maintainability)
**Location:** `components.js:1114-1276` (mealCardPhoto) + `nutrition.js:1360-1361`
- Single massive 160-line function generating HTML strings
- Pending/failed/analyzed states all in one function with complex conditionals
- Composition expansion state tracked in `nutrition.js:_expandedCompositions` but rendered in component

### 3. **Excessive Module-Level State** (Architecture)
**Location:** `nutrition.js:21-64`
```javascript
_newMealModalState: null,
_newMealModalClosing: null,
_periodSheetState: null,
_periodSheetClosing: null,
_editMealModalState: null,
_editMealModalClosing: null,
_dailySummaryLoading: false,
_mealsCache: new Map(),
_scrollTargetMealId: null,
_expandedCompositions: new Set(),
_dailySummaryExpanded: false,
_currentDailySummary: null,
// ... 10+ more AI Synergy fields
```
- 20+ module-level properties mixing UI state, cache, and async flags
- No encapsulation - everything mutable from anywhere

### 4. **Blocking Sequential Awaits** (Performance)
**Location:** `nutrition.js:1207-1220`
```javascript
const periodDataPromise = this.loadPeriodData();
const dailySummaryPromise = this.loadDailySummary();
const synergyReportPromise = ...;
const loaded = await this.loadData();  // ← BLOCKS the other promises!
const periodData = await periodDataPromise;  // These already resolved
const dailySummary = await dailySummaryPromise;
await synergyReportPromise;
```
- `loadData()` awaited BEFORE awaiting the parallel promises, defeating parallelism

### 5. **Dead Code Branches & Rudiments**
| Location | Issue |
|----------|-------|
| `nutrition.js:1353` | Empty conditional: `pendingSorted.some(...) ? '' : ''` |
| `nutrition.js:69-71` | `isTempMealId` duplicated in `camera.js` logic |
| `components.js:19-31` | `MEAL_TYPE_META` + `MEAL_TYPE_ICON_PATHS` - icon paths could be unified |
| `nutrition.js:329-367` | Complex deduplication logic with tempId/resolved checks - brittle |

### 6. **Cache Invalidation Race Conditions**
**Location:** `api.js:599-620` (getWithReadCache) + `nutrition.js:521`
- `API.invalidateReadCache('/nutrition/daily-summary')` called AFTER render
- No deduplication for concurrent `loadDailySummary()` calls
- Stale cache can be served during race window

### 7. **Modal/Sheet Lifecycle Duplication**
**Location:** `nutrition.js:1034-1171` (PeriodSheet), `1459-1514` (NewMealModal), `2084-2133` (EditMealModal)
- Nearly identical open/close/bind patterns (3x ~100 lines each)
- Backdrop click, Escape key, animation, body lock - all duplicated

### 8. **Inconsistent Error Handling**
- Some paths use `app.showToast()`, others `console.error` only
- Network errors sometimes trigger offline queue, sometimes not
- No unified error boundary for the nutrition page

---

## Refactoring Plan (Prioritized)

### Phase 1: Core Architecture & Rendering (High Impact)

#### Task 1.1: Implement Targeted DOM Updates
- Replace full `innerHTML` swap with granular updates for:
  - Carousel: insert/update/remove individual meal cards
  - Daily Summary: in-place card swap (already partially done via `renderDailySummaryCard`)
  - AI Synergy Widget: in-place re-render (already done via `renderAiSynergyWidget`)
  - Pending/Failed banners: toggle visibility instead of rebuild

#### Task 1.2: Fix Parallel Data Loading
```javascript
// Current (broken parallelism):
const loaded = await this.loadData();
const periodData = await periodDataPromise;

// Fixed:
const [loaded, periodData, dailySummary, synergyReport] = await Promise.all([
    this.loadData(),
    periodDataPromise,
    dailySummaryPromise,
    synergyReportPromise,
]);
```

#### Task 1.3: Extract Meal Card Component
- Move `mealCardPhoto` to a dedicated class with:
  - `render(meal, options)` → HTML string
  - `update(meal, options)` → targeted DOM updates
  - `bindEvents(cardElement)` → attach handlers
  - Internal state for composition expansion

---

### Phase 2: State Management & Modals (Medium Impact)

#### Task 2.1: Consolidate Modal/Sheet Base Class
Create `BaseSheet` class handling:
- Open/close lifecycle with animations
- Backdrop click + Escape key
- Body scroll lock
- Focus management
- Cleanup (event listeners, object URLs)

Subclasses: `PeriodSheet`, `NewMealSheet`, `EditMealSheet`, `AiSynergySleepSheet`

#### Task 2.2: Encapsulate Module State
Replace 20+ loose properties with structured state object:
```javascript
this._state = {
    ui: { selectedDate, selectedPeriod, customRange },
    modals: { newMeal: null, editMeal: null, period: null },
    cache: { meals: new Map(), dailySummary: null },
    aiSynergy: { period: '14', customRange: {}, result: null, running: false },
    flags: { mealSubmitInFlight: false, dailySummaryLoading: false }
};
```

#### Task 2.3: Deduplicate Temp ID Logic
- Centralize `isTempMealId` in `utils.js` or `db.js`
- Use consistently across `nutrition.js`, `camera.js`, `sync.js`

---

### Phase 3: Network & Cache Layer (Medium Impact)

#### Task 3.1: Request Deduplication for Read APIs
Add `API.dedupeGet(endpoint, token)` that:
- Returns in-flight promise if same request pending
- Prevents duplicate `/nutrition/daily-summary` calls

#### Task 3.2: Fix Cache Invalidation Timing
- Invalidate cache BEFORE re-fetching, not after
- Use `API.getFresh()` for user-triggered reloads (generateDailySummary)

#### Task 3.3: Unify Offline Queue Handling
- `SyncEngine` already handles retry/backoff
- Remove manual retry logic from `nutrition.js:1863-1929`
- Use `SyncEngine` events for UI updates

---

### Phase 4: Code Cleanup & Dead Code Removal (Low Risk)

#### Task 4.1: Remove Dead Branches
- `nutrition.js:1353` - empty ternary
- Unused imports in `components.js` (`DB`, `getFriendlyEndpointLabel` at top)
- Debug `console.log` statements in all files

#### Task 4.2: Consolidate Icon Paths
- Merge `MEAL_TYPE_META` + `MEAL_TYPE_ICON_PATHS` into single source
- Same for `MEAL_ACTION_ICON_PATHS`

#### Task 4.3: Extract Constants
- Magic numbers: `3 * 60 * 1000` (stuck threshold), `220` (animation duration)
- API endpoints as constants

---

## Validation Checklist

### Performance
- [ ] Carousel scroll position preserved exactly (no flicker) on poll re-render
- [ ] Daily summary card swaps in-place without full page rebuild
- [ ] AI Synergy widget updates without carousel rebuild
- [ ] Parallel data loading reduces render latency by ~30%

### Correctness
- [ ] Temp meal IDs handled consistently (edit, delete, retry)
- [ ] Cache invalidation doesn't serve stale data
- [ ] Offline queue retry doesn't duplicate items
- [ ] Modal close restores body scroll state correctly

### Code Quality
- [ ] No `console.log("[DEBUG]")` statements in production code
- [ ] No empty conditionals (`? '' : ''`)
- [ ] No duplicated modal lifecycle code
- [ ] Module state encapsulated, not 20+ loose properties

---

## Out of Scope
- Backend API changes
- CSS/styling changes (unless blocking JS refactor)
- New features (AI Synergy modal, etc.)
- Workout page refactoring (separate module)

---

## Implementation Order

1. **Fix parallel loading bug** (15 min) - immediate perf win
2. **Extract BaseSheet class** (1 hr) - removes 300 lines of duplication
3. **Targeted carousel updates** (2 hrs) - core perf fix
4. **State encapsulation** (1 hr) - architectural cleanup
5. **Request deduplication** (30 min) - cache correctness
6. **Dead code removal** (30 min) - hygiene
7. **Meal card component extraction** (2 hrs) - maintainability

Total estimated: ~7 hours