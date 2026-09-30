const SHELL_CACHE = 'mylofi-shell-v12';
const RUNTIME_CACHE = 'mylofi-runtime-v12';
const CATALOG_CACHE = 'mylofi-catalog-v12';
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE, CATALOG_CACHE];

const OFFLINE_FALLBACK_HTML = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mylofi — офлайн</title><link rel="stylesheet" href="/static/css/styles.css"></head><body><div class="min-h-screen flex items-center justify-center p-4"><div class="text-center"><h1 class="text-2xl font-bold mb-2">Офлайн</h1><p class="text-surface-500">Проверьте подключение к интернету. Данные, сохранённые локально, будут синхронизированы при возвращении связи.</p></div></div></body></html>';

function offlineResponse() {
    return new Response(OFFLINE_FALLBACK_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

const SHELL_ASSETS = [
    '/',
    '/static/index.html',
    '/static/manifest.json',
    '/static/css/styles.css',
    '/static/js/app.js',
    '/static/js/api.js',
    '/static/js/auth.js',
    '/static/js/camera.js',
    '/static/js/components.js',
    '/static/js/db.js',
    '/static/js/network.js',
    '/static/js/sync.js',
    '/static/js/nutrition.js',
    '/static/js/profile.js',
    '/static/js/theme.js',
    '/static/js/utils.js',
    '/static/js/workouts.js',
    '/static/icons/icon-128.png',
    '/static/icons/icon-152.png',
    '/static/icons/icon-192.png',
    '/static/icons/icon-384.png',
    '/static/icons/icon-512.png',
    '/static/icons/apple-touch-icon.png',
];

// Reference / catalog endpoints are served stale-while-revalidate so the
// exercise picker and macro reference stay usable offline.
const CATALOG_PATHS = new Set([
    '/api/v1/workouts/exercises',
    '/api/v1/workouts/exercises/meta',
]);

// Cross-origin resources (Tailwind CDN, Google Fonts) are cached at runtime only,
// so a failed precache of the CDN never blocks the app shell install.
const RUNTIME_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await Promise.all(SHELL_ASSETS.map(async (asset) => {
            try {
                await cache.add(new Request(asset, { cache: 'reload' }));
            } catch (error) {
                console.warn('[SW] Shell asset failed to precache:', asset, error);
            }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name.startsWith('mylofi-') && !CURRENT_CACHES.includes(name))
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data?.type === 'TRIGGER_SYNC') {
        event.waitUntil(syncPendingPhotos().then(() => syncQueueItems()));
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
        if (CATALOG_PATHS.has(url.pathname)) {
            event.respondWith(staleWhileRevalidate(request, CATALOG_CACHE));
        } else {
            event.respondWith(networkFirst(request, RUNTIME_CACHE));
        }
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request));
        return;
    }

    if (url.origin === self.location.origin && url.pathname.startsWith('/static/')) {
        event.respondWith(cacheFirst(request, SHELL_CACHE, true));
        return;
    }

    // Meal photos: cache-first with background revalidation so previously
    // loaded dishes stay visible offline.
    if (url.origin === self.location.origin && url.pathname.startsWith('/uploads/')) {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
        return;
    }

    if (RUNTIME_HOSTS.includes(url.hostname)) {
        event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    }
});

async function handleNavigation(request) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true })
        || await cache.match('/static/index.html', { ignoreSearch: true })
        || await cache.match('/', { ignoreSearch: true });

    // The shell is served instantly from cache; the network copy refreshes in background
    const network = fetch(request)
        .then((response) => {
            if (response && response.ok) {
                cache.put('/static/index.html', response.clone());
            }
            return response;
        })
        .catch((error) => {
            console.warn('[SW] Navigation request failed, serving shell from cache:', error);
            return cached;
        });

    if (cached) {
        network.catch(() => {});
        return cached;
    }
    return network.then(response => response || offlineResponse());
}

async function cacheFirst(request, cacheName, ignoreSearch) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreSearch });
    if (cached) {
        revalidate(cache, request);
        return cached;
    }
    try {
        const response = await fetch(request);
        if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const fallback = await cache.match(request, { ignoreSearch: true });
        if (fallback) return fallback;
        throw error;
    }
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        // Only cache successful responses — never cache 4xx/5xx errors
        if (response && response.ok && response.type !== 'opaque') {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) {
            console.warn('[SW] Serving cached API response (network down):', request.url);
            return cached;
        }
        throw error;
    }
}

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        revalidate(cache, request);
        return cached;
    }
    try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        console.warn('[SW] Network failed for runtime asset, no cache available:', request.url, error);
    }
}

function revalidate(cache, request) {
    fetch(request)
        .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
        })
        .catch(() => {});
}

const SYNC_TAG = 'mylofi-sync';

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-photos' || event.tag === SYNC_TAG) {
        event.waitUntil(syncPendingPhotos().then(() => syncQueueItems()));
    }
});

async function syncPendingPhotos() {
    try {
        const db = await openIndexedDB();
        const tx = db.transaction('pendingPhotos', 'readonly');
        const photos = await getAll(tx.objectStore('pendingPhotos'));

        for (const photo of photos) {
            try {
                const formData = new FormData();
                formData.append('file', photo.blob, photo.filename || 'photo.png');
                formData.append('eaten_at', photo.eatenAt);
                if (photo.notes) formData.append('notes', photo.notes);

                const response = await fetch('/api/v1/nutrition/photos', {
                    method: 'POST',
                    body: formData,
                    headers: { 'Authorization': `Bearer ${photo.accessToken}` }
                });

                if (response.ok) {
                    const deleteTx = db.transaction('pendingPhotos', 'readwrite');
                    await deleteTx.objectStore('pendingPhotos').delete(photo.id);
                }
            } catch (error) {
                console.error('[SW] Sync photo failed:', error);
            }
        }
    } catch (error) {
        console.error('[SW] Sync photos error:', error);
    }
}

async function syncQueueItems() {
    try {
        const db = await openIndexedDB();
        const store = db.transaction('sync_queue', 'readwrite').objectStore('sync_queue');
        const index = store.index('status');
        const items = await getAll(index, 'pending');

        for (const item of items) {
            try {
                const response = await replayQueueItem(item);
                if (response.ok) {
                    const data = await response.json().catch(() => null);
                    if (item.tempId && item.store && data && data.id) {
                        await resolveTempIdInDB(db, item.store, item.tempId, data.id);
                    }
                    await deleteFromStore(store, item.id);
                    notifyClientsSynced();
                } else if (response.status >= 400 && response.status < 500) {
                    // Permanent failure — remove from queue
                    await deleteFromStore(store, item.id);
                }
                // Transient (5xx/network) — leave in queue for next sync cycle
            } catch (error) {
                console.warn('[SW] Queue item replay failed (will retry):', error);
            }
        }
    } catch (error) {
        console.error('[SW] Sync queue error:', error);
    }
}

async function replayQueueItem(item) {
    const url = `${self.location.origin}/api/v1${item.endpoint}`;
    const accessToken = item.accessToken;
    const headers = { 'Authorization': `Bearer ${accessToken}` };

    const options = { method: item.method, headers, credentials: 'include' };

    if (item.isFormData && item.formData) {
        const fd = new FormData();
        if (item.formData.blob instanceof Blob) {
            fd.append('file', item.formData.blob, item.formData.filename || 'photo.webp');
        }
        const fields = item.formData.fields || {};
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined && value !== null) fd.append(key, value);
        }
        options.body = fd;
    } else if (item.payload) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(item.payload);
    }

    return fetch(url, options);
}

async function resolveTempIdInDB(db, storeName, tempId, realId) {
    try {
        const tx = db.transaction([storeName, 'sync_queue'], 'readwrite');
        const recordStore = tx.objectStore(storeName);
        const record = await getOne(recordStore, tempId);
        if (record) {
            record.id = realId;
            record.sync_status = 'synced';
            record.updated_at = Date.now();
            recordStore.put(record);
        }
        const queueStore = tx.objectStore('sync_queue');
        queueStore.index('status').openCursor().onsuccess = function (event) {
            const cursor = event.target.result;
            if (!cursor) return;
            if (cursor.value.tempId === tempId) cursor.delete();
            cursor.continue();
        };
        await txDone(tx);
    } catch (error) {
        console.error('[SW] Temp ID resolution failed:', error);
    }
}

function notifyClientsSynced() {
    self.clients && self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SYNC_COMPLETE' }));
    });
}

function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('mylofi-offline', 2);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;

            if (!db.objectStoreNames.contains('pendingPhotos')) {
                db.createObjectStore('pendingPhotos', { keyPath: 'id', autoIncrement: true });
            }

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
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getAll(store, value) {
    return new Promise((resolve, reject) => {
        const request = value !== undefined
            ? store.getAll(IDBKeyRange.only(value))
            : store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getOne(store, key) {
    return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deleteFromStore(store, key) {
    return new Promise((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}
