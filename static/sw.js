const CACHE_NAME = 'mylofi-v5';

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    // Pass everything through to the network and satisfy PWA install requirements
    event.respondWith(fetch(event.request));
});

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
