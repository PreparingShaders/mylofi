console.log("[DEBUG] Loaded api.js");
import { SyncEngine } from './sync.js';

const API_BASE = `${window.location.origin}/api/v1`;

const OFFLINE_QUEUE_KEY = 'offline_sync_queue';
const OFFLINE_MESSAGE = 'Сеть недоступна. Изменения сохранены локально и будут отправлены при появлении связи';
const QUEUEABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const READ_CACHE_PREFIX = 'offline_read_cache:';
const READ_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const READ_CACHE_MAX_ENTRY_BYTES = 300 * 1024;
const READ_CACHE_TOTAL_BYTES = 2 * 1024 * 1024;

// Every nutrition read the dashboard can be showing: the day log, the period
// summaries, the custom-range endpoints and the daily recap.
const NUTRITION_READS = [
    'nutrition/logs',
    'nutrition/summary',
    'nutrition/week',
    'nutrition/month',
    'nutrition/range',
    'nutrition/daily-summary',
];

// Cache entries invalidated together when a mutation touches a resource.
// The coach's verdict is keyed to a session, so completing or editing a session
// moves the stored verdict with it - otherwise the history card would keep
// rendering a verdict for a session the user has since changed.
const READ_CACHE_RELATIONSHIPS = {
    'workouts/sets': ['workouts/sessions', 'workouts/statistics', 'workouts/history', 'ai/workout-summary'],
    'workouts/sessions': ['workouts/sessions', 'workouts/statistics', 'workouts/history', 'ai/workout-summary'],
    'workouts/templates': ['workouts/templates'],
    'ai/workout-summary': ['ai/workout-summary'],
    'nutrition/meals': NUTRITION_READS,
    'nutrition/photos': NUTRITION_READS,
    // Targets live on the user profile, so a profile change moves every
    // nutrition readout the dashboard renders.
    'users/me': ['users/me', 'users/me/usage', ...NUTRITION_READS],
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
            
            // Detailed error logging for debugging mobile Safari issues
            console.error('[API] Request failed:', {
                status: response.status,
                statusText: response.statusText,
                url: response.url,
                method: response.method || 'unknown',
                responseData: data,
                errorMessage: message,
                timestamp: new Date().toISOString()
            });
            
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
        return SyncEngine.getPendingItems();
    }

    writeQueue() {
        // No-op: SyncEngine owns persistence in IndexedDB (sync_queue store).
    }

    hasPendingRequests() {
        return SyncEngine.getPendingCount();
    }

    async enqueueRequest(method, endpoint, data, accessToken, options = {}) {
        const item = await SyncEngine.enqueue({
            method,
            endpoint,
            data: data ?? null,
            accessToken: accessToken ?? null,
            offlineSessionKey: options.offlineSessionKey ?? null,
            tempId: options.tempId ?? null,
            store: options.store ?? null,
            formData: options.formData ?? null,
            prepend: options.prepend || false,
        });
        this.invalidateReadCache(endpoint);
        console.log(`[API] Queued offline request: ${method} ${endpoint}`);
        return item;
    }

    isQueueable(method, data, isFormData) {
        return QUEUEABLE_METHODS.has(method) && !isFormData && data !== undefined;
    }

    // Attaches metadata to the most recently queued matching request
    markQueuedRequest(method, endpoint, extra) {
        return SyncEngine.markQueued(endpoint, method, extra);
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

    async replayQueuedItem(item) {
        const accessToken = item.accessToken || window.App?.state?.tokens?.access || null;
        let data = item.payload ?? item.data ?? null;
        const isFormData = Boolean(item.isFormData || item.formData);

        if (isFormData && item.formData) {
            const fd = new FormData();
            if (item.formData.blob instanceof Blob) {
                fd.append('file', item.formData.blob, item.formData.filename || 'photo.webp');
            }
            const fields = item.formData.fields || {};
            for (const [key, value] of Object.entries(fields)) {
                if (value !== undefined && value !== null) fd.append(key, value);
            }
            data = fd;
        }

        return this.request(item.method, item.endpoint, data, accessToken, isFormData, true);
    }

    async processOfflineQueue() {
        return SyncEngine.processQueue();
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
                    await this.enqueueRequest(method, endpoint, data, accessToken);
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
        
        // Try token refresh for 401 responses
        if (response.status === 401 && accessToken && window.App) {
            return this.handleUnauthorized(method, endpoint, data, accessToken, isFormData);
        }

        // Global 403 handling - clear auth and redirect to login (no refresh possible for 403)
        if (response.status === 403 && accessToken && window.App) {
            console.error('[API] Forbidden response, clearing auth state:', {
                status: response.status,
                url: response.url,
                method: method
            });
            window.App.clearTokens();
            window.App.showScreen('landing');
            window.App.renderLanding();
            const authError = new Error('Доступ запрещён. Пожалуйста, войдите снова.');
            authError.status = response.status;
            throw authError;
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
                console.error('[API] Token refresh failed, clearing auth state:', {
                    error: error?.message,
                    status: error?.status
                });
                window.App.clearTokens();
                window.App.showScreen('landing');
                window.App.renderLanding();
            }
            throw error;
        } finally {
            this.refreshing = false;
        }
    }
    
    get(endpoint, accessToken = null) { return this.getWithReadCache(endpoint, accessToken); }
    post(endpoint, data, accessToken = null, isFormData = false) { return this.request('POST', endpoint, data, accessToken, isFormData); }
    /**
     * A POST that must never enter the offline queue.
     *
     * The coach's two calls are the exception: a plan replayed hours later lands
     * on a workout that is over, and a verdict replayed later spends the Free
     * tier's one weekly analysis on a session from yesterday. Both fail loudly
     * instead, and the UI already treats them as optional.
     */
    postImmediate(endpoint, data, accessToken = null) { return this.request('POST', endpoint, data, accessToken, false, true); }
    patch(endpoint, data, accessToken = null) { return this.request('PATCH', endpoint, data, accessToken); }
    delete(endpoint, accessToken = null) { return this.request('DELETE', endpoint, null, accessToken); }
    deleteMeal(mealId, accessToken = null) { return this.request('DELETE', `/nutrition/meals/${mealId}`, null, accessToken); }
    
    createWebSocket(token) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}${this.baseURL}/ws?token=${token}`;
        return new WebSocket(wsUrl);
    }
}

export const API = new APIClient();