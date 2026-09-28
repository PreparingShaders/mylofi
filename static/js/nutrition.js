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
    _addMealModalState: null,

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

    async loadPeriodData(period, date) {
        if (period === 'day') return null;
        const token = this.app.state.tokens.access;
        const endpoint = period === 'week' ? '/nutrition/week' : '/nutrition/month';
        try {
            const data = await API.get(`${endpoint}?date=${date || this.selectedDate}`, token);
            if (data && typeof data === 'object') {
                return {
                    calories: data.avg_calories ?? data.total_calories ?? 0,
                    protein: data.avg_protein_g ?? data.total_protein_g ?? 0,
                    fat: data.avg_fat_g ?? data.total_fat_g ?? 0,
                    carbs: data.avg_carbs_g ?? data.total_carbs_g ?? 0,
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

    periodRangeLabel(dateISO, period) {
        const d = new Date(dateISO);
        if (period === 'week') {
            const start = new Date(d);
            const weekday = (start.getDay() + 6) % 7;
            start.setDate(start.getDate() - weekday);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            return `${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
        }
        if (period === 'month') {
            const month = d.toLocaleDateString('ru-RU', { month: 'long' });
            return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
        }
        return this.formatDateLabel(dateISO);
    },

    /**
     * Label above the ring: the period name plus the range it covers.
     * Day keeps the existing "Сегодня"/date wording.
     */
    periodTitle(dateISO, period) {
        if (period === 'day') return `Питание за ${this.formatDateLabel(dateISO)}`;
        const noun = period === 'week' ? 'Неделя' : 'Месяц';
        return `Питание · ${noun}: ${this.periodRangeLabel(dateISO, period)}`;
    },

    changeDate(delta) {
        const today = new Date().toISOString().split('T')[0];
        if (delta > 0 && this.selectedDate >= today) {
            return;
        }
        const current = new Date(this.selectedDate);
        if (this.period === 'week') {
            current.setDate(current.getDate() + delta * 7);
        } else if (this.period === 'month') {
            current.setMonth(current.getMonth() + delta);
        } else {
            current.setDate(current.getDate() + delta);
        }
        this.selectedDate = current.toISOString().split('T')[0];
        this.render(this.app.elements.pageContent, this.app, this.selectedDate);
    },

    renderDateNav(dateISO, dateLabel, fromCache = false) {
        const today = new Date().toISOString().split('T')[0];
        const isCurrent = dateISO >= today;
        return `
            <div class="flex items-center justify-between" id="date-nav">
                <button id="date-prev" data-action="date-prev" aria-label="Предыдущий период" class="btn-press w-10 h-10 rounded-xl glass flex items-center justify-center text-surface-700 dark:text-surface-300 shrink-0">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
                </button>
                <div class="flex flex-col items-center min-w-0">
                    <div class="flex items-center gap-1.5">
                        <h2 class="text-xl font-bold text-surface-900 dark:text-zinc-100 truncate">${dateLabel}</h2>
                        <label class="relative inline-flex items-center justify-center w-8 h-8 rounded-lg text-surface-500 dark:text-surface-400 hover:text-surface-900 dark:hover:text-zinc-100 transition-colors" for="date-picker" aria-label="Выбрать дату">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3M3.5 9.5h17M5 5h14a1.5 1.5 0 011.5 1.5v12A1.5 1.5 0 0119 20H5a1.5 1.5 0 01-1.5-1.5v-12A1.5 1.5 0 015 5z"/></svg>
                            <input type="date" id="date-picker" value="${dateISO}" max="${today}" class="date-picker absolute inset-0 opacity-0 cursor-pointer">
                        </label>
                    </div>
                    <span class="text-xs text-amber-500" id="date-offline-hint" ${fromCache ? '' : 'hidden'}>Оффлайн</span>
                </div>
                <button id="date-next" data-action="date-next" aria-label="Следующий период" class="btn-press w-10 h-10 rounded-xl glass flex items-center justify-center text-surface-700 dark:text-surface-300 shrink-0 ${isCurrent ? 'opacity-50 cursor-not-allowed' : ''}">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                </button>
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
            <div class="flex items-center gap-1 bg-surface-100 dark:bg-white/5 rounded-xl px-2 py-1" role="group" aria-label="Период аналитики">
                ${options.map((opt) => `
                    <button type="button" data-action="set-period" data-period="${opt.value}"
                            aria-pressed="${this.period === opt.value}"
                            class="period-pill flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${this.period === opt.value ? 'active' : 'text-surface-500 dark:text-surface-400'}">
                        ${opt.label}
                    </button>
                `).join('')}
            </div>
        `;
    },

    renderMealTypeChips() {
        const types = [
            { value: 'breakfast', label: 'Завтрак' },
            { value: 'lunch', label: 'Обед' },
            { value: 'dinner', label: 'Ужин' },
            { value: 'snack', label: 'Перекус' },
        ];
        return types.map((t) => `
            <button type="button" data-action="set-meal-type" data-type="${t.value}" aria-pressed="${this.selectedMealType === t.value}"
                    class="meal-type-chip flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 text-[10px] font-medium text-surface-600 dark:text-surface-400 transition-colors">
                ${Components.mealTypeIcon(t.value, 'w-5 h-5')}
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
            const periodTitle = this.periodTitle(this.selectedDate, this.period);

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

            const carouselCards = sortedMeals.map((meal) => Components.mealCardPhoto(meal, app)).join('');

            let displaySummary = summary;
            let periodHint = '';
            if (this.period !== 'day') {
                const avg = await this.loadPeriodData(this.period, this.selectedDate);
                if (avg) {
                    displaySummary = avg;
                    periodHint = 'Среднее за период';
                } else {
                    displaySummary = { calories: 0, protein: 0, fat: 0, carbs: 0 };
                    periodHint = 'Нет данных за период';
                }
            }

            const totalMeals = sortedMeals.length + pendingSorted.length;

            // Compute quality score for the metric bar
            const qualityScore = totalMeals > 0 ? Utils.computeQualityScore(displaySummary) : null;

            let html = `
                <div class="single-viewport safe-area-inset-top safe-area-inset-bottom">
                    <!-- HEADER -->
                    <div class="viewport-header p-4 pb-3">
                        <div class="flex justify-between items-center gap-2 mb-3">
                            ${this.renderDateNav(this.selectedDate, dateLabel, fromCache)}
                            ${this.renderPeriodSelector()}
                        </div>

                        <!-- Period Title -->
                        <h3 class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider truncate mb-2">${periodTitle}</h3>

                        <!-- 5-Column Metric Bar -->
                        ${Components.nutritionMetricsBar(displaySummary, targets, qualityScore)}
                        ${periodHint ? `<p class="text-[11px] text-center text-surface-500 dark:text-surface-400 mt-1">${periodHint}</p>` : ''}
                    </div>

                    <!-- CENTER CAROUSEL -->
                    <div class="viewport-content flex-1 overflow-x-auto snap-x snap-mandatory px-4 pb-4 -mx-4" id="meal-carousel">
                        ${pendingSorted.length > 0
                            ? `
                            <div class="flex gap-3 snap-none min-w-0">
                                <div class="w-64 shrink-0 flex items-center justify-center">
                                    <span class="text-xs text-amber-500 font-medium">Ожидают синхронизации</span>
                                </div>
                                ${pendingSorted.map((meal) => Components.mealCardPhoto(meal, app)).join('')}
                            </div>
                            `
                            : ''}
                        ${totalMeals === 0
                            ? `
                            <div class="flex items-center justify-center h-full min-w-full px-8">
                                <div class="text-center">
                                    <div class="w-16 h-16 rounded-full glass flex items-center justify-center mx-auto mb-3">
                                        <svg class="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6l4 2M4 12a8 8 0 1116 0 8 8 0 01-16 0z"/></svg>
                                    </div>
                                    <h3 class="text-lg font-semibold text-surface-900 dark:text-zinc-100 mb-1">Нет приёмов пищи</h3>
                                    <p class="text-sm text-surface-500">Нажмите "Добавить приём пищи", чтобы начать</p>
                                </div>
                            </div>
                            `
                            : `
                            <div class="flex gap-3 snap-none min-w-0">
                                ${carouselCards}
                            </div>
                            `
                        }
                    </div>

                    <!-- FAILED SYNC ITEMS (inline if any) -->
                    ${failedItems.length > 0
                        ? `
                        <div class="viewport-content px-4 pb-2 -mx-4" id="failed-items-section">
                            <div class="glass rounded-xl p-3 mb-2 border border-red-500/20">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wider">Ошибка синхронизации</h3>
                                    <button id="clear-failed" class="text-xs text-red-500 hover:text-red-400">Очистить все</button>
                                </div>
                                ${failedItems.map((item) => `
                                    <div class="glass rounded-lg p-2 mb-1">
                                        <p class="text-sm text-surface-600 dark:text-surface-300">${item.endpoint || 'Запрос'}</p>
                                        <p class="text-xs text-surface-500 truncate">${item.error || 'Неизвестная ошибка'}</p>
                                    </div>
                                `).join('')}
                                <button id="retry-failed" class="w-full py-2 mt-1 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl">Повторить сейчас</button>
                            </div>
                        </div>
                        `
                        : ''}

                    <!-- BOTTOM CTA -->
                    <div class="viewport-footer p-4 pt-2">
                        <button type="button" id="add-meal-btn" data-action="open-add-meal-modal" class="btn-press w-full flex items-center justify-center gap-2 py-3.5 glass rounded-xl text-center transition-all bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-600/30">
                            <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                            <span class="text-sm font-semibold">Добавить приём пищи</span>
                        </button>
                    </div>
                </div>
            `;

            container.innerHTML = html;

            this.bindDateNav();
            this.bindPeriodSelector();
            this.bindFlipCards();
            this.bindMealMenus();
            this.bindAddMealModal();
            this.bindFailedItems();

        } catch (error) {
            console.error('[Nutrition] Render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки данных');
        }
    },

    /**
     * Three-dot menus on meal cards. One menu open at a time; clicking the
     * toggle again, pressing Escape, or clicking outside closes it.
     */
    bindMealMenus() {
        this.unbindMealMenus();
        const container = this.app.elements.pageContent;
        const triggers = container.querySelectorAll('[data-action="toggle-meal-menu"]');

        const closeAll = (except = null) => {
            triggers.forEach((trigger) => {
                if (trigger === except) return;
                const menu = trigger.parentElement?.querySelector('.meal-card-menu');
                menu?.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            });
        };

        triggers.forEach((trigger) => {
            trigger.onclick = (e) => {
                e.stopPropagation();
                const menu = trigger.parentElement?.querySelector('.meal-card-menu');
                if (!menu) return;
                const willOpen = menu.classList.contains('hidden');
                closeAll(trigger);
                menu.classList.toggle('hidden', !willOpen);
                trigger.setAttribute('aria-expanded', String(willOpen));
            };
        });

        container.querySelectorAll('.meal-card-menu').forEach((menu) => {
            menu.onclick = (e) => e.stopPropagation();
        });

        this._closeMealMenus = (e) => {
            if (e.target.closest('[data-action="toggle-meal-menu"]')) return;
            closeAll();
        };
        this._closeMealMenusKeydown = (e) => {
            if (e.key === 'Escape') closeAll();
        };
        document.addEventListener('click', this._closeMealMenus);
        document.addEventListener('keydown', this._closeMealMenusKeydown);
    },

    unbindMealMenus() {
        if (this._closeMealMenus) {
            document.removeEventListener('click', this._closeMealMenus);
            this._closeMealMenus = null;
        }
        if (this._closeMealMenusKeydown) {
            document.removeEventListener('keydown', this._closeMealMenusKeydown);
            this._closeMealMenusKeydown = null;
        }
    },

    bindFlipCards() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('[data-action="flip-card"]').forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const card = btn.closest('.meal-card-3d');
                if (card) {
                    const inner = card.querySelector('.meal-card-inner');
                    if (inner) {
                        inner.classList.toggle('is-flipped');
                    }
                }
            };
        });
    },

    bindAddMealModal() {
        const container = this.app.elements.pageContent;

        // Open modal
        const openBtn = container.querySelector('#add-meal-btn');
        if (openBtn) {
            openBtn.onclick = () => this.openAddMealModal();
        }
    },

    openAddMealModal() {
        if (this._addMealModalState) return;

        const modalHtml = Components.addMealModal();
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        const modalEl = modalContainer.firstElementChild;
        document.body.appendChild(modalEl);

        this._addMealModalState = {
            modalEl,
            selectedMealType: null,
        };

        // Animate in
        requestAnimationFrame(() => {
            modalEl.classList.add('opacity-100');
            modalEl.querySelector('#add-meal-modal')?.classList.remove('translate-y-full');
        });

        // Bind events
        this.bindAddMealModalEvents(modalEl);
    },

    closeAddMealModal() {
        if (!this._addMealModalState) return;

        const { modalEl } = this._addMealModalState;
        modalEl.classList.remove('opacity-100');
        modalEl.querySelector('#add-meal-modal')?.classList.add('translate-y-full');

        setTimeout(() => {
            modalEl.remove();
            this._addMealModalState = null;
        }, 250);
    },

    bindAddMealModalEvents(modalEl) {
        const state = this._addMealModalState;

        // Close button
        modalEl.querySelector('[data-action="close-add-meal-modal"]')?.addEventListener('click', () => {
            this.closeAddMealModal();
        });

        // Backdrop click to close
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl) {
                this.closeAddMealModal();
            }
        });

        // Escape key
        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                this.closeAddMealModal();
                document.removeEventListener('keydown', onKeydown);
            }
        };
        document.addEventListener('keydown', onKeydown);

        // Meal type selection
        modalEl.querySelectorAll('[data-action="set-modal-meal-type"]').forEach((btn) => {
            btn.onclick = () => {
                state.selectedMealType = btn.dataset.type;
                modalEl.querySelectorAll('[data-action="set-modal-meal-type"]').forEach((b) => {
                    b.classList.toggle('active', b.dataset.type === state.selectedMealType);
                });
            };
        });

        // Camera button
        modalEl.querySelector('[data-action="modal-camera"]')?.addEventListener('click', () => {
            const input = modalEl.querySelector('#modal-photo-input');
            if (input) {
                input.setAttribute('capture', 'environment');
                input.click();
            }
        });

        // Gallery button
        modalEl.querySelector('[data-action="modal-gallery"]')?.addEventListener('click', () => {
            const input = modalEl.querySelector('#modal-photo-input');
            if (input) {
                input.removeAttribute('capture');
                input.click();
            }
        });

        // File input change
        const photoInput = modalEl.querySelector('#modal-photo-input');
        if (photoInput) {
            photoInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleModalPhotoUpload(file, state);
                }
            };
        }
    },

    async handleModalPhotoUpload(file, state) {
        if (!state.selectedMealType) {
            this.app.showToast('Выберите тип приёма пищи', 'error');
            return;
        }

        const notesInput = this._addMealModalState.modalEl.querySelector('#modal-meal-notes');
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
        formData.append('meal_type', state.selectedMealType);
        if (notes) formData.append('notes', notes);

        try {
            await API.post('/nutrition/photos', formData, token, true);
            this.app.showToast('Фото загружено, идёт анализ', 'success');
            this.closeAddMealModal();
        } catch (error) {
            if (error?.isNetworkError || error?.offlineQueued) {
                await Camera.queueOfflineMeal(compressedBlob, notes, state.selectedMealType);
                this.app.showToast('Нет связи. Фото сохранено локально и будет загружено при появлении связи', 'info');
                this.closeAddMealModal();
            } else {
                console.error('[Nutrition] Upload error:', error);
                this.app.showToast(error.data?.detail || 'Ошибка загрузки', 'error');
            }
        }

        this.render(this.app.elements.pageContent, this.app, this.selectedDate);
    },

    bindFailedItems() {
        const container = this.app.elements.pageContent;

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
    },

    bindDateNav() {
        const container = this.app.elements.pageContent;
        const prev = container.querySelector('#date-prev');
        const next = container.querySelector('#date-next');
        const picker = container.querySelector('#date-picker');
        const today = new Date().toISOString().split('T')[0];
        const isCurrent = this.selectedDate >= today;

        if (prev) {
            prev.onclick = () => this.changeDate(-1);
        }
        if (next) {
            next.onclick = () => {
                if (this.selectedDate >= today) return;
                this.changeDate(1);
            };
        }
        if (picker) {
            picker.value = this.selectedDate;
            picker.onchange = (e) => {
                const value = e.target.value;
                if (!value) return;
                this.selectedDate = value > today ? today : value;
                this.render(container, this.app, this.selectedDate);
            };
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
};
