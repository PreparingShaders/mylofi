console.log("[DEBUG] Loaded camera.js");
import { API } from './api.js';
import { DB } from './db.js';
import { SyncEngine } from './sync.js';
import { Utils, clientTimezone } from './utils.js';

export const Camera = {
    app: null,

    /**
     * Hint messages cycled through while the upload and analysis run. Each one
     * names a stage of the work the server is doing, so the wait reads as
     * progress rather than a frozen spinner.
     */
    loadingHints: [
        'Определяем продукты...',
        'Оцениваем размер порции...',
        'Считаем КБЖУ...',
    ],

    /**
     * Time fields that travel with a photo upload.
     *
     * `eaten_at` is the instant the photo was taken, in UTC, so the server stores
     * the true moment no matter where it runs; the offset and the zone tell it
     * which local day the meal belongs to, which is the part an instant alone
     * cannot say.
     */
    mealTimeFields() {
        const { offsetMinutes, timeZone } = clientTimezone();
        const fields = { eaten_at: new Date().toISOString() };
        if (offsetMinutes !== null) fields.tz_offset = String(offsetMinutes);
        if (timeZone) fields.tz = timeZone;
        return fields;
    },

    /**
     * Render the blurred loading overlay on top of the upload form. It locks the
     * underlying controls, starts the stopwatch and rotates the hint messages
     * while the upload and analysis run. Returns the overlay element plus the
     * timer handle the caller must stop and remove.
     */
    showLoadingOverlay(container) {
        const overlay = document.createElement('div');
        overlay.id = 'camera-loading-overlay';
        overlay.className = 'absolute inset-0 z-[9999] backdrop-blur-md bg-black/60 flex flex-col items-center justify-center text-white p-6 rounded-3xl pointer-events-auto';
        overlay.innerHTML = `
            <div class="flex flex-col items-center gap-5">
                <div class="relative w-20 h-20">
                    <div class="absolute inset-0 rounded-full border-2 border-white/20"></div>
                    <div class="absolute inset-0 rounded-full border-2 border-t-transparent border-r-emerald-400 border-b-emerald-400 border-l-emerald-400 animate-spin"></div>
                    <div class="absolute inset-0 flex items-center justify-center">
                        <svg class="w-8 h-8 text-emerald-400 camera-loading-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                    </div>
                </div>
                <div class="text-center">
                    <p id="camera-loading-timer" class="text-2xl font-bold tabular-nums">00:00</p>
                    <p id="camera-loading-hint" class="text-sm text-white/80 mt-1 min-h-[1.25rem]">Определяем продукты...</p>
                </div>
            </div>
        `;

        // Lock the underlying form so taps land on the overlay instead.
        const formRoot = container.querySelector('.p-4');
        if (formRoot) {
            formRoot.querySelectorAll('input, textarea, button').forEach((el) => {
                el.disabled = true;
                el.classList.add('pointer-events-none');
            });
        }

        const computedPos = getComputedStyle(container).position;
        if (computedPos === 'static') {
            container.classList.add('relative');
            container.style.position = 'relative';
        }
        container.appendChild(overlay);
        console.log('[Camera] showLoadingOverlay created and appended', overlay);

        const startedAt = Date.now();
        const hints = this.loadingHints;
        let hintIndex = 0;
        const timerId = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const seconds = String(elapsed % 60).padStart(2, '0');
            const timerEl = overlay.querySelector('#camera-loading-timer');
            if (timerEl) timerEl.textContent = `${minutes}:${seconds}`;
        }, 1000);
        const hintId = setInterval(() => {
            hintIndex = (hintIndex + 1) % hints.length;
            const hintEl = overlay.querySelector('#camera-loading-hint');
            if (hintEl) hintEl.textContent = hints[hintIndex];
        }, 2500);

        return { overlay, timerId, hintId };
    },

    /**
     * Mark the overlay as finished: swap the spinner for a green checkmark and
     * the hint for the completion message. The caller is still responsible for
     * removing the overlay after the pause.
     */
    markLoadingComplete(overlay) {
        const iconWrap = overlay.querySelector('.relative.w-20.h-20 > div:last-child');
        const icon = overlay.querySelector('.camera-loading-pulse');
        if (icon) {
            icon.outerHTML = `<svg class="w-8 h-8 text-emerald-400 camera-loading-check-pop" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`;
        }
        const hintEl = overlay.querySelector('#camera-loading-hint');
        if (hintEl) hintEl.textContent = 'Анализ завершен!';
    },

    /**
     * Stop the ticking timers and tear the overlay down, restoring the form
     * controls underneath. The optional `onDone` callback runs after the DOM
     * node is gone so the caller can close the modal or redirect.
     */
    hideLoadingOverlay(state, onDone = null) {
        if (!state) return;
        const { overlay, timerId, hintId } = state;
        clearInterval(timerId);
        clearInterval(hintId);
        if (overlay) overlay.remove();
        if (onDone) onDone();
    },

    /**
     * Poll a meal's analysis status until it reaches a terminal state.
     *
     * The POST /nutrition/photos answer only means the background task
     * started, so the caller keeps its loading overlay up and polls here
     * every 800ms until the meal is `completed` or `failed`. A hard
     * deadline bounds the wait, and a dropped connection is retried on
     * the next tick; only a persistent failure ends the loop early.
     *
     * Returns 'completed' | 'failed' | 'timeout' | 'error'.
     */
    async pollMealAnalysisStatus(mealId, accessToken) {
        const POLL_INTERVAL_MS = 800;
        const POLL_TIMEOUT_MS = 45000;
        const MAX_CONSECUTIVE_ERRORS = 3;
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let consecutiveErrors = 0;

        while (Date.now() < deadline) {
            let meal = null;
            try {
                meal = await API.get(`/nutrition/meals/${mealId}`, accessToken);
            } catch (error) {
                consecutiveErrors += 1;
                console.warn('[Camera] Meal status poll failed:', error?.message);
                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    return 'error';
                }
            }

            if (meal) {
                consecutiveErrors = 0;
                if (meal.status === 'completed') return 'completed';
                if (meal.status === 'failed') return 'failed';
            }

            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        return 'timeout';
    },

    /**
     * Toast for a poll outcome that did not reach `completed`.
     * A timeout is informational: the backend task may still be
     * running, and the nutrition page keeps watching the card.
     * `app` is passed in because the camera page may never have
     * been rendered (the nutrition sheet calls this too).
     */
    reportAnalysisOutcome(outcome, app) {
        if (!app) return;
        if (outcome === 'failed') {
            app.showToast('Анализ фото не завершился. Попробуйте ещё раз', 'error');
        } else if (outcome === 'timeout') {
            app.showToast('Анализ ещё не завершился. Следите за карточкой блюда', 'info');
        } else if (outcome === 'error') {
            app.showToast('Не удалось получить результат анализа', 'error');
        }
    },

    async handleSyncedMeal(item, response, { failed = false } = {}) {
        if (failed || !item || item.store !== 'meals') return;
        if (!item.tempId || !response || !response.id) return;
        try {
            const existing = await DB.getMeal(response.id) || await DB.getMeal(item.tempId);
            const merged = {
                ...(existing || {}),
                ...response,
                blob: existing?.blob ?? null,
                sync_status: DB.SYNC_STATUS.SYNCED,
                updated_at: Date.now(),
            };
            await DB.saveMeal(merged);
            window.dispatchEvent(new CustomEvent('mylofi:meal-synced', { detail: { mealId: response.id } }));
        } catch (error) {
            console.error('[Camera] Failed to merge synced meal:', error);
        }
    },

    async render(container, app) {
        this.app = app;
        container.innerHTML = `
            <div class="p-4">
                <h2 class="text-xl font-bold mb-4">Камера</h2>
                <div class="border-2 border-dashed border-surface-300 dark:border-white/10 rounded-xl p-6 text-center mb-4 glass">
                    <input type="file" id="photo-input" accept="image/*" class="hidden">
                    <label for="photo-input"
                           class="cursor-pointer inline-flex flex-col items-center gap-2 text-surface-500 dark:text-surface-400 hover:text-surface-900 dark:hover:text-zinc-100">
                        <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                  d="M12 13a3 3 0 100-6 3 3 0 000 6z"/>
                        </svg>
                        <span class="text-sm font-medium">Выбрать фото или сделать</span>
                    </label>
                </div>

                <label class="block text-xs text-surface-500 mb-2">Заметки (необязательно)</label>
                <textarea id="photo-notes" placeholder="Например: обед, завтрак..."
                          class="w-full px-3 py-2 rounded-xl glass-input text-sm"></textarea>

                <button id="upload-btn"
                        class="w-full py-3 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl font-medium mt-4 opacity-50 cursor-not-allowed"
                        disabled>Готово — загрузить</button>
            </div>
        `;

        const input = container.querySelector('#photo-input');
        const uploadBtn = container.querySelector('#upload-btn');
        let selectedFile = null;

        input.addEventListener('change', (e) => {
            selectedFile = e.target.files[0];
            uploadBtn.disabled = !selectedFile;
            uploadBtn.classList.toggle('opacity-50', !selectedFile);
            uploadBtn.classList.toggle('cursor-not-allowed', !selectedFile);
            uploadBtn.classList.toggle('bg-primary-600', selectedFile);
            uploadBtn.classList.toggle('dark:bg-white', selectedFile);
            uploadBtn.classList.toggle('bg-surface-400', !selectedFile);
            uploadBtn.classList.toggle('dark:bg-surface-700', !selectedFile);
        });

        uploadBtn.addEventListener('click', async () => {
            if (!selectedFile) return;

            const notes = container.querySelector('#photo-notes')?.value || null;
            const token = this.app.state.tokens.access;
            uploadBtn.disabled = true;
            uploadBtn.textContent = 'Сжатие...';

            // Show the overlay synchronously before compression to eliminate
            // UI jumping and layout shift on click.
            const overlayState = this.showLoadingOverlay(container);

            let compressedBlob = null;
            try {
                compressedBlob = await Utils.compressImage(selectedFile);
                if (compressedBlob) {
                    const originalSize = Utils.fileSizeLabel(selectedFile.size);
                    const compressedSize = Utils.fileSizeLabel(compressedBlob.size);
                    console.log(`[Camera] Compressed ${originalSize} → ${compressedSize}`);
                }
            } catch (compressError) {
                console.warn('[Camera] Compression failed, using original:', compressError);
                compressedBlob = selectedFile;
            }

            if (navigator.onLine) {
                uploadBtn.textContent = 'Загрузка...';
                // The overlay takes over the form while the upload and analysis
                // run, so the user sees a live timer and rotating hints instead
                // of a frozen button. It is torn down only once the analysis
                // reaches a terminal status, not when the upload answers.
                try {
                    const formData = new FormData();
                    formData.append('file', compressedBlob, 'photo.webp');
                    if (notes) formData.append('notes', notes);
                    for (const [key, value] of Object.entries(this.mealTimeFields())) {
                        formData.append(key, value);
                    }

                    const response = await API.post('/nutrition/photos', formData, token, true);
                    const mealId = response?.meal_id ?? null;

                    this.app.showToast('Фото загружено, идёт анализ', 'success');
                    input.value = '';
                    selectedFile = null;
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = 'Готово — загрузить';

                    // The 201 only means the background analysis started: keep
                    // the overlay up and poll the meal until it is completed
                    // (or failed), so the checkmark marks the finished analysis.
                    if (mealId) {
                        const outcome = await this.pollMealAnalysisStatus(mealId, token);
                        if (outcome === 'completed') {
                            this.markLoadingComplete(overlayState.overlay);
                            await new Promise((resolve) => setTimeout(resolve, 500));
                        } else {
                            this.reportAnalysisOutcome(outcome, this.app);
                        }
                    }

                    this.hideLoadingOverlay(overlayState);

                    if (window.App && window.App.showPage) {
                        window.App.showPage('nutrition');
                    }
                } catch (error) {
                    this.hideLoadingOverlay(overlayState);
                    if (error?.isNetworkError || error?.offlineQueued) {
                        await this.queueOfflineMeal(compressedBlob, notes);
                        this.app.showToast('Нет связи. Фото сохранено локально и будет загружено при появлении связи', 'info');
                        input.value = '';
                        selectedFile = null;
                        uploadBtn.disabled = false;
                        uploadBtn.textContent = 'Готово — загрузить';
                    } else {
                        console.error('[Camera] Upload error:', error);
                        this.app.showToast(error.data?.detail || 'Ошибка загрузки', 'error');
                        uploadBtn.disabled = false;
                        uploadBtn.textContent = 'Готово — загрузить';
                    }
                }
            } else {
                this.hideLoadingOverlay(overlayState);
                await this.queueOfflineMeal(compressedBlob, notes);
                this.app.showToast('Оффлайн режим — фото сохранено локально и будет загружено при появлении связи', 'info');
                input.value = '';
                selectedFile = null;
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Готово — загрузить';
            }
        });
    },

    /**
     * Park a photo in the local queue until the network comes back. Returns the
     * temporary id so the caller can scroll the queued meal into view.
     */
    async queueOfflineMeal(blob, notes, mealType = null) {
        await DB.init();
        const tempId = DB.generateTempId();
        const timeFields = this.mealTimeFields();
        const meal = {
            id: tempId,
            blob: blob,
            notes: notes || null,
            meal_type: mealType || null,
            dish_name: null,
            calories: null,
            status: 'pending',
            sync_status: DB.SYNC_STATUS.PENDING,
            eaten_at: timeFields.eaten_at,
            updated_at: Date.now(),
        };

        const syncItem = {
            endpoint: '/nutrition/photos',
            method: 'POST',
            isFormData: true,
            formData: {
                blob: blob,
                filename: 'photo.webp',
                fields: {
                    ...timeFields,
                    ...(notes ? { notes } : {}),
                    ...(mealType ? { meal_type: mealType } : {}),
                },
            },
            tempId,
            store: 'meals',
            accessToken: this.app.state.tokens.access || null,
        };

        await DB.atomicWrite('meals', meal, syncItem);

        if (window.App && typeof window.App.updateNetworkBanner === 'function') {
            window.App.updateNetworkBanner();
        }

        return tempId;
    },
};
