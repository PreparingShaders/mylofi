# Nutrition Photo Upload - Complete Fix Plan

## Problems Identified

### 1. Broken Streaming Save (`save_uploaded_photo_streaming`)
- **Location**: `app/services/nutrition.py:210-268`
- **Issue**: FastAPI's `UploadFile` stream can only be read **once**. The streaming function reads in chunks but if any prior operation touches the stream (even `file.size` check), the stream is exhausted → empty/corrupt file → `PIL.UnidentifiedImageError`
- **Evidence**: Route at `routes.py:931` calls streaming save, but `file.size` check at line 914 may consume the stream

### 2. Triple Compression (Wasteful & Quality Loss)
| Layer | Function | Target |
|-------|----------|--------|
| Frontend | `Utils.compressImage()` (utils.js:55) | 1024px, quality 0.8, WebP |
| Backend Save | `save_uploaded_photo_streaming()` (nutrition.py:243) | 1024px, quality 80, WebP |
| Background Task | `process_meal_photo_task()` (nutrition.py:1006) | 512px, quality 60, JPEG |

### 3. Incomplete Error Handling in Background Task
- Task catches exceptions but some paths don't mark meal as FAILED
- No guarantee `meal.status = FAILED` on all error types

### 4. Frontend Race Conditions
- Submit button disabled AFTER FormData creation (line 1650 vs 1676)
- No protection against rapid clicks

---

## Fix Plan

### Phase 1: Revert to Reliable File Save (Critical)

**File: `app/services/nutrition.py`**
- Remove `save_uploaded_photo_streaming()` entirely
- Use original `save_uploaded_photo(bytes, filename)` which:
  1. Reads entire file into memory (≤10MB is fine)
  2. Processes with PIL reliably
  3. Has proper fallback if PIL fails

**File: `app/api/v1/routes.py:931`**
- Change to read file content first, then call `save_uploaded_photo(file_content, filename)`

```python
# Read file content (validates size at same time)
file_content = await file.read()
max_size = settings.MAX_FILE_SIZE_MB * 1024 * 1024
if len(file_content) > max_size:
    raise HTTPException(status_code=413, detail="File too large")

photo_path, thumbnail_path = await save_uploaded_photo(
    file_content, file.filename or "photo.jpg"
)
```

### Phase 2: Single Compression Strategy

**Decision**: Compress **ONLY on frontend** (utils.js). Backend saves as-is.

**Rationale**:
- Frontend already compresses to WebP (1024px, quality 0.8)
- Reduces upload bandwidth
- Backend just validates and stores
- Background task reads saved file and re-compresses for AI (512px JPEG q60)

**Changes**:
1. **Frontend** (`static/js/utils.js:55-100`): Keep current compression
2. **Backend Save** (`nutrition.py:163-207`): Remove PIL processing, just save bytes + create thumbnail
3. **Background Task** (`nutrition.py:1006-1018`): Keep AI compression (this is necessary for API payload size)

### Phase 3: Robust Background Task Error Handling

**File: `app/services/nutrition.py` - `process_meal_photo_task()`**
- Wrap entire task body in try/except
- Ensure `mark_meal_failed()` is called in ALL exception paths
- Add `finally` block to guarantee status update

### Phase 4: Frontend Hardening

**File: `static/js/nutrition.js` - `handleNewMealSubmit()`**
- Disable submit button **before** any async work (line 1650 → before line 1676)
- Add `submitting` flag to prevent double-submit
- Validate file type/size before creating FormData

---

## Detailed Code Changes

### 1. `app/services/nutrition.py` - Fix save_uploaded_photo

```python
async def save_uploaded_photo(
    file_content: bytes,
    original_filename: str
) -> tuple[str, str]:
    """Save uploaded photo bytes and return (photo_path, thumbnail_path).
    
    Accepts pre-compressed bytes from frontend. Validates it's a valid image
    and creates a thumbnail. Falls back gracefully if PIL cannot decode.
    """
    upload_dir = await ensure_upload_dir()
    filename = generate_photo_filename(original_filename)
    photo_path = os.path.join(upload_dir, filename)
    thumbnail_path = os.path.join(upload_dir, "thumbnails", filename)

    # Validate it's a decodable image and create normalized version
    is_valid_image = False
    try:
        with Image.open(io.BytesIO(file_content)) as img:
            img.verify()  # Verify without loading pixels
        is_valid_image = True
    except Exception:
        logger.warning(f"[Photos] Uploaded file is not a valid image, saving as-is")

    if is_valid_image:
        # Create normalized WebP (max 1024px) and thumbnail
        try:
            with Image.open(io.BytesIO(file_content)) as img:
                img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                img.save(photo_path, "WEBP", quality=80, optimize=True)
        except Exception as e:
            logger.warning(f"[Photos] Normalization failed, saving raw: {e}")
            with open(photo_path, "wb") as f:
                f.write(file_content)
    else:
        # Not a valid image - save raw bytes
        with open(photo_path, "wb") as f:
            f.write(file_content)

    # Create thumbnail (always attempt)
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

### 2. `app/api/v1/routes.py` - Fix upload endpoint

```python
@router.post(
    "/nutrition/photos",
    response_model=PhotoUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
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
    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    # Daily quota check
    meal_ai_limit = can_use_meal_ai(current_user)
    if not meal_ai_limit.allowed:
        raise HTTPException(status_code=403, detail=meal_ai_limit.message)

    # Read file content (validates size)
    file_content = await file.read()
    max_size = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(file_content) > max_size:
        raise HTTPException(status_code=413, detail=f"File too large. Max size: {settings.MAX_FILE_SIZE_MB}MB")

    tz_offset_minutes = normalize_tz_offset(tz_offset)
    parsed_eaten_at = resolve_eaten_at(eaten_at, tz_offset_minutes)

    # Save photo using reliable byte-based method
    photo_path, thumbnail_path = await save_uploaded_photo(
        file_content, file.filename or "photo.jpg"
    )

    # Create meal record
    meal_data = MealCreate(eaten_at=parsed_eaten_at, notes=notes)
    meal = await create_meal(db, current_user.id, meal_data, photo_path, thumbnail_path)

    consume_meal_ai(current_user)
    await db.commit()

    # Trigger async vision API processing
    background_tasks.add_task(process_meal_photo_task, meal.id, tz_offset_minutes)

    return PhotoUploadResponse(
        meal_id=meal.id,
        status=meal.status,
        message="Photo uploaded. Analysis started.",
    )
```

### 3. `app/services/nutrition.py` - Harden background task

```python
async def process_meal_photo_task(meal_id: int, tz_offset_minutes: int = 0) -> None:
    """Background task to process meal photo with AI vision cascade."""
    started_at = time.perf_counter()
    logger.info(f"[AI Task] Starting analysis for meal {meal_id}")

    async with async_session_maker() as db:
        meal = None
        try:
            result = await db.execute(select(Meal).where(Meal.id == meal_id))
            meal = result.scalar_one_or_none()
            if not meal:
                logger.error(f"[AI Task] Meal {meal_id} not found")
                return

            if not meal.photo_path or not os.path.exists(meal.photo_path):
                logger.error(f"[AI Task] Photo file missing: {meal.photo_path}")
                await mark_meal_failed(db, meal_id, "Photo file not found", "Фото не найдено на сервере")
                return

            meal.status = MealStatus.PROCESSING
            meal.error_message = None
            meal.updated_at = utcnow()
            await db.commit()
            logger.info(f"[AI Task] Meal {meal_id} marked as PROCESSING")

            # ... existing logic for targets, balance, persona ...

            # Compress for AI (512px JPEG q60)
            with Image.open(meal.photo_path) as img:
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                max_dim = 512
                if max(img.size) > max_dim:
                    ratio = max_dim / max(img.size)
                    new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                    img = img.resize(new_size, Image.Resampling.LANCZOS)
                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=60, optimize=True)
                buffer.seek(0)
                base64_img = base64.b64encode(buffer.read()).decode("utf-8")

            logger.info(f"[AI Task] Image compressed: {len(base64_img) // 1024} KB base64")

            analysis = await asyncio.wait_for(
                analyze_meal_photo(
                    base64_img, user_goal=user_goal, targets=user_targets,
                    current_balance=current_balance, user_notes=meal.notes,
                    persona=persona, persona_custom_text=persona_custom_text
                ),
                timeout=AI_TASK_TIMEOUT,
            )

            # Update meal with results
            meal.calories = float(analysis["calories"])
            meal.protein_g = float(analysis["protein_g"])
            meal.fat_g = float(analysis["fat_g"])
            meal.carbs_g = float(analysis["carbs_g"])
            meal.fiber_g = float(analysis.get("fiber_g", 0))
            meal.sugar_g = float(analysis.get("sugar_g", 0))
            meal.sodium_mg = float(analysis.get("sodium_mg", 0))
            meal.dish_name = analysis["dish_name"]
            meal.tags = json.dumps(analysis["tags"])
            meal.quality_score = float(analysis["quality_score"])
            meal.quality_reason = json.dumps(analysis.get("quality_metrics", []), ensure_ascii=False)
            meal.ai_insight = analysis.get("ai_verdict")
            meal.ai_persona = persona
            meal.status = MealStatus.COMPLETED
            meal.error_message = None
            meal.updated_at = utcnow()

            await db.commit()
            logger.info(f"[AI Task] Meal {meal_id} completed in {time.perf_counter() - started_at:.1f}s")

            await notify_meal_analysis_update(db, meal_id, MealStatus.COMPLETED, user_id=meal.user_id, ...)

        except asyncio.TimeoutError:
            await mark_meal_failed(db, meal_id, f"Timeout after {AI_TASK_TIMEOUT}s", "Анализ ИИ занял слишком много времени")
        except UnidentifiedImageError:
            await mark_meal_failed(db, meal_id, "Invalid image", "Не удалось прочитать фото")
        except FileNotFoundError:
            await mark_meal_failed(db, meal_id, "File not found", "Фото не найдено на сервере")
        except Exception as e:
            logger.exception(f"[AI Task] Meal {meal_id} failed: {e}")
            await mark_meal_failed(db, meal_id, f"{type(e).__name__}: {e}", _user_facing_error(e))
        finally:
            # Ensure meal is not stuck in PROCESSING
            if meal and meal.status == MealStatus.PROCESSING:
                await db.rollback()
                try:
                    await mark_meal_failed(db, meal_id, "Task crashed", "Сбой сервера при анализе")
                except Exception:
                    pass
```

### 4. `static/js/nutrition.js` - Frontend hardening

```javascript
async handleNewMealSubmit(modalEl, state) {
    // Prevent double-submit
    if (this._mealSubmitInFlight) return;
    this._mealSubmitInFlight = true;

    try {
        if (!state.selectedFile || !state.selectedMealType) return;

        // Disable IMMEDIATELY - before any async work
        const submitBtn = modalEl.querySelector('#new-meal-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<svg class="animate-spin...">...</svg><span>Подготовка...</span>`;

        const isOffline = !window.App?.state?.isOnline || !navigator.onLine;
        if (isOffline) { /* ... offline handling ... */ return; }

        const overlayState = Camera.showLoadingOverlay(modalEl);

        // Validate file before sending
        if (!state.selectedFile.type.startsWith('image/')) {
            this.app.showToast('Выберите изображение', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', state.selectedFile, state.selectedFile.name || 'photo.webp');
        formData.append('meal_type', state.selectedMealType);
        // ... notes, time fields ...

        this.showAnalyzingSkeleton();

        try {
            const response = await API.post('/nutrition/photos', formData, token, true);
            // ... rest of logic ...
        } finally {
            this.removeAnalyzingSkeleton();
            submitBtn.disabled = false;
            submitBtn.innerHTML = `...`;
        }
    } catch (err) {
        /* error handling */
    } finally {
        this._mealSubmitInFlight = false;
    }
}
```

---

## Validation Checklist

- [ ] File upload works with various image formats (JPG, PNG, HEIC, WebP)
- [ ] Large files (10MB) upload without memory issues
- [ ] Corrupted/invalid files handled gracefully (not 500)
- [ ] Background task always sets meal status to COMPLETED or FAILED
- [ ] No stuck PROCESSING meals after errors/timeouts
- [ ] Frontend shows proper loading states, no double-submit
- [ ] Polling works and updates UI when analysis completes
- [ ] Offline queue + sync works correctly
- [ ] Thumbnail generation works for all valid images

---

## Rollback Plan

If issues arise:
1. Revert `routes.py` to use `save_uploaded_photo_streaming` (but fix the stream consumption bug)
2. Keep `save_uploaded_photo(bytes, ...)` as fallback
3. Frontend changes are low-risk, can be reverted independently