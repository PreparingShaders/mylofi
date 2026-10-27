# Implementation Plan: Fix AI Workout Plan Start Flow & Remove Noisy Toasts

## Problem Summary

### Issue 1: Noisy/Unnecessary Toast Notifications
- **`loadAiPlan` (workouts.js:1503-1523)** shows three toasts that clutter the UI:
  - Line 1505: "ИИ-тренер работает только с подключением к интернету" (offline) - reasonable
  - Line 1514: "ИИ-план недоступен, тренировка без него" (plan unavailable) - noisy
  - Line 1520: Same message again in catch block - **contradicts comment** saying "Never surfaced as an error toast"
- The comment on lines 1517-1518 explicitly states: "Never surfaced as an error toast: the workout is what the user came for, and a plan that did not arrive is not a failure" - but line 1520 violates this

### Issue 2: Unreliable AI Plan Delivery & UI Update
- **WebSocket listener race condition** in `startTemplateWithAi`/`startQuickWorkoutWithAi`:
  - Listener added at line 1572-1573 only if `app.realtime` exists
  - But `app.realtime` might not be connected yet (connection established asynchronously via `ensureRealtimeToken`)
  - If WebSocket connects *after* listener is added, it works; if it connects *before*, the `workout_plan_ready` message might be missed
- **Polling fallback race condition**: Both WebSocket handler and `loadAiPlan` polling call `updateAiPlanBadges` - potential double-render
- **Missing fallback**: If WebSocket fails entirely, polling via `loadAiPlan` should be more robust

## Affected Files & Changes

### 1. `static/js/workouts.js` - Remove Noisy Toasts & Fix Delivery

#### Remove Toasts from `loadAiPlan` (lines 1503-1523)
```javascript
// REMOVE these toast calls:
- Line 1505: app.showToast(AI_OFFLINE_MESSAGE, 'info');  // Keep? User might want to know
- Line 1514: app.showToast(payload?.reason || AI_PLAN_UNAVAILABLE_MESSAGE, 'info');  // REMOVE
- Line 1520: app.showToast(AI_PLAN_UNAVAILABLE_MESSAGE, 'info');  // REMOVE (contradicts comment)

// KEEP: console.warn for debugging
```

#### Fix WebSocket Listener Setup in `startTemplateWithAi` & `startQuickWorkoutWithAi`
```javascript
// CURRENT (lines 1572-1574):
if (app.realtime) {
    wsCleanup = app.realtime.on('workout_plan_ready', wsHandler);
}

// PROBLEM: app.realtime might not be connected yet

// FIX: Wait for realtime connection or add retry logic
const setupWsListener = () => {
    if (!app.realtime) return false;
    if (app.realtime.isConnected()) {
        wsCleanup = app.realtime.on('workout_plan_ready', wsHandler);
        return true;
    }
    // Not connected yet - listen for connection
    const onStatus = (status) => {
        if (status === 'open') {
            wsCleanup = app.realtime.on('workout_plan_ready', wsHandler);
            app.realtime.off('status', onStatus);
        }
    };
    app.realtime.on('status', onStatus);
    return false;
};

// Call setupWsListener(); if it returns false, it will auto-setup when connected
```

#### Improve `updateAiPlanBadges` Idempotency
- Already handles existing badges (line 1688-1689: replaces existing)
- Add guard to prevent double-update in same tick

#### Strengthen `loadAiPlan` Polling Fallback
- Current: Uses `API.postImmediate` which bypasses queue - good
- Issue: If both WebSocket and polling succeed, `updateAiPlanBadges` called twice
- Fix: Add a flag to track if plan was already applied for this session

### 2. `static/js/app.js` - Ensure Realtime Connection Before AI Start

#### Add Method to Wait for Realtime Connection
```javascript
// Add to App object:
async waitForRealtimeConnected(timeout = 5000) {
    if (!this.realtime) return false;
    if (this.realtime.isConnected()) return true;
    
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            this.realtime.off('status', onStatus);
            resolve(false);
        }, timeout);
        
        const onStatus = (status) => {
            if (status === 'open') {
                clearTimeout(timer);
                this.realtime.off('status', onStatus);
                resolve(true);
            }
        };
        this.realtime.on('status', onStatus);
    });
}
```

#### Call Before AI Start
In `startTemplateWithAi` and `startQuickWorkoutWithAi`:
```javascript
// Before setting up WebSocket listener:
await app.waitForRealtimeConnected(3000);
```

### 3. Backend - Ensure WebSocket Push Works (Already Implemented)
- `ai_workout_service.py:1188-1205` sends `WORKOUT_PLAN_READY` via WebSocket - **already correct**
- Just need frontend to reliably receive it

## Data Flow (After Fix)

### Scenario: User clicks "Старт с ИИ"
1. Frontend calls `POST /workouts/templates/{id}/start?with_ai_plan=true`
2. Backend creates session, returns immediately, queues background task
3. **Frontend waits for realtime connection** (new step)
4. Frontend sets up WebSocket listener for `workout_plan_ready` (with retry if not connected)
5. Frontend renders workout screen immediately
6. Background task generates plan (~5-10s with optimized model order)
7. Backend stores plan in DB, sends `WORKOUT_PLAN_READY` via WebSocket
8. **Frontend receives WebSocket message** → `updateAiPlanBadges` → badges appear instantly
9. **Fallback**: If WebSocket missed, `loadAiPlan` polling (with 45s server wait) returns plan → `updateAiPlanBadges`

## Failure Modes & Mitigations
| Failure | Mitigation |
|---------|------------|
| WebSocket not connected | Wait for connection with timeout before adding listener |
| WebSocket message missed | Polling fallback via `loadAiPlan` (45s server-side wait) |
| Both WebSocket & polling fail | `updateAiPlanBadges` idempotent; cached plan shown on resume |
| Race: WS + polling both fire | `updateAiPlanBadges` replaces existing badge; add `planApplied` flag |
| Backend model timeout | Model cascade reordered (separate PR) - fast model first |

## Validation Plan
1. **Toast removal**: Start AI workout → verify NO "ИИ-план недоступен" toasts appear
2. **WebSocket delivery**: Open DevTools → Network → WS → verify `workout_plan_ready` received
3. **UI update**: AI badges appear on exercise cards within 10s of starting workout
4. **Fallback test**: Disconnect WebSocket (close tab, reopen) → badges still appear via polling
5. **Resume test**: Background app → resume → cached badges shown immediately
6. **No double badges**: Verify only one badge per exercise card

## Implementation Order
1. **Remove toasts** from `loadAiPlan` (lines 1514, 1520) - immediate UX win
2. **Add `waitForRealtimeConnected`** to `app.js`
3. **Fix WebSocket listener setup** in `startTemplateWithAi` & `startQuickWorkoutWithAi`
4. **Add `planApplied` flag** to prevent double-render
5. **Test end-to-end** with backend running

## Open Questions
- Should we keep the offline toast (line 1505)? It might be useful for debugging but noisy for users.
- Do we need to handle the case where user starts AI workout while offline? Currently `loadAiPlan` returns early with toast - maybe just silently return null.
- Should `startTemplateWithAi` show a subtle "AI plan generating..." indicator in the badge area while waiting?

## Risk Assessment
- **Low risk**: Toast removal is purely subtractive
- **Medium risk**: WebSocket connection wait adds ~100-500ms delay to startup
- **Low risk**: Idempotent badge update prevents visual glitches