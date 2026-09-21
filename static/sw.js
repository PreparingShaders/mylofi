const CACHE_NAME = 'mylofi-v1';
const STATIC_CACHE = 'mylofi-static-v1';
const DYNAMIC_CACHE = 'mylofi-dynamic-v1';
const IMAGE_CACHE = 'mylofi-images-v1';

const STATIC_ASSETS = [
    '/',
    '/static/index.html',
    '/static/manifest.json',
    '/static/js/app.js',
    '/static/js/api.js',
    '/static/js/auth.js',
    '/static/js/nutrition.js',
    '/static/js/workouts.js',
    '/static/js/profile.js',
    '/static/js/camera.js',
    '/static/js/db.js',
    '/static/js/utils.js',
    '/static/js/components.js',
    '/static/css/styles.css',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE && name !== IMAGE_CACHE)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstWithCache(request));
        return;
    }

    if (request.destination === 'image') {
        event.respondWith(cacheFirstWithNetwork(request, IMAGE_CACHE));
        return;
    }

    event.respondWith(cacheFirstWithNetwork(request, STATIC_CACHE));
});

async function networkFirstWithCache(request) {
    const cache = await caches.open(DYNAMIC_CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
}

async function cacheFirstWithNetwork(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        fetch(request).then((response) => {
            if (response.ok) cache.put(request, response);
        }).catch(() => {});
        return cached;
    }
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (error) {
        if (request.destination === 'image') {
            return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="#e4e4e7" width="200" height="200"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#a1a1aa" font-family="system-ui" font-size="14">Нет изображения</text></svg>', { headers: { 'Content-Type': 'image/svg+xml' } });
        }
        throw error;
    }
}

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-photos') event.waitUntil(syncPendingPhotos());
});

async function syncPendingPhotos() {
    try {
        const db = await openIndexedDB();
        const tx = db.transaction('pendingPhotos', 'readonly');
        const photos = await getAll(tx.objectStore('pendingPhotos'));
        
        for (const photo of photos) {
            try {
                const formData = new FormData();
                formData.append('file', photo.blob, photo.filename);
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

function openIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('mylofi-offline', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('pendingPhotos')) {
                db.createObjectStore('pendingPhotos', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getAll(store) {
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
