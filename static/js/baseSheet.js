/**
 * BaseSheet - Base class for all bottom sheet modals (drum sheets).
 * Handles open/close lifecycle, animations, backdrop, Escape key, body scroll lock,
 * focus management, and cleanup.
 */
export class BaseSheet {
    constructor(options = {}) {
        this.modalEl = null;
        this.panelEl = null;
        this.backdropEl = null;
        this.bodyWasLocked = false;
        this.onKeydown = null;
        this.onClose = options.onClose || (() => {});
        this.animationDuration = options.animationDuration || 220;
    }

    /**
     * Create and show the sheet. Subclasses must implement getHtml() to return the HTML string.
     */
    open() {
        if (this.modalEl) return; // Already open

        const html = this.getHtml();
        const container = document.createElement('div');
        container.innerHTML = html;
        this.modalEl = container.firstElementChild;
        document.body.appendChild(this.modalEl);

        // Find key elements
        this.panelEl = this.modalEl.querySelector('.drum-sheet-panel');
        this.backdropEl = this.modalEl.querySelector('.drum-sheet-backdrop');

        // Lock background scroll
        this.bodyWasLocked = document.body.classList.contains('overflow-hidden');
        document.body.classList.add('overflow-hidden');

        // Bind events
        this.bindEvents();

        // Trigger entrance animation
        requestAnimationFrame(() => {
            this.panelEl?.classList.remove('is-closing');
            this.backdropEl?.classList.remove('is-closing');
        });
    }

    /**
     * Close the sheet with animation.
     */
    close() {
        if (!this.modalEl) return;

        // Clean up event listeners
        if (this.onKeydown) {
            document.removeEventListener('keydown', this.onKeydown);
            this.onKeydown = null;
        }

        // Remove modal-specific listeners
        this.unbindEvents();

        // Restore body scroll
        if (!this.bodyWasLocked) {
            document.body.classList.remove('overflow-hidden');
        }

        // Start exit animation
        this.panelEl?.classList.add('is-closing');
        this.backdropEl?.classList.add('is-closing');

        // Remove from DOM after animation
        setTimeout(() => {
            this.modalEl?.remove();
            this.modalEl = null;
            this.panelEl = null;
            this.backdropEl = null;
            this.onClose();
        }, this.animationDuration);
    }

    /**
     * Get the HTML for the sheet. Must be implemented by subclasses.
     */
    getHtml() {
        throw new Error('getHtml() must be implemented by subclass');
    }

    /**
     * Bind event listeners. Override in subclasses for custom bindings.
     */
    bindEvents() {
        // Backdrop click to close
        this.backdropEl?.addEventListener('click', () => this.close());

        // Close button inside panel
        this.modalEl?.querySelectorAll('[data-action^="close-"]').forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        // Escape key
        this.onKeydown = (e) => {
            if (e.key === 'Escape') this.close();
        };
        document.addEventListener('keydown', this.onKeydown);
    }

    /**
     * Unbind event listeners. Override in subclasses if needed.
     */
    unbindEvents() {
        // Subclasses can override to clean up their specific listeners
    }

    /**
     * Check if sheet is currently open.
     */
    isOpen() {
        return Boolean(this.modalEl);
    }
}

/**
     * PeriodSheet - Period/date picker sheet for nutrition page.
     */
    export class PeriodSheet extends BaseSheet {
        constructor(nutrition, options = {}) {
            super({ ...options, onClose: () => nutrition._periodSheetState = null });
            this.nutrition = nutrition;
            this.today = options.today || nutrition.todayISO();
            this.start = options.start;
            this.end = options.end;
            this.isRange = options.isRange ?? (nutrition.selectedPeriod !== 'day');
            this.initialStart = this.start;
            this.initialEnd = this.end;
            this._startChangeHandler = null;
            this._endChangeHandler = null;
            this._presetHandlers = [];
            this._resetHandler = null;
            this._applyHandler = null;
        }

        getHtml() {
            if (!this.nutrition?.Components) return '';
            return this.nutrition.Components.periodSheet({
                today: this.today,
                start: this.start,
                end: this.end,
                isRange: this.isRange,
            });
        }

        bindEvents() {
            super.bindEvents();

            const modalEl = this.modalEl;
            const startInput = modalEl.querySelector('[data-period-field="start"]');
            const endInput = modalEl.querySelector('[data-period-field="end"]');

            // Keep bounds ordered
            if (this.isRange && startInput && endInput) {
                this._startChangeHandler = () => {
                    if (!startInput.value) return;
                    if (endInput.value && endInput.value < startInput.value) {
                        endInput.value = startInput.value;
                    }
                    endInput.min = startInput.value;
                };
                this._endChangeHandler = () => {
                    if (!endInput.value) return;
                    if (startInput.value && startInput.value > endInput.value) {
                        startInput.value = endInput.value;
                    }
                    endInput.min = startInput.value;
                };
                startInput.addEventListener('change', this._startChangeHandler);
                endInput.addEventListener('change', this._endChangeHandler);
            }

            // Preset buttons
            modalEl.querySelectorAll('[data-action="period-preset"]').forEach(btn => {
                const handler = () => {
                    const range = this.nutrition.presetRange(btn.dataset.range, this.today);
                    if (!range) return;
                    if (startInput) startInput.value = range.start;
                    if (endInput) endInput.value = range.end;
                    if (endInput) endInput.min = range.start;
                };
                btn.addEventListener('click', handler);
                this._presetHandlers.push({ btn, handler });
            });

            // Reset button
            this._resetHandler = () => {
                if (startInput) startInput.value = this.initialStart;
                if (endInput) {
                    endInput.value = this.initialEnd;
                    endInput.min = this.initialStart;
                }
            };
            modalEl.querySelector('[data-action="reset-period-sheet"]')?.addEventListener('click', this._resetHandler);

            // Apply button
            this._applyHandler = async () => {
                let start = startInput?.value || '';
                let end = this.isRange ? (endInput?.value || '') : start;
                if (!start) return;
                if (!end) end = start;
                if (start > end) [start, end] = [end, start];
                if (end > this.today) end = this.today;
                if (start > this.today) start = this.today;

                this.close();

                if (this.isRange) {
                    this.nutrition.selectedPeriod = 'custom';
                    this.nutrition.customRange = { start, end };
                    this.nutrition.selectedDate = end;
                } else {
                    this.nutrition.selectedDate = start;
                }

                await this.nutrition.render(this.nutrition.app.elements.pageContent, this.nutrition.app);
            };
            modalEl.querySelector('[data-action="apply-period-sheet"]')?.addEventListener('click', this._applyHandler);
        }

        unbindEvents() {
            const modalEl = this.modalEl;
            const startInput = modalEl?.querySelector('[data-period-field="start"]');
            const endInput = modalEl?.querySelector('[data-period-field="end"]');

            if (this._startChangeHandler && startInput) {
                startInput.removeEventListener('change', this._startChangeHandler);
                this._startChangeHandler = null;
            }
            if (this._endChangeHandler && endInput) {
                endInput.removeEventListener('change', this._endChangeHandler);
                this._endChangeHandler = null;
            }
            this._presetHandlers.forEach(({ btn, handler }) => {
                btn.removeEventListener('click', handler);
            });
            this._presetHandlers = [];
            if (this._resetHandler) {
                modalEl?.querySelector('[data-action="reset-period-sheet"]')?.removeEventListener('click', this._resetHandler);
                this._resetHandler = null;
            }
            if (this._applyHandler) {
                modalEl?.querySelector('[data-action="apply-period-sheet"]')?.removeEventListener('click', this._applyHandler);
                this._applyHandler = null;
            }
        }
    }

/**
     * NewMealSheet - New meal entry sheet.
     */
    export class NewMealSheet extends BaseSheet {
        constructor(nutrition, options = {}) {
            super({ ...options, onClose: () => nutrition._newMealModalState = null });
            this.nutrition = nutrition;
            this.state = {
                selectedFile: null,
                selectedMealType: null,
                previewUrl: null,
            };
            this._mealTypeHandlers = [];
            this._cameraHandler = null;
            this._galleryHandler = null;
            this._removeImageHandler = null;
            this._photoInputHandler = null;
            this._submitHandler = null;
        }

        getHtml() {
            if (!this.nutrition?.Components) return '';
            return this.nutrition.Components.newMealModal();
        }

        bindEvents() {
            super.bindEvents();

            const modalEl = this.modalEl;
            const state = this.state;

            // Meal type selection
            modalEl.querySelectorAll('[data-action="set-new-meal-type"]').forEach(btn => {
                const handler = () => {
                    state.selectedMealType = btn.dataset.type;
                    modalEl.querySelectorAll('[data-action="set-new-meal-type"]').forEach(b => {
                        const isActive = b.dataset.type === state.selectedMealType;
                        b.classList.toggle('active', isActive);
                        b.setAttribute('aria-pressed', String(isActive));
                    });
                    this.updateSubmitState();
                };
                btn.onclick = handler;
                this._mealTypeHandlers.push({ btn, handler });
            });

            // Camera button
            this._cameraHandler = () => {
                const input = modalEl.querySelector('#new-meal-photo-input');
                if (input) {
                    input.setAttribute('capture', 'environment');
                    input.click();
                }
            };
            modalEl.querySelector('[data-action="new-meal-camera"]')?.addEventListener('click', this._cameraHandler);

            // Gallery button
            this._galleryHandler = () => {
                const input = modalEl.querySelector('#new-meal-photo-input');
                if (input) {
                    input.removeAttribute('capture');
                    input.click();
                }
            };
            modalEl.querySelector('[data-action="new-meal-gallery"]')?.addEventListener('click', this._galleryHandler);

            // Remove image button
            this._removeImageHandler = (e) => {
                e.stopPropagation();
                this.clearImage();
            };
            modalEl.querySelector('[data-action="remove-new-meal-img"]')?.addEventListener('click', this._removeImageHandler);

            // File input change
            const photoInput = modalEl.querySelector('#new-meal-photo-input');
            if (photoInput) {
                this._photoInputHandler = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        this.handleFileSelect(file);
                    }
                };
                photoInput.onchange = this._photoInputHandler;
            }

            // Submit button
            this._submitHandler = () => {
                this.handleSubmit();
            };
            modalEl.querySelector('[data-action="submit-new-meal"]')?.addEventListener('click', this._submitHandler);
        }

        unbindEvents() {
            const modalEl = this.modalEl;

            this._mealTypeHandlers.forEach(({ btn, handler }) => {
                btn.onclick = null;
            });
            this._mealTypeHandlers = [];

            if (this._cameraHandler) {
                modalEl?.querySelector('[data-action="new-meal-camera"]')?.removeEventListener('click', this._cameraHandler);
                this._cameraHandler = null;
            }
            if (this._galleryHandler) {
                modalEl?.querySelector('[data-action="new-meal-gallery"]')?.removeEventListener('click', this._galleryHandler);
                this._galleryHandler = null;
            }
            if (this._removeImageHandler) {
                modalEl?.querySelector('[data-action="remove-new-meal-img"]')?.removeEventListener('click', this._removeImageHandler);
                this._removeImageHandler = null;
            }
            const photoInput = modalEl?.querySelector('#new-meal-photo-input');
            if (photoInput && this._photoInputHandler) {
                photoInput.onchange = null;
                this._photoInputHandler = null;
            }
            if (this._submitHandler) {
                modalEl?.querySelector('[data-action="submit-new-meal"]')?.removeEventListener('click', this._submitHandler);
                this._submitHandler = null;
            }
        }

        handleFileSelect(file) {
        if (!file.type.startsWith('image/')) {
            this.nutrition.app.showToast('Выберите изображение', 'error');
            return;
        }

        this.state.selectedFile = file;

        const previewContainer = this.modalEl.querySelector('#new-meal-preview-container');
        const preview = this.modalEl.querySelector('#new-meal-img');
        const sourceBtns = this.modalEl.querySelector('#new-meal-source-btns');

        if (this.state.previewUrl) {
            URL.revokeObjectURL(this.state.previewUrl);
        }
        this.state.previewUrl = URL.createObjectURL(file);

        preview.src = this.state.previewUrl;
        previewContainer.classList.remove('hidden');
        sourceBtns.classList.add('hidden');

        this.updateSubmitState();
    }

    clearImage() {
        const previewContainer = this.modalEl.querySelector('#new-meal-preview-container');
        const preview = this.modalEl.querySelector('#new-meal-img');
        const sourceBtns = this.modalEl.querySelector('#new-meal-source-btns');
        const photoInput = this.modalEl.querySelector('#new-meal-photo-input');

        if (this.state.previewUrl) {
            URL.revokeObjectURL(this.state.previewUrl);
            this.state.previewUrl = null;
        }
        preview.removeAttribute('src');
        previewContainer.classList.add('hidden');
        sourceBtns.classList.remove('hidden');
        photoInput.value = '';
        this.state.selectedFile = null;

        this.updateSubmitState();
    }

    updateSubmitState() {
        const submitBtn = this.modalEl.querySelector('#new-meal-submit');
        if (submitBtn) {
            const hasFile = !!this.state.selectedFile;
            const hasMealType = !!this.state.selectedMealType;
            submitBtn.disabled = !(hasFile && hasMealType);
        }
    }

    async handleSubmit() {
        // Delegate to nutrition module's existing handler
        await this.nutrition.handleNewMealSubmit(this.modalEl, this.state);
    }
}

/**
     * EditMealSheet - Edit existing meal sheet.
     */
    export class EditMealSheet extends BaseSheet {
        constructor(nutrition, mealId, options = {}) {
            super({ ...options, onClose: () => nutrition._editMealModalState = null });
            this.nutrition = nutrition;
            this.mealId = mealId;
            this._submitHandler = null;
        }

        getHtml() {
            if (!this.nutrition?.Components) return '';
            const meal = this.nutrition._state?.cache?.meals?.get(String(this.mealId));
            return this.nutrition.Components.editMealModal(meal);
        }

        bindEvents() {
            super.bindEvents();

            this._submitHandler = () => {
                this.handleSubmit();
            };
            this.modalEl.querySelector('[data-action="submit-edit-meal"]')?.addEventListener('click', this._submitHandler);
        }

        unbindEvents() {
            if (this._submitHandler) {
                this.modalEl?.querySelector('[data-action="submit-edit-meal"]')?.removeEventListener('click', this._submitHandler);
                this._submitHandler = null;
            }
        }

        async handleSubmit() {
            await this.nutrition.handleEditMealSubmit(this.modalEl, this);
        }
    }

/**
     * AiSynergySleepSheet - Sleep input sheet for AI Synergy.
     */
    export class AiSynergySleepSheet extends BaseSheet {
        constructor(nutrition, options = {}) {
            super({ ...options, onClose: () => nutrition._aiSynergySleepSheet = null });
            this.nutrition = nutrition;
            this.value = options.value || '';
            this._confirmHandler = null;
        }

        getHtml() {
            if (!this.nutrition?.Components) return '';
            return this.nutrition.Components.aiSynergySleepModal({ value: this.value });
        }

        bindEvents() {
            super.bindEvents();

            this._confirmHandler = () => {
                this.handleConfirm();
            };
            this.modalEl.querySelector('[data-action="confirm-ai-synergy-sleep"]')?.addEventListener('click', this._confirmHandler);
        }

        unbindEvents() {
            if (this._confirmHandler) {
                this.modalEl?.querySelector('[data-action="confirm-ai-synergy-sleep"]')?.removeEventListener('click', this._confirmHandler);
                this._confirmHandler = null;
            }
        }

        handleConfirm() {
            const input = this.modalEl.querySelector('#ai-synergy-sleep-input');
            const value = input?.value || '';
            this.close();
            // Delegate to nutrition module
            this.nutrition.handleAiSynergySleepConfirm(value);
        }
    }