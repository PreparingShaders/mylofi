console.log("[DEBUG] Loaded db.js");
const DB_NAME = 'mylofi-offline';
const DB_VERSION = 1;

export const DB = {
    db: null,
    
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('pendingPhotos')) {
                    db.createObjectStore('pendingPhotos', { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };
            request.onerror = (event) => reject(event.target.error);
        });
    },
    
    async addPendingPhoto(photoData) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('pendingPhotos', 'readwrite');
            const request = tx.objectStore('pendingPhotos').add({
                blob: photoData.blob,
                filename: photoData.filename,
                eatenAt: photoData.eatenAt,
                notes: photoData.notes,
                accessToken: photoData.accessToken,
                timestamp: Date.now(),
            });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    
    async getAllPendingPhotos() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('pendingPhotos', 'readonly');
            const request = tx.objectStore('pendingPhotos').getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    
    async deletePendingPhoto(id) {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('pendingPhotos', 'readwrite');
            tx.objectStore('pendingPhotos').delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
};