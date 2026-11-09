# Offline Queue Sync Fix - Implementation Plan

## Executive Summary

The MyLofi PWA has a sophisticated offline-first architecture with IndexedDB storage, a SyncEngine, Background Sync API, and WebSocket-based realtime channel. This plan addresses four critical issues:

1. **Redundant `/health` checks** - Remove HTTP `/health` probes; WebSocket connection is the ground truth for backend connectivity
2. **Mutex not guaranteed to release** - Add proper `try/finally` lock in `flushOfflineQueue`
3. **WebSocket event debouncing** - Add hysteresis (2-3s offline, 1.5-2s online) to prevent UI flickering on brief network blips
4. **Safe queue item cleanup** - For photo uploads, only delete queue item after successful upload AND analysis completion (not just after 201 response)

---

## Current Architecture Analysis

### WebSocket as Network Authority (Already Implemented)
The `RealtimeSocket` in `api.js`:
- Emits `status` events: `'connecting'`, `'open'`, `'closed'`
- Dispatches `mylofi:realtime-status` custom events on `window`
- Has heartbeat (ping/pong) to detect dead connections faster than TCP timeout
- Auto-reconnects with backoff, pauses on `navigator.onLine === false`

The `App.connectRealtime()` in `app.js` (lines 1728-1755) listens to WebSocket status and triggers `flushOfflineQueue()` on `open`.

### Problem: Queue Item Deleted Before Analysis Completes
**Current flow for offline photo uploads:**
1. `SyncEngine.processQueue()` uploads photo → gets 201 with `meal_id`
2. **Immediately deletes queue item** (sync.js line 483)
3. Calls `onItemSynced` hook → `Camera.handleSyncedMeal()` merges temp meal
4. **But analysis hasn't completed yet!** No wait for analysis like in online flow

**Online flow (correct):**
1. `handleNewMealSubmit()` uploads → gets `meal_id`
2. Calls `Camera.pollMealAnalysisStatus()` → waits for `'completed'`
3. Only then considers the meal fully processed

**Gap:** Offline queued items skip the analysis wait, so if analysis fails, the item is already gone from queue and can't be retried.

---

## Fix Strategy

### Phase 1: WebSocket Debouncing (Hysteresis)
**Goal**: Prevent UI/queue triggers from firing on brief network blips.

**Changes**:
1. Add debounce timers in `RealtimeSocket.setStatus()` or in `App` handlers
2. On `closed`/`error`: wait 2-3s of stable offline before emitting `'closed'` status
3. On `open`: wait 1.5-2s of stable connection before emitting `'open'` status
4. Cancel pending debounce timer if opposite event fires first

### Phase 2: Safe Queue Cleanup for Photo Uploads
**Goal**: Only delete `/nutrition/photos` queue items after analysis completes.

**Changes**:
1. In `SyncEngine.processQueue()`, for endpoint `/nutrition/photos`: don't delete on upload success
2. Instead, mark item with `meal_id` and status `'uploaded_awaiting_analysis'`
3. After upload, wait for analysis completion via WebSocket push or polling
4. Only then delete queue item and call `onItemSynced`

### Phase 3: Proper Mutex in `flushOfflineQueue`
**Goal**: Guarantee lock release with `try/finally`.

### Phase 4: Remove Redundant `/health` Checks
**Goal**: WebSocket as single source of truth.

### Phase 5: Clean Up Redundant Listeners

---

## Detailed Implementation Tasks

### Task 1: Add Debounce to `RealtimeSocket.setStatus()`
**File**: `static/js/api.js` - `RealtimeSocket` class

```javascript
// Add to constructor (after line 100):
this._statusDebounceTimer = null;
this._pendingStatus = null;
this._stableStatus = 'idle';  // The last confirmed stable status

// Debounce delays (ms)
this._debounceDelays = {
    open: 1500,    // Wait 1.5s stable before confirming online
    closed: 3000,  // Wait 3s stable before confirming offline
    connecting: 0  // No debounce for connecting
};

// Replace setStatus (lines 138-143):
setStatus(status) {
    // Clear any pending debounce
    if (this._statusDebounceTimer) {
        clearTimeout(this._statusDebounceTimer);
        this._statusDebounceTimer = null;
    }

    // If status hasn't actually changed (stable), no need to debounce
    if (this._stableStatus === status) {
        this._pendingStatus = null;
        return;
    }

    const delay = this._debounceDelays[status] ?? 0;
    
    if (delay === 0) {
        // No debounce needed (e.g., 'connecting')
        this._doSetStatus(status);
        return;
    }

    // Debounce: wait for stable status
    this._pendingStatus = status;
    this._statusDebounceTimer = setTimeout(() => {
        this._statusDebounceTimer = null;
        // Only commit if status hasn't flipped again during wait
        if (this._pendingStatus === status) {
            this._doSetStatus(status);
        }
        this._pendingStatus = null;
    }, delay);
},

// Internal method that actually emits the status
_doSetStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this._stableStatus = status;
    this.emit('status', status);
    window.dispatchEvent(new CustomEvent('mylofi:realtime-status', { detail: { status } }));
},
```

**Rationale**: 
- Prevents rapid `open`/`closed` oscillations on flaky connections
- 3s offline debounce: short blips (tunnel, handover) won't trigger offline UI
- 1.5s online debounce: ensures connection is stable before flushing queue
- Heartbeat continues during debounce; if pong fails, `dropSocket()` forces `closed` immediately

---

### Task 2: Safe Queue Cleanup - Modify `SyncEngine.processQueue()` for Photo Uploads
**File**: `static/js/sync.js`

```javascript
// Add helper to detect photo upload endpoint
isPhotoUpload(item) {
    return item && item.endpoint === '/nutrition/photos' && item.method === 'POST' && item.isFormData;
},

// In processQueue, after successful replay (around line 481), REPLACE:
                    // Delete on success; retain FAILED items for inspection/retry.
                    if (!failed) {
                        await DB.deleteSyncQueue(item.id);
                        // Verify deletion
                        const deleted = await DB.get('sync_queue', item.id);
                        if (deleted) {
                            console.warn('[SyncEngine] Item still exists after sync deletion:', item.id);
                        }
                    }

// WITH:
                    // Delete on success; retain FAILED items for inspection/retry.
                    // EXCEPTION: Photo uploads must wait for analysis completion before deletion.
                    if (!failed) {
                        if (this.isPhotoUpload(item)) {
                            // Mark as uploaded, awaiting analysis completion
                            await DB.updateSyncQueue(item.id, {
                                status: 'uploaded_awaiting_analysis',
                                mealId: response?.id ?? response?.meal_id ?? null,
                                updatedAt: Date.now(),
                            });
                            console.log('[SyncEngine] Photo uploaded, awaiting analysis completion:', item.id);
                            // Do NOT call onItemSynced yet - will be called after analysis completes
                            // Do NOT increment synced counter yet
                        } else {
                            await DB.deleteSyncQueue(item.id);
                            // Verify deletion
                            const deleted = await DB.get('sync_queue', item.id);
                            if (deleted) {
                                console.warn('[SyncEngine] Item still exists after sync deletion:', item.id);
                            }
                            
                            // General temp-id → real-id translation for POST/PUT responses
                            if (this.isMutableCreate(item) && response && response.id && item.tempId && item.store) {
                                try {
                                    await DB.resolveTempId(item.store, item.tempId, response.id);
                                } catch (mappingError) {
                                    console.error('[SyncEngine] Temp ID resolution failed:', mappingError);
                                }
                            }

                            if (typeof this.onItemSynced === 'function') {
                                try {
                                    await this.onItemSynced(item, response, { failed: false });
                                } catch (hookError) {
                                    console.error('[SyncEngine] Post-sync hook failed:', hookError);
                                }
                            }
                            
                            synced += 1;
                        }
                    }

// ADD new method to wait for analysis and complete the sync:
    async _waitForPhotoAnalysisAndComplete(item, response) {
        const mealId = response?.id ?? response?.meal_id;
        if (!mealId) {
            console.error('[SyncEngine] No mealId in photo upload response, marking failed');
            await DB.updateSyncQueue(item.id, {
                status: DB.SYNC_STATUS.FAILED,
                error: 'no meal_id in response',
                updatedAt: Date.now(),
            });
            if (typeof this.onItemSynced === 'function') {
                await this.onItemSynced(item, null, { failed: true });
            }
            return;
        }

        try {
            // Wait for analysis completion using Camera's poll mechanism
            // We need access to Camera - use dynamic import or global
            const Camera = window.Camera || (await import('./camera.js')).Camera;
            const accessToken = item.accessToken || window.App?.state?.tokens?.access;
            
            if (!accessToken) {
                throw new Error('No access token for analysis polling');
            }

            const outcome = await Camera.pollMealAnalysisStatus(mealId, accessToken);
            
            if (outcome === 'completed') {
                // Analysis succeeded - now delete queue item and fire onItemSynced
                await DB.deleteSyncQueue(item.id);
                
                // Temp ID resolution
                if (this.isMutableCreate(item) && item.tempId && item.store) {
                    try {
                        await DB.resolveTempId(item.store, item.tempId, mealId);
                    } catch (mappingError) {
                        console.error('[SyncEngine] Temp ID resolution failed:', mappingError);
                    }
                }

                if (typeof this.onItemSynced === 'function') {
                    await this.onItemSynced(item, response, { failed: false });
                }
                
                console.log('[SyncEngine] Photo analysis completed, sync finalized:', item.id);
                
                // Trigger UI refresh
                window.dispatchEvent(new CustomEvent('mylofi:offline-sync', { detail: { synced: 1 } }));
                window.dispatchEvent(new CustomEvent('mylofi:sync-completed', { detail: { syncedCount: 1 } }));
                
                const app = window.App;
                if (app?.state?.currentScreen === 'main' && app?.state?.currentPage === 'nutrition') {
                    if (typeof app.renderPage === 'function') {
                        await app.renderPage('nutrition');
                    }
                }
            } else {
                // Analysis failed/timed out - keep item in queue for retry
                await DB.updateSyncQueue(item.id, {
                    status: DB.SYNC_STATUS.PENDING,  // Back to pending for retry
                    retryCount: (item.retryCount || 0) + 1,
                    error: `analysis ${outcome}`,
                    updatedAt: Date.now(),
                });
                console.warn('[SyncEngine] Photo analysis failed, re-queuing:', item.id, outcome);
            }
        } catch (error) {
            console.error('[SyncEngine] Error waiting for photo analysis:', error);
            // On error, mark as failed but keep for manual retry
            await DB.updateSyncQueue(item.id, {
                status: DB.SYNC_STATUS.FAILED,
                error: error?.message || 'analysis wait error',
                updatedAt: Date.now(),
            });
        }
    },

// In the processQueue loop, after the try/catch for replayFn (around line 479), ADD:
                    // For photo uploads, wait for analysis completion before finalizing
                    if (!failed && this.isPhotoUpload(item)) {
                        // Don't increment synced yet, don't call onItemSynced yet
                        // Fire and forget the analysis wait
                        this._waitForPhotoAnalysisAndComplete(item, response).catch(e => {
                            console.error('[SyncEngine] Analysis wait crashed:', e);
                        });
                        // Continue to next item - this one is "in progress"
                        continue;
                    }
```

**Rationale**:
- Photo upload 201 only means "analysis started", not "analysis complete"
- Queue item stays in `uploaded_awaiting_analysis` status until analysis completes
- If analysis fails, item returns to `PENDING` for retry (with incremented retry count)
- Only on `'completed'` analysis is the queue item deleted and `onItemSynced` fired
- This matches the online flow behavior exactly

---

### Task 3: Add Proper Mutex to `App.flushOfflineQueue()`
**File**: `static/js/app.js`

```javascript
// Add to App.state (around line 94):
_flushLock: false,

// Replace flushOfflineQueue (lines 451-482):
async flushOfflineQueue() {
    // Guard: no tokens = nothing to sync
    if (!this.state.tokens.access) return;
    
    // Guard: auth failed = session invalid, don't retry
    if (SyncEngine.authFailed) {
        console.log('[App] Auth session invalid, skipping offline queue flush');
        return;
    }
    
    // Guard: SyncEngine not initialized yet
    if (!SyncEngine.isReady()) {
        console.log('[App] SyncEngine not ready, deferring queue flush');
        // Schedule ONE retry after init (not a loop)
        setTimeout(() => this.flushOfflineQueue(), 100);
        return;
    }
    
    // Mutex: prevent concurrent flushes with guaranteed release
    if (this.state._flushLock) {
        console.log('[App] Queue flush already in progress, skipping duplicate');
        return;
    }
    
    this.state._flushLock = true;
    console.log('[App] Starting offline queue flush');
    
    try {
        await SyncEngine.processQueue();
        console.log('[App] Offline queue flush completed');
    } catch (e) {
        console.error('[App] Offline queue processing failed:', e);
    } finally {
        this.state._flushLock = false;
        console.log('[App] Flush lock released');
    }
},
```

---

### Task 4: Remove `checkHostConnectivity()` and `/health` Checks
**File**: `static/js/app.js`

```javascript
// REMOVE entire checkHostConnectivity function (lines 892-928)

// REMOVE call in init (line 343):
// await this.checkHostConnectivity();  // DELETE

// REMOVE call in handleAppResume (line 682):
// const reachable = await this.checkHostConnectivity();  // DELETE

// REMOVE call in online handler (line 1831):
// this.checkHostConnectivity().catch(() => {});  // DELETE
```

**File**: `static/js/api.js` - Remove `checkHostReachable` method (lines 429-445)

---

### Task 5: WebSocket `open` Event as Sole Flush Trigger (with Debounce)
**File**: `static/js/app.js` - Update `openRealtime()` (lines 1728-1755)

```javascript
openRealtime(token) {
    if (this.state.tokens?.access !== token) return;

    if (!this.realtime) {
        this.realtime = API.createWebSocket(token);
        this.realtime.on('status', (status) => {
            if (status === 'open') {
                this._realtimeAuthRetries = 0;
                this.state.isOnline = true;
                NetworkBanner.hide();
            } else if (status === 'closed') {
                this.state.isOnline = false;
                NetworkBanner.showOffline();
            }
        });
        window.addEventListener('mylofi:realtime-status', (e) => {
            const status = e?.detail?.status;
            if (status === 'open') {
                this.state.isOnline = true;
                NetworkBanner.hide();
                // ONLY place that triggers queue flush on network restore
                // (debounced by RealtimeSocket - only fires after 1.5s stable)
                if (this.state.tokens?.access && this.state.currentScreen === 'main') {
                    this.flushOfflineQueue().catch(() => {});
                    this.refreshCurrentView();
                }
            } else if (status === 'closed') {
                this.state.isOnline = false;
                NetworkBanner.showOffline();
            }
        });
        // ... rest unchanged
    }
}
```

---

### Task 6: Simplify `NetworkBanner` to Read App State
**File**: `static/js/network.js`

```javascript
// REMOVE lines 42-43 (offline/online listeners in init):
// window.addEventListener('offline', () => this.showOffline());
// window.addEventListener('online', () => this.showRestored());

// REPLACE refresh() (lines 196-220):
async refresh(skipHostCheck = false) {
    // Authoritative state from App (set by WebSocket)
    const isOnline = window.App?.state?.isOnline ?? navigator.onLine;
    
    if (!isOnline) {
        if (this.state !== 'offline') this.showOffline();
        return 'offline';
    }
    
    // Online - show restored briefly then hide
    if (this.state !== 'hidden') {
        this.showRestored();
    }
    return 'restored';
},

// REMOVE showRestored() debounce and sync trigger (lines 165-181):
showRestored() {
    this.clearTimers();
    this.state = 'restored';
    this.mount();
    this.render('restored');
    this.el.classList.add('is-visible');
    document.body.classList.add('has-network-banner');
    
    // NO SyncEngine.processQueue() call here
    // App.flushOfflineQueue() triggered by WebSocket open event
    
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
},
```

---

### Task 7: Remove Redundant Event Listeners in `App.setupOfflineSync()`
**File**: `static/js/app.js` (lines 379-448)

```javascript
setupOfflineSync() {
    // REMOVE: window.addEventListener('offline', ...) - WebSocket handles
    // REMOVE: window.addEventListener('online', ...) - WebSocket handles
    
    // KEEP: visibilitychange, focus, pageshow for app resume
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        this.handleAppResume('visibility');
    });

    window.addEventListener('focus', () => {
        if (document.visibilityState !== 'visible') return;
        this.handleAppResume('focus');
    });

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            this.handleAppResume('pageshow');
        }
    });

    // KEEP: mylofi:offline-sync, mylofi:meal-synced, mylofi:auth-failed
    // ... existing handlers ...

    // KEEP: SW message handler for FLUSH_OFFLINE_QUEUE
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'FLUSH_OFFLINE_QUEUE') {
                console.log('[App] SW requested queue flush');
                this.flushOfflineQueue().catch(() => {});
            }
            if (event.data?.type === 'SYNC_COMPLETE') {
                // ... existing handler ...
            }
        });
    }
},
```

**Update `handleAppResume`** (lines 634-732):

```javascript
async runAppResume(source) {
    // ... existing debounce logic ...
    
    if (this.state.currentScreen !== 'main' || !this.state.tokens?.access) return;
    if (SyncEngine.authFailed) return;

    console.log(`[App] App resumed (${source})`);
    
    // WebSocket will reconnect automatically via its onlineHandler
    // Just ensure it's connecting
    this.connectRealtime();
    
    // NO checkHostConnectivity() - WebSocket 'open' event will trigger flush
    // Just rearm workout timer if on workout screen
    if (this.isWorkoutScreenOpen()) {
        this.rearmWorkoutTimer();
    }
}
```

---

### Task 8: Update `SyncEngine` - Remove Internal `online` Listener
**File**: `static/js/sync.js` (lines 140-144)

```javascript
// REMOVE:
window.addEventListener('online', () => {
    console.log('[SyncEngine] Online event — scheduling queue flush');
    this.processQueue().catch((error) => console.error('[SyncEngine] processQueue error:', error));
    if (typeof this.onOnline === 'function') this.onOnline();
});

// KEEP: Background Sync registration (lines 146-152)
// KEEP: auth:logged-in listener (lines 163-168)
```

---

### Task 9: Add `SyncEngine.isReady()` Helper
**File**: `static/js/sync.js`

```javascript
// Add after line 86 (initialized: false)
isReady() {
    return this.initialized && typeof this.replayFn === 'function';
},
```

---

## Validation Plan

### Manual Testing Checklist

| Scenario | Expected Behavior |
|----------|-------------------|
| **Cold start, online** | WebSocket connects → debounced `open` (1.5s) → single `flushOfflineQueue()` |
| **Cold start, offline** | No WebSocket connection; queue processes when WebSocket opens |
| **Brief network blip (<2s)** | No offline banner, no queue flush, WebSocket reconnects silently |
| **Network down >3s** | Offline banner shows, `isOnline = false` |
| **Network restored >1.5s** | Banner hides, `flushOfflineQueue()` runs once |
| **Photo upload offline → online** | Upload → queue item stays `uploaded_awaiting_analysis` → analysis completes → queue item deleted |
| **Photo upload offline → online → analysis fails** | Queue item returns to `PENDING` with incremented retry count |
| **SW Background Sync fires** | Posts `FLUSH_OFFLINE_QUEUE` → `flushOfflineQueue()` (mutex prevents duplicate) |
| **Auth token expired** | `authFailed` flag set → queue halted → redirect to login |
| **Error during flush** | Lock released in `finally`; next WebSocket `open` retries |

### Automated Verification Points

1. **Console logs**: Exactly one `[App] Starting offline queue flush` and `[App] Flush lock released` per restoration
2. **No stuck state**: Never see "Queue flush already in progress" without subsequent "Flush lock released"
3. **Network tab**: No `GET /health` requests; WebSocket handshake proves connectivity
4. **IndexedDB**: Photo queue items show `uploaded_awaiting_analysis` status during analysis; deleted only after `completed`
5. **UI**: "Ожидают синхронизации" badge disappears after analysis completes (not after upload)
6. **Events**: `mylofi:sync-completed` fires once per photo after analysis completes

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebSocket fails to connect but network works | Low | Medium | SW `FLUSH_OFFLINE_QUEUE` fallback; manual refresh works |
| Lock not released on unhandled exception | Eliminated | - | `try/finally` guarantees release |
| Duplicate flush from SW + WebSocket | Low | Low | Mutex prevents concurrent execution |
| `navigator.onLine` false positive | N/A | N/A | WebSocket handshake is ground truth |
| Analysis wait crashes | Low | Medium | Try/catch in `_waitForPhotoAnalysisAndComplete`; item marked FAILED |
| Debounce delays UX | Low | Low | 1.5s/3s is imperceptible; heartbeat detects hard failures faster |

---

## Rollout Plan

1. **Phase 1** (Tasks 1, 3): Add WebSocket debounce, proper mutex
2. **Phase 2** (Task 2): Safe queue cleanup for photo uploads (most critical fix)
3. **Phase 3** (Tasks 4, 5, 6): Remove `/health` checks, WebSocket as sole trigger
4. **Phase 4** (Tasks 7, 8, 9): Remove redundant listeners, add `isReady()`

---

## Files to Modify

| File | Changes |
|------|---------|
| `static/js/api.js` | Add debounce to `RealtimeSocket.setStatus()`, remove `checkHostReachable()` |
| `static/js/app.js` | Add `_flushLock`, rewrite `flushOfflineQueue()`, remove `checkHostConnectivity()`, update `openRealtime()`, `setupOfflineSync()`, `handleAppResume()`, remove init call |
| `static/js/sync.js` | Add `isPhotoUpload()`, modify `processQueue()` to wait for analysis, add `_waitForPhotoAnalysisAndComplete()`, remove `online` listener, add `isReady()` |
| `static/js/network.js` | Remove `online`/`offline` listeners, simplify `refresh()`, `showRestored()` |

---

## Out of Scope

- Service Worker precaching strategy
- Read cache (`localStorage`) invalidation
- Workout session offline sync (handled separately in `workouts.js`)
- Background Sync API registration (keep as fallback)
- UI/UX of network banner (functional only)