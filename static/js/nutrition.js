import { API } from './api.js';
import { DB } from './db.js';
import { SyncEngine } from './sync.js';
import { Components } from './components.js';
import { Utils } from './utils.js';
import { Camera } from './camera.js';

export const Nutrition = {
    app: null,
    selectedDate: null,
    selectedMealType: null,
    _newMealModalState: null,
    _newMealModalClosing: null,

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

        const targets = data
            ? {
                  target_calories: data.target_calories ?? null,
                  target_protein: data.target_protein_g ?? null,
                  target_fat: data.target_fat_g ?? null,
                  target_carbs: data.target_carbs_g ?? null,
              }
            : { target_calories: null, target_protein: null, target_fat: null, target_carbs: null };

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

        return { serverMeals, summary, targets, pendingMeals, failedItems, fromCache };
    },

    /**
     * Averages for the week the date belongs to, used by dashboard slide 2.
     * The endpoint already returns per-day averages, so the payload is only
     * normalised into the summary shape the ring expects.
     */
    async loadPeriodData(date) {
        const token = this.app.state.tokens.access;
        try {
            const data = await API.get(`/nutrition/week?date=${date || this.selectedDate}`, token);
            if (data && typeof data === 'object') {
                return {
                    calories: data.avg_calories ?? data.total_calories ?? 0,
                    protein: data.avg_protein_g ?? data.total_protein_g ?? 0,
                    fat: data.avg_fat_g ?? data.total_fat_g ?? 0,
                    carbs: data.avg_carbs_g ?? data.total_carbs_g ?? 0,
                    target_calories: data.target_calories ?? null,
                    days: data.days ?? null,
                    active_days: data.active_days ?? null,
                    series: Array.isArray(data.series) ? data.series : [],
                };
            }
        } catch (error) {
            console.warn('[Nutrition] Period average unavailable:', error?.message);
        }
        return null;
    },

    /**
     * Newest-first ordering key for a meal. Timestamps arrive as ISO strings,
     * so they must be parsed before comparing (a raw "-" on strings yields NaN
     * and leaves the list in its original order).
     */
    mealTimestamp(meal) {
        const raw = meal?.eaten_at || meal?.updated_at || meal?.created_at;
        if (!raw) return 0;
        const ts = new Date(raw).getTime();
        return Number.isFinite(ts) ? ts : 0;
    },

    formatDateLabel(dateISO) {
        const d = new Date(dateISO);
        const today = new Date().toISOString().split('T')[0];
        if (dateISO === today) return 'Сегодня';
        return Utils.formatDate(d);
    },

    weekRangeLabel(dateISO) {
        const start = new Date(dateISO);
        const weekday = (start.getDay() + 6) % 7;
        start.setDate(start.getDate() - weekday);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return `${start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — ${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
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

/**
     * One dashboard slide: the Mercedes ring plus a single caption line naming
     * the period it covers. The caption keeps a fixed height so both slides stay
     * exactly the same height and the card never jumps while swiping.
     */
    renderNutritionSlide(summary, targets, qualityScore, caption) {
        return `
            ${Components.mercedesComboRing(summary, targets, qualityScore)}
            <p class="mt-0.5 h-3.5 text-[10px] leading-3.5 text-center text-surface-400 dark:text-surface-500 truncate">${caption}</p>
        `;
    },

    /**
     * Slide 2 figures: the 7-day averages the /nutrition/week payload already
     * returns, plus the mean AI quality across the days that actually carry
     * meals. Missing payload means the ring falls back to zeros instead of
     * silently rendering another period's numbers.
     */
    weeklyAverage(periodData) {
        if (!periodData) {
            return { summary: { calories: 0, protein: 0, fat: 0, carbs: 0 }, qualityScore: null, hasData: false };
        }

        const series = Array.isArray(periodData.series) ? periodData.series : [];
        const scores = series
            .filter(day => Number(day.meals_count) > 0)
            .map(day => Utils.computeQualityScore({
                calories: day.calories,
                protein: day.protein_g,
                fat: day.fat_g,
                carbs: day.carbs_g,
            }))
            .filter(score => score !== null && Number.isFinite(score));

        return {
            summary: {
                calories: Number(periodData.calories) || 0,
                protein: Number(periodData.protein) || 0,
                fat: Number(periodData.fat) || 0,
                carbs: Number(periodData.carbs) || 0,
            },
            qualityScore: scores.length
                ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
                : null,
            hasData: series.length > 0,
        };
    },

    /**
     * Swipe and pagination-dot navigation for the dashboard card. The active
     * dot follows the scroll position so a manual swipe and a dot tap stay in
     * sync in both directions.
     */
    bindDashboardSlides() {
        const container = this.app.elements.pageContent;
        const track = container.querySelector('[data-role="nutrition-slides"]');
        if (!track) return;

        const dots = Array.from(container.querySelectorAll('[data-action="nutrition-dot"]'));
        const setActive = (index) => {
            dots.forEach((dot, i) => {
                const active = i === index;
                dot.classList.toggle('bg-lime-500', active);
                dot.classList.toggle('dark:bg-lime-400', active);
                dot.classList.toggle('opacity-100', active);
                dot.classList.toggle('bg-surface-300', !active);
                dot.classList.toggle('dark:bg-zinc-700', !active);
                dot.classList.toggle('opacity-60', !active);
                dot.setAttribute('aria-pressed', String(active));
            });
        };

        const activeIndex = () => {
            const width = track.clientWidth;
            if (!width) return 0;
            return Math.round(track.scrollLeft / width);
        };

        // A dot tap scrolls the track programmatically, which fires scroll
        // events of its own. The flag keeps the handler from overwriting the
        // dot the user just picked while the smooth scroll is still running.
        let programmatic = false;

        const goTo = (index) => {
            const max = dots.length - 1;
            const target = Math.min(max, Math.max(0, index));
            programmatic = true;
            track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
            setActive(target);
            clearTimeout(track._dotScrollTimer);
            track._dotScrollTimer = setTimeout(() => { programmatic = false; }, 400);
        };

        dots.forEach((dot) => {
            dot.onclick = () => goTo(Number(dot.dataset.slide));
        });

        track.addEventListener('scroll', () => {
            if (programmatic) return;
            setActive(activeIndex());
        }, { passive: true });

setActive(activeIndex());
    },

    async render(container, app, dateOverride = null) {
        this.app = app;
        if (dateOverride) {
            this.selectedDate = dateOverride;
        }
        if (!this.selectedDate) {
            this.selectedDate = new Date().toISOString().split('T')[0];
        }

        // Close any open modal before re-rendering
        this.closeNewMealModal();

        container.innerHTML = Components.loadingSpinner();

        try {
            const { serverMeals, summary, targets: apiTargets, pendingMeals, failedItems, fromCache } = await this.loadData(this.selectedDate);

            // Slide 2 is always the week the selected date belongs to, so the average
            // never drifts onto a period the user cannot navigate to any more.
            const weekDataPromise = this.loadPeriodData(this.selectedDate);

            const user = this.app.state.user || {};
            const resolveTarget = (apiValue, userValue, fallback) => {
                if (Number.isFinite(Number(apiValue)) && Number(apiValue) > 0) return Number(apiValue);
                if (Number.isFinite(Number(userValue)) && Number(userValue) > 0) return Number(userValue);
                return fallback;
            };

            const targets = {
                target_calories: resolveTarget(apiTargets?.target_calories, user.target_calories, 2000),
                target_protein: resolveTarget(apiTargets?.target_protein, user.target_protein_g, 150),
                target_fat: resolveTarget(apiTargets?.target_fat, user.target_fat_g, 65),
                target_carbs: resolveTarget(apiTargets?.target_carbs, user.target_carbs_g, 250),
            };

            const dateLabel = this.formatDateLabel(this.selectedDate);

            // LIFO: the most recent meal is the first tile after the action card.
            const sortedMeals = serverMeals
                .slice()
                .sort((a, b) => this.mealTimestamp(b) - this.mealTimestamp(a));

            const pendingSorted = pendingMeals
                .slice()
                .sort((a, b) => this.mealTimestamp(b) - this.mealTimestamp(a));

            const weekData = await weekDataPromise;
            const week = this.weeklyAverage(weekData);

            const totalMeals = sortedMeals.length + pendingSorted.length;

            // Compute quality score for the metric bar
            const qualityScore = totalMeals > 0 ? Utils.computeQualityScore(summary) : null;

            // Week targets track the week payload first so the average ring always
            // compares against the same goal the profile shows.
            const weekTargets = weekData?.target_calories
                ? { ...targets, target_calories: Number(weekData.target_calories) }
                : targets;
            const weekCaption = week.hasData
                ? `Неделя: ${this.weekRangeLabel(this.selectedDate)}`
                : 'Неделя: нет данных';
            const dashboard = Components.nutritionDashboardCard({
                title: 'Питание',
                slides: [
                    this.renderNutritionSlide(summary, targets, qualityScore, 'День'),
                    this.renderNutritionSlide(week.summary, weekTargets, week.qualityScore, weekCaption),
                ],
            });

            let html = `
                <div class="single-viewport px-4 pt-4 pb-20">
                    <!-- HEADER -->
                    <div class="viewport-header p-1 pt-0 pb-2">
                        ${this.renderDateNav(this.selectedDate, dateLabel, fromCache)}

                        <!-- Swipable dashboard: selected day + weekly average -->
                        ${dashboard}
                    </div>

                    <!-- PENDING SYNC BANNER -->
                    ${pendingSorted.length > 0
                        ? `
                        <div class="shrink-0 mb-1">
                            <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                Ожидают синхронизации: ${pendingSorted.length}
                            </span>
                        </div>
                        `
                        : ''}

                    <!-- SNAP CAROUSEL: action tile first, then pending meals, then logged meals (LIFO) -->
                    <div class="meal-carousel" id="meal-carousel">
                        ${Components.addMealActionCard()}
                        ${pendingSorted.map((meal) => Components.mealCardPhoto(meal, app)).join('')}
                        ${sortedMeals.map((meal) => Components.mealCardPhoto(meal, app)).join('')}
                        ${totalMeals === 0 ? Components.mealCarouselEmptyState() : ''}
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
                </div>
            `;

            container.innerHTML = html;

            this.bindDateNav();
            this.bindDashboardSlides();
            this.bindFlipCards();
            this.bindAddMealModal();
            this.bindMealActions();
            this.bindFailedItems();

        } catch (error) {
            console.error('[Nutrition] Render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки данных');
        }
    },

    bindFlipCards() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('[data-action="flip-card"]').forEach((btn) => {
            btn.onclick = (e) => {
                // Scrolling the in-card AI analysis must not trigger the 3D flip.
                if (e.target.closest('[data-no-flip]')) return;
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

        // The action tile lives inside the carousel, so bind every match.
        container.querySelectorAll('[data-action="open-add-meal-modal"]').forEach((btn) => {
            btn.onclick = () => this.openNewMealModal();
        });
    },

    openNewMealModal() {
        // Guard on the closing element too, so a tap during the slide-out
        // animation cannot stack a second sheet on top of the first.
        if (this._newMealModalState || this._newMealModalClosing) return;

        const modalHtml = Components.newMealModal();
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        const modalEl = modalContainer.firstElementChild;
        document.body.appendChild(modalEl);

        this._newMealModalState = {
            modalEl,
            panelEl: modalEl.querySelector('.drum-sheet-panel'),
            selectedFile: null,
            selectedMealType: null,
            previewUrl: null,
        };

        // Lock background scroll while the sheet is open (restore prior state on close)
        this._newMealModalState.bodyWasLocked = document.body.classList.contains('overflow-hidden');
        document.body.classList.add('overflow-hidden');

        // Bind events
        this.bindNewMealModalEvents(modalEl);
    },

    closeNewMealModal() {
        if (!this._newMealModalState) return;

        const { modalEl, panelEl, previewUrl, onKeydown, bodyWasLocked } = this._newMealModalState;
        // Revoke the object URL before the modal leaves the DOM so a preview
        // that is never submitted does not leak its blob.
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        this._newMealModalState = null;
        if (onKeydown) {
            document.removeEventListener('keydown', onKeydown);
        }
        if (!bodyWasLocked) {
            document.body.classList.remove('overflow-hidden');
        }

        // Slide the panel back out before removing it, mirroring the drum sheet.
        panelEl?.classList.add('is-closing');
        modalEl.querySelector('.drum-sheet-backdrop')?.classList.add('is-closing');

        this._newMealModalClosing = modalEl;
        setTimeout(() => {
            modalEl.remove();
            if (this._newMealModalClosing === modalEl) {
                this._newMealModalClosing = null;
            }
        }, 220);
    },

    bindNewMealModalEvents(modalEl) {
        const state = this._newMealModalState;

        // Backdrop closes the sheet; the close button sits inside the panel and
        // is bound directly so panel clicks never bubble into the backdrop handler.
        modalEl.querySelector('.drum-sheet-backdrop')?.addEventListener('click', () => {
            this.closeNewMealModal();
        });
        modalEl.querySelector('.drum-sheet-panel [data-action="close-new-meal-modal"]')?.addEventListener('click', () => {
            this.closeNewMealModal();
        });

        // Escape key
        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                this.closeNewMealModal();
            }
        };
        state.onKeydown = onKeydown;
        document.addEventListener('keydown', onKeydown);

        // Meal type selection
        modalEl.querySelectorAll('[data-action="set-new-meal-type"]').forEach((btn) => {
            btn.onclick = () => {
                state.selectedMealType = btn.dataset.type;
                modalEl.querySelectorAll('[data-action="set-new-meal-type"]').forEach((b) => {
                    const isActive = b.dataset.type === state.selectedMealType;
                    b.classList.toggle('active', isActive);
                    b.setAttribute('aria-pressed', String(isActive));
                });
                this.updateNewMealSubmitState(modalEl, state);
            };
        });

        // Camera button
        modalEl.querySelector('[data-action="new-meal-camera"]')?.addEventListener('click', () => {
            const input = modalEl.querySelector('#new-meal-photo-input');
            if (input) {
                input.setAttribute('capture', 'environment');
                input.click();
            }
        });

        // Gallery button
        modalEl.querySelector('[data-action="new-meal-gallery"]')?.addEventListener('click', () => {
            const input = modalEl.querySelector('#new-meal-photo-input');
            if (input) {
                input.removeAttribute('capture');
                input.click();
            }
        });

        // Remove image button
        modalEl.querySelector('[data-action="remove-new-meal-img"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearNewMealImage(modalEl, state);
        });

        // File input change
        const photoInput = modalEl.querySelector('#new-meal-photo-input');
        if (photoInput) {
            photoInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleNewMealFileSelect(file, modalEl, state);
                }
            };
        }

        // Submit button
        modalEl.querySelector('[data-action="submit-new-meal"]')?.addEventListener('click', () => {
            this.handleNewMealSubmit(modalEl, state);
        });
    },

    handleNewMealFileSelect(file, modalEl, state) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.app.showToast('Выберите изображение', 'error');
            return;
        }

        state.selectedFile = file;

        const previewContainer = modalEl.querySelector('#new-meal-preview-container');
        const preview = modalEl.querySelector('#new-meal-img');
        const sourceBtns = modalEl.querySelector('#new-meal-source-btns');

        // Revoke the previous preview so re-picking a photo does not leak.
        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
        }
        state.previewUrl = URL.createObjectURL(file);

        preview.src = state.previewUrl;
        previewContainer.classList.remove('hidden');
        sourceBtns.classList.add('hidden');

        this.updateNewMealSubmitState(modalEl, state);
    },

    clearNewMealImage(modalEl, state) {
        const previewContainer = modalEl.querySelector('#new-meal-preview-container');
        const preview = modalEl.querySelector('#new-meal-img');
        const sourceBtns = modalEl.querySelector('#new-meal-source-btns');
        const photoInput = modalEl.querySelector('#new-meal-photo-input');

        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
            state.previewUrl = null;
        }
        preview.removeAttribute('src');
        previewContainer.classList.add('hidden');
        sourceBtns.classList.remove('hidden');
        photoInput.value = '';
        state.selectedFile = null;

        this.updateNewMealSubmitState(modalEl, state);
    },

    updateNewMealSubmitState(modalEl, state) {
        const submitBtn = modalEl.querySelector('#new-meal-submit');
        if (submitBtn) {
            const hasFile = !!state.selectedFile;
            const hasMealType = !!state.selectedMealType;
            submitBtn.disabled = !(hasFile && hasMealType);
        }
    },

    async handleNewMealSubmit(modalEl, state) {
        if (!state.selectedFile || !state.selectedMealType) {
            return;
        }

        const notesInput = modalEl.querySelector('#new-meal-notes');
        const notes = notesInput ? notesInput.value.trim() || null : null;
        const token = this.app.state.tokens.access;

        const submitBtn = modalEl.querySelector('#new-meal-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
            <svg class="animate-spin w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <span class="text-sm font-semibold">Загрузка...</span>
        `;

        let compressedBlob = state.selectedFile;

        try {
            const compressed = await Utils.compressImage(state.selectedFile);
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
            this.closeNewMealModal();
        } catch (error) {
            if (error?.isNetworkError || error?.offlineQueued) {
                await Camera.queueOfflineMeal(compressedBlob, notes, state.selectedMealType);
                this.app.showToast('Нет связи. Фото сохранено локально и будет загружено при появлении связи', 'info');
                this.closeNewMealModal();
            } else {
                console.error('[Nutrition] Upload error:', error);
                this.app.showToast(error.data?.detail || 'Ошибка загрузки', 'error');
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `
                <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                <span class="text-sm font-semibold">Отправить / Анализировать</span>
            `;
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

    /**
     * Edit/delete handlers for every card action button (front menu and back
     * face). Both stop propagation and prevent default: the flip listener is
     * bound on the .meal-card-inner ancestor, so without this the click would
     * bubble up and rotate the card instead of running the action.
     */
    bindMealActions() {
        const container = this.app.elements.pageContent;

        container.querySelectorAll('[data-action="edit-meal"]').forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const mealId = btn.dataset.mealId;
                this.app.showToast(`Редактирование: ${mealId}`, 'info');
            };
        });

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
