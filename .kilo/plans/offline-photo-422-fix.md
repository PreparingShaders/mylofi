# Offline Photo Upload 422 Error - Analysis & Fix Plan

## Problem Summary

When syncing offline food photos, the `POST /api/v1/nutrition/photos` endpoint returns **422 Unprocessable Entity**. This indicates the FormData or parameters reconstructed from IndexedDB don't match the backend's Pydantic validation schema.

## Current Flow Analysis

### Online Upload (Working - `nutrition.js:1680-1690`)
```javascript
const formData = new FormData();
formData.append('file', state.selectedFile, state.selectedFile.name || 'photo.webp');
formData.append('meal_type', state.selectedMealType);  // Direct append
if (notes) formData.append('notes', notes);
for (const [key, value] of Object.entries(Camera.mealTimeFields())) {
    formData.append(key, value);  // eaten_at, tz_offset, tz
}
```

**Fields sent:** `file`, `meal_type`, `notes`, `eaten_at`, `tz_offset`, `tz`

### Offline Queue Storage (`camera.js:552-568`)
```javascript
const syncItem = {
    endpoint: '/nutrition/photos',
    method: 'POST',
    isFormData: true,
    formData: {
        blob: blob,
        filename: 'photo.webp',
        fields: {
            ...timeFields,  // eaten_at, tz_offset, tz
            ...(notes ? { notes } : {}),
            ...(mealType ? { meal_type: mealType } : {}),  // Inside fields!
        },
    },
    ...
};
```

### Replay Logic (`api.js:626-636`)
```javascript
if (isFormData && item.formData) {
    const fd = new FormData();
    if (item.formData.blob instanceof Blob) {
        fd.append('file', item.formData.blob, item.formData.filename || 'photo.webp');
    }
    const fields = item.formData.fields || {};
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) fd.append(key, value);
    }
    data = fd;
}
```

**Reconstructed fields:** `file`, then all fields from `formData.fields` including `meal_type`, `notes`, `eaten_at`, `tz_offset`, `tz`

## Potential Issues Identified

| # | Issue | Likelihood | Evidence |
|---|-------|------------|----------|
| 1 | **Blob not a Blob instance after IndexedDB round-trip** | High | IndexedDB structured clone should preserve Blob, but File→Blob conversion may lose properties |
| 2 | **Missing required field `meal_type`** | Medium | Backend may require it; offline stores it in `fields.meal_type` but replay should handle it |
| 3 | **Field name mismatch** | Medium | Backend might expect `image` not `file`, or different casing |
| 4 | **Invalid `eaten_at` format** | Low | Both use ISO string from `new Date().toISOString()` |
| 5 | **Blob corrupted/empty** | Medium | Compression or storage might produce empty blob |

## Root Cause Hypothesis

**Most likely**: The Blob stored in IndexedDB's `sync_queue` store is not properly preserved as a Blob instance. When retrieved, `item.formData.blob instanceof Blob` returns `false`, causing the file to not be appended to FormData.

**Why**: IndexedDB stores Blobs via structured clone, but:
- If the original was a `File` (from `<input type="file">`), it becomes a generic `Blob` without `name`/`lastModified`
- Some browsers/versions have issues with Blob storage in IDB
- The `photoHash` is computed from the original blob, but the stored blob might differ

## Investigation Steps (for implementation)

1. **Add debug logging** in `replayQueuedItem` to verify:
   - `item.formData.blob` type and size
   - `item.formData.blob instanceof Blob` result
   - All fields being appended

2. **Verify backend schema** (if accessible) for:
   - Required fields
   - Expected field names (`file` vs `image`)
   - `meal_type` enum values

3. **Test Blob preservation** by logging blob size before storage and after retrieval

## Fix Strategy

### Fix 1: Robust Blob Handling in Replay
Ensure we handle cases where the blob might not be a Blob instance, or convert it properly.

### Fix 2: Validate FormData Before Sending
Log the complete FormData entries before request.

### Fix 3: Fallback to Base64 if Blob Fails
If blob is corrupted, convert to base64 and reconstruct on server (requires backend support).

### Fix 4: Ensure Field Completeness
Explicitly check all required fields are present.

## Files to Modify

| File | Change |
|------|--------|
| `static/js/api.js` | Add debug logging in `replayQueuedItem`, robust blob handling |
| `static/js/camera.js` | Ensure blob is stored correctly, add validation before queue |
| `static/js/sync.js` | Add blob validation in `enqueuePhotoUpload` |

## Validation Plan

1. **Offline → Online flow**: Take photo offline, wait for sync, verify no 422
2. **Console logs**: Verify blob size/type before/after storage, FormData entries
3. **Network tab**: Inspect actual request payload
4. **Backend logs**: Check validation error details (if accessible)

## Open Questions for User

1. **Backend schema**: What are the exact required fields and their names for `POST /api/v1/nutrition/photos`? (e.g., `file` vs `image`, `meal_type` enum values)
2. **Error details**: Can you share the full 422 response body? It usually contains field-specific validation errors.
3. **File type**: Are users uploading from camera (`File` object) or gallery (also `File`)? Both should work but File has extra properties.