console.log("[DEBUG] Loaded api.js");
import { SyncEngine } from './sync.js';

const API_BASE = `${window.location.origin}/api/v1`;

// The live channel sits next to the REST API, but it is NOT the API prefix:
// the websocket route is /api/v1/ws, and a handshake to /api/v1 matches no
// websocket route at all - the server answers it with a close before the
// handshake, which the browser reports as "403 Forbidden".
const WS_PATH = '/api/v1/ws';

// How long before the expiry the access token is renewed for the handshake.
// The server checks the token once, at the handshake, so a token that dies
// a second later would leave the channel dead without a word.
const TOKEN_EXPIRY_SKEW_MS = 30000;

const OFFLINE_QUEUE_KEY = 'offline_sync_queue';
const OFFLINE_MESSAGE = 'Сеть недоступна. Изменения сохранены локально и будут отправлены при появлении связи';
const QUEUEABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const HOST_CHECK_TIMEOUT_MS = 3000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const UPLOAD_TIMEOUT_MS = 8000;

const READ_CACHE_PREFIX = 'offline_read_cache:';
const READ_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const READ_CACHE_MAX_ENTRY_BYTES = 300 * 1024;
const READ_CACHE_TOTAL_BYTES = 2 * 1024 * 1024;

// The live socket pings often enough that no middlebox in the path can drop
// the connection as idle, and it gives up on a link that stopped answering
// long before the TCP stack would notice.
const REALTIME_PING_INTERVAL_MS = 25000;
const REALTIME_PONG_TIMEOUT_MS = 10000;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 30000;

// Close code the server sends when the handshake carried an invalid or
// expired token. Reconnecting with the same token cannot succeed.
const REALTIME_CLOSE_UNAUTHORIZED = 4001;

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

/**
 * A managed WebSocket connection to the live channel.
 *
 * The channel is a notification bus, not a data source: it tells the app
 * that a background analysis landed, and everything else is still read over
 * REST. That is what makes the lifecycle below safe - a socket that never
 * opens, dies or is refused only removes the instant update, and the
 * polling fallback covers the rest.
 *
 * Responsibilities:
 *  - reconnect with backoff after a drop, so a backgrounded tab or a
 *    cellular handover recovers on its own;
 *  - ping the server and give up on a link that stopped answering, which
 *    detects an L3 block long before the TCP timeout would;
 *  - re-broadcast incoming messages as window events, so the views can
 *    subscribe without holding a reference to the socket.
 */
class RealtimeSocket {
    constructor(token) {
        this.token = token;
        this.socket = null;
        this.status = 'idle';
        this.listeners = new Map();
        this.reconnectAttempt = 0;
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.pongTimer = null;
        this.closedByUser = false;
        this.waitingForOnline = false;

        // An outage stops the reconnect loop until the browser says the
        // network is back; without this the socket would hammer a link that
        // is known to be down.
        this.onlineHandler = () => {
            if (!this.waitingForOnline) return;
            this.resume();
        };
        window.addEventListener('online', this.onlineHandler);
    }

    isConnected() {
        return this.status === 'open';
    }

    on(type, handler) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type).add(handler);
        return () => this.off(type, handler);
    }

    off(type, handler) {
        this.listeners.get(type)?.delete(handler);
    }

    emit(type, payload) {
        this.listeners.get(type)?.forEach((handler) => {
            try {
                handler(payload);
            } catch (error) {
                console.error('[Realtime] handler failed:', error);
            }
        });
    }

    setStatus(status) {
        if (this.status === status) return;
        this.status = status;
        this.emit('status', status);
        window.dispatchEvent(new CustomEvent('mylofi:realtime-status', { detail: { status } }));
    }

    buildSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}${WS_PATH}?token=${encodeURIComponent(this.token)}`;
        return new WebSocket(url);
    }

    /**
     * Point the socket at a newer access token.
     *
     * The token is only checked during the handshake, so the one the next
     * reconnect would use has to be the current one - otherwise the socket
     * would come back with a token the server no longer accepts.
     */
    setToken(token) {
        if (!token || token === this.token) return;
        this.token = token;
    }

    connect() {
        if (!this.token) return;
        if (this.socket) {
            const readyState = this.socket.readyState;
            if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) return;
        }

        this.closedByUser = false;
        this.setStatus('connecting');

        let socket;
        try {
            socket = this.buildSocket();
        } catch (error) {
            console.warn('[Realtime] Could not open the socket:', error);
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;

        socket.onopen = () => {
            // A newer socket may have taken over while this one was
            // connecting; the stale one must not touch the shared state.
            if (this.socket !== socket) return;
            this.reconnectAttempt = 0;
            this.setStatus('open');
            this.startHeartbeat();
        };

        socket.onmessage = (event) => {
            if (this.socket !== socket) return;
            this.handleMessage(event);
        };

        socket.onerror = () => {
            // onclose always follows, and that is where the reconnect lives.
        };

        socket.onclose = (event) => {
            if (this.socket !== socket) return;
            this.stopHeartbeat();
            this.socket = null;
            this.setStatus('closed');

            if (event?.code === REALTIME_CLOSE_UNAUTHORIZED) {
                // The token was rejected. Retrying with it cannot succeed, so
                // the owner decides whether a fresher token exists.
                this.closedByUser = true;
                this.emit('unauthorized', event);
                return;
            }

            if (!this.closedByUser) {
                this.scheduleReconnect();
            }
        };
    }

    handleMessage(event) {
        let message = null;
        try {
            message = JSON.parse(event?.data);
        } catch (error) {
            return;
        }
        if (!message || typeof message !== 'object') return;

        const type = message.type;
        if (type === 'pong') {
            this.clearPongTimer();
            return;
        }
        if (type === 'ping') {
            this.send({ type: 'pong' });
            return;
        }

        this.emit(type, message.payload);
        // The window event follows the naming the rest of the app uses
        // ("mylofi:meal-update"), so the underscore of the wire type becomes
        // a hyphen here.
        window.dispatchEvent(new CustomEvent(`mylofi:${String(type).replace(/_/g, '-')}`, { detail: message.payload }));
    }

    send(data) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
        try {
            this.socket.send(JSON.stringify(data));
            return true;
        } catch (error) {
            console.warn('[Realtime] Send failed:', error);
            return false;
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.pingTimer = setInterval(() => {
            if (!this.send({ type: 'ping' })) return;
            // A ping that is never answered means the link is gone even
            // though the socket still believes it is open.
            this.clearPongTimer();
            this.pongTimer = setTimeout(() => {
                console.warn('[Realtime] Heartbeat timed out, dropping the socket');
                this.dropSocket();
            }, REALTIME_PONG_TIMEOUT_MS);
        }, REALTIME_PING_INTERVAL_MS);
    }

    clearPongTimer() {
        if (this.pongTimer) {
            clearTimeout(this.pongTimer);
            this.pongTimer = null;
        }
    }

    stopHeartbeat() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        this.clearPongTimer();
    }

    dropSocket() {
        if (!this.socket) return;
        try {
            this.socket.close(4000, 'heartbeat timeout');
        } catch (error) {
            // The socket is already gone; onclose still runs the reconnect.
        }
    }

    scheduleReconnect() {
        if (this.closedByUser) return;
        if (this.reconnectTimer) return;

        // Under a real outage every attempt would fail the same way, so the
        // reconnect waits for the browser to report the network back instead.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            this.waitingForOnline = true;
            return;
        }

        const delay = Math.min(
            REALTIME_RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
            REALTIME_RECONNECT_MAX_MS
        );
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    /** Reconnect as soon as the browser reports the network is back. */
    resume() {
        this.waitingForOnline = false;
        if (this.reconnectAttempt > 0) {
            this.reconnectAttempt = 0;
        }
        this.connect();
    }

    close() {
        this.closedByUser = true;
        this.waitingForOnline = false;
        this.stopHeartbeat();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.onlineHandler) {
            window.removeEventListener('online', this.onlineHandler);
            this.onlineHandler = null;
        }
        if (this.socket) {
            try {
                this.socket.close(1000, 'client closed');
            } catch (error) {
                // Already closing.
            }
            this.socket = null;
        }
        this.setStatus('closed');
    }
}

class APIClient {
    constructor() {
        this.baseURL = API_BASE;
        this.refreshPromise = null;
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

    isTimeoutError(error) {
        return error?.name === 'AbortError' || error?.isNetworkError === true && error?.status === 0 && error?.cause?.name === 'AbortError';
    }

    async checkHostReachable(accessToken = null) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), HOST_CHECK_TIMEOUT_MS);
        try {
            const response = await fetch(`${window.location.origin}/health`, {
                method: 'GET',
                headers: this.getHeaders(accessToken, false),
                credentials: 'include',
                signal: controller.signal,
            });
            return response.ok;
        } catch (error) {
            return false;
        } finally {
            clearTimeout(timeoutId);
        }
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

    async request(method, endpoint, data = null, accessToken = null, isFormData = false, skipEnqueue = false, timeoutMs = null) {
        // Photo uploads are the most fragile path on mobile: a large blob
        // crossing a saturated or L3-blocked link can hang forever. Form
        // uploads therefore default to the strict 8s budget; everything else
        // keeps the roomier 10s default. Callers can still override.
        if (timeoutMs === null) {
            timeoutMs = isFormData ? UPLOAD_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
        }
        const url = `${this.baseURL}${endpoint}`;
        const headers = this.getHeaders(accessToken, isFormData);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const options = { method, headers, credentials: 'include', signal: controller.signal };
        if (data) {
            options.body = isFormData ? data : JSON.stringify(data);
        }

        let response;
        try {
            response = await fetch(url, options);
        } catch (error) {
            clearTimeout(timeoutId);
            let normalized;
            if (error?.name === 'AbortError') {
                normalized = new Error(
                    `Сеть недоступна (таймаут ${method} ${endpoint}). Проверьте подключение к интернету.`
                );
                normalized.status = 0;
                normalized.isNetworkError = true;
                normalized.isTimeout = true;
                normalized.cause = error;
            } else {
                normalized = this.normalizeError(error, method, url);
            }
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
                offlineError.isTimeout = normalized.isTimeout;
                offlineError.cause = normalized;
                console.error(`[API] Request failed and queued: ${method} ${url}`);
                throw offlineError;
            }
            console.error(`[API] Request failed: ${method} ${url}`, normalized);
            throw normalized;
        }

        clearTimeout(timeoutId);
        
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
            authError.authInvalidated = true;
            if (typeof SyncEngine?.signalAuthFailure === 'function') {
                SyncEngine.signalAuthFailure(authError);
            }
            throw authError;
        }

        if (method !== 'GET') {
            this.invalidateReadCache(endpoint);
        }

        return this.handleResponse(response);
    }
    
    async handleUnauthorized(method, endpoint, data, accessToken, isFormData) {
        // While a refresh is already in flight, every concurrent 401 awaits the
        // same shared promise so a single /auth/refresh call serves them all
        // instead of racing separate retries against a revoked refresh token.
        if (this.refreshPromise) {
            return this.refreshPromise.then((newToken) =>
                this.request(method, endpoint, data, newToken, isFormData)
            );
        }

        const startRefresh = async () => {
            const refreshed = await window.App.refreshAccessToken();
            if (!refreshed) throw new Error('Token refresh failed');
            return window.App.state.tokens.access;
        };

        this.refreshPromise = startRefresh().finally(() => {
            this.refreshPromise = null;
        });

        try {
            const newToken = await this.refreshPromise;
            return this.request(method, endpoint, data, newToken, isFormData);
        } catch (error) {
            // Network errors during refresh must not wipe tokens — the user is
            // still authenticated; they simply can't reach the server right now.
            if (error?.isNetworkError) {
                console.error('[API] Token refresh failed (network), preserving session:', {
                    error: error?.message,
                    status: error?.status,
                });
                throw error;
            }
            // Auth failure (401/403 on the refresh call): the session is gone
            // for good. Clear tokens, halt the sync queue and redirect to login.
            console.error('[API] Token refresh failed, invalidating auth session:', {
                error: error?.message,
                status: error?.status,
            });
            if (window.App) {
                window.App.clearTokens();
                window.App.showScreen('landing');
                window.App.renderLanding();
            }
            if (typeof SyncEngine?.signalAuthFailure === 'function') {
                SyncEngine.signalAuthFailure(error);
            }
            throw error;
        }
    }
    
    get(endpoint, accessToken = null) { return this.getWithReadCache(endpoint, accessToken); }
    /**
     * Whether an access token is expired or about to expire.
     *
     * The JWT payload is read, not verified - only the server can verify the
     * signature - but the expiry claim is enough to know whether a handshake
     * would be accepted. It matters because a refused handshake is not
     * something the socket retries on its own: the server answers it with a
     * close before the connection is established.
     */
    isTokenExpiring(token, skewMs = TOKEN_EXPIRY_SKEW_MS) {
        if (!token) return true;
        try {
            const segment = String(token).split('.')[1];
            if (!segment) return false;
            const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
            const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
            const payload = JSON.parse(new TextDecoder().decode(bytes));
            const exp = Number(payload?.exp);
            if (!Number.isFinite(exp)) return false;
            return exp * 1000 - Date.now() <= skewMs;
        } catch (error) {
            // A token the client cannot read is left for the server to judge.
            return false;
        }
    }
    /**
     * A GET that bypasses the offline read cache.
     *
     * The cache exists to paint a screen while the network is gone, but a
     * status poll needs the truth: a stale "still processing" answer would
     * keep the loop spinning until its deadline instead of surfacing the
     * outage, and it would hide a meal that is actually finished.
     */
    getFresh(endpoint, accessToken = null) { return this.request('GET', endpoint, null, accessToken); }
    post(endpoint, data, accessToken = null, isFormData = false, timeoutMs = null) { return this.request('POST', endpoint, data, accessToken, isFormData, false, timeoutMs); }
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
    
    /**
     * Open a managed live channel to the backend.
     *
     * The returned socket owns its own lifecycle - it reconnects, it
     * heartbeats and it turns incoming messages into window events - so the
     * caller only has to keep it alive for as long as the session lasts.
     */
    createWebSocket(token) {
        return new RealtimeSocket(token);
    }
}

export const API = new APIClient();