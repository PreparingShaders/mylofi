console.log("[DEBUG] Loaded api.js");
const API_BASE = `${window.location.origin}/api/v1`;

const OFFLINE_QUEUE_KEY = 'offline_sync_queue';
const OFFLINE_MESSAGE = 'Сеть недоступна. Изменения сохранены локально и будут отправлены при появлении связи';
const QUEUEABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const READ_CACHE_PREFIX = 'offline_read_cache:';
const READ_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const READ_CACHE_MAX_ENTRY_BYTES = 300 * 1024;
const READ_CACHE_TOTAL_BYTES = 2 * 1024 * 1024;

// Cache entries invalidated together when a mutation touches a resource
const READ_CACHE_RELATIONSHIPS = {
    'workouts/sets': ['workouts/sessions', 'workouts/statistics', 'workouts/history'],
    'workouts/sessions': ['workouts/sessions', 'workouts/statistics', 'workouts/history'],
    'workouts/templates': ['workouts/templates'],
    'nutrition/meals': ['nutrition/logs', 'nutrition/summary'],
    'nutrition/photos': ['nutrition/logs', 'nutrition/summary'],
    'users/me': ['users/me'],
};

class APIClient {
    constructor() {
        this.baseURL = API_BASE;
        this.refreshing = false;
        this.refreshQueue = [];
        this.processingQueue = false;
        this.itemResolver = null;
        this.onItemSynced = null;
    }

    getHeaders(accessToken, isFormData = false) {
        const headers = {};
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
        }
        if (!isFormData) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }
    
    async handleResponse(response) {
        const contentType = response.headers.get('content-type');
        const isJSON = contentType && contentType.includes('application/json');
        let data;
        try {
            data = isJSON ? await response.json() : await response.text();
        } catch (parseError) {
            console.error('[API] Failed to parse response body:', parseError);
            data = null;
        }
        
        if (!response.ok) {
            let message = `HTTP ${response.status} ${response.statusText || ''}`.trim();
            if (typeof data === 'string' && data.trim()) {
                message = data.trim().slice(0, 200);
            } else if (data?.detail) {
                message = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
            } else if (data?.message) {
                message = data.message;
            }
            const error = new Error(message);
            error.status = response.status;
            error.data = data;
            throw error;
        }
        
        return data;
    }
    
    normalizeError(error, method, url) {
        if (error?.name === 'TypeError' || error?.message === 'Failed to fetch') {
            const networkError = new Error(
                `Сеть недоступна (${method} ${url}). Проверьте подключение к интернету или адрес сервера.`
            );
            networkError.status = 0;
            networkError.isNetworkError = true;
            networkError.cause = error;
            return networkError;
        }
        return error;
    }
    
    readQueue() {
        try {
            const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter(item => item && item.method && item.endpoint) : [];
        } catch (error) {
            console.warn('[API] Failed to read offline queue:', error);
            return [];
        }
    }

    writeQueue(queue) {
        try {
            localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        } catch (error) {
            console.error('[API] Failed to persist offline queue:', error);
        }
    }

    hasPendingRequests() {
        return this.readQueue().length > 0;
    }

    enqueueRequest(method, endpoint, data, accessToken, options = {}) {
        const queue = this.readQueue();
        const item = {
            method,
            endpoint,
            data: data ?? null,
            accessToken: accessToken ?? null,
            queuedAt: new Date().toISOString(),
        };
        if (options.offlineSessionKey) item.offlineSessionKey = options.offlineSessionKey;
        if (options.prepend) {
            queue.unshift(item);
        } else {
            queue.push(item);
        }
        this.writeQueue(queue);
        this.invalidateReadCache(endpoint);
        console.log(`[API] Queued offline request: ${method} ${endpoint} (queue: ${queue.length})`);
        return item;
    }

    isQueueable(method, data, isFormData) {
        return QUEUEABLE_METHODS.has(method) && !isFormData && data !== undefined;
    }

    // Attaches metadata to the most recently queued matching request
    markQueuedRequest(method, endpoint, extra) {
        const queue = this.readQueue();
        for (let i = queue.length - 1; i >= 0; i -= 1) {
            if (queue[i].method === method && queue[i].endpoint === endpoint) {
                queue[i] = { ...queue[i], ...extra };
                this.writeQueue(queue);
                return queue[i];
            }
        }
        return null;
    }

    static readCacheKey(endpoint) {
        return `${READ_CACHE_PREFIX}${endpoint}`;
    }

    readCacheGet(endpoint) {
        try {
            const raw = localStorage.getItem(APIClient.readCacheKey(endpoint));
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (!entry || typeof entry !== 'object' || entry.data === undefined) return null;
            if (Date.now() - (entry.savedAt || 0) > READ_CACHE_MAX_AGE_MS) {
                localStorage.removeItem(APIClient.readCacheKey(endpoint));
                return null;
            }
            return entry.data;
        } catch (error) {
            console.warn('[API] Failed to read cache entry:', endpoint, error);
            return null;
        }
    }

    readCacheSet(endpoint, data) {
        if (data === undefined || data === null || typeof data !== 'object') return;
        let serialized;
        try {
            serialized = JSON.stringify({ savedAt: Date.now(), data });
        } catch (error) {
            return;
        }
        if (serialized.length > READ_CACHE_MAX_ENTRY_BYTES) return;
        try {
            const cacheKey = APIClient.readCacheKey(endpoint);
            let used = serialized.length;
            const evictable = this.listReadCacheKeys()
                .filter(key => key !== cacheKey)
                .map(key => ({ key, savedAt: this.readCacheSavedAt(key) }))
                .sort((a, b) => a.savedAt - b.savedAt);

            for (const entry of evictable) {
                if (used <= READ_CACHE_TOTAL_BYTES) break;
                used -= (localStorage.getItem(entry.key)?.length || 0);
                localStorage.removeItem(entry.key);
            }
            if (used > READ_CACHE_TOTAL_BYTES) return;

            localStorage.setItem(cacheKey, serialized);
        } catch (error) {
            console.warn('[API] Failed to persist cache entry:', endpoint, error);
        }
    }

    listReadCacheKeys() {
        const keys = [];
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (key?.startsWith(READ_CACHE_PREFIX)) keys.push(key);
            }
        } catch (error) {
            console.warn('[API] Failed to enumerate read cache:', error);
        }
        return keys;
    }

    readCacheSavedAt(cacheKey) {
        try {
            return JSON.parse(localStorage.getItem(cacheKey))?.savedAt || 0;
        } catch (error) {
            return 0;
        }
    }

    invalidateReadCache(endpoint) {
        const toResource = (item) => String(item).split('?')[0].replace(/^\/+/, '').split('/').slice(0, 2).join('/');
        const resource = toResource(endpoint);
        const related = new Set([resource, ...(READ_CACHE_RELATIONSHIPS[resource] || [])]);
        this.listReadCacheKeys().forEach((key) => {
            if (related.has(toResource(key.slice(READ_CACHE_PREFIX.length)))) {
                localStorage.removeItem(key);
            }
        });
    }

    async getWithReadCache(endpoint, accessToken = null) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            const offlineData = this.readCacheGet(endpoint);
            if (offlineData !== null) {
                console.log(`[API] Serving "${endpoint}" from read cache (offline)`);
                return offlineData;
            }
        }

        try {
            const data = await this.request('GET', endpoint, null, accessToken);
            this.readCacheSet(endpoint, data);
            return data;
        } catch (error) {
            const cachedData = this.readCacheGet(endpoint);
            if (cachedData !== null) {
                console.warn(`[API] Serving "${endpoint}" from read cache after failed request`);
                return cachedData;
            }
            throw error;
        }
    }

    async processOfflineQueue() {
        if (this.processingQueue) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            console.log('[API] Still offline, skipping queue processing');
            return;
        }
        this.processingQueue = true;

        try {
            let synced = 0;

            for (;;) {
                const queue = this.readQueue();
                if (!queue.length) break;

                let item = queue[0];
                if (typeof this.itemResolver === 'function') {
                    const resolved = this.itemResolver(item);
                    if (resolved === false) {
                        console.warn('[API] Queued request not ready for replay yet, keeping queue intact');
                        break;
                    }
                    if (resolved && resolved !== item) {
                        item = resolved;
                        queue[0] = item;
                        this.writeQueue(queue);
                    }
                }

                const token = item.accessToken || window.App?.state?.tokens?.access || null;
                let response = null;
                let failed = false;

                try {
                    response = await this.request(item.method, item.endpoint, item.data, token, false, true);
                } catch (error) {
                    // Transient failures (offline, token refresh issue) keep the item for a later retry
                    if (!error?.status || error.status < 400) {
                        console.warn('[API] Replay deferred, keeping queue intact:', error?.message);
                        return;
                    }
                    failed = true;
                    console.error('[API] Dropping permanently failed queued request:', item, error);
                }

                queue.shift();
                this.writeQueue(queue);
                this.invalidateReadCache(item.endpoint);
                synced += 1;

                if (typeof this.onItemSynced === 'function') {
                    try {
                        await this.onItemSynced(item, failed ? null : response, { failed });
                    } catch (hookError) {
                        console.error('[API] Post-sync hook failed:', hookError);
                    }
                }
            }

            if (synced) {
                console.log(`[API] Offline queue synced: ${synced} request(s)`);
                window.App?.showToast?.(`Синхронизировано изменений: ${synced}`, 'success');
                window.dispatchEvent(new CustomEvent('mylofi:offline-sync', { detail: { synced } }));
            }
        } finally {
            this.processingQueue = false;
        }
    }

    async request(method, endpoint, data = null, accessToken = null, isFormData = false, skipEnqueue = false) {
        const url = `${this.baseURL}${endpoint}`;
        const headers = this.getHeaders(accessToken, isFormData);
        
        const options = { method, headers, credentials: 'include' };
        if (data) {
            options.body = isFormData ? data : JSON.stringify(data);
        }
        
        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            const normalized = this.normalizeError(error, method, url);
            if (normalized?.isNetworkError && !skipEnqueue && this.isQueueable(method, data, isFormData)) {
                try {
                    this.enqueueRequest(method, endpoint, data, accessToken);
                } catch (queueError) {
                    console.error('[API] Failed to queue request:', queueError);
                }
                const offlineError = new Error(OFFLINE_MESSAGE);
                offlineError.status = 0;
                offlineError.isNetworkError = true;
                offlineError.offlineQueued = true;
                offlineError.cause = normalized;
                console.error(`[API] Request failed and queued: ${method} ${url}`);
                throw offlineError;
            }
            console.error(`[API] Request failed: ${method} ${url}`, normalized);
            throw normalized;
        }
        
        if (response.status === 401 && accessToken && window.App) {
            return this.handleUnauthorized(method, endpoint, data, accessToken, isFormData);
        }

        if (method !== 'GET') {
            this.invalidateReadCache(endpoint);
        }

        return this.handleResponse(response);
    }
    
    async handleUnauthorized(method, endpoint, data, accessToken, isFormData) {
        if (this.refreshing) {
            return new Promise((resolve, reject) => {
                this.refreshQueue.push({ resolve, reject, method, endpoint, data, isFormData });
            });
        }
        
        this.refreshing = true;
        
        try {
            const refreshed = await window.App.refreshAccessToken();
            if (!refreshed) throw new Error('Token refresh failed');
            
            const newToken = window.App.state.tokens.access;
            const response = await this.request(method, endpoint, data, newToken, isFormData);
            
            this.refreshQueue.forEach(({ resolve, method: m, endpoint: e, data: d, isFormData: f }) => {
                this.request(m, e, d, newToken, f).then(resolve).catch(reject);
            });
            this.refreshQueue = [];
            
            return response;
        } catch (error) {
            this.refreshQueue.forEach(({ reject }) => reject(error));
            this.refreshQueue = [];
            // Network errors during refresh must not wipe tokens — the user is still
            // authenticated; they simply can't reach the server right now.
            if (!error?.isNetworkError) {
                window.App.clearTokens();
                window.App.showScreen('landing');
            }
            throw error;
        } finally {
            this.refreshing = false;
        }
    }
    
    get(endpoint, accessToken = null) { return this.getWithReadCache(endpoint, accessToken); }
    post(endpoint, data, accessToken = null, isFormData = false) { return this.request('POST', endpoint, data, accessToken, isFormData); }
    patch(endpoint, data, accessToken = null) { return this.request('PATCH', endpoint, data, accessToken); }
    delete(endpoint, accessToken = null) { return this.request('DELETE', endpoint, null, accessToken); }
    
    createWebSocket(token) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}${this.baseURL}/ws?token=${token}`;
        return new WebSocket(wsUrl);
    }
}

export const API = new APIClient();