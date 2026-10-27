# Fix Stuck AI Analysis in PWA - Implementation Plan

## Diagnosis Summary

**Where the error is lost:**
1. **Backend** (`nutrition.py:process_meal_photo_task`) - Actually HAS proper try/except and calls `mark_meal_failed()` which sets `status=FAILED`, saves `error_message`, and sends WebSocket notification. This part works correctly.

2. **Frontend** (`components.js:mealCardPhoto`) - **Main bug location:**
   - `isPending` checks `meal.status === 'pending' || meal.status === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING` (line 1071)
   - `isFailed` checks `meal.sync_status === DB.SYNC_STATUS.FAILED` (line 1072) — **WRONG**: This checks local IndexedDB sync status, not server meal status!
   - `isStuck` is hardcoded to `false` (line 1073) — **NO stuck detection**
   - When `meal.status === 'failed'` (server status), the card still renders as "analyzing" because `isPending` doesn't catch `'failed'` status
   - No error message display, no retry button, no delete button for failed meals

3. **Sync Queue** (`sync.js`) - Failed server meals (`status=FAILED`) are different from failed sync queue items. The "Ожидают синхронизации: N" counter uses `SyncEngine.getFailedItems()` which returns failed *sync queue* entries, not failed meals.

4. **WebSocket** - Backend sends notification on failure (`nutrition.py:500-506`), frontend listens for `completed`/`failed` (nutrition.js:103) and re-renders — this part works.

---

## Files to Modify

### Backend (minor - ensure robustness)
1. `app/services/nutrition.py` - Verify `mark_meal_failed` always sends WebSocket; add explicit logging

### Frontend (major fixes)
2. `static/js/components.js` - **Primary fix**: Update `mealCardPhoto` to:
   - Detect `meal.status === 'failed'` server status
   - Detect stuck analyzing (> 3 min since `created_at`/`updated_at`)
   - Render error state with message, retry button, delete button
   - Apply `meal-card--alert` class for failed/stuck meals

3. `static/js/nutrition.js` - Update `loadData` to:
   - Exclude server-side `FAILED` meals from "awaiting sync" counter
   - Pass stuck/failed info to render

4. `static/js/sync.js` - Optional: Ensure failed meal analysis doesn't create sync queue entries

---

## Detailed Change Plan

### 1. `static/js/components.js` - `mealCardPhoto` function (lines 1070-1212)

**Changes:**
```javascript
// OLD (line 1071-1073):
const isPending = meal.status === 'pending' || meal.status === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING;
const isFailed = meal.sync_status === DB.SYNC_STATUS.FAILED;
const isStuck = false;

// NEW:
const serverStatus = meal.status; // 'pending' | 'processing' | 'completed' | 'failed'
const isPending = serverStatus === 'pending' || serverStatus === 'processing';
const isFailed = serverStatus === 'failed';
const createdAt = meal.created_at ? new Date(meal.created_at).getTime() : Date.now();
const updatedAt = meal.updated_at ? new Date(meal.updated_at).getTime() : createdAt;
const analysisStartTime = Math.max(createdAt, updatedAt);
const isStuck = (serverStatus === 'pending' || serverStatus === 'processing') && 
                (Date.now() - analysisStartTime > 3 * 60 * 1000); // 3 minutes
const isAlert = isFailed || isStuck;
```

**Error state rendering (when `isFailed` or `isStuck`):**
- Show `meal.error_message` or `meal.quality_reason` (user-facing text)
- Show "Повторить анализ" button → calls `retryMealAnalysis(mealId)`
- Show "Удалить" button → calls existing delete action
- Keep photo visible, show macro pills as skeleton or zeros

**Add `retryMealAnalysis` function** in Nutrition module (or Components) that:
- Calls `POST /nutrition/meals/{id}/retry-analysis` (new endpoint needed) OR
- Re-triggers the background task via existing mechanism

### 2. Backend: Add Retry Endpoint in `app/api/v1/routes.py`

**New endpoint:** `POST /nutrition/meals/{meal_id}/retry-analysis`
- Check meal exists, belongs to user, has photo, status is `FAILED` or stuck
- Reset status to `PENDING`, clear `error_message`
- Re-enqueue `process_meal_photo_task` via `BackgroundTasks`
- Return updated meal

### 3. `static/js/nutrition.js` - `loadData` function (lines 286-354)

**Changes:**
- When building `pendingMeals`, filter out meals where `meal.status === 'failed'` (server status)
- These are not "awaiting sync" - they are permanently failed analyses
- The "Ожидают синхронизации" counter should only count `sync_status === PENDING` items that are NOT failed server meals

### 4. `app/services/nutrition.py` - `mark_meal_failed` (lines 476-507)

**Verify/Enhance:**
- Already calls `notify_meal_analysis_update` with `MealStatus.FAILED` ✓
- Ensure `error_message` is always set (technical) and `quality_reason` is user-facing ✓
- Add explicit logging for WebSocket send success/failure

---

## Additional Improvements (Optional but Recommended)

### 5. Stuck Meal Cleanup - Already Exists!
- `fail_stale_meals` (nutrition.py:544) runs on every `load_meals_for_range` call
- Marks meals stuck in `PENDING`/`PROCESSING` > 5 min as `FAILED`
- Sends WebSocket notification
- **No code change needed** - just verify it works

### 6. Mass Cleanup Admin Endpoint (Optional)
- `POST /admin/cleanup-stuck-meals` to manually trigger `fail_stale_meals` for all users

---

## Validation Plan

1. **Simulate AI timeout**: Set `AI_TASK_TIMEOUT = 1` in nutrition.py, upload photo, verify:
   - Meal shows "Анализируем..." for ~1 min
   - Then shows error state with message, retry, delete buttons
   - WebSocket notification received, card updates without refresh

2. **Simulate API error**: Mock Gemini/OpenRouter to return 500, verify same behavior

3. **Retry flow**: Click "Повторить анализ" → meal goes back to analyzing → completes or fails again

4. **Sync counter**: Verify failed meals don't appear in "Ожидают синхронизации" count

5. **Stuck detection**: Create meal with `status=PROCESSING` and old `updated_at` (> 3 min), verify shows as stuck with error UI

---

## Implementation Order

1. **Frontend: `components.js`** - Core fix: error state rendering + stuck detection
2. **Backend: `routes.py`** - Add retry analysis endpoint
3. **Frontend: `nutrition.js`** - Fix sync counter, wire retry button
4. **Backend: `nutrition.py`** - Verify/improve WebSocket notification logging
5. **Test all scenarios**