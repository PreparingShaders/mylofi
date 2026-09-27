console.log("[DEBUG] Loaded auth.js");
import { API } from './api.js';

export const Auth = {
    renderLogin(container, app) {
        container.innerHTML = `
            <div class="min-h-screen flex items-center justify-center p-4">
                <div class="w-full max-w-md glass rounded-2xl p-6">
                    <h1 class="text-3xl font-bold text-center mb-8">MyLofi</h1>
                    <form id="login-form" class="space-y-4">
                        <input type="email" name="email" placeholder="Email" required class="w-full px-4 py-3 rounded-xl glass-input">
                        <input type="password" name="password" placeholder="Пароль" required class="w-full px-4 py-3 rounded-xl glass-input">
                        <button type="submit" class="w-full py-3 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl font-semibold">Войти</button>
                    </form>
                    <p class="text-center text-sm mt-6">
                        Нет аккаунта? 
                        <button data-action="show-register" class="text-surface-900 dark:text-zinc-100 font-medium hover:underline">Зарегистрироваться</button>
                    </p>
                </div>
            </div>
        `;
        // Attach submit handler directly to form as backup
        const form = container.querySelector('#login-form');
        if (form) {
            form.addEventListener('submit', (e) => this.handleLogin(e, app));
        }
    },
    
    renderRegister(container, app) {
        container.innerHTML = `
            <div class="min-h-screen flex items-center justify-center p-4">
                <div class="w-full max-w-md glass rounded-2xl p-6">
                    <h1 class="text-3xl font-bold text-center mb-8">MyLofi</h1>
                    <form id="register-form" class="space-y-4">
                        <input type="email" name="email" placeholder="Email" required class="w-full px-4 py-3 rounded-xl glass-input">
                        <input type="text" name="full_name" placeholder="Имя" class="w-full px-4 py-3 rounded-xl glass-input">
                        <input type="password" name="password" placeholder="Пароль" required class="w-full px-4 py-3 rounded-xl glass-input">
                        <input type="password" name="password_confirm" placeholder="Подтвердите пароль" required class="w-full px-4 py-3 rounded-xl glass-input">
                        <button type="submit" class="w-full py-3 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl font-semibold">Зарегистрироваться</button>
                    </form>
                    <p class="text-center text-sm mt-6">
                        Уже есть аккаунт? 
                        <button data-action="show-auth" class="text-surface-900 dark:text-zinc-100 font-medium hover:underline">Войти</button>
                    </p>
                </div>
            </div>
        `;
        const form = container.querySelector('#register-form');
        if (form) {
            form.addEventListener('submit', (e) => this.handleRegister(e, app));
        }
    },
    
    extractErrorMessage(error) {
        const detail = error?.data?.detail;
        if (typeof detail === 'string' && detail) return detail;
        if (Array.isArray(detail) && detail.length) {
            const first = detail[0];
            if (first?.msg) return first.msg;
        }
        if (typeof error?.data?.message === 'string' && error.data.message) return error.data.message;
        if (typeof error?.message === 'string' && error.message) return error.message;
        return 'Неизвестная ошибка';
    },
    
    showError(app, message) {
        console.error('[Auth] Error:', message);
        let shown = false;
        try {
            if (typeof app?.showToast === 'function') {
                app.showToast(message, 'error');
                shown = Boolean(app.elements?.toastContainer);
            }
        } catch (e) {
            console.error('[Auth] showToast failed:', e);
            shown = false;
        }
        if (!shown) {
            window.alert(message);
        }
    },
    
    async handleLogin(event, app) {
        console.log('[Auth] handleLogin called');
        event.preventDefault();
        const formData = new FormData(event.target);
        console.log('[Auth] formData:', Object.fromEntries(formData));
        
        const params = new URLSearchParams();
        params.append('username', formData.get('email'));
        params.append('password', formData.get('password'));
        console.log('[Auth] params:', params.toString());
        
        try {
            const response = await API.post('/auth/login', params, null, true);
            console.log('[Auth] login response:', response);
            if (!response?.access_token) {
                throw new Error('Сервер не вернул токен доступа');
            }
            app.state.tokens.access = response.access_token;
            app.state.tokens.refresh = response.refresh_token;
            app.saveTokens();
            const user = await API.get('/users/me', app.state.tokens.access);
            app.state.user = user;
            app.saveTokens();
            app.showScreen('main');
            app.showPage('nutrition');
        } catch (error) {
            console.error('[Auth] Login error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    },
    
    async handleRegister(event, app) {
        event.preventDefault();
        const formData = new FormData(event.target);
        
        try {
            await API.post('/auth/register', { 
                email: formData.get('email'), 
                password: formData.get('password'), 
                full_name: formData.get('full_name') 
            });
            app.showToast('Аккаунт создан', 'success');
            app.showScreen('auth');
            this.renderLogin(app.elements.screens.auth, app);
        } catch (error) {
            console.error('[Auth] Register error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    }
};