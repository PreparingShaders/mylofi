console.log("[DEBUG] Loaded api.js");
const API_BASE = `${window.location.origin}/api/v1`;

class APIClient {
    constructor() {
        this.baseURL = API_BASE;
        this.refreshing = false;
        this.refreshQueue = [];
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