# Nutrition Module: Safe Temp ID Handling for Offline Meals

## Problem Summary

When a meal is created offline (via `Camera.queueOfflineMeal`), it gets a temporary ID like `temp_1794218817930_3un48upa`. When the user tries to:
- **Delete** the meal (`DELETE /api/v1/nutrition/meals/{mealId}`)
- **Edit** the meal (`PATCH /api/v1/nutrition/meals/{mealId}`)
- **Retry analysis** (`POST /api/v1/nutrition/meals/{mealId}/retry-analysis`)

The client sends the temp ID to the backend, which expects an integer `meal_id`, causing a 422 validation error.

## Current Flow (Broken)

1. User creates meal offline → stored in IndexedDB with `id: "temp_..."`, `sync_status: "pending"`
2. Queue item created in `sync_queue` with `tempId`, `endpoint: "/nutrition/photos"`, `store: "meals"`
3. User clicks delete/edit/retry on the meal card
4. Handler calls `API.deleteMeal(mealId)` / `API.patch(...)` / `API.post(...)` with the temp ID
5. Backend rejects with 422: "Input should be a valid integer"

## Solution Design

### Core Principle
**Temp IDs (`temp_...`) are local-only identifiers. Never send them to the backend.**

### Three Cases to Handle

| Operation | Temp ID (offline, not synced) | Real ID (synced) |
|-----------|-------------------------------|------------------|
| **Delete** | Delete locally from IndexedDB + sync_queue; no network call | Send DELETE to backend |
| **Edit (PATCH)** | Update local meal in IndexedDB; no network call (or queue for later?) | Send PATCH to backend |
| **Retry Analysis** | Not applicable (analysis hasn't started) | Send POST to backend |

**Note**: For temp ID meals, "Edit" and "Retry Analysis" don't make sense until the meal is synced and analyzed. The UI should probably disable these actions for pending meals, or we handle them gracefully.

---

## Implementation Tasks

### Task 1: Add Helper to Detect Temp IDs

**File**: `static/js/nutrition.js` (add near top of module, after imports)

```javascript
// Check if a meal ID is a temporary local ID
isTempMealId(mealId) {
    return typeof mealId === 'string' && mealId.startsWith('temp_');
},
```

### Task 2: Fix Delete Handler for Temp IDs

**File**: `static/js/nutrition.js` (lines 1985-2007)

```javascript
container.querySelectorAll('[data-action="delete-meal"]').forEach((btn) => {
    btn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const mealId = btn.dataset.mealId;
        const confirmed = await Components.confirmModal({
            title: 'Удалить блюдо?',
            message: 'Это действие нельзя отменить.',
            confirmText: 'Удалить',
            confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md',
            cancelText: 'Отмена',
        });
        if (confirmed) {
            try {
                const token = this.app.state.tokens.access;
                
                // NEW: Handle temp IDs locally - no network request
                if (this.isTempMealId(mealId)) {
                    console.log('[Nutrition] Deleting local temp meal:', mealId);
                    // Delete from meals store
                    await DB.deleteMeal(mealId);
                    // Delete any pending sync queue items for this temp ID
                    const queueItems = await DB.getAll('sync_queue');
                    for (const item of queueItems) {
                        if (item.tempId === mealId && item.status === DB.SYNC_STATUS.PENDING) {
                            await DB.deleteSyncQueue(item.id);
                            console.log('[Nutrition] Deleted pending sync queue item for temp meal:', item.id);
                        }
                    }
                    this.app.showToast('Блюдо удалено', 'success');
                    await this.render(this.app.elements.pageContent, this.app, this.selectedDate);
                    return;
                }
                
                // Real ID - send to backend
                await API.deleteMeal(mealId, token);
                await this.loadData();
                this.render(this.app.elements.pageContent, this.app);
            } catch (error) {
                console.error('[Nutrition] Delete error:', error);
                this.app.showToast('Ошибка удаления', 'error');
            }
        }
    };
});
```

### Task 3: Fix Edit Handler for Temp IDs

**File**: `static/js/nutrition.js` (lines 2130-2179)

```javascript
async handleEditMealSubmit(modalEl, state) {
    const mealId = state.mealId;
    const token = this.app.state.tokens.access;

    // NEW: Handle temp IDs - update locally only
    if (this.isTempMealId(mealId)) {
        console.log('[Nutrition] Updating local temp meal:', mealId);
        const meal = await DB.getMeal(mealId);
        if (!meal) {
            this.app.showToast('Блюдо не найдено', 'error');
            return;
        }
        
        // Gather form data (same as existing code)
        const dishNameInput = modalEl.querySelector('#edit-meal-dish-name');
        const caloriesInput = modalEl.querySelector('#edit-meal-calories');
        const proteinInput = modalEl.querySelector('#edit-meal-protein');
        const fatInput = modalEl.querySelector('#edit-meal-fat');
        const carbsInput = modalEl.querySelector('#edit-meal-carbs');
        const tagsInput = modalEl.querySelector('#edit-meal-tags');
        const notesInput = modalEl.querySelector('#edit-meal-notes');

        const toNumOrNull = (input) => {
            const val = input?.value?.trim();
            return val !== '' ? Number(val) : null;
        };
        const toTextOrNull = (input) => {
            const val = input?.value?.trim();
            return val !== '' ? val : null;
        };

        const tagsRaw = tagsInput?.value?.trim() ?? '';
        const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

        const updatedMeal = {
            ...meal,
            dish_name: toTextOrNull(dishNameInput),
            calories: toNumOrNull(caloriesInput),
            protein_g: toNumOrNull(proteinInput),
            fat_g: toNumOrNull(fatInput),
            carbs_g: toNumOrNull(carbsInput),
            tags: tags.length > 0 ? tags : null,
            notes: toTextOrNull(notesInput),
            updated_at: Date.now(),
        };

        await DB.saveMeal(updatedMeal);
        this._mealsCache.set(String(mealId), updatedMeal);
        this.closeEditMealModal();
        this.app.showToast('Блюдо обновлено локально', 'success');
        await this.render(this.app.elements.pageContent, this.app, this.selectedDate);
        return;
    }

    // Real ID - send to backend (existing code)
    const submitBtn = modalEl.querySelector('#edit-meal-submit');
    const originalHTML = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `...spinner...`;

    try {
        const updated = await API.patch(`/nutrition/meals/${mealId}`, updateData, token);
        this._mealsCache.set(String(mealId), updated);
        this.closeEditMealModal();
        this.app.showToast('Блюдо обновлено', 'success');
        await this.render(this.app.elements.pageContent, this.app, this.selectedDate);
    } catch (error) {
        console.error('[Nutrition] Edit meal error:', error);
        this.app.showToast(error?.data?.detail || 'Ошибка сохранения', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHTML;
    }
},
```

### Task 4: Fix Retry Analysis Handler for Temp IDs

**File**: `static/js/nutrition.js` (lines 2020-2045)

```javascript
async retryMealAnalysis(mealId, btnEl) {
    // NEW: Temp IDs can't retry analysis - not synced yet
    if (this.isTempMealId(mealId)) {
        this.app.showToast('Блюдо еще не синхронизировано. Дождитесь загрузки.', 'info');
        return;
    }

    const token = this.app.state.tokens.access;
    const disabled = (v) => { ... };
    disabled(true);
    try {
        await API.post(`/nutrition/meals/${mealId}/retry-analysis`, {}, token);
        this.app.showToast('Анализ запущен повторно', 'success');
        this.render(this.app.elements.pageContent, this.app);
    } catch (error) {
        if (error?.isNetworkError) {
            this.app.showToast('Нет связи. Попробуйте снова', 'error');
        } else {
            this.app.showToast(error?.data?.detail || 'Ошибка повторного запуска', 'error');
        }
        console.error('[Nutrition] Retry analysis error:', error);
    } finally {
        disabled(false);
    }
},
```

### Task 5: Ensure Temp ID Resolution Works for Synced Meals

When a meal is synced (via `Camera.handleSyncedMeal`), the temp ID is replaced with real ID in the `meals` store (see camera.js:313-324). The meal card in the carousel uses the real ID after sync.

**Verification needed**: After sync, the meal card's `data-meal-id` attribute should be the real numeric ID, not the temp ID. Check `Components.mealCardPhoto` to ensure it uses `meal.id` which becomes the real ID after `handleSyncedMeal`.

Let me check the render flow...

In `nutrition.js` line 1247-1249:
```javascript
for (const meal of pendingSorted) {
    if (meal.id != null) this._mealsCache.set(String(meal.id), meal);
}
```

And line 1353-1354:
```javascript
${pendingSorted.map((meal) => Components.mealCardPhoto(meal, cardOptions)).join('')}
```

The `mealCardPhoto` component should use `meal.id` for the `data-meal-id` attribute. After sync, `handleSyncedMeal` updates the meal in DB with real ID (camera.js:317), and the next render will pick up the real ID.

**No code change needed** - the existing sync flow handles ID resolution correctly.

---

## Validation Plan

### Test Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| **Delete temp meal (offline)** | Meal removed from IndexedDB, sync queue cleaned, UI updates, no network request |
| **Delete temp meal (online, not synced)** | Same as above |
| **Delete real meal (synced)** | DELETE sent to backend, meal removed from server and local DB |
| **Edit temp meal (offline)** | Meal updated in IndexedDB, UI updates, no network request |
| **Edit real meal (synced)** | PATCH sent to backend, meal updated on server |
| **Retry analysis on temp meal** | Toast "Блюдо еще не синхронизировано", no network request |
| **Retry analysis on real meal** | POST sent to backend, analysis restarts |

### Verification Checklist

- [ ] Console: `[Nutrition] Deleting local temp meal: temp_xxx` (no network request in DevTools)
- [ ] Console: `[Nutrition] Deleted pending sync queue item for temp meal: xxx`
- [ ] Console: `[Nutrition] Updating local temp meal: temp_xxx` (no network request)
- [ ] No 422 errors in network tab for any meal operations
- [ ] Temp meals disappear from UI after delete
- [ ] Synced meals still work correctly (delete/edit/retry)

---

## Files to Modify

| File | Changes |
|------|---------|
| `static/js/nutrition.js` | Add `isTempMealId()` helper; update delete, edit, retry handlers |

---

## Out of Scope

- Backend changes (validation is correct - expects integer)
- Workout module temp ID handling (separate issue)
- Service Worker sync logic
- UI changes for pending meal action buttons (could disable edit/retry for pending, but not required)