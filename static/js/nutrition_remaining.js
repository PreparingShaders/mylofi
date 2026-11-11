bindDateNav() {
        const container = this.app.elements.pageContent;
        const prev = container.querySelector('#date-prev');
        const next = container.querySelector('#date-next');
        const trigger = container.querySelector('#date-picker-trigger');

        if (prev) {
            prev.onclick = () => this.stepPeriod(-1);
        }
        if (next) {
            next.onclick = () => this.stepPeriod(1);
        }
        if (trigger) {
            trigger.onclick = () => this.openPeriodSheet();
        }
    },

    bindPeriodTabs() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('[data-action="set-period"]').forEach((btn) => {
            btn.onclick = () => this.setPeriod(btn.dataset.period);
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
        // Prevent double-submit
        if (this._mealSubmitInFlight) return;
        this._mealSubmitInFlight = true;

        try {
            if (!state.selectedFile || !state.selectedMealType) return;

            // Disable submit button immediately - before any async work
            const submitBtn = modalEl.querySelector('#new-meal-submit');
            submitBtn.disabled = true;
            submitBtn.innerHTML = `
                <svg class="animate-spin w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span class="text-sm font-semibold">Подготовка...</span>
            `;

            const isOffline = !window.App?.state?.isOnline || !navigator.onLine;
            if (isOffline) {
                const notesInput = modalEl.querySelector('#new-meal-notes');
                const notes = notesInput ? notesInput.value.trim() || null : null;
                await Camera.queueOfflineMeal(state.selectedFile, notes, state.selectedMealType);
                this.app.showToast('Сохранено локально. Отправим при появлении связи', 'info');
                this.closeNewMealModal();
                this._scrollTargetMealId = null;
                await this.render(this.app.elements.pageContent, this.app, this.selectedDate);
                return;
            }

            // Validate file before sending
            if (!state.selectedFile.type.startsWith('image/')) {
                this.app.showToast('Выберите изображение', 'error');
                return;
            }

            // Show the blurred loading overlay synchronously to
            // eliminate UI jumping and lock the modal during the upload.
            const overlayState = Camera.showLoadingOverlay(modalEl);

            const notesInput = modalEl.querySelector('#new-meal-notes');
            const notes = notesInput ? notesInput.value.trim() || null : null;
            const token = this.app.state.tokens.access;

            const formData = new FormData();
            formData.append('file', state.selectedFile, state.selectedFile.name || 'photo.webp');
            formData.append('meal_type', state.selectedMealType);
            if (notes) formData.append('notes', notes);
            // The instant of the shot plus the device's offset: the server buckets
            // meals into the user's local days, and it can only do that if it is
            // told where local midnight is.
            for (const [key, value] of Object.entries(Camera.mealTimeFields())) {
                formData.append(key, value);
            }

            // The analysis takes tens of seconds, so the carousel gets its slot
            // before the request leaves; the id it scrolls to is only known once
            // the server (or the local queue) has answered.
            let newMealId = null;
            let uploadedOnline = false;
            this.showAnalyzingSkeleton();

            try {
                const response = await API.post('/nutrition/photos', formData, token, true);
                newMealId = response?.meal_id ?? null;
                uploadedOnline = Boolean(newMealId);
                this.app.showToast('Фото загружено, идёт анализ', 'success');
                // The sheet and its overlay stay up: the 201 only means the
                // background analysis started, not that it finished.
            } catch (error) {
                if (error?.isNetworkError || error?.offlineQueued) {
                    try {
                        newMealId = await Camera.queueOfflineMeal(state.selectedFile, notes, state.selectedMealType);
                        this.app.showToast('Нет связи. Фото сохранено локально и будет загружено при появлении связи', 'info');
                    } catch (qerr) {
                        console.error('[Nutrition] Offline queue failed:', qerr);
                        this.app.showToast(qerr?.message || 'Не удалось сохранить оффлайн', 'error');
                        newMealId = null;
                        uploadedOnline = false;
                    }
                } else {
                    console.error('[Nutrition] Upload error:', error);
                    this.app.showToast(error.data?.detail || error.message || 'Ошибка загрузки', 'error');
                }
            } finally {
                this.removeAnalyzingSkeleton();
                submitBtn.disabled = false;
                submitBtn.innerHTML = `
                    <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                    <span class="text-sm font-semibold">Отправить / Анализировать</span>
                `;
            }

            // The overlay stays up through the whole analysis: the meal status
            // is polled until the background task lands a terminal status, and
            // only then does the checkmark appear. An offline-queued meal has
            // nothing to poll yet - it syncs later - and a failed upload leaves
            // nothing to wait for.
            if (uploadedOnline) {
                const outcome = await Camera.pollMealAnalysisStatus(newMealId, token);
                if (outcome === 'completed') {
                    Camera.markLoadingComplete(overlayState.overlay);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                } else {
                    Camera.reportAnalysisOutcome(outcome, this.app);
                }
            }

            Camera.hideLoadingOverlay(overlayState);
            this.closeNewMealModal();

            // The reload brings the real card (pending, then analysed); the carousel only
            // knows its id once the render that produced it is done, so the target
            // is handed over instead of scrolled to here.
            this._scrollTargetMealId = newMealId;
            await this.render(this.app.elements.pageContent, this.app, this.selectedDate);
        } catch (err) {
            console.error('[Nutrition] handleNewMealSubmit error:', err);
            try { this.removeAnalyzingSkeleton(); } catch (_) {}
            const submitBtn = modalEl && modalEl.querySelector('#new-meal-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span class="text-sm font-semibold">Создать</span>';
            }
            try { Camera.hideLoadingOverlay(modalEl); } catch (_) {}
            this.app.showToast(err?.message || 'Не удалось сохранить блюдо', 'error');
        } finally {
            this._mealSubmitInFlight = false;
        }
    },

    /**
     * Claim a carousel slot for the meal being uploaded. The tile is inserted
     * after the add tile and scrolled to, so the wait happens on a card instead
     * of on a screen that does not react.
     */
    showAnalyzingSkeleton() {
        const carousel = this.app.elements.pageContent.querySelector('#meal-carousel');
        if (!carousel || carousel.querySelector('[data-meal-skeleton]')) return;

        const holder = document.createElement('div');
        holder.innerHTML = Components.mealCardAnalyzingSkeleton();
        const slot = holder.firstElementChild;
        if (!slot) return;

        // The add-meal action tile is always the first real slot (or the second
        // in the day view, right after the daily-summary slot); the new meal lands
        // immediately after it so it never appears between the recap and the
        // action card.
        const actionTile = carousel.querySelector('.meal-action-slot');
        carousel.insertBefore(slot, actionTile ? actionTile.nextElementSibling : (carousel.firstElementChild || null));
        this.scrollCarouselToSlot(slot);
    },

    /**
     * Drop the optimistic tile. It only lives until the next render, which
     * replaces the whole carousel, but an upload that failed without a reload
     * would otherwise leave a spinner behind forever.
     */
    removeAnalyzingSkeleton() {
        this.app.elements.pageContent.querySelector('#meal-carousel [data-meal-skeleton]')?.remove();
    },

    /** Centre a carousel slot without disturbing the rest of the layout. */
    scrollCarouselToSlot(slot, behavior = 'smooth') {
        const carousel = slot?.closest('.meal-carousel');
        if (!slot || !carousel) return;

        // Rect deltas rather than offsetLeft: the carousel is not a positioned
        // ancestor, so offsetLeft would be measured against a further ancestor.
        const carouselBox = carousel.getBoundingClientRect();
        const slotBox = slot.getBoundingClientRect();
        const centered = carousel.scrollLeft
            + (slotBox.left - carouselBox.left)
            - (carousel.clientWidth - slotBox.width) / 2;
        const max = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        const target = Math.max(0, Math.min(centered, max));

        if (typeof carousel.scrollTo === 'function') {
            carousel.scrollTo({ left: target, behavior });
        } else {
            carousel.scrollLeft = target;
        }
    },

    /**
     * Put the carousel where it belongs after a re-render.
     *
     * The carousel element is recreated by every render - including each poll
     * tick - so without this the user's place is lost every few seconds while a
     * meal is being analysed. A pending target (the meal just added, whose id
     * only the server knows) wins over the remembered offset and is consumed on
     * use, so it scrolls exactly once.
     */
    settleCarouselScroll(previousLeft) {
        const carousel = this.app.elements.pageContent.querySelector('#meal-carousel');
        if (!carousel) return;

        const targetId = this._scrollTargetMealId;
        this._scrollTargetMealId = null;
        if (targetId !== null && targetId !== undefined) {
            const slot = carousel.querySelector(`.meal-card-slot[data-meal-id="${targetId}"]`);
            if (slot) {
                this.scrollCarouselToSlot(slot);
                return;
            }
        }

        if (previousLeft === null || previousLeft === undefined || previousLeft === 0) {
            const addSlot = carousel.querySelector('.meal-action-slot');
            if (addSlot) {
                this.scrollCarouselToSlot(addSlot, 'instant');
                return;
            }
        }

        const max = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        carousel.scrollLeft = Math.max(0, Math.min(previousLeft || 0, max));
    },

    bindFailedItems() {
        const container = this.app.elements.pageContent;

        // Individual retry buttons for each failed sync item
        container.querySelectorAll('[data-action="retry-failed-sync-item"]').forEach((btn) => {
            btn.onclick = async () => {
                const itemId = btn.dataset.syncItemId;
                if (!itemId) return;
                btn.disabled = true;
                btn.innerHTML = `<svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                try {
                    // Reset the item status to PENDING so it gets picked up by processQueue
                    await DB.updateSyncQueue(Number(itemId), {
                        status: DB.SYNC_STATUS.PENDING,
                        retryCount: 0,
                        error: null,
                        updatedAt: Date.now(),
                    });
                    await SyncEngine.processQueue();
                } catch (e) {
                    console.error('[Nutrition] Retry failed sync item:', e);
                }
                this.app.renderPage('nutrition');
            };
        });

        // Individual delete buttons for each failed sync item
        container.querySelectorAll('[data-action="delete-failed-sync-item"]').forEach((btn) => {
            btn.onclick = async () => {
                const itemId = btn.dataset.syncItemId;
                if (!itemId) return;
                try {
                    await DB.deleteSyncQueue(Number(itemId));
                    // Also delete the local meal if it exists
                    const item = await DB.get('sync_queue', Number(itemId));
                    if (item?.tempId) {
                        await DB.deleteMeal(item.tempId);
                    }
                } catch (e) {
                    console.error('[Nutrition] Delete failed sync item:', e);
                }
                this.app.renderPage('nutrition');
            };
        });

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

    /**
     * Expand or collapse one composition list.
     *
     * The list attribute is the whole state: the CSS rules reveal the overflow
     * items and pick the control's wording, so no card content is rebuilt and
     * the carousel keeps its scroll position.
     */
    setCompositionExpanded(list, expanded) {
        if (!list) return;
        list.dataset.expanded = String(expanded);
        list.querySelectorAll('[data-composition-toggle]').forEach((toggle) => {
            toggle.setAttribute('aria-expanded', String(expanded));
        });
    },

    /**
     * Edit/delete handlers for every card action button. The meal card is one
     * monolithic block, so both handlers keep the default action intact and
     * only stop the click from bubbling any further.
     */
    bindMealActions() {
        const container = this.app.elements.pageContent;

        // Every render rebuilds the cards, the poll loop included, so an open
        // composition would snap shut while the user is reading it. The open
        // meal ids are restored right after the handlers are attached.
        container.querySelectorAll('[data-composition]').forEach((list) => {
            const mealId = list.closest('[data-meal-id]')?.dataset.mealId;
            if (mealId && this._expandedCompositions.has(String(mealId))) {
                this.setCompositionExpanded(list, true);
            }
        });

        container.querySelectorAll('[data-composition-toggle]').forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const list = btn.closest('[data-composition]');
                if (!list) return;
                const expanded = list.dataset.expanded !== 'true';
                this.setCompositionExpanded(list, expanded);

                const mealId = list.closest('[data-meal-id]')?.dataset.mealId;
                if (mealId) {
                    const id = String(mealId);
                    if (expanded) this._expandedCompositions.add(id);
                    else this._expandedCompositions.delete(id);
                }
            };
        });

        container.querySelectorAll('[data-action="edit-meal"]').forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const mealId = btn.dataset.mealId;
                this.openEditMealModal(mealId);
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

        container.querySelectorAll('[data-action="retry-analysis"]').forEach((btn) => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const mealId = btn.dataset.mealId;
                await this.retryMealAnalysis(mealId, btn);
            };
        });
    },

    async retryMealAnalysis(mealId, btnEl) {
        // NEW: Temp IDs can't retry analysis - not synced yet
        if (this.isTempMealId(mealId)) {
            this.app.showToast('Блюдо еще не синхронизировано. Дождитесь загрузки.', 'info');
            return;
        }

        const token = this.app.state.tokens.access;
        const disabled = (v) => {
            if (btnEl) {
                btnEl.disabled = v;
                btnEl.innerHTML = v
                    ? `${Components.mealActionIcon('retry')}<span class="animate-spin border-2 border-white/20 border-t-white rounded-full w-3 h-3"></span>`
                    : Components.mealActionIcon('retry');
            }
        };
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

    /**
     * Edit meal modal: bottom sheet pre-filled with the current meal data,
     * following the same drum-sheet open/close lifecycle as the new-meal sheet.
     */
    openEditMealModal(mealId) {
        if (this._editMealModalState || this._editMealModalClosing) return;

        const meal = this._mealsCache.get(String(mealId));
        if (!meal) {
            this.app.showToast('Не удалось загрузить данные блюда', 'error');
            return;
        }

        const modalHtml = Components.editMealModal(meal);
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        const modalEl = modalContainer.firstElementChild;
        document.body.appendChild(modalEl);

        this._editMealModalState = {
            modalEl,
            mealId,
            panelEl: modalEl.querySelector('.drum-sheet-panel'),
        };

        this._editMealModalState.bodyWasLocked = document.body.classList.contains('overflow-hidden');
        document.body.classList.add('overflow-hidden');

        this.bindEditMealModalEvents(modalEl, this._editMealModalState);
    },

    closeEditMealModal() {
        if (!this._editMealModalState) return;

        const { modalEl, panelEl, onKeydown, bodyWasLocked } = this._editMealModalState;
        this._editMealModalState = null;
        if (onKeydown) {
            document.removeEventListener('keydown', onKeydown);
        }
        if (!bodyWasLocked) {
            document.body.classList.remove('overflow-hidden');
        }

        panelEl?.classList.add('is-closing');
        modalEl.querySelector('.drum-sheet-backdrop')?.classList.add('is-closing');

        this._editMealModalClosing = modalEl;
        setTimeout(() => {
            modalEl.remove();
            if (this._editMealModalClosing === modalEl) {
                this._editMealModalClosing = null;
            }
        }, 220);
    },

    bindEditMealModalEvents(modalEl, state) {
        // Backdrop closes the sheet
        modalEl.querySelector('.drum-sheet-backdrop')?.addEventListener('click', () => {
            this.closeEditMealModal();
        });
        modalEl.querySelector('.drum-sheet-panel [data-action="close-edit-meal-modal"]')?.addEventListener('click', () => {
            this.closeEditMealModal();
        });

        // Escape key
        const onKeydown = (e) => {
            if (e.key === 'Escape') this.closeEditMealModal();
        };
        state.onKeydown = onKeydown;
        document.addEventListener('keydown', onKeydown);

        // Submit button
        modalEl.querySelector('[data-action="submit-edit-meal"]')?.addEventListener('click', () => {
            this.handleEditMealSubmit(modalEl, state);
        });
    },

    /**
     * Gather edited fields, PATCH the meal, then re-render so the card and the
     * daily summary ring/totals both update in place without a page reload.
     * Fields are always sent (null when blank) so clearing one drops the stored
     * value instead of leaving a stale figure.
     */
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

        const updateData = {
            dish_name: toTextOrNull(dishNameInput),
            calories: toNumOrNull(caloriesInput),
            protein_g: toNumOrNull(proteinInput),
            fat_g: toNumOrNull(fatInput),
            carbs_g: toNumOrNull(carbsInput),
            tags: tags.length > 0 ? tags : null,
            notes: toTextOrNull(notesInput),
        };

        const submitBtn = modalEl.querySelector('#edit-meal-submit');
        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
            <svg class="animate-spin w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <span class="text-sm font-semibold">Сохранение...</span>
        `;

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
    }
};