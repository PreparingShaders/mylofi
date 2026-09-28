console.log("[DEBUG] Loaded camera.js");
import { API } from './api.js';
import { DB } from './db.js';
import { SyncEngine } from './sync.js';
import { Utils } from './utils.js';

export const Camera = {
    app: null,

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
                try {
                    const formData = new FormData();
                    formData.append('file', compressedBlob, 'photo.webp');
                    if (notes) formData.append('notes', notes);

                    await API.post('/nutrition/photos', formData, token, true);

                    this.app.showToast('Фото загружено, идёт анализ', 'success');
                    input.value = '';
                    selectedFile = null;
                    uploadBtn.disabled = false;
                    uploadBtn.textContent = 'Готово — загрузить';

                    if (window.App && window.App.showPage) {
                        window.App.showPage('nutrition');
                    }
                } catch (error) {
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
                await this.queueOfflineMeal(compressedBlob, notes);
                this.app.showToast('Оффлайн режим — фото сохранено локально и будет загружено при появлении связи', 'info');
                input.value = '';
                selectedFile = null;
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Готово — загрузить';
            }
        });
    },

    async queueOfflineMeal(blob, notes, mealType = null) {
        await DB.init();
        const tempId = DB.generateTempId();
        const meal = {
            id: tempId,
            blob: blob,
            notes: notes || null,
            meal_type: mealType || null,
            dish_name: null,
            calories: null,
            status: 'pending',
            sync_status: DB.SYNC_STATUS.PENDING,
            eaten_at: new Date().toISOString(),
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
    },
};
