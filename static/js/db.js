console.log("[DEBUG] Loaded db.js");
const DB_NAME = 'mylofi-offline';
const DB_VERSION = 2;

let _db = null;

function generateTempId() {
    return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;

            // v1 store (already exists for upgraded users)
            if (!db.objectStoreNames.contains('pendingPhotos')) {
                db.createObjectStore('pendingPhotos', { keyPath: 'id', autoIncrement: true });
            }

            // v2 stores — created on first open or upgraded from v1
            if (oldVersion < 2) {
                if (!db.objectStoreNames.contains('templates')) {
                    const store = db.createObjectStore('templates', { keyPath: 'id' });
                    store.createIndex('updated_at', 'updated_at', { unique: false });
                    store.createIndex('sync_status', 'sync_status', { unique: false });
                }
                if (!db.objectStoreNames.contains('workouts')) {
                    const store = db.createObjectStore('workouts', { keyPath: 'id' });
                    store.createIndex('date', 'date', { unique: false });
                    store.createIndex('sync_status', 'sync_status', { unique: false });
                }
                if (!db.objectStoreNames.contains('meals')) {
                    const store = db.createObjectStore('meals', { keyPath: 'id' });
                    store.createIndex('eaten_at', 'eaten_at', { unique: false });
                    store.createIndex('sync_status', 'sync_status', { unique: false });
                }
                if (!db.objectStoreNames.contains('PRs')) {
                    const store = db.createObjectStore('PRs', { keyPath: 'id' });
                    store.createIndex('exercise_id', 'exercise_id', { unique: false });
                }
                if (!db.objectStoreNames.contains('sync_queue')) {
                    const store = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('status', 'status', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('exercise_catalog')) {
                    db.createObjectStore('exercise_catalog', { keyPath: 'id' });
                }
            }
        };

        request.onsuccess = () => {
            _db = request.result;
            _db.addEventListener('versionerror', (event) => {
                console.error('[DB] Version error:', event.target.error);
            });
            resolve(_db);
        };
        request.onerror = () => reject(request.error);
    });
}

function promisify(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

const SYNC_STATUS = { PENDING: 'pending', SYNCED: 'synced', FAILED: 'failed' };
const SYNC_METHODS = { POST: 'POST', PUT: 'PUT', DELETE: 'DELETE', PATCH: 'PATCH' };

export const DB = {
    name: DB_NAME,
    version: DB_VERSION,
    SYNC_STATUS,
    SYNC_METHODS,

    async init() {
        try {
            await openDB();
            console.log('[DB] Initialized', DB_NAME, 'v' + DB_VERSION);
        } catch (error) {
            console.error('[DB] Init failed:', error);
            throw error;
        }
    },

    get db() {
        return _db;
    },

    generateTempId,

    // ─── Generic helpers ───────────────────────────────────────────────
    async get(storeName, id) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readonly');
        return promisify(tx.objectStore(storeName).get(id));
    },

    async getAll(storeName) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readonly');
        return promisify(tx.objectStore(storeName).getAll());
    },

    async getByIndex(storeName, indexName, value) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readonly');
        return promisify(tx.objectStore(storeName).index(indexName).getAll(IDBKeyRange.only(value)));
    },

    async put(storeName, value) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readwrite');
        const result = await promisify(tx.objectStore(storeName).put(value));
        await txDone(tx);
        return result;
    },

    async add(storeName, value) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readwrite');
        const result = await promisify(tx.objectStore(storeName).add(value));
        await txDone(tx);
        return result;
    },

    async delete(storeName, id) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        await txDone(tx);
    },

    async clear(storeName) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        await txDone(tx);
    },

    async count(storeName) {
        const db = await openDB();
        const tx = db.transaction(storeName, 'readonly');
        return promisify(tx.objectStore(storeName).count());
    },

    // ─── Atomic mutation + queue write ────────────────────────────────
    // Writes a local record and enqueues a sync_queue entry in a single
    // transaction so the queue is always consistent with the local state.
    async atomicWrite(storeName, record, syncItem) {
        const db = await openDB();
        const tx = db.transaction([storeName, 'sync_queue'], 'readwrite');
        const store = tx.objectStore(storeName);
        const queue = tx.objectStore('sync_queue');

        if (record) store.put(record);
        if (syncItem) queue.add(this._normalizeSyncItem(syncItem));

        return txDone(tx);
    },

    _normalizeSyncItem(item) {
        return {
            endpoint: item.endpoint,
            method: item.method,
            payload: item.payload ?? item.data ?? null,
            formData: item.formData ?? null,
            isFormData: item.isFormData ?? Boolean(item.formData),
            tempId: item.tempId ?? null,
            store: item.store ?? null,
            accessToken: item.accessToken ?? null,
            offlineSessionKey: item.offlineSessionKey ?? null,
            status: item.status ?? SYNC_STATUS.PENDING,
            retryCount: item.retryCount ?? 0,
            error: item.error ?? null,
            createdAt: item.createdAt ?? Date.now(),
            updatedAt: item.updatedAt ?? Date.now(),
        };
    },

    // ─── Temp ID resolution ───────────────────────────────────────────
    // Replaces a temp_<...> id with the server-assigned id in the given store
    // and flips the sync_status. Related hooks can update foreign keys.
    async resolveTempId(storeName, tempId, realId) {
        if (!storeName || !tempId || realId === undefined || realId === null) return null;
        const record = await this.get(storeName, tempId);
        if (!record) return null;

        const updated = { ...record, id: realId, sync_status: SYNC_STATUS.SYNCED, updated_at: Date.now() };
        const db = await openDB();
        const tx = db.transaction([storeName, 'sync_queue'], 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(updated);

        // Best-effort: clear pending queue entries that reference this temp id
        const queueStore = tx.objectStore('sync_queue');
        const createdAtIdx = queueStore.index('createdAt');
        createdAtIdx.openCursor().onsuccess = function (event) {
            const cursor = event.target.result;
            if (!cursor) return;
            if (cursor.value.tempId === tempId && cursor.value.status === SYNC_STATUS.PENDING) {
                cursor.delete();
            }
            cursor.continue();
        };

        await txDone(tx);
        return updated;
    },

    // ─── pendingPhotos (legacy support) ───────────────────────────────
    async addPendingPhoto(photoData) {
        return this.add('pendingPhotos', {
            blob: photoData.blob,
            filename: photoData.filename,
            eatenAt: photoData.eatenAt,
            notes: photoData.notes,
            accessToken: photoData.accessToken,
            timestamp: Date.now(),
        });
    },

    async getAllPendingPhotos() {
        return this.getAll('pendingPhotos');
    },

    async deletePendingPhoto(id) {
        return this.delete('pendingPhotos', id);
    },

    // ─── sync_queue ───────────────────────────────────────────────────
    async addSyncQueue(item) {
        return this.add('sync_queue', this._normalizeSyncItem(item));
    },

    async getSyncQueuePending(limit = null) {
        const db = await openDB();
        const tx = db.transaction('sync_queue', 'readonly');
        const store = tx.objectStore('sync_queue');
        const index = store.index('status');
        let request;
        if (limit && limit > 0) {
            request = index.getAll(IDBKeyRange.only(SYNC_STATUS.PENDING), limit);
        } else {
            request = index.getAll(IDBKeyRange.only(SYNC_STATUS.PENDING));
        }
        const items = await promisify(request);
        return items.sort((a, b) => a.createdAt - b.createdAt);
    },

    async updateSyncQueue(id, updates) {
        const db = await openDB();
        const tx = db.transaction('sync_queue', 'readwrite');
        const store = tx.objectStore('sync_queue');
        const existing = await promisify(store.get(id));
        if (!existing) return;
        store.put({ ...existing, ...updates, updatedAt: Date.now() });
        await txDone(tx);
    },

    async deleteSyncQueue(id) {
        return this.delete('sync_queue', id);
    },

    async getSyncQueueFailed() {
        const db = await openDB();
        const tx = db.transaction('sync_queue', 'readonly');
        const index = tx.objectStore('sync_queue').index('status');
        return promisify(index.getAll(IDBKeyRange.only(SYNC_STATUS.FAILED)));
    },

    async clearSyncQueue() {
        return this.clear('sync_queue');
    },

    // ─── Meals ────────────────────────────────────────────────────────
    async saveMeal(meal) {
        const record = {
            ...meal,
            sync_status: meal.sync_status ?? SYNC_STATUS.PENDING,
            updated_at: meal.updated_at ?? Date.now(),
            eaten_at: meal.eaten_at ?? Date.now(),
        };
        return this.put('meals', record);
    },

    async getMeal(id) {
        return this.get('meals', id);
    },

    async getAllMeals() {
        return this.getAll('meals');
    },

    async getMealsByStatus(status) {
        return this.getByIndex('meals', 'sync_status', status);
    },

    async deleteMeal(id) {
        return this.delete('meals', id);
    },

    // ─── Workouts ─────────────────────────────────────────────────────
    async saveWorkout(session) {
        const record = {
            ...session,
            sync_status: session.sync_status ?? SYNC_STATUS.PENDING,
            updated_at: session.updated_at ?? Date.now(),
            date: session.date ?? session.started_at ?? Date.now(),
        };
        return this.put('workouts', record);
    },

    async getWorkout(id) {
        return this.get('workouts', id);
    },

    async getAllWorkouts() {
        return this.getAll('workouts');
    },

    async getWorkoutsByStatus(status) {
        return this.getByIndex('workouts', 'sync_status', status);
    },

    async deleteWorkout(id) {
        return this.delete('workouts', id);
    },

    // ─── Templates ────────────────────────────────────────────────────
    async saveTemplate(template) {
        const record = {
            ...template,
            sync_status: template.sync_status ?? SYNC_STATUS.PENDING,
            updated_at: template.updated_at ?? Date.now(),
        };
        return this.put('templates', record);
    },

    async getTemplate(id) {
        return this.get('templates', id);
    },

    async getAllTemplates() {
        return this.getAll('templates');
    },

    async getTemplatesByStatus(status) {
        return this.getByIndex('templates', 'sync_status', status);
    },

    async deleteTemplate(id) {
        return this.delete('templates', id);
    },

    // ─── PRs (Personal Records) ───────────────────────────────────────
    async savePR(pr) {
        const record = {
            ...pr,
            updated_at: pr.updated_at ?? Date.now(),
        };
        return this.put('PRs', record);
    },

    async getPR(id) {
        return this.get('PRs', id);
    },

    async getAllPRs() {
        return this.getAll('PRs');
    },

    async getPRsByExercise(exerciseId) {
        return this.getByIndex('PRs', 'exercise_id', exerciseId);
    },

    async deletePR(id) {
        return this.delete('PRs', id);
    },

    // ─── Exercise catalog (offline cache) ───────────────────────────────
    async saveExerciseCatalog(exercises) {
        if (!Array.isArray(exercises)) return;
        const db = await openDB();
        const tx = db.transaction('exercise_catalog', 'readwrite');
        const store = tx.objectStore('exercise_catalog');
        const now = Date.now();
        for (const ex of exercises) {
            if (ex && ex.id != null && ex.id !== '__meta__') {
                store.put({ ...ex, _cached_at: now });
            }
        }
        await txDone(tx);
    },

    async saveExerciseCatalogMeta(meta) {
        if (!meta || typeof meta !== 'object') return;
        return this.put('exercise_catalog', { id: '__meta__', ...meta, _cached_at: Date.now() });
    },

    async getExerciseCatalogMeta() {
        return this.get('exercise_catalog', '__meta__');
    },

    async getExerciseCatalog() {
        const all = await this.getAll('exercise_catalog');
        return (all || []).filter(item => item && item.id !== '__meta__');
    },

    async getExerciseCatalogCount() {
        const items = await this.getExerciseCatalog();
        return items.length;
    },
};

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
