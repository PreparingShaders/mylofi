import { API } from './api.js';
import { DB } from './db.js';
import { SyncEngine } from './sync.js';
import { Components } from './components.js';
import { Utils } from './utils.js';
import { Camera } from './camera.js';

export const Nutrition = {
    app: null,
    selectedDate: null,
    period: 'day',
    selectedMealType: null,

    async loadData(date) {
        const token = this.app.state.tokens.access;
        let data = null;
        let fromCache = false;

        try {
            data = await API.get(`/nutrition/logs?date=${date}`, token);
        } catch (error) {
            console.warn('[Nutrition] API unavailable, falling back to local data:', error?.message);
            fromCache = true;
        }

        if (!data && !fromCache) {
            data = { meals: [], total_calories: 0, total_protein_g: 0, total_fat_g: 0, total_carbs_g: 0 };
        }

        const serverMeals = (data && data.meals) || [];
        const summary = data
            ? {
                  calories: data.total_calories || 0,
                  protein: data.total_protein_g || 0,
                  fat: data.total_fat_g || 0,
                  carbs: data.total_carbs_g || 0,
              }
            : { calories: 0, protein: 0, fat: 0, carbs: 0 };

        let pendingMeals = [];
        try {
            pendingMeals = await DB.getMealsByStatus(DB.SYNC_STATUS.PENDING);
        } catch (error) {
            console.warn('[Nutrition] Failed to read pending meals:', error);
        }

        let failedItems = [];
        try {
            failedItems = await SyncEngine.getFailedItems();
        } catch (error) {
            console.warn('[Nutrition] Failed to read failed items:', error);
        }

        return { serverMeals, summary, pendingMeals, failedItems, fromCache };
    },

    async loadPeriodData(period) {
        if (period === 'day') return null;
        const token = this.app.state.tokens.access;
        const endpoint = period === 'week' ? '/nutrition/week' : '/nutrition/month';
        try {
            const data = await API.get(endpoint, token);
            if (data && typeof data === 'object') {
                return {
                    calories: data.total_calories || data.avg_calories || 0,
                    protein: data.total_protein_g || data.avg_protein_g || 0,
                    fat: data.total_fat_g || data.avg_fat_g || 0,
                    carbs: data.total_carbs_g || data.avg_carbs_g || 0,
                };
            }
        } catch (error) {
            console.warn('[Nutrition] Period average unavailable:', error?.message);
        }
        return null;
    },

    formatDateLabel(dateISO) {
        const d = new Date(dateISO);
        const today = new Date().toISOString().split('T')[0];
        if (dateISO === today) return 'Сегодня';
        return Utils.formatDate(d);
    },

    changeDate(delta) {
        const today = new Date().toISOString().split('T')[0];
        if (delta > 0 && this.selectedDate >= today) {
            return;
        }
        const current = new Date(this.selectedDate);
        current.setDate(current.getDate() + delta);
        this.selectedDate = current.toISOString().split('T')[0];
        this.render(this.app.elements.pageContent, this.app, this.selectedDate);
    },

    renderMacroBar(label, current, target, unit, colorClass = 'bg-primary-600 dark:bg-zinc-100') {
        const pct = Math.min(100, (target > 0 ? (current / target) * 100 : 0));
        const rounded = Math.min(current, target);
        return `
            <div class="mb-3">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-medium text-surface-600 dark:text-surface-400">${label}</span>
                    <span class="text-xs text-surface-500">${Math.round(rounded)} / ${target} ${unit}</span>
                </div>
                <div class="h-2 bg-surface-200 dark:bg-white/10 rounded-full overflow-hidden">
                    <div class="h-full ${colorClass} rounded-full transition-all" style="width: ${pct}%"></div>
                </div>
            </div>
        `;
    },

    renderCompactMacros(summary, targets) {
        const items = [
            { label: 'Б', value: summary.protein, target: targets.target_protein, color: 'bg-blue-500' },
            { label: 'Ж', value: summary.fat, target: targets.target_fat, color: 'bg-amber-500' },
            { label: 'У', value: summary.carbs, target: targets.target_carbs, color: 'bg-lime-500' },
        ];
        return `
            <div class="grid grid-cols-3 gap-2">
                ${items.map((item) => {
                    const pct = item.target > 0 ? Math.min(100, (item.value / item.target) * 100) : 0;
                    return `
                        <div class="flex flex-col items-center gap-1.5">
                            <div class="relative w-full h-16 bg-surface-200 dark:bg-white/5 rounded-lg overflow-hidden flex items-end">
                                <div class="w-full ${item.color} opacity-80 macro-mini-fill" style="height: ${Math.max(pct, 4)}%"></div>
                            </div>
                            <div class="text-center">
                                <p class="text-[10px] font-bold text-surface-900 dark:text-zinc-100 leading-tight">${Math.round(item.value)}г</p>
                                <p class="text-[9px] text-surface-400 leading-tight">${item.label} · ${Math.round(item.target)}г</p>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderPeriodSelector() {
        const options = [
            { value: 'day', label: 'День' },
            { value: 'week', label: 'Неделя' },
            { value: 'month', label: 'Месяц' },
        ];
        return `
            <div class="flex items-center gap-1 bg-surface-100 dark:bg-white/5 rounded-lg p-1 mb-3">
                ${options.map((opt) => `
                    <button type="button" data-action="set-period" data-period="${opt.value}"
                            class="period-pill flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${this.period === opt.value ? 'active' : 'text-surface-500 dark:text-surface-400'}">
                        ${opt.label}
                    </button>
                `).join('')}
            </div>
        `;
    },

    renderMealTypeChips() {
        const types = [
            { value: 'breakfast', label: 'Завтрак', icon: '🍳' },
            { value: 'lunch', label: 'Обед', icon: '🍜' },
            { value: 'dinner', label: 'Ужин', icon: '🍽️' },
            { value: 'snack', label: 'Перекус', icon: '🍎' },
        ];
        return types.map((t) => `
            <button type="button" data-action="set-meal-type" data-type="${t.value}"
                    class="meal-type-chip flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg border border-surface-200 dark:border-white/10 text-[10px] font-medium text-surface-600 dark:text-surface-400 transition-colors">
                <span class="text-base leading-none">${t.icon}</span>
                <span>${t.label}</span>
            </button>
        `).join('');
    },

    async render(container, app, dateOverride = null) {
        this.app = app;
        if (dateOverride) {
            this.selectedDate = dateOverride;
        }
        if (!this.selectedDate) {
            this.selectedDate = new Date().toISOString().split('T')[0];
        }

        container.innerHTML = Components.loadingSpinner();

        try {
            const { serverMeals, summary, pendingMeals, failedItems, fromCache } = await this.loadData(this.selectedDate);

            const targets = {
                target_calories: this.app.state.user?.target_calories || 2000,
                target_protein: this.app.state.user?.target_protein_g || 150,
                target_fat: this.app.state.user?.target_fat_g || 65,
                target_carbs: this.app.state.user?.target_carbs_g || 250,
            };

            const dateLabel = this.formatDateLabel(this.selectedDate);

            const sortedMeals = serverMeals
                .slice()
                .sort((a, b) => {
                    const ta = (b.eaten_at || b.updated_at || b.created_at || 0);
                    const tb = (a.eaten_at || a.updated_at || a.created_at || 0);
                    return tb - ta;
                });

            const pendingSorted = pendingMeals
                .slice()
                .sort((a, b) => {
                    const ta = (b.eaten_at || b.updated_at || 0);
                    const tb = (a.eaten_at || a.updated_at || 0);
                    return tb - ta;
                });

            const carouselCards = sortedMeals.map((meal) => Components.mealCarouselCard(meal, app)).join('');

            const dailyScore = (summary.calories > 0 || summary.protein > 0 || summary.fat > 0 || summary.carbs > 0)
                ? Utils.computeQualityScore({
                    calories: summary.calories,
                    protein: summary.protein,
                    fat: summary.fat,
                    carbs: summary.carbs,
                })
                : null;
            const dailyGrade = dailyScore !== null
                ? Utils.qualityGrade(dailyScore)
                : { label: 'Нет данных', color: 'text-surface-400' };

            let displaySummary = summary;
            let displayScore = dailyScore;
            let displayGrade = dailyGrade;
            if (this.period !== 'day') {
                const avg = await this.loadPeriodData(this.period);
                if (avg) {
                    displaySummary = avg;
                    displayScore = (avg.calories > 0 || avg.protein > 0 || avg.fat > 0 || avg.carbs > 0)
                        ? Utils.computeQualityScore({
                            calories: avg.calories,
                            protein: avg.protein,
                            fat: avg.fat,
                            carbs: avg.carbs,
                        })
                        : null;
                    displayGrade = displayScore !== null
                        ? Utils.qualityGrade(displayScore)
                        : { label: 'Нет данных', color: 'text-surface-400' };
                }
            }

            const totalMeals = sortedMeals.length + pendingSorted.length;

            let html = `
                <div class="p-4 pb-20 safe-area-inset-top">
                    <!-- 1. Header & Date Selector -->
                    <div class="flex items-center justify-between mb-4">
                        <button id="date-prev" data-action="date-prev" class="btn-press w-10 h-10 rounded-xl glass flex items-center justify-center text-surface-700 dark:text-surface-300">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                        </button>
                        <div class="flex flex-col items-center">
                            <h2 class="text-xl font-bold text-surface-900 dark:text-zinc-100">${dateLabel}</h2>
                            ${fromCache ? '<span class="text-xs text-amber-500">Оффлайн</span>' : ''}
                        </div>
                        <button id="date-next" data-action="date-next" class="btn-press w-10 h-10 rounded-xl glass flex items-center justify-center text-surface-700 dark:text-surface-300">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                        </button>
                    </div>

                    <!-- 2. Compact Nutrition Dashboard -->
                    <div class="glass-strong rounded-2xl p-4 mb-4">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="text-xs font-semibold text-surface-400 uppercase tracking-wider">Питание за ${dateLabel}</h3>
                            <div class="flex items-center gap-1.5 bg-surface-100 dark:bg-white/5 rounded-lg px-2 py-1">
                                <span class="text-xs font-bold text-surface-900 dark:text-zinc-100">${displayScore !== null ? displayScore : '—'}</span>
                                <span class="text-[10px] text-surface-500 dark:text-surface-400">/100</span>
                                <span class="text-[10px] font-medium ${displayGrade.color}">${displayGrade.label}</span>
                            </div>
                        </div>
                        ${this.renderPeriodSelector()}
                        <div class="flex items-center gap-4">
                            <div class="flex-shrink-0">
                                ${Components.caloricDonut(displaySummary.calories, targets.target_calories, '#3b82f6', '#d4d4d8')}
                            </div>
                            <div class="flex-1">
                                ${this.renderCompactMacros(displaySummary, targets)}
                            </div>
                        </div>
                    </div>

                    <!-- 3. Failed sync items -->
                    ${failedItems.length > 0
                        ? `
                        <div class="mb-4">
                            <div class="flex items-center justify-between mb-2">
                                <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wider">Ошибка синхронизации</h3>
                                <button id="clear-failed" class="text-xs text-red-500 hover:text-red-400">Очистить все</button>
                            </div>
                            ${failedItems.map((item) => `
                                <div class="glass rounded-xl p-3 mb-2">
                                    <p class="text-sm text-surface-600 dark:text-surface-300">${item.endpoint || 'Запрос'}</p>
                                    <p class="text-xs text-surface-500 truncate">${item.error || 'Неизвестная ошибка'}</p>
                                </div>
                            `).join('')}
                            <button id="retry-failed" class="w-full py-2 mt-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl">Повторить сейчас</button>
                        </div>
                        `
                        : ''}

                    <!-- 4. Pending meals -->
                    ${pendingSorted.length > 0
                        ? `
                        <div class="mb-4">
                            <h4 class="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-2">Ожидают синхронизации</h4>
                            <div class="meal-carousel flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-2">
                                ${pendingSorted.map((meal) => Components.mealCarouselCard(meal, app)).join('')}
                            </div>
                        </div>
                        `
                        : ''}

                    <!-- 5. Food Carousel or Empty state -->
                    ${totalMeals === 0
                        ? `
                        <div class="text-center py-12">
                            <div class="w-16 h-16 rounded-full glass flex items-center justify-center mx-auto mb-4">
                                <svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6l4 2M4 12a8 8 0 1116 0 8 8 0 01-16 0z"/></svg>
                            </div>
                            <h3 class="text-lg font-semibold text-surface-900 dark:text-zinc-100 mb-2">Нет приёмов пищи</h3>
                            <p class="text-sm text-surface-500">Сфотографируйте блюдо или введите его вручную, чтобы начать</p>
                        </div>
                        `
                        : `
                        ${sortedMeals.length > 0
                            ? `
                            <div class="mb-4">
                                <h3 class="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2">Приёмы пищи</h3>
                            </div>
                            <div class="meal-carousel flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-2" id="meal-carousel">
                                ${carouselCards}
                            </div>
                            `
                            : ''}
                        `}

                    <!-- 6. Actions Section (below carousel) -->
                    <div class="mt-6">
                        <h3 class="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Тип приёма пищи</h3>
                        <div class="grid grid-cols-4 gap-2 mb-4" id="meal-type-selector">
                            ${this.renderMealTypeChips()}
                        </div>

                        <h3 class="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Действия</h3>
                        <div class="grid grid-cols-2 gap-3 mb-4">
                            <label for="photo-input" class="btn-press cursor-pointer flex flex-col items-center gap-2 py-3 glass rounded-xl text-center transition-all">
                                <svg class="w-7 h-7 text-primary-600 dark:text-zinc-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 010 6z"/></svg>
                                <span class="text-sm font-medium text-surface-900 dark:text-zinc-100">Сфотографировать</span>
                                <input type="file" id="photo-input" accept="image/*" class="hidden">
                            </label>
                            <button id="manual-entry-btn" data-action="manual-entry" class="btn-press flex flex-col items-center gap-2 py-3 glass rounded-xl text-center transition-all">
                                <svg class="w-7 h-7 text-primary-600 dark:text-zinc-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 0 2 2 0 010 2.828l-9.414 9.414H7v-2.828a2 2 0 012-2l5.414-5.414Z"/></svg>
                                <span class="text-sm font-medium text-surface-900 dark:text-zinc-100">Ввести вручную</span>
                            </button>
                        </div>

                        <label class="block text-xs text-surface-500 mb-1">Заметки (необязательно)</label>
                        <textarea id="photo-notes" placeholder="Например: обед, завтрак..." class="w-full px-3 py-2 rounded-xl glass-input text-sm resize-none" rows="2"></textarea>
                    </div>
                </div>
            `;

            container.innerHTML = html;

            this.bindDateNav();
            this.bindPeriodSelector();
            this.bindMealTypeSelector();
            this.bindPhotoInput();
            this.bindManualEntry();
            this.bindMealActions();
            this.bindFlipCards();

            const retryBtn = container.querySelector('#retry-failed');
            if (retryBtn) {
                retryBtn.onclick = async () => {
                    retryBtn.disabled = true;
                    retryBtn.textContent = 'Синхронизация...';
                    try {
                        await SyncEngine.processQueue();
                    } catch (e) {
                        console.error('[Nutrition] Retry failed:', e);
                    }
                    this.app.renderPage('nutrition');
                };
            }

            const clearBtn = container.querySelector('#clear-failed');
            if (clearBtn) {
                clearBtn.onclick = async () => {
                    await SyncEngine.clearQueue();
                    this.app.renderPage('nutrition');
                };
            }
        } catch (error) {
            console.error('[Nutrition] Render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки данных');
        }
    },

    bindFlipCards() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('.flip-card').forEach((card) => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="edit-meal"], [data-action="delete-meal"]')) return;
                const inner = card.querySelector('.flip-card-inner');
                if (inner) inner.classList.toggle('flipped');
            });
        });
    },

    bindDateNav() {
        const prev = this.app.elements.pageContent.querySelector('#date-prev');
        const next = this.app.elements.pageContent.querySelector('#date-next');
        const today = new Date().toISOString().split('T')[0];
        const isToday = this.selectedDate >= today;

        if (prev) {
            prev.onclick = () => this.changeDate(-1);
            prev.disabled = false;
            prev.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        if (next) {
            next.onclick = () => this.changeDate(1);
            next.disabled = isToday;
            next.classList.toggle('opacity-50', isToday);
            next.classList.toggle('cursor-not-allowed', isToday);
        }
    },

    bindPeriodSelector() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('[data-action="set-period"]').forEach((btn) => {
            btn.onclick = () => {
                this.period = btn.dataset.period;
                this.render(this.app.elements.pageContent, this.app, this.selectedDate);
            };
        });
    },

    bindMealTypeSelector() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('[data-action="set-meal-type"]').forEach((btn) => {
            btn.onclick = () => {
                this.selectedMealType = btn.dataset.type;
                this.bindMealTypeSelector();
            };
        });
        // Update active state
        container.querySelectorAll('[data-action="set-meal-type"]').forEach((btn) => {
            const isActive = btn.dataset.type === this.selectedMealType;
            btn.classList.toggle('active', isActive);
        });
    },

    bindPhotoInput() {
        const input = this.app.elements.pageContent.querySelector('#photo-input');
        if (!input) return;
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.uploadPhoto(file);
            }
        };
    },

    bindManualEntry() {
        const btn = this.app.elements.pageContent.querySelector('#manual-entry-btn');
        if (btn) {
            btn.onclick = () => {
                this.app.showToast('Ручной ввод пока недоступен', 'info');
            };
        }
    },

    bindMealActions() {
        const container = this.app.elements.pageContent;

        container.querySelectorAll('[data-action="edit-meal"]').forEach((btn) => {
            btn.onclick = (e) => {
                const mealId = btn.dataset.mealId;
                this.app.showToast(`Редактирование: ${mealId}`, 'info');
            };
        });

        container.querySelectorAll('[data-action="delete-meal"]').forEach((btn) => {
            btn.onclick = async (e) => {
                e.stopPropagation();
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
                        await DB.deleteMeal(mealId);
                        this.render(this.app.elements.pageContent, this.app);
                    } catch (error) {
                        console.error('[Nutrition] Delete error:', error);
                        this.app.showToast('Ошибка удаления', 'error');
                    }
                }
            };
        });
    },

    async uploadPhoto(file) {
        if (!this.selectedMealType) {
            this.app.showToast('Выберите тип приёма пищи', 'error');
            return;
        }
        const notesInput = this.app.elements.pageContent.querySelector('#photo-notes');
        const notes = notesInput ? notesInput.value || null : null;
        const token = this.app.state.tokens.access;

        Camera.app = this.app;
        let compressedBlob = file;

        try {
            const compressed = await Utils.compressImage(file);
            if (compressed) {
                compressedBlob = compressed;
            }
        } catch (compressError) {
            console.warn('[Nutrition] Compression failed, using original:', compressError);
        }

        const formData = new FormData();
        formData.append('file', compressedBlob, 'photo.webp');
        formData.append('meal_type', this.selectedMealType);
        if (notes) formData.append('notes', notes);

        try {
            await API.post('/nutrition/photos', formData, token, true);
            this.app.showToast('Фото загружено, идёт анализ', 'success');
        } catch (error) {
            if (error?.isNetworkError || error?.offlineQueued) {
                await Camera.queueOfflineMeal(compressedBlob, notes, this.selectedMealType);
                this.app.showToast('Нет связи. Фото сохранено локально и будет загружено при появлении связи', 'info');
            } else {
                console.error('[Nutrition] Upload error:', error);
                this.app.showToast(error.data?.detail || 'Ошибка загрузки', 'error');
            }
        }

        const input = this.app.elements.pageContent.querySelector('#photo-input');
        if (input) input.value = '';
        if (notesInput) notesInput.value = '';

        this.render(this.app.elements.pageContent, this.app, this.selectedDate);
    },
};
