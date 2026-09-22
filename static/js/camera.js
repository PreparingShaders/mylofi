console.log("[DEBUG] Loaded camera.js");
import { API } from './api.js';
import { DB } from './db.js';

export const Camera = {
    app: null,

    async render(container, app) {
        this.app = app;
        container.innerHTML = `
            <div class="p-4">
                <h2 class="text-xl font-bold mb-4">Камера</h2>
                <div class="border-2 border-dashed border-surface-300 dark:border-surface-700 rounded-xl p-6 text-center mb-4">
                    <input type="file" id="photo-input" accept="image/*" capture="environment"
                           class="hidden">
                    <label for="photo-input"
                           class="cursor-pointer inline-flex flex-col items-center gap-2 text-surface-500 hover:text-surface-900">
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
                          class="w-full px-3 py-2 rounded-xl border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-sm"></textarea>

                <button id="upload-btn"
                        class="w-full py-3 bg-primary-600 text-white rounded-xl font-medium mt-4 opacity-50 cursor-not-allowed"
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
            uploadBtn.classList.toggle('bg-surface-400', !selectedFile);
        });

        uploadBtn.addEventListener('click', async () => {
            if (!selectedFile) return;

            const notes = container.querySelector('#photo-notes')?.value || null;
            uploadBtn.disabled = true;
            uploadBtn.textContent = 'Загрузка...';

            try {
                const formData = new FormData();
                formData.append('file', selectedFile);
                if (notes) formData.append('notes', notes);

                const response = await API.post('/nutrition/photos', formData, this.app.state.tokens.access, true);

                this.app.showToast('Фото загружено, идёт анализ', 'success');
                input.value = '';
                selectedFile = null;

                if (window.App && window.App.showPage) {
                    window.App.showPage('nutrition');
                }
            } catch (error) {
                console.error('[Camera] Upload error:', error);
                this.app.showToast(error.data?.detail || 'Ошибка загрузки', 'error');
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Готово — загрузить';
            }
        });
    }
};
