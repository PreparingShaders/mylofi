# Offline Photo Upload Fix - Implementation Plan

## Problem
Raw `Blob`/`File` objects stored directly in IndexedDB cause serialization errors on mobile devices (especially iOS Safari):
- `UnknownError: Error preparing Blob/File data to be stored in object store`
- Backend receives empty file → `422 Unprocessable Entity: missing body -> file`

## Root Cause Locations
1. **`camera.js:535-586`** - `queueOfflineMeal()` stores raw `blob` in `formData`
2. **`sync.js:379-422`** - `enqueuePhotoUpload()` stores raw `blob` in `formData`  
3. **`api.js:621-671`** - `replayQueuedItem()` fails to reconstruct Blob from corrupted data

## Solution: Base64 Serialization

### 1. Add utilities to `utils.js`
```javascript
// Convert Blob/File to Base64 DataURL string
async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); // data:image/webp;base64,...
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// Convert Base64 DataURL back to Blob
function base64ToBlob(base64, mimeType = 'image/webp') {
    // Handle both "data:image/webp;base64,..." and raw base64
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    const byteChars = atob(base64Data);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}
```

### 2. Modify `camera.js:queueOfflineMeal()`
- Convert `blob` to Base64 before storing in `formData`
- Store mime type for reconstruction
- Keep `blob` in local `meal` record for immediate UI display (it's not persisted to sync_queue)

### 3. Modify `sync.js:enqueuePhotoUpload()`
- Convert `blob` to Base64 before storing in `formData`
- Store mime type and filename

### 4. Modify `api.js:replayQueuedItem()`
- Detect Base64 string in `formData.blob` and convert back to Blob
- Fallback to existing reconstruction logic for backward compatibility
- Add validation: skip/cleanup items with missing/invalid blob data

### 5. Add queue cleanup in `sync.js:processQueue()`
- Before processing, validate item has valid blob data
- Mark corrupted items as FAILED with descriptive error
- Prevent blocked queue from corrupted items

## Files to Modify
1. `static/js/utils.js` - Add Base64 conversion utilities
2. `static/js/camera.js` - Fix `queueOfflineMeal()`
3. `static/js/sync.js` - Fix `enqueuePhotoUpload()` and add validation in `processQueue()`
4. `static/js/api.js` - Fix `replayQueuedItem()` to handle Base64

## Testing Checklist
- [ ] Offline photo capture → queued locally → online → uploads successfully
- [ ] Network failure during upload → queued → retry → uploads successfully  
- [ ] Corrupted queue item (missing blob) → cleaned up, doesn't block queue
- [ ] Duplicate photo detection still works (photoHash)
- [ ] Meal analysis polling works after upload
- [ ] iOS Safari / mobile Chrome compatibility