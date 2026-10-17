console.log("[DEBUG] Loaded sync.js");
import { DB } from './db.js';

const SYNC_TAG = 'mylofi-sync';
const MAX_RETRIES = 5;

function isTransientError(error) {
    if (error?.isNetworkError) return true;
    if (!error?.status) return true;
    if (error.status >= 500) return true;
    if (error.status === 408 || error.status === 429) return true;
    return false;
}

export const SyncEngine = {
    replayFn: null,
    itemResolver: null,
    onItemSynced: null,
    onOnline: null,
    processing: false,
    initialized: false,

    init(opts = {}) {
        if (this.initialized) return;
        this.initialized = true;
        this.replayFn = opts.replayFn || null;
        this.itemResolver = opts.itemResolver || null;
        this.onItemSynced = opts.onItemSynced || null;
        this.onOnline = opts.onOnline || null;

        window.addEventListener('online', () => {
            console.log('[SyncEngine] Online event — scheduling queue flush');
            this.processQueue().catch((error) => console.error('[SyncEngine] processQueue error:', error));
            if (typeof this.onOnline === 'function') this.onOnline();
        });

        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then((registration) => {
                return registration.sync.register(SYNC_TAG);
            }).catch((error) => {
                console.warn('[SyncEngine] Background sync registration failed:', error);
            });
        }

        this.migrateLocalStorageQueue();

        console.log('[SyncEngine] Initialized');
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

        if (navigator.onLine && !this.processing) {
            setTimeout(() => this.processQueue().catch(() => {}), 0);
        }

        return item;
    },

    async enqueuePhotoUpload(endpoint, fileBlob, filename, meta, accessToken, options = {}) {
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
        if (this.processing) {
            console.log('[SyncEngine] Already processing, skipping');
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

        this.processing = true;
        let synced = 0;

        try {
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
                if (!failed) {
                    await DB.deleteSyncQueue(item.id);
                }

                // General temp-id → real-id translation for POST/PUT responses
                if (!failed && this.isMutableCreate(item) && response && response.id && item.tempId && item.store) {
                    try {
                        await DB.resolveTempId(item.store, item.tempId, response.id);
                    } catch (mappingError) {
                        console.error('[SyncEngine] Temp ID resolution failed:', mappingError);
                    }
                }

                if (typeof this.onItemSynced === 'function') {
                    try {
                        await this.onItemSynced(item, failed ? null : response, { failed });
                    } catch (hookError) {
                        console.error('[SyncEngine] Post-sync hook failed:', hookError);
                    }
                }

                synced += 1;
            }

            if (synced > 0) {
                console.log(`[SyncEngine] Queue synced: ${synced} item(s)`);
                const app = window.App;
                if (typeof app?.showToast === 'function') {
                    app.showToast(`Синхронизировано изменений: ${synced}`, 'success');
                }
                window.dispatchEvent(new CustomEvent('mylofi:offline-sync', { detail: { synced } }));
            }

            return synced > 0;
        } finally {
            this.processing = false;
        }
    },

    isMutableCreate(item) {
        return item && (item.method === 'POST' || item.method === 'PUT') && Boolean(item.store);
    },

    async getFailedItems() {
        return DB.getSyncQueueFailed();
    },

    async clearQueue() {
        return DB.clearSyncQueue();
    },
};
