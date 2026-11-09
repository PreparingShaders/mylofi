# Offline Workout Session ID Resolution - Implementation Plan

## Current State Analysis

**Good news**: The codebase already has ~90% of the fix implemented:
- `SyncEngine.enqueue` accepts `isSessionCreation` flag (sync.js:353)
- `startLocalSessionFromTemplate` calls `API.enqueueRequest` with `isSessionCreation: true` (workouts.js:1158-1169)
- `resolveQueuedItem` handles `item.isSessionCreation` - sends creation request as-is (workouts.js:1036-1038)
- `handleSyncedItem` captures `remoteSessionId` from creation response (workouts.js:1070-1090)
- Completion request uses placeholder `/workouts/sessions/__local_session__/complete` (workouts.js:1315)
- Queue ordering: creation enqueued before completion (FIFO by `createdAt`)

**Single Missing Link**: `API.enqueueRequest` in `api.js` (line 488-502) does NOT pass `isSessionCreation` from options to `SyncEngine.enqueue`.

---

## Root Cause

```javascript
// api.js:488-502 - CURRENT (missing isSessionCreation)
async enqueueRequest(method, endpoint, data, accessToken, options = {}) {
    const item = await SyncEngine.enqueue({
        method,
        endpoint,
        data: data ?? null,
        accessToken: accessToken ?? null,
        offlineSessionKey: options.offlineSessionKey ?? null,
        tempId: options.tempId ?? null,
        store: options.store ?? null,
        formData: options.formData ?? null,
        prepend: options.prepend || false,
        // MISSING: isSessionCreation: options.isSessionCreation ?? false
    });
    ...
}
```

When `startLocalSessionFromTemplate` passes `{ isSessionCreation: true }`, it gets dropped. The queue item is created with `isSessionCreation: false` (default in SyncEngine.enqueue line 353). This means:
1. `resolveQueuedItem` doesn't recognize it as a creation request
2. Tries to replace `__local_session__` placeholder on the creation request itself
3. Since `remoteSessionId` is null, returns `false` (not ready) → queue stalls
4. Completion request never gets processed

---

## Implementation Tasks

### Task 1: Fix `API.enqueueRequest` to Pass `isSessionCreation`  [CRITICAL]

**File**: `static/js/api.js` (lines 488-502)

```javascript
async enqueueRequest(method, endpoint, data, accessToken, options = {}) {
    const item = await SyncEngine.enqueue({
        method,
        endpoint,
        data: data ?? null,
        accessToken: accessToken ?? null,
        offlineSessionKey: options.offlineSessionKey ?? null,
        tempId: options.tempId ?? null,
        store: options.store ?? null,
        formData: options.formData ?? null,
        prepend: options.prepend || false,
        isSessionCreation: options.isSessionCreation ?? false,  // ADD THIS LINE
    });
    this.invalidateReadCache(endpoint);
    console.log(`[API] Queued offline request: ${method} ${endpoint}${options.isSessionCreation ? ' (isSessionCreation)' : ''}`);
    return item;
}
```

---

### Task 2: Verify Queue Ordering & Local State Cleanup  [VERIFICATION]

No code changes needed - verify existing behavior works:

**Queue Order** (by `createdAt` ascending, db.js:324):
1. Session creation: `POST /workouts/templates/{id}/start` with `isSessionCreation: true`, `offlineSessionKey: "local-xxx"`
2. Set patches (if any): `PATCH /workouts/sets/{tempId}` with same `offlineSessionKey`
3. Completion: `POST /workouts/sessions/__local_session__/complete` with same `offlineSessionKey`

**Processing Flow**:
1. Creation processes → `handleSyncedItem` sets `session.remoteSessionId = response.id`
2. Completion processes → `resolveQueuedItem` replaces `__local_session__` with real ID
3. After completion deleted from queue → `handleSyncedItem` calls `clearLocalSession()`

**Local State Cleanup** (workouts.js:1149-1151):
```javascript
if (!(await API.readQueue()).some(queued => queued.offlineSessionKey === session.key)) {
    this.clearLocalSession();  // Clears LOCAL_SESSION_KEY from localStorage
}
```
This correctly waits until ALL items for this session are processed.

---

### Task 3: Handle Empty Workouts (Free-form)  [DESIGN DECISION NEEDED]

**Current**: `startEmptyWorkout` (workouts.js:5674) creates local session but **does not enqueue any creation request**. Relies on `recoverCompletedSessions` → `sync-offline` endpoint.

**Options**:
1. **Add `POST /workouts/sessions` endpoint** (backend) for empty session creation, then enqueue it like template workouts
2. **Keep using `sync-offline`** - no queue changes needed, already works for completed empty workouts
3. **Create virtual template** for empty workouts and use existing template start endpoint

**Recommendation**: Option 2 (keep `sync-offline`) for now. The queue-based temp ID resolution is designed for template workouts where server creates session from template. Empty workouts have no template - `sync-offline` accepts full session data in one call.

**No code change needed** for empty workouts in this fix.

---

### Task 4: Add Logging for Debugging  [NICE TO HAVE]

**File**: `static/js/sync.js` (around line 370)

```javascript
if (item.tempId) {
    console.log(`[SyncEngine] Enqueued ${entry.method} ${entry.endpoint} (tempId=${item.tempId})`);
} else if (item.isSessionCreation) {
    console.log(`[SyncEngine] Enqueued ${entry.method} ${entry.endpoint} (isSessionCreation=true, offlineSessionKey=${item.offlineSessionKey})`);
} else {
    console.log(`[SyncEngine] Enqueued ${entry.method} ${entry.endpoint}`);
}
```

---

## Validation Plan

### Test Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| **Template workout offline → online** | 1. Creation queued with `isSessionCreation=true`<br>2. Completion queued with placeholder<br>3. Sync: creation processes first → gets real ID<br>4. Completion resolves placeholder → succeeds |
| **Template workout offline → complete offline → online** | Same as above |
| **Empty workout offline → online** | Uses `sync-offline` endpoint (unchanged) |
| **Online workout → complete** | Direct API call (unchanged) |
| **Network flaky during sync** | Retries work; failed items stay in queue |

### Verification Checklist

- [ ] Console: `[SyncEngine] Enqueued POST /workouts/templates/{id}/start (isSessionCreation=true, offlineSessionKey=local-xxx)`
- [ ] Console: `[Workouts] Session creation synced: local local-xxx → server 123`
- [ ] Console: `[SyncEngine] Enqueued POST /workouts/sessions/123/complete` (real ID, not placeholder)
- [ ] No 422 validation errors in network tab
- [ ] "Активная тренировка" UI clears after sync completes
- [ ] `localStorage` `offline_local_session` key removed after sync

---

## Files to Modify

| File | Change |
|------|--------|
| `static/js/api.js` | Add `isSessionCreation: options.isSessionCreation ?? false` to `SyncEngine.enqueue` call (line ~495) |

---

## Out of Scope

- Backend API changes (existing `/workouts/templates/{id}/start` works for template workouts)
- Empty workout queue-based sync (keep using `sync-offline`)
- Workout set/exercise ID mapping for patches (already implemented)
- Network banner/UI changes
- Service Worker sync logic

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `isSessionCreation` not passed | Fixed | - | Single line addition in api.js |
| Queue order violation | Low | Medium | FIFO by `createdAt` verified; `prepend: false` default |
| Local state not cleared | Low | Low | Existing `clearLocalSession` logic verified |
| Empty workout regression | None | - | No changes to empty workout path |