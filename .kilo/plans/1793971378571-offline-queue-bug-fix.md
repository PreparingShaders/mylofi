# Offline Queue Bug Fix Plan

## Problem Summary
Food photo uploads in the Nutrition section get stuck in the offline queue indefinitely (weeks), and when network restores, duplicate submissions occur or queue doesn't clear properly.

## Root Causes Identified

### 1. No Deduplication Mechanism
- Photos uploaded offline get queued in IndexedDB (`sync_queue` store) via `SyncEngine.enqueuePhotoUpload()`
- No unique identifier (hash) for photos to detect duplicates
- Same photo can be queued multiple times if user retries or app restarts

### 2. Stale Items Not Purged Reliably
- `SYNC_TTL_MS = 24h` exists but `purgeStaleItems()` only runs:
  - On `SyncEngine.init()` (once per session)
  - Before each `processQueue()` call
- If user never opens app while online, items never get purged
- No background/periodic cleanup

### 3. Race Condition on Network Restore
- `NetworkBanner.showRestored()` calls `SyncEngine.processQueue()` on `online` event
- `SyncEngine.processQueue()` has `this.processing` guard but no deduplication
- Multiple rapid online/offline events can trigger concurrent processing

### 4. No Manual Cleanup UI
- Failed items shown in nutrition page via `SyncEngine.getFailedItems()`
- No user-facing "delete" or "retry" buttons for stuck items

### 5. Incomplete Cleanup After Success
- `processQueue()` deletes item on success (`DB.deleteSyncQueue(item.id)`)
- But `handleSyncedMeal()` in camera.js only handles `store === 'meals'`
- Photo uploads use `store: 'meals'` so this should work, but no verification

## Implementation Plan

### Phase 1: Add Photo Deduplication (Core Fix)

**File: `static/js/sync.js`**
1. Add `generatePhotoHash(blob)` utility - compute SHA-256 hash of photo blob
2. Modify `enqueuePhotoUpload()` to:
   - Compute hash before enqueueing
   - Check `sync_queue` for existing PENDING item with same hash + endpoint
   - If found, update existing item instead of creating duplicate
3. Store hash in sync_queue item as `photoHash` field

**File: `static/js/db.js`**
1. Add index on `photoHash` in `sync_queue` store (requires DB version bump to 4)
2. Add `getSyncQueueByPhotoHash(hash, endpoint)` method

### Phase 2: Reliable Stale Item Cleanup

**File: `static/js/sync.js`**
1. Reduce `SYNC_TTL_MS` from 24h to **6 hours** (configurable)
2. Add `MAX_RETRY_COUNT = 3` (reduced from 5)
3. Add periodic cleanup: `setInterval(purgeStaleItems, 30 min)` when online
4. Run `purgeStaleItems()` on app startup (already in init) AND on visibility change

**File: `static/js/app.js`** (or main entry)
1. Listen for `visibilitychange` event, run cleanup when tab becomes visible

### Phase 3: Fix Race Conditions on Network Restore

**File: `static/js/sync.js`**
1. Strengthen `processQueue()` guard:
   - Use `Promise`-based mutex instead of boolean flag
   - Track currently processing item IDs in a `Set`
2. Add `isItemProcessing(itemId)` check before replaying

**File: `static/js/network.js`**
1. Debounce `online` event handler (already has 3s debounce for offline, add for online)
2. Only trigger sync if queue has pending items: `SyncEngine.getPendingCount() > 0`

### Phase 4: Add Manual Cleanup UI

**File: `static/js/nutrition.js`**
1. In `loadData()`, failed items already loaded via `SyncEngine.getFailedItems()`
2. Add retry/delete buttons to failed meal cards in `Components.mealCard()` or new component
3. Add handlers:
   - `retryFailedMeal(item)` → re-enqueue with new tempId, reset retryCount
   - `deleteFailedMeal(item)` → `DB.deleteSyncQueue(item.id)` + remove local meal

**File: `static/js/components.js`**
1. Add `failedMealActions(item)` component with retry/delete buttons
2. Style consistently with existing meal cards

### Phase 5: Verify Cleanup After Success

**File: `static/js/camera.js`**
1. In `handleSyncedMeal()`, add logging to confirm deletion
2. Ensure `onItemSynced` hook in SyncEngine triggers nutrition page refresh

**File: `static/js/sync.js`**
1. After successful `replayFn()`, verify item deleted from queue
2. Add assertion/log: `console.assert(!(await DB.getSyncQueue(item.id)))`

### Phase 6: Backend Hardening (Already Partially Done)

**File: `app/services/nutrition.py`**
- `fail_stale_meals()` runs on every read (5 min timeout) ✓
- Consider adding hash-based duplicate detection on `/nutrition/photos` endpoint

## Testing Strategy

### Unit Tests (Backend - pytest)
```bash
pytest tests/ -v -k "nutrition" --tb=short
```
- Test `fail_stale_meals()` marks stuck meals FAILED
- Test `retry_meal_analysis()` resets FAILED → PENDING
- Test duplicate photo upload returns existing meal

### Integration Tests (Frontend - Manual/Playwright)
1. **Offline → Online flow:**
   - Disconnect network
   - Upload 3 photos
   - Reconnect network
   - Verify: all 3 processed, no duplicates, queue empty

2. **Duplicate prevention:**
   - Offline: upload same photo twice
   - Online: verify only 1 meal created

3. **Stale cleanup:**
   - Create queue item with old `createdAt` (mock time)
   - Open app → verify item purged

4. **Manual retry/delete:**
   - Fail a meal (mock server error)
   - Verify retry/delete buttons appear and work

## Configuration Constants

| Constant | Current | Proposed | Location |
|----------|---------|----------|----------|
| `SYNC_TTL_MS` | 24h | 6h (21600000) | `sync.js:6` |
| `MAX_RETRIES` | 5 | 3 | `sync.js:5` |
| `STUCK_MEAL_TIMEOUT` | 5 min | 5 min (keep) | `nutrition.py:43` |

## Migration Notes

- IndexedDB version bump from 3 → 4 for `photoHash` index
- `migrateLocalStorageQueue()` in `sync.js` handles legacy localStorage → IndexedDB
- No backend migration needed

## Rollout Plan

1. Deploy backend changes (nutrition.py) - no breaking changes
2. Deploy frontend changes with DB version bump
3. Monitor sync queue size metrics
4. Verify no duplicate meals in production logs

## Open Questions

1. **Photo hash computation cost**: SHA-256 on large blobs may block UI. Consider:
   - Web Worker for hash computation
   - Use first 64KB + size + name as weak hash (faster, collision-resistant enough)

2. **Failed items UI location**: Where exactly should retry/delete buttons appear?
   - In meal carousel as separate "Failed" section?
   - Inline on the pending card?
   - Separate "Sync Errors" page?

3. **TTL value**: 6 hours may be too aggressive for users with intermittent connectivity. Make configurable via settings?