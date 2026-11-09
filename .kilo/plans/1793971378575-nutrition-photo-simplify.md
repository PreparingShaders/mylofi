# Nutrition Photo Upload - Simplification & Hardening Plan

## Current State Analysis

**Files involved:**
- `app/api/v1/routes.py` - POST `/nutrition/photos` endpoint (lines 870-945)
- `app/services/nutrition.py` - `save_uploaded_photo()` (lines 161-200), `process_meal_photo_task()` (lines 924-1033)

**Current flow:**
1. Endpoint reads file bytes → `await file.read()` → validates size
2. Calls `save_uploaded_photo(file_content, filename)` which:
   - Tries to open with PIL, resize to 1024px, convert to WebP
   - Falls back to saving raw bytes if PIL fails
   - Creates thumbnail (400px WebP) or copies photo as fallback
3. Creates meal record with `status=PENDING`
4. Background task opens saved file with `Image.open(meal.photo_path)`, compresses to 512px JPEG q60, sends to AI
5. On success: marks COMPLETED; on error: marks FAILED via exception handlers
6. Finally block ensures no stuck PROCESSING

## Issues to Fix

1. **`save_uploaded_photo` does too much**: PIL processing at save time is unnecessary since frontend already compresses. If PIL processing corrupts the stream or has a bug, the saved file may not match what frontend sent.

2. **Thumbnail creation can fail silently**: If thumbnail fails, it copies the (potentially already processed) photo - but if the photo was saved as raw bytes due to PIL failure, thumbnail will also be raw.

3. **Double compression**: Frontend compresses → Backend may re-compress at save → Background task compresses again for AI.

## Plan

### 1. Simplify `save_uploaded_photo()` in `app/services/nutrition.py`

**New behavior:** Just save bytes directly to disk. No PIL processing, no verification, no conversion.

```python
async def save_uploaded_photo(
    file_content: bytes,
    original_filename: str
) -> tuple[str, str]:
    """Save uploaded photo bytes as-is. Returns (photo_path, thumbnail_path)."""
    upload_dir = await ensure_upload_dir()
    filename = generate_photo_filename(original_filename)
    photo_path = os.path.join(upload_dir, filename)
    thumbnail_path = os.path.join(upload_dir, "thumbnails", filename)

    # Save original bytes directly - no processing, no verification
    with open(photo_path, "wb") as f:
        f.write(file_content)

    # Thumbnail: try to create from saved file, fallback to copy
    try:
        with Image.open(photo_path) as img:
            img.thumbnail((400, 400), Image.Resampling.LANCZOS)
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            img.save(thumbnail_path, "WEBP", quality=80, optimize=True)
    except Exception:
        shutil.copy2(photo_path, thumbnail_path)

    return photo_path, thumbnail_path
```

### 2. Update Background Task Error Handling in `process_meal_photo_task()`

The task already has good exception handling, but need to ensure `UnidentifiedImageError` is caught when `Image.open(meal.photo_path)` is called (line 939). Current code catches it at line 1019-1020 - this is correct.

**Add explicit handling for the PIL open call** to make it clearer and ensure proper error message:

```python
# Compress for AI (512px JPEG q60)
try:
    with Image.open(meal.photo_path) as img:
        # ... compression logic ...
except UnidentifiedImageError:
    await mark_meal_failed(db, meal_id, "Invalid image file", "Не удалось прочитать фото. Попробуйте загрузить другое изображение.")
    return
```

### 3. Ensure `finally` Block Is Robust

Current finally block (lines 1026-1033) checks `if meal and meal.status == MealStatus.PROCESSING`. This is good but `meal` variable might not be defined if exception happens before assignment. Fix:

```python
finally:
    # Ensure meal is not stuck in PROCESSING
    try:
        if meal is not None and meal.status == MealStatus.PROCESSING:
            await db.rollback()
            await mark_meal_failed(db, meal_id, "Task crashed", "Сбой сервера при анализе")
    except Exception:
        pass
```

### 4. Update Endpoint to Use Simplified Save

The endpoint at `routes.py:927-929` already calls `save_uploaded_photo(file_content, filename)` - no change needed there.

## Tasks

| # | Task | File | Lines |
|---|------|------|-------|
| 1 | Replace `save_uploaded_photo()` with simplified version | `app/services/nutrition.py` | 161-200 |
| 2 | Add explicit `UnidentifiedImageError` handling in background task | `app/services/nutrition.py` | ~939 |
| 3 | Harden `finally` block in background task | `app/services/nutrition.py` | 1026-1033 |
| 4 | Verify endpoint calls simplified function correctly | `app/api/v1/routes.py` | 927-929 |

## Validation

1. **Upload valid image** → Meal created, background task processes, status → COMPLETED
2. **Upload corrupted/non-image file** → Meal created, background task catches `UnidentifiedImageError` → FAILED with user message
3. **Upload large file (>10MB)** → Endpoint rejects with 413 before save
4. **Background task timeout (90s)** → Caught by `asyncio.TimeoutError` handler → FAILED
5. **Unexpected exception in task** → Finally block ensures FAILED, not stuck PROCESSING

## Rollback

If issues arise, revert `save_uploaded_photo()` to previous version (with PIL processing). The endpoint and background task don't need changes for rollback.