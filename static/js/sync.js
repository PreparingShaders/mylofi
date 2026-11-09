console.log("[DEBUG] Loaded sync.js");
import { DB } from './db.js';

const SYNC_TAG = 'mylofi-sync';
const MAX_RETRIES = 3;
const SYNC_TTL_MS = 6 * 60 * 60 * 1000;
const PERIODIC_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

async function generatePhotoHash(blob) {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function isTransientError(error) {
    if (error?.isNetworkError) return true;
    if (!error?.status) return true;
    if (error.status >= 500) return true;
    if (error.status === 408 || error.status === 429) return true;
    return false;
}

/**
 * Auth errors (401/403) are never transient: retrying the same expired
 * token just produces the same 401 again. When a queued item fails
 * with an auth error the caller has already failed to refresh, so the
 * queue must halt entirely and the session must be invalidated.
 */
function isAuthError(error) {
    if (!error) return false;
    if (error?.authInvalidated) return true;
    const status = error.status;
    return status === 401 || status === 403;
}

/**
 * Infrastructure / auth endpoints that must never be queued for retry and
 * must never appear in the sync-errors UI. Retrying them with a stale token
 * just produces the same 401, and they carry no user-facing action.
 */
const INFRA_ENDPOINTS = new Set([
    '/auth/refresh',
    '/auth/login',
    '/auth/register',
    '/auth/verify-register',
    '/auth/resend-code',
    '/auth/forgot-password',
    '/auth/verify-reset-code',
    '/auth/reset-password',
    '/auth/logout',
    '/auth/logout-all',
    '/health',
]);

function isInfrastructureEndpoint(endpoint) {
    if (!endpoint) return false;
    const normalized = String(endpoint).replace(/\?.*$/, '');
    return INFRA_ENDPOINTS.has(normalized);
}

/**
 * User-friendly labels for actionable sync endpoints shown in the error UI.
 * Endpoints not listed here fall back to their path with the leading slash
 * stripped.
 */
const FRIENDLY_ENDPOINT_LABELS = {
    '/nutrition/photos': 'Фото еды',
    '/nutrition/meals': 'Продукты',
    '/workouts/sessions': 'Тренировка',
    '/workouts/templates': 'Шаблон тренировки',
    '/users/me': 'Профиль',
};

function getFriendlyEndpointLabel(endpoint) {
    if (!endpoint) return 'Запрос';
    const normalized = String(endpoint).replace(/\?.*$/, '');
    return FRIENDLY_ENDPOINT_LABELS[normalized] || normalized.replace(/^\//, '') || 'Запрос';
}

export const SyncEngine = {
    replayFn: null,
    itemResolver: null,
    onItemSynced: null,
    onOnline: null,
    initialized: false,
    authFailed: false,
    authFailedPromise: null,
    _processingMutex: Promise.resolve(),
    _periodicCleanupTimer: null,
    _visibilityCleanupBound: null,

    /**
     * Reject a pending auth-failed promise so any caller awaiting queue
     * processing receives the auth error instead of hanging or retrying.
     */
    _rejectAuthFailed(error) {
        this.authFailed = true;
        if (this.authFailedPromise) {
            const { reject } = this.authFailedPromise;
            this.authFailedPromise = null;
            reject(error);
        }
    },

    /**
     * Signal that the auth session is invalid and no queued mutation can
     * succeed. App code calls this when token refresh fails with 401.
     */
    signalAuthFailure(error) {
        if (this.authFailed) return;
        const authError = error || new Error('Сессия истекла. Пожалуйста, войдите снова.');
        authError.status = authError.status || 401;
        authError.authInvalidated = true;
        this._rejectAuthFailed(authError);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('mylofi:auth-failed', { detail: { error: authError.message } }));
        }
    },

    /**
     * Clear the auth-failed flag so the queue can resume processing.
     * Called when a new login or token refresh succeeds.
     */
    clearAuthFailure() {
        if (!this.authFailed) return;
        console.log('[SyncEngine] Clearing auth-failed flag');
        this.authFailed = false;
        this.authFailedPromise = null;
    },

    isPhotoUpload(item) {
        return item && item.endpoint === '/nutrition/photos' && item.method === 'POST' && item.isFormData;
    },

    async _waitForPhotoAnalysisAndComplete(item, response) {
        const mealId = response?.id ?? response?.meal_id;
        if (!mealId) {
            console.error('[SyncEngine] No mealId in photo upload response, marking failed');
            await DB.updateSyncQueue(item.id, {
                status: DB.SYNC_STATUS.FAILED,
                error: 'no meal_id in response',
                updatedAt: Date.now(),
            });
            if (typeof this.onItemSynced === 'function') {
                await this.onItemSynced(item, null, { failed: true });
            }
            return;
        }

        try {
            // Wait for analysis completion using Camera's poll mechanism
            const Camera = window.Camera || (await import('./camera.js')).Camera;
            const accessToken = item.accessToken || window.App?.state?.tokens?.access;
            
            if (!accessToken) {
                throw new Error('No access token for analysis polling');
            }

            const outcome = await Camera.pollMealAnalysisStatus(mealId, accessToken);
            
            if (outcome === 'completed') {
                // Analysis succeeded - now delete queue item and fire onItemSynced
                await DB.deleteSyncQueue(item.id);
                
                // Temp ID resolution
                if (this.isMutableCreate(item) && item.tempId && item.store) {
                    try {
                        await DB.resolveTempId(item.store, item.tempId, mealId);
                    } catch (mappingError) {
                        console.error('[SyncEngine] Temp ID resolution failed:', mappingError);
                    }
                }

                if (typeof this.onItemSynced === 'function') {
                    await this.onItemSynced(item, response, { failed: false });
                }
                
                console.log('[SyncEngine] Photo analysis completed, sync finalized:', item.id);
                
                // Trigger UI refresh
                window.dispatchEvent(new CustomEvent('mylofi:offline-sync', { detail: { synced: 1 } }));
                window.dispatchEvent(new CustomEvent('mylofi:sync-completed', { detail: { syncedCount: 1 } }));
                
                const app = window.App;
                if (app?.state?.currentScreen === 'main' && app?.state?.currentPage === 'nutrition') {
                    if (typeof app.renderPage === 'function') {
                        await app.renderPage('nutrition');
                    }
                }
            } else {
                // Analysis failed/timed out - keep item in queue for retry
                await DB.updateSyncQueue(item.id, {
                    status: DB.SYNC_STATUS.PENDING,  // Back to pending for retry
                    retryCount: (item.retryCount || 0) + 1,
                    error: `analysis ${outcome}`,
                    updatedAt: Date.now(),
                });
                console.warn('[SyncEngine] Photo analysis failed, re-queuing:', item.id, outcome);
            }
        } catch (error) {
            console.error('[SyncEngine] Error waiting for photo analysis:', error);
            // On error, mark as failed but keep for manual retry
            await DB.updateSyncQueue(item.id, {
                status: DB.SYNC_STATUS.FAILED,
                error: error?.message || 'analysis wait error',
                updatedAt: Date.now(),
            });
        }
    },

    init(opts = {}) {
        if (this.initialized) return;
        this.initialized = true;
        this.replayFn = opts.replayFn || null;
        this.itemResolver = opts.itemResolver || null;
        this.onItemSynced = opts.onItemSynced || null;
        this.onOnline = opts.onOnline || null;

        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then((registration) => {
                return registration.sync.register(SYNC_TAG);
            }).catch((error) => {
                console.warn('[SyncEngine] Background sync registration failed:', error);
            });
        }

        this.migrateLocalStorageQueue();

        this.purgeStaleItems().catch((e) => console.warn('[SyncEngine] purgeStaleItems failed:', e));

        this._startPeriodicCleanup();
        this._setupVisibilityCleanup();

        // A successful login or token refresh clears the auth-failed flag
        // so the queue can resume on the next online/resume event.
        window.addEventListener('auth:logged-in', () => {
            if (this.authFailed) {
                console.log('[SyncEngine] Auth resolved, clearing auth-failed flag');
                this.clearAuthFailure();
            }
        });

        console.log('[SyncEngine] Initialized');
    },

    isReady() {
        return this.initialized && typeof this.replayFn === 'function';
    },

    _startPeriodicCleanup() {
        if (this._periodicCleanupTimer) return;
        this._periodicCleanupTimer = setInterval(() => {
            if (navigator.onLine) {
                this.purgeStaleItems().catch((e) => console.warn('[SyncEngine] periodic purgeStaleItems failed:', e));
            }
        }, PERIODIC_CLEANUP_INTERVAL_MS);
    },

    _stopPeriodicCleanup() {
        if (this._periodicCleanupTimer) {
            clearInterval(this._periodicCleanupTimer);
            this._periodicCleanupTimer = null;
        }
    },

    _setupVisibilityCleanup() {
        if (this._visibilityCleanupBound) return;
        this._visibilityCleanupBound = () => {
            if (!document.hidden && navigator.onLine) {
                this.purgeStaleItems().catch((e) => console.warn('[SyncEngine] visibility purgeStaleItems failed:', e));
            }
        };
        document.addEventListener('visibilitychange', this._visibilityCleanupBound);
    },

    async migrateLocalStorageQueue() {
        try {
            const raw = localStorage.getItem('offline_sync_queue');
            if (!raw) return;
            const items = JSON.parse(raw);
            if (!Array.isArray(items) || !items.length) {
                localStorage.removeItem('offline_sync_queue');
                return;
            }
            await DB.init();
            let migrated = 0;
            for (const item of items) {
                if (item && item.method && item.endpoint) {
                    await DB.addSyncQueue({
                        endpoint: item.endpoint,
                        method: item.method,
                        payload: item.data ?? null,
                        formData: item.formData ?? null,
                        isFormData: Boolean(item.formData),
                        tempId: item.tempId ?? item.id ?? null,
                        store: item.store ?? null,
                        accessToken: item.accessToken ?? null,
                        offlineSessionKey: item.offlineSessionKey ?? null,
                        status: DB.SYNC_STATUS.PENDING,
                        retryCount: 0,
                        error: null,
                        createdAt: item.queuedAt ? new Date(item.queuedAt).getTime() : Date.now(),
                        updatedAt: Date.now(),
                    });
                    migrated += 1;
                }
            }
            if (migrated > 0) {
                console.log(`[SyncEngine] Migrated ${migrated} offline queue item(s) from LocalStorage to IndexedDB`);
            }
            localStorage.removeItem('offline_sync_queue');
        } catch (error) {
            console.warn('[SyncEngine] Migration of LocalStorage queue failed:', error);
        }
    },

    setReplayFn(fn) {
        this.replayFn = typeof fn === 'function' ? fn : null;
    },

    setHooks(opts = {}) {
        if (opts.itemResolver !== undefined) this.itemResolver = opts.itemResolver;
        if (opts.onItemSynced !== undefined) this.onItemSynced = opts.onItemSynced;
        if (opts.onOnline !== undefined) this.onOnline = opts.onOnline;
    },

    generateTempId() {
        return DB.generateTempId();
    },

    // Persist a mutation to the sync_queue. `entry.payload` is the JSON body;
    // `entry.formData` is a plain object (with Blob values) replayed as FormData.
    async enqueue(entry) {
        // Infrastructure / auth endpoints must never enter the sync queue:
        // retrying them with a stale token only produces the same 401, and
        // they carry no user-facing action worth surfacing in the error UI.
        if (isInfrastructureEndpoint(entry.endpoint)) {
            console.log(`[SyncEngine] Skipping infrastructure endpoint: ${entry.endpoint}`);
            return null;
        }

        const item = {
            endpoint: entry.endpoint,
            method: entry.method,
            payload: entry.payload ?? entry.data ?? null,
            formData: entry.formData ?? null,
            isFormData: entry.isFormData || Boolean(entry.formData),
            tempId: entry.tempId ?? null,
            store: entry.store ?? null,
            accessToken: entry.accessToken ?? null,
            offlineSessionKey: entry.offlineSessionKey ?? null,
            status: DB.SYNC_STATUS.PENDING,
            retryCount: 0,
            error: null,
            createdAt: entry.createdAt ?? Date.now(),
            updatedAt: entry.updatedAt ?? Date.now(),
            photoHash: entry.photoHash ?? null,
        };

        if (entry.prepend) {
            item.createdAt = Date.now() - 1000;
        }

        await DB.addSyncQueue(item);

        if (item.tempId) {
            console.log(`[SyncEngine] Enqueued ${entry.method} ${entry.endpoint} (tempId=${item.tempId})`);
        } else {
            console.log(`[SyncEngine] Enqueued ${entry.method} ${entry.endpoint}`);
        }

        return item;
    },

    async enqueuePhotoUpload(endpoint, fileBlob, filename, meta, accessToken, options = {}) {
        const photoHash = await generatePhotoHash(fileBlob);
        const existing = await DB.getSyncQueueByPhotoHash(photoHash, endpoint);
        if (existing && existing.length > 0) {
            const pendingItem = existing.find(item => item.status === DB.SYNC_STATUS.PENDING);
            if (pendingItem) {
                console.log(`[SyncEngine] Duplicate photo detected (hash=${photoHash.slice(0, 16)}...), updating existing queue item ${pendingItem.id}`);
                await DB.updateSyncQueue(pendingItem.id, {
                    formData: {
                        blob: fileBlob,
                        filename: filename || 'photo.webp',
                        fields: meta || {},
                    },
                    accessToken,
                    tempId: options.tempId ?? null,
                    store: options.store ?? null,
                    updatedAt: Date.now(),
                });
                return pendingItem;
            }
        }

        return this.enqueue({
            endpoint,
            method: 'POST',
            formData: {
                blob: fileBlob,
                filename: filename || 'photo.webp',
                fields: meta || {},
            },
            isFormData: true,
            accessToken,
            tempId: options.tempId ?? null,
            store: options.store ?? null,
            prepend: options.prepend || false,
            photoHash,
        });
    },

    async getPendingItems() {
        return DB.getSyncQueuePending();
    },

    async getPendingCount() {
        await DB.init();
        const db = DB.db;
        return new Promise((resolve, reject) => {
            const tx = db.transaction('sync_queue', 'readonly');
            const index = tx.objectStore('sync_queue').index('status');
            const request = index.count(DB.SYNC_STATUS.PENDING);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async markQueued(endpoint, method, updates) {
        const items = await DB.getSyncQueuePending();
        for (let i = items.length - 1; i >= 0; i -= 1) {
            if (items[i].endpoint === endpoint && (items[i].method === method)) {
                await DB.updateSyncQueue(items[i].id, updates);
                return items[i];
            }
        }
        return null;
    },

    async resolveTempId(storeName, tempId, realId) {
        return DB.resolveTempId(storeName, tempId, realId);
    },

    async processQueue() {
        if (this.authFailed) {
            console.log('[SyncEngine] Auth session invalid, aborting queue processing');
            return false;
        }
        // Validate tokens before flushing: a cold start or resume with no
        // access token must not replay queued mutations against the server.
        const hasToken = typeof window !== 'undefined'
            && Boolean(window.App?.state?.tokens?.access);
        if (!hasToken) {
            console.log('[SyncEngine] No access token, skipping queue processing');
            return false;
        }
        if (!navigator.onLine) {
            console.log('[SyncEngine] Still offline, skipping queue processing');
            return false;
        }
        if (typeof this.replayFn !== 'function') {
            console.warn('[SyncEngine] No replayFn registered — cannot process queue');
            return false;
        }

        // Promise-based mutex to serialize concurrent processQueue calls
        const currentRun = this._processingMutex.then(async () => {
            let synced = 0;

            try {
                await this.purgeStaleItems().catch(() => {});
                for (;;) {
                    const items = await DB.getSyncQueuePending(1);
                    if (!items.length) {
                        break;
                    }

                    let item = items[0];

                    // Allow callers to rewrite items that depend on not-yet-synced
                    // state (e.g. a local session whose real server id is unknown).
                    if (typeof this.itemResolver === 'function') {
                        try {
                            const resolved = this.itemResolver(item);
                            if (resolved === false) {
                                console.warn('[SyncEngine] Queued item not ready for replay, keeping queue intact');
                                break;
                            }
                            if (resolved && resolved !== item) {
                                item = resolved;
                                await DB.updateSyncQueue(item.id, {
                                    endpoint: item.endpoint,
                                    method: item.method,
                                    payload: item.payload,
                                    formData: item.formData,
                                    isFormData: item.isFormData,
                                    tempId: item.tempId,
                                    store: item.store,
                                    accessToken: item.accessToken,
                                    offlineSessionKey: item.offlineSessionKey,
                                });
                            }
                        } catch (resolveError) {
                            console.error('[SyncEngine] itemResolver error:', resolveError);
                        }
                    }

                    let response = null;
                    let failed = false;

                    try {
                        response = await this.replayFn(item);
                    } catch (error) {
                        // Auth errors (401/403 after refresh attempt) are terminal:
                        // every remaining item will fail the same way. Halt the
                        // loop immediately and signal the app to sign out.
                        if (isAuthError(error)) {
                            console.error('[SyncEngine] Auth failure during queue replay, halting:', error);
                            await DB.updateSyncQueue(item.id, {
                                status: DB.SYNC_STATUS.FAILED,
                                error: error?.message || 'auth failure',
                                updatedAt: Date.now(),
                            });
                            this.signalAuthFailure(error);
                            break;
                        }

                        if (isTransientError(error)) {
                            const newRetryCount = item.retryCount + 1;
                            if (newRetryCount >= MAX_RETRIES) {
                                failed = true;
                                await DB.updateSyncQueue(item.id, {
                                    status: DB.SYNC_STATUS.FAILED,
                                    retryCount: newRetryCount,
                                    error: error?.message || 'max retries exceeded',
                                    updatedAt: Date.now(),
                                });
                                console.error('[SyncEngine] Max retries exceeded, marking failed:', item, error);
                            } else {
                                await DB.updateSyncQueue(item.id, {
                                    retryCount: newRetryCount,
                                    error: error?.message || 'transient error',
                                    updatedAt: Date.now(),
                                });
                                console.warn('[SyncEngine] Replay deferred (transient):', error?.message || error);
                                break;
                            }
                        } else {
                            failed = true;
                            await DB.updateSyncQueue(item.id, {
                                status: DB.SYNC_STATUS.FAILED,
                                error: error?.message || 'permanent failure',
                                updatedAt: Date.now(),
                            });
                            console.error('[SyncEngine] Permanently failed queued request:', item, error);
                        }
                    }

                    // Delete on success; retain FAILED items for inspection/retry.
                    // EXCEPTION: Photo uploads must wait for analysis completion before deletion.
                    if (!failed) {
                        if (this.isPhotoUpload(item)) {
                            // Mark as uploaded, awaiting analysis completion
                            await DB.updateSyncQueue(item.id, {
                                status: DB.SYNC_STATUS.UPLOADED_AWAITING_ANALYSIS,
                                mealId: response?.id ?? response?.meal_id ?? null,
                                updatedAt: Date.now(),
                            });
                            console.log('[SyncEngine] Photo uploaded, awaiting analysis completion:', item.id);
                            // Do NOT call onItemSynced yet - will be called after analysis completes
                            // Do NOT increment synced counter yet
                        } else {
                            await DB.deleteSyncQueue(item.id);
                            // Verify deletion
                            const deleted = await DB.get('sync_queue', item.id);
                            if (deleted) {
                                console.warn('[SyncEngine] Item still exists after sync deletion:', item.id);
                            }
                            
                            // General temp-id → real-id translation for POST/PUT responses
                            if (this.isMutableCreate(item) && response && response.id && item.tempId && item.store) {
                                try {
                                    await DB.resolveTempId(item.store, item.tempId, response.id);
                                } catch (mappingError) {
                                    console.error('[SyncEngine] Temp ID resolution failed:', mappingError);
                                }
                            }

                            if (typeof this.onItemSynced === 'function') {
                                try {
                                    await this.onItemSynced(item, response, { failed: false });
                                } catch (hookError) {
                                    console.error('[SyncEngine] Post-sync hook failed:', hookError);
                                }
                            }
                            
                            synced += 1;
                        }
                    }

                    // For photo uploads, wait for analysis completion before finalizing
                    if (!failed && this.isPhotoUpload(item)) {
                        // Don't increment synced yet, don't call onItemSynced yet
                        // Fire and forget the analysis wait
                        this._waitForPhotoAnalysisAndComplete(item, response).catch(e => {
                            console.error('[SyncEngine] Analysis wait crashed:', e);
                        });
                        // Continue to next item - this one is "in progress"
                        continue;
                    }
                }

                if (synced > 0) {
                    console.log(`[SyncEngine] Queue synced: ${synced} item(s)`);
                    const app = window.App;
                    if (typeof app?.showToast === 'function') {
                        app.showToast(`Синхронизировано изменений: ${synced}`, 'success');
                    }
                    window.dispatchEvent(new CustomEvent('mylofi:offline-sync', { detail: { synced } }));
                    window.dispatchEvent(new CustomEvent('mylofi:sync-completed', { detail: { syncedCount: synced } }));
                    try {
                        if (app?.state?.currentScreen === 'main' && app?.state?.currentPage === 'nutrition') {
                            if (typeof app.renderPage === 'function') {
                                await app.renderPage('nutrition');
                            }
                        }
                    } catch (e) {
                        console.error('[SyncEngine] Direct nutrition refresh failed:', e);
                    }
                }

                return synced > 0;
            } finally {
                // Mutex is released when this promise resolves
            }
        });

        // Chain the mutex so the next call waits for this one to complete
        this._processingMutex = currentRun.catch(() => {}); // catch to avoid unhandled rejection
        return currentRun;
    },

    isMutableCreate(item) {
        return item && (item.method === 'POST' || item.method === 'PUT') && Boolean(item.store);
    },

    async purgeStaleItems() {
        await DB.init();
        const items = await DB.getAll('sync_queue');
        const now = Date.now();
        for (const item of items || []) {
            // Skip items awaiting photo analysis - they have a longer expected lifetime
            if (item.status === DB.SYNC_STATUS.UPLOADED_AWAITING_ANALYSIS) {
                continue;
            }
            const stale = !item.createdAt || (now - item.createdAt > SYNC_TTL_MS);
            const stuck = (item.retryCount ?? 0) >= MAX_RETRIES;
            if (stale || stuck) {
                try { await DB.deleteSyncQueue(item.id); } catch (e) { console.warn('[SyncEngine] purge delete failed:', e); }
            }
        }
    },

    async getFailedItems() {
        const items = await DB.getSyncQueueFailed();
        const now = Date.now();
        const actionable = [];
        for (const item of items) {
            const stale = !item.createdAt || (now - item.createdAt > SYNC_TTL_MS);
            if (isInfrastructureEndpoint(item.endpoint) || stale) {
                await DB.deleteSyncQueue(item.id);
                console.log(`[SyncEngine] Auto-purged stale/system error: ${item.endpoint}`);
            } else {
                actionable.push(item);
            }
        }
        return actionable;
    },

    async clearQueue() {
        return DB.clearSyncQueue();
    },
};

export { isInfrastructureEndpoint, getFriendlyEndpointLabel };
