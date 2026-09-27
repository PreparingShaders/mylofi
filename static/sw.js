const SHELL_CACHE = 'mylofi-shell-v6';
const RUNTIME_CACHE = 'mylofi-runtime-v6';
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

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
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // API traffic is handled by the client-side read cache / sync queue
    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(request));
        return;
    }

    if (url.origin === self.location.origin && url.pathname.startsWith('/static/')) {
        event.respondWith(cacheFirst(request, SHELL_CACHE, true));
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
    return network;
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

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        revalidate(cache, request);
        return cached;
    }
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
    }
    return response;
}

function revalidate(cache, request) {
    fetch(request)
        .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
        })
        .catch(() => {});
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
