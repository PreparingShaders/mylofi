# Food Photo Analysis - Frontend/Backend Deep Dive & Fix Plan

## Executive Summary
The photo analysis pipeline has **multiple timeout layers** that compound:
- Frontend: `UPLOAD_TIMEOUT_MS = 8000` (8s) for upload + `POLL_TIMEOUT_MS = 45000` (45s) for polling
- Backend: `AI_TASK_TIMEOUT = 90.0` (90s) for the full cascade + `MODEL_REQUEST_TIMEOUT = 20.0` (20s) per model call
- Worker proxy: Unknown CPU limits causing `ReadError`/`TimeoutError` on image payloads

**Result**: Requests routinely hit 90s total timeout (cascade through all models) while text requests complete in ~3.7s.

---

## 1. Frontend Analysis (nutrition.js + camera.js + api.js)

### 1.1 Modal & File Handling (nutrition.js:1452-1636)
**Current Flow:**
```
User clicks "Add Meal" → Modal opens (drum-sheet)
→ Camera/Gallery button → <input type="file" id="new-meal-photo-input"> 
→ handleNewMealFileSelect() → Creates object URL preview (URL.createObjectURL)
→ User clicks Submit (id="new-meal-submit") → handleNewMealSubmit()
```

**Issues Found:**
- **No client-side compression before FormData creation** - The `Utils.compressImage()` is called *inside* `handleNewMealSubmit()` (line 1687), AFTER the loading overlay shows
- **Image size limit check**: `compressImage()` only compresses if `file.size > 150KB` (utils.js:60) - too high for worker proxy
- **No EXIF stripping** - Raw camera photos may be 5-10MB before compression
- **Double compression**: Offline path (line 1654) and online path (line 1687) both compress

### 1.2 Upload Request (nutrition.js:1695-1714)
```javascript
const formData = new FormData();
formData.append('file', compressedBlob, 'photo.webp');
formData.append('meal_type', state.selectedMealType);
if (notes) formData.append('notes', notes);
for (const [key, value] of Object.entries(Camera.mealTimeFields())) {
    formData.append(key, value);
}
const response = await API.post('/nutrition/photos', formData, token, true);
```

**Issues:**
- **8s timeout** (`UPLOAD_TIMEOUT_MS = 8000` in api.js:23) - too aggressive for mobile upload + worker processing
- **No request deduplication** - Rapid clicks can send multiple requests
- **Button disabled AFTER request starts** (line 1678) - race window exists

### 1.3 Polling Logic (camera.js:234-283)
```javascript
const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 45000;
const LIVE_PUSH_WAIT_MS = 8000;
```

**Issues:**
- **Aggressive polling**: 800ms interval = up to 56 requests in 45s
- **No exponential backoff** - Hammers the server during analysis
- **WebSocket fallback logic inverted**: When socket IS connected, waits 8s for push; when NOT connected, polls at 800ms. Should be opposite.
- **45s poll timeout** shorter than backend 90s cascade timeout → Frontend gives up before backend finishes

### 1.4 Client Timeouts (api.js:21-26)
```javascript
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;  // 10s
const UPLOAD_TIMEOUT_MS = 8000;            // 8s  ← UPLOAD
const AI_PREVIEW_TIMEOUT_MS = 60000;       // 60s
```

---

## 2. Backend Analysis (routes.py:872-947 + nutrition.py:940-1021)

### 2.1 Upload Endpoint (routes.py:872-947)
```python
async def upload_meal_photo(
    file: UploadFile = File(...),
    eaten_at: str | None = Form(None),
    notes: str | None = Form(None),
    tz_offset: int | None = Form(None),
    tz: str | None = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
```

**Flow:**
1. Validate file type & size (10MB max)
2. Check daily quota (Free: 5/day)
3. Read entire file into memory: `file_content = await file.read()`
4. Save photo (compresses to 1024x1024 WebP quality 80)
5. Create meal record with `status=PENDING`
6. `background_tasks.add_task(process_meal_photo_task, meal.id, tz_offset_minutes)`
7. Return 201 with `meal_id`

**Issues:**
- **Entire file read into memory** before validation - large files cause memory pressure
- **Synchronous compression in request path** - `save_uploaded_photo()` does PIL processing blocking the event loop
- **No async file streaming** - FastAPI's `UploadFile` supports streaming but code reads all at once
- **Background task may not survive worker restart** - No persistence of pending analyses

### 2.2 Background Task (nutrition.py:862-1053)
```python
async def process_meal_photo_task(meal_id: int, tz_offset_minutes: int = 0):
    # ...
    async with async_session_maker() as db:
        # Load meal, check photo exists
        # Mark status = PROCESSING
        # Compress image AGAIN (1024x1024 JPEG quality 80)
        # base64 encode
        # Call ai_vision.analyze_meal_photo() with 90s total timeout
        # Update meal with results or mark FAILED
```

**Critical Issues:**
- **Double compression**: Frontend compresses → Backend compresses AGAIN in task
- **90s AI_TASK_TIMEOUT** but individual model calls have 20s timeout → 4-5 model fallbacks before timeout
- **No WebSocket notification on timeout** - If task exceeds 90s, meal stays PROCESSING forever
- **Stuck meal detection only runs on READ** (`fail_stale_meals()` in `load_meals_for_range`) - Not proactive

### 2.3 AI Vision Cascade (ai_vision.py:553-699)
```python
MODEL_REQUEST_TIMEOUT = 20.0
MODEL_CONNECT_TIMEOUT = 10.0

UNIFIED_MODEL_CASCADE = [
    "gemini-3.1-flash-lite",           # Fast, stable - FIRST
    "gemini-3.1-flash-lite-preview",   # Backup fast
    "gemini-3.5-flash-lite",           # Heavy - moved down
    "gemini-2.5-flash-lite",           # Fast fallback
    "gemini-2.5-flash",                # Reliable
    "gemini-3.6-flash",                # Heavy - moved down
    "qwen/qwen3.8-27b:free",           # OpenRouter
    ...
]
```

**Root Cause of Timeouts:**
1. Worker proxy (`inspectorgpt.classname1984.workers.dev`) has **CPU time limits** (~10-50ms on free tier)
2. Image payloads (base64 ~200-300KB) exceed worker's processing budget
3. Each model call times out at 20s → cascade tries 5-6 models → 90s total
4. Text requests (2-5KB) work fine; image requests (200-300KB) fail

---

## 3. Critical Weak Points Summary

| Layer | Component | Current | Problem | Impact |
|-------|-----------|---------|---------|--------|
| **Frontend** | Upload timeout | 8s | Too short for mobile + worker | False "offline" queueing |
| **Frontend** | Poll interval | 800ms | No backoff, 56 req/45s | Server spam |
| **Frontend** | Poll timeout | 45s | < Backend 90s | Frontend gives up early |
| **Frontend** | Compression | 150KB threshold | Too high for worker | Worker CPU timeout |
| **Backend** | File read | `await file.read()` | Blocks event loop, memory | OOM risk on large files |
| **Backend** | Double compression | Frontend + Backend | Wasted CPU, quality loss | Slower processing |
| **Backend** | AI cascade | 90s total, 20s/model | Worker kills image requests | All models fail |
| **Backend** | Stuck meals | Only on read | No proactive cleanup | Meals stuck for days |
| **Worker** | Image handling | Unknown | Likely CPU/memory limits | ReadError/Timeout |

---

## 4. Proposed Fixes (Prioritized)

### Phase 1: Quick Wins (Frontend Only) - 1-2 hours

**1.1 Reduce frontend compression threshold** (utils.js:60)
```javascript
// Change from 150KB to 50KB
if (file.size && file.size < 50 * 1024) {
    return Promise.resolve(file);
}
```

**1.2 Increase upload timeout** (api.js:23)
```javascript
const UPLOAD_TIMEOUT_MS = 30000;  // Was 8000
```

**1.3 Extend poll timeout to match backend** (camera.js:236)
```javascript
const POLL_TIMEOUT_MS = 95000;  // Was 45000 (slightly > 90s)
```

**1.4 Add exponential backoff to polling** (camera.js:274-276)
```javascript
let pollInterval = POLL_INTERVAL_MS;
if (!window.App?.realtime?.isConnected()) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    pollInterval = Math.min(pollInterval * 1.5, 5000);  // Cap at 5s
}
```

**1.5 Disable submit button BEFORE async work** (nutrition.js:1678)
```javascript
const submitBtn = modalEl.querySelector('#new-meal-submit');
submitBtn.disabled = true;  // Move BEFORE compression
// ... compression and upload
```

### Phase 2: Backend Optimizations - 2-3 hours

**2.1 Stream file upload, don't buffer entirely** (routes.py:910)
```python
# Instead of: file_content = await file.read()
# Use streaming to save_uploaded_photo
photo_path, thumbnail_path = await save_uploaded_photo_streaming(file)
```

**2.2 Remove double compression** - Choose ONE place:
- Option A: Frontend only (send WebP, backend passes through)
- Option B: Backend only (send original, backend compresses)

**Recommended: Option B** - Backend has PIL, consistent quality, simpler frontend
```python
# nutrition.py:944-956 - REMOVE frontend compression call
# In handleNewMealSubmit: remove lines 1653-1660 and 1686-1693
```

**2.3 Reduce backend image size for worker** (nutrition.py:948)
```python
max_dim = 512    # Was 1024
quality = 60     # Was 80
```
Target: base64 < 50KB for worker CPU budget

**2.4 Proactive stuck meal cleanup** - Add periodic task
```python
# In main.py startup or separate worker
async def cleanup_stuck_meals_periodic():
    while True:
        await asyncio.sleep(60)  # Every minute
        async with async_session_maker() as db:
            await fail_stale_meals(db)
```

### Phase 3: Worker Contract Fix - Requires Worker Update

**3.1 Unified worker endpoint** (See plan: 1793971378572-vision-api-timeout-fix.md)
- Client sends: `{model, prompt, image: {data, mime_type}, generation_config}`
- Worker handles: routing, auth, provider transformation
- Response: `{text, provider, usage}`

**3.2 Increase model timeouts** (ai_vision.py:16-17)
```python
MODEL_REQUEST_TIMEOUT = 90.0   # Was 20.0
MODEL_CONNECT_TIMEOUT = 30.0   # Was 10.0
```

---

## 5. Validation Plan

### Automated Tests
```bash
# Run existing test suite
pytest tests/ -v -k "nutrition or vision" --tb=short

# Key tests to pass:
# - test_ai_verdict_rules.py (prompt/validation logic)
# - test_ai_daily_summary_rules.py (text cascade)
# - test_ai_workout_rules.py (text cascade)
```

### Manual Integration Tests
1. **Upload 5 photos sequentially** (online)
   - Target: All complete < 60s total
   - Verify: No duplicate meals, no stuck PENDING

2. **Offline → Online sync**
   - Disconnect network, upload 3 photos
   - Reconnect, verify all sync without duplicates

3. **Large photo stress test**
   - Upload 5MB RAW photo
   - Verify: Compression works, no OOM, analysis completes

4. **Timeout edge case**
   - Mock slow AI response (>90s)
   - Verify: Meal marked FAILED, not stuck PROCESSING

---

## 6. Rollout Strategy

| Phase | Changes | Risk | Rollback |
|-------|---------|------|----------|
| 1 | Frontend timeouts, polling, compression | Low | Revert JS files |
| 2 | Backend streaming, size reduction, cleanup task | Medium | Revert nutrition.py + routes.py |
| 3 | Worker contract, model timeouts | High | Feature flag + legacy fallback |

---

## 7. Open Questions

1. **Worker access**: Can we deploy worker changes? Need `/v1/generate` unified endpoint.
2. **Free tier limits**: What are exact CPU/memory limits on Cloudflare Worker free tier?
3. **Image quality floor**: Is 512px/quality 60 sufficient for nutrition accuracy?
4. **Direct API fallback**: Should we bypass worker for vision if worker fails?

---

## 8. File References

- **Frontend modal/upload**: `static/js/nutrition.js:1452-1780`
- **Frontend polling**: `static/js/camera.js:219-302`
- **Frontend API/client timeouts**: `static/js/api.js:21-26, 615-700`
- **Frontend compression**: `static/js/utils.js:55-100`
- **Backend upload endpoint**: `app/api/v1/routes.py:872-947`
- **Backend background task**: `app/services/nutrition.py:862-1053`
- **Backend AI vision**: `app/services/ai_vision.py:1-699`
- **Components**: `static/js/components.js` (mealCardAnalyzingSkeleton, newMealModal)