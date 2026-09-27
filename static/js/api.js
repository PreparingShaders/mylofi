console.log("[DEBUG] Loaded api.js");
const API_BASE = `${window.location.origin}/api/v1`;

const OFFLINE_QUEUE_KEY = 'offline_sync_queue';
const OFFLINE_MESSAGE = 'Сеть недоступна. Изменения сохранены локально и будут отправлены при появлении связи';
const QUEUEABLE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class APIClient {
    constructor() {
        this.baseURL = API_BASE;
        this.refreshing = false;
        this.refreshQueue = [];
        this.replaying = false;
        this.processingQueue = false;
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

    enqueueRequest(method, endpoint, data, accessToken) {
        const queue = this.readQueue();
        queue.push({
            method,
            endpoint,
            data: data ?? null,
            accessToken: accessToken ?? null,
            queuedAt: new Date().toISOString(),
        });
        this.writeQueue(queue);
        console.log(`[API] Queued offline request: ${method} ${endpoint} (queue: ${queue.length})`);
    }

    isQueueable(method, data, isFormData) {
        return !this.replaying && QUEUEABLE_METHODS.has(method) && !isFormData && data !== undefined;
    }

    async processOfflineQueue() {
        if (this.processingQueue) return;
        this.processingQueue = true;

        try {
            let queue = this.readQueue();
            if (!queue.length) return;

            console.log(`[API] Processing offline queue (${queue.length} pending)`);
            let synced = 0;

            while (queue.length) {
                const item = queue[0];
                const token = item.accessToken || window.App?.state?.tokens?.access || null;

                try {
                    this.replaying = true;
                    await this.request(item.method, item.endpoint, item.data, token, false);
                } catch (error) {
                    // Transient failures (offline, token refresh issue) keep the item for a later retry
                    if (!error?.status || error.status < 400) {
                        console.warn('[API] Replay deferred, keeping queue intact:', error?.message);
                        return;
                    }
                    console.error('[API] Dropping permanently failed queued request:', item, error);
                } finally {
                    this.replaying = false;
                }

                queue.shift();
                this.writeQueue(queue);
                synced += 1;
            }

            if (synced) {
                console.log(`[API] Offline queue synced: ${synced} request(s)`);
                window.App?.showToast?.(`Синхронизировано изменений: ${synced}`, 'success');
            }
        } finally {
            this.processingQueue = false;
            this.replaying = false;
        }
    }

    async request(method, endpoint, data = null, accessToken = null, isFormData = false) {
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
            if (normalized?.isNetworkError && this.isQueueable(method, data, isFormData)) {
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
            window.App.clearTokens();
            window.App.showScreen('landing');
            throw error;
        } finally {
            this.refreshing = false;
        }
    }
    
    get(endpoint, accessToken = null) { return this.request('GET', endpoint, null, accessToken); }
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