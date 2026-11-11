# Final Audit & Refactoring Plan

## Goal
Comprehensive audit and refactoring of five core modules: `nutrition.js`, `mealCard.js`, `baseSheet.js`, `workouts.js`, `app.js` — covering memory leaks, unhandled promises, import correctness, defensive DOM/API checks, cross-module logic consistency, and test validation.

---

## 1. Code Review Checklist (Per File)

### `nutrition.js` (2156 lines)
| Area | Findings | Action |
|------|----------|--------|
| **Memory Leaks** | • `window.addEventListener('mylofi:sync-completed', ...)` and `mylofi:meal-update` registered in `init()` but **never removed** — listener persists across page navigations. <br>• `setDailySummaryBusy()` stores `dataset.idleHtml` on button but never cleans up on unmount. <br>• `renderAiSynergyWidget()` creates new `div` + `innerHTML` each call; old widget elements may leak if not replaced cleanly. | Add `destroy()` method to unregister global listeners. Use `AbortController` or track listener refs. Clean up `dataset.idleHtml` in `finally` or on modal close. |
| **Unhandled Promises** | • `loadAiSynergyReport()` called without `await` in `selectAiSynergyPeriod()` (line 719) — fire-and-forget. <br>• `generateDailySummary()` swallows errors but `renderDailySummaryCard()` assumes `section` exists. <br>• `updateCarouselInPlace()` calls `bindMealActions()`/`bindFailedItems()` which attach `.onclick` — old handlers not removed. | Await all async calls. Add null checks before DOM mutations. Use `addEventListener` with `{ once: true }` or track/remove handlers. |
| **Import Correctness** | • Imports from `./api.js`, `./db.js`, `./sync.js`, `./components.js`, `./utils.js`, `./camera.js`, `./mealCard.js`, `./baseSheet.js`, `./constants.js` — all exist. <br>• `API.dedupeGet` used but `API` import doesn't export it (check `api.js`). | Verify `api.js` exports `dedupeGet`. If not, fix import or implementation. |
| **Defensive Checks (`?.`)** | • `this.app?.state?.currentPage` ✓ <br>• `this.app.elements?.pageContent` ✓ <br>• `event?.detail?.status` ✓ <br>• **Missing**: `this._state.modals.newMeal?.close()` (line 1509) — guard added but `close()` may throw. <br>• `container.querySelector(...)` results used without null check in multiple places (e.g., line 1186, 1192, 1219). | Add `?.` and null guards before `.remove()`, `.outerHTML`, `.innerHTML`. Wrap DOM mutations in `if (el) { ... }`. |
| **State Consistency** | • `_state.flags.mealSubmitInFlight` prevents double-submit but reset in `finally` — OK. <br>• `_state.cache.meals` Map rebuilt on every render — OK. <br>• `scrollTargetMealId` consumed once — OK. | No action needed. |

---

### `mealCard.js` (220 lines)
| Area | Findings | Action |
|------|----------|--------|
| **Memory Leaks** | • `update()` creates new `div` + `innerHTML` + `replaceWith()` — old element GC'd but **event handlers on old card not removed** (handled by parent `bindMealActions()` re-binding). <br>• No internal listeners — OK. | Parent re-binds on each render; acceptable. Document assumption. |
| **Unhandled Promises** | • None — purely synchronous render. | — |
| **Import Correctness** | • `Utils`, `DB`, `Components`, `MEAL_ANALYSIS` — all exist. | — |
| **Defensive Checks** | • `meal?.status`, `meal?.sync_status` ✓ <br>• `meal.id ?? ''` ✓ <br>• `Components.mealPhotoUrl(meal)` — assumes `meal` valid. | Add `if (!meal) return ''` guard at top of `render()`. |
| **Other** | • `isPending()`, `isFailed()`, `isStuck()` duplicate logic from `render()` — DRY violation. | Extract shared status computation to private method. |

---

### `baseSheet.js` (409 lines)
| Area | Findings | Action |
|------|----------|--------|
| **Memory Leaks** | • `BaseSheet.open()` adds `keydown` listener (`this.onKeydown`) — **removed in `close()`** ✓. <br>• `bindEvents()` adds `click` on `backdropEl` and `close-` buttons — **removed in `unbindEvents()`** (no-op base, subclasses must override). <br>• **Risk**: `PeriodSheet.bindEvents()` adds `change` listeners on inputs — **never removed** because `unbindEvents()` not overridden. <br>• `NewMealSheet.bindEvents()` adds `click` on camera/gallery/remove/submit, `onchange` on file input — **never removed**. <br>• `EditMealSheet.bindEvents()` adds submit click — **never removed**. <br>• `AiSynergySleepSheet.bindEvents()` adds confirm click — **never removed**. | Override `unbindEvents()` in each subclass to remove all attached listeners. Store handler refs on `this` for removal. |
| **Unhandled Promises** | • `PeriodSheet.apply-period-sheet` calls `nutrition.render()` — **not awaited** (line 211). <br>• `NewMealSheet.handleSubmit()` delegates to `nutrition.handleNewMealSubmit()` — **not awaited** (line 349). <br>• `EditMealSheet.handleSubmit()` delegates — **not awaited** (line 377). | Await delegated calls. Return promises from `handleSubmit()`. |
| **Import Correctness** | • No external imports — self-contained. | — |
| **Defensive Checks** | • `this.modalEl?.querySelectorAll(...)` ✓ <br>• `this.panelEl?.classList.remove(...)` ✓ <br>• **Missing**: `this.nutrition.Components?.periodSheet(...)` — optional chaining but `nutrition` or `Components` could be null. | Add `if (!this.nutrition?.Components) return ''` guards in `getHtml()`. |
| **Lifecycle** | • `close()` calls `this.onClose()` after DOM removal — OK. <br>• `animationDuration` configurable — OK. | — |

---

### `workouts.js` (4000+ lines)
| Area | Findings | Action |
|------|----------|--------|
| **Memory Leaks** | • `workoutTimerInterval`, `restTimerInterval` — **cleared in `stopWorkoutTimer()`/`stopRestTimer()`** ✓. <br>• `rearmWorkoutTimer()` / `rearmRestTimer()` recreate intervals — **old interval cleared first** ✓. <br>• `DRUM_KEYDOWN_HANDLER` (global) — **set but never cleared** (line 39). <br>• `pollForAiPlan()` creates recursive `setTimeout` — **no cancellation on unmount**. <br>• `startWorkoutTimer()` called in `renderWorkoutScreen()` — **previous timer stopped** ✓. <br>• `SyncEngine` hooks registered in `app.initSyncEngine()` — **never unregistered**. | Add `DRUM_KEYDOWN_HANDLER` cleanup. Track `pollForAiPlan` timer ID and cancel on session change/unmount. |
| **Unhandled Promises** | • `render()` calls `refreshTonnageModule()` as fire-and-forget (line 1537) — **no error handling beyond catch**. <br>• `startTemplateWithAi()` — `app.waitForRealtimeConnected()` not awaited before `app.realtime.on()` (line 2752). <br>• `completeWorkoutWithAi()` — `app.flushPendingSetEdits()` not awaited (line 3120). <br>• `renderWorkoutScreen()` — `this.bindWorkoutScreenEvents()` not awaited (synchronous). <br>• Multiple `API.patch`/`post` calls in `bindSetRowEvents()` — **errors caught but not always propagated**. | Await all async operations. Add `.catch()` to fire-and-forget calls with logging. |
| **Import Correctness** | • Imports from `./api.js`, `./components.js`, `./utils.js`, `./db.js`, `./camera.js` — all exist. <br>• `AI_PREVIEW_TIMEOUT_MS` from `api.js` — verify export. | Verify `api.js` exports `AI_PREVIEW_TIMEOUT_MS`. |
| **Defensive Checks** | • `session?.exercises` ✓ <br>• `this.currentSession?.id` ✓ <br>• **Missing**: `container?.querySelector(...)` used without null check in `bindWorkoutScreenEvents()`, `updateTimerPanel()`, `insertSetRow()`, etc. <br>• `app?.state?.tokens?.access` — chain is long, may be null. | Add `?.` and null guards before DOM mutations. Early-return if critical deps missing. |
| **State Consistency** | • `currentSession` set/cleared in multiple places — **race risk** between `render()`, `renderWorkoutScreen()`, `resolveActiveWorkout()`. <br>• `exercisesModified` flag — **reset on new session** (line 3480) ✓. <br>• `restAutoStart` Map — **persisted but never cleared** on session end. | Centralize session state transitions. Clear `restAutoStart` on session close. |
| **Cross-Module Logic** | • `app.rearmWorkoutTimer()` snapshots/restores rest timer state — **complex, fragile**. <br>• `app.handleAppResume()` calls `rearmWorkoutTimer()` — **assumes `Workouts.currentSession` valid**. <br>• `SyncEngine` hooks call `Workouts.handleSyncedItem()` — **tight coupling**. | Consider event-driven decoupling. Add state validation guards. |

---

### `app.js` (2000+ lines)
| Area | Findings | Action |
|------|----------|--------|
| **Memory Leaks** | • `realtime` socket — **`disconnectRealtime()` in `clearTokens()`** ✓. <br>• `visibilitychange`, `focus`, `pageshow` listeners — **never removed** (lines 384-400). <br>• `mylofi:offline-sync`, `mylofi:meal-synced`, `mylofi:auth-failed` listeners — **never removed**. <br>• `serviceWorker` message listener — **never removed**. <br>• `_resumePromise`, `_flushLock` — mutexes OK but `_resumePromise` never cleared on error path (line 646 `finally` does clear). | Add `destroy()` method to remove all global listeners. Call on logout/unload. |
| **Unhandled Promises** | • `init()` — `initDBAndSync()` awaited ✓. <br>• `showMainAndValidate()` — `validateToken().then(() => initSyncEngine()).catch(...)` — **`initSyncEngine()` errors caught** ✓. <br>• `handleAppResume()` — `runAppResume()` returns promise, `_resumePromise` tracks it ✓. <br>• `flushOfflineQueue()` — mutex + try/finally ✓. <br>• `refreshAccessToken()` — network errors re-thrown, auth errors clear tokens ✓. | — |
| **Import Correctness** | • Imports all local modules — verify all exist. <br>• `Admin` from `./admin.js` — exists. | — |
| **Defensive Checks** | • `this.elements.pageContent?.querySelector(...)` ✓ <br>• `this.state.tokens?.access` ✓ <br>• **Missing**: `this.elements.navItems?.forEach(...)` — `navItems` is NodeList, `forEach` works but `elements.navItems` could be null. <br>• `API.refreshFromCookie()` — assumes cookie exists. | Add `if (!this.elements.navItems) return` guards. |
| **State Consistency** | • `state.completingWorkout` flag prevents `saveState()` during completion — OK. <br>• `state.workoutScreenDismissed` — **reset on resume** (line 716) but not on explicit back navigation. <br>• `active_session_id` / `active_workout` in localStorage — **cleared in `clearActiveSessionState()`** ✓. | Ensure `workoutScreenDismissed` reset on all exit paths. |

---

## 2. Cross-Module Logic Verification

| Flow | Modules Involved | Consistency Check |
|------|------------------|-------------------|
| **New Meal Modal** | `nutrition.js` → `baseSheet.js` (NewMealSheet) → `camera.js` → `api.js` | `openNewMealModal()` creates sheet, `handleNewMealSubmit()` delegates to sheet's `handleSubmit()`, which calls back to `nutrition.handleNewMealSubmit()`. **Circular but controlled**. Verify `closeNewMealModal()` called on all paths (success, error, offline). |
| **Edit Meal Modal** | `nutrition.js` → `baseSheet.js` (EditMealSheet) → `api.js` / `db.js` | Similar pattern. `openEditMealModal()` fetches from `_state.cache.meals`. Verify cache populated before modal opens. |
| **Nutrition Carousel** | `nutrition.js` → `mealCard.js` → `components.js` | `renderCarouselHtml()` calls `_mealCard.render()`. `updateCarouselInPlace()` rebuilds carousel and re-binds. **Scroll position preserved via `settleCarouselScroll()`**. Verify `bindMealActions()` re-attaches after every render. |
| **Period Sheet** | `nutrition.js` → `baseSheet.js` (PeriodSheet) | `openPeriodSheet()` creates sheet with current range. `apply-period-sheet` updates `nutrition` state and calls `render()`. **Verify `selectedDate`/`selectedPeriod`/`customRange` sync**. |
| **AI Synergy** | `nutrition.js` (widget + modal) ↔ `api.js` | Widget renders from `_state.aiSynergy`. `loadAiSynergyReport()` fetches saved report. `selectAiSynergyPeriod()` updates period and re-renders widget. **Verify `periodType` mapping matches backend**. |
| **Workout Lifecycle** | `app.js` ↔ `workouts.js` ↔ `sync.js` ↔ `api.js` | `app.resolveActiveWorkout()` merges server + local sessions. `Workouts.renderWorkoutScreen()` owns tracking screen. `app.handleAppResume()` re-arms timers. **Verify session ID mapping (local key ↔ server ID) consistent across `syncSessionFromDOM`, `persistLocalSession`, `handleSyncedItem`**. |
| **Workout Completion** | `workouts.js` → `app.js` → `sync.js` | `completeWorkoutWithAi()` calls `Workouts.clearActiveSessionState(app)`, `app.flushPendingSetEdits()`, then `API.post(/complete)`. Offline path enqueues via `API.enqueueRequest`. **Verify `last_closed_session_id` blocks resurrection**. |
| **Rest Timer** | `workouts.js` (internal) | Dual-mode (timer/stopwatch). `startRestTimer()` / `stopAndSaveRestTimer()` / `dismissRestTimer()` / `rearmRestTimer()`. **Verify `restTimerTargetTimestamp` survives resume via `rearmWorkoutTimer()` snapshot**. |

---

## 3. Test Execution Plan

### Backend (pytest)
```bash
cd C:\PyProj\mylofi
python -m pytest tests/ -v --tb=short
```
**Expected**: All 9 test files pass. Key tests:
- `test_auth.py` — token rotation, concurrency
- `test_ai_*_rules.py` — AI workout/synergy/verdict logic
- `test_feedback.py`, `test_websocket_meal_updates.py` — integration

### Frontend
**No test framework configured** (no `package.json`, `jest.config`, `vitest.config`).
**Recommendation**: Add Vitest + JSDOM for unit testing JS modules. Minimum smoke tests:
- `nutrition.js`: `periodRange()`, `mealTimestamp()`, `stepAnchor()`
- `mealCard.js`: `isPending()`, `isFailed()`, `render()` output shape
- `workouts.js`: `getWorkoutMetrics()`, `computePrevText()`, `drumClampTenths()`
- `baseSheet.js`: `open()`/`close()` lifecycle, event cleanup

---

## 4. Refactoring Tasks (Priority Order)

### P0 — Critical (Memory Leaks / Crashes)
1. **`nutrition.js`**: Add `destroy()` to unregister global `window` listeners. Call from `app.js` on page unload/logout.
2. **`baseSheet.js`**: Implement `unbindEvents()` in **all subclasses** (`PeriodSheet`, `NewMealSheet`, `EditMealSheet`, `AiSynergySleepSheet`). Store handler refs for removal.
3. **`workouts.js`**: Clear `DRUM_KEYDOWN_HANDLER` on unmount. Track/cancel `pollForAiPlan` timer.
4. **`app.js`**: Add `destroy()` to remove all global event listeners (`visibilitychange`, `focus`, `pageshow`, custom events, SW messages).

### P1 — High (Unhandled Promises / Race Conditions)
5. **`nutrition.js`**: Await `loadAiSynergyReport()` in `selectAiSynergyPeriod()`. Add null guards for all `querySelector` results.
6. **`baseSheet.js`**: Await delegated `handleSubmit()` calls. Return promises from sheet `handleSubmit()`.
7. **`workouts.js`**: Await `app.waitForRealtimeConnected()` before registering WS handler. Await `app.flushPendingSetEdits()` in `completeWorkoutWithAi()`.
8. **`app.js`**: Ensure `workoutScreenDismissed` reset on all workout exit paths (back button, completion, cancel).

### P2 — Medium (Defensive Checks / DRY)
9. **`mealCard.js`**: Extract shared status logic (`isPending`/`isFailed`/`isStuck`) to private `_getStatus(meal)`. Add `if (!meal) return ''` guard.
10. **`workouts.js`**: Add `?.` guards before all DOM mutations. Centralize session state transitions (single `setCurrentSession()` method).
11. **`nutrition.js`**: Add null checks for `container.querySelector()` results in `updateCarouselInPlace()`.
12. **`baseSheet.js`**: Add `if (!this.nutrition?.Components) return ''` in `getHtml()` methods.

### P3 — Low (Code Quality / Testing)
13. **All files**: Add JSDoc for public methods (already mostly present).
14. **Frontend tests**: Add `package.json` with Vitest, write unit tests for pure functions.
15. **`workouts.js`**: Decouple `SyncEngine` hooks via events instead of direct `Workouts.handleSyncedItem()` calls.

---

## 5. Validation Steps

After each refactoring task:
1. **Lint**: `npx eslint static/js/**/*.js` (if ESLint configured) or manual review.
2. **Type Check**: `npx tsc --noEmit` (if TS) — not applicable, pure JS.
3. **Run Backend Tests**: `python -m pytest tests/ -v`
4. **Manual Smoke Test** (browser):
   - Open nutrition page → switch periods → open/close modals → add/edit meal → verify carousel scroll restored.
   - Start workout (template + free-form) → complete sets → test rest timer (timer/stopwatch) → complete with/without AI → verify history.
   - Go offline → add meal/start workout → come online → verify sync.
   - Background app → resume → verify workout timer/rest timer restored.

---

## 6. Open Questions for User

1. **Frontend test framework**: Add Vitest? (requires `package.json`, `vite.config.js` if not present)
2. **TypeScript migration**: Any interest in gradual TS adoption for these modules?
3. **`api.js` exports**: Confirm `dedupeGet` and `AI_PREVIEW_TIMEOUT_MS` are exported — if not, I'll fix imports.
4. **`components.js`**: Verify `Components.dailySummaryCard`, `aiSynergyWidget`, `periodSheet`, `newMealModal`, `editMealModal`, `aiSynergySleepModal`, `mealCardAnalyzingSkeleton`, `failedSyncItem`, `confirmModal`, `errorState`, `loadingSpinner`, `sparkline`, `aiWorkoutPlanBadge`, `aiWorkoutCard`, `mercedesComboRing`, `nutritionDashboardCard`, `periodTabs`, `mealActionIcon`, `qualityBadge`, `personaBadge`, `qualityMetrics`, `addMealActionCard`, `mealCarouselEmptyState`, `mealBreakdown`, `mealPhotoUrl` — all used in audited files.
5. **Deployment**: Run tests in CI? Current setup runs pytest only.

---

## 7. Plan File Location
Saved to: `.kilo/plans/1794314911214-final-audit-refactor-plan.md`