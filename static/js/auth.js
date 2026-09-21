console.log("[DEBUG] Loaded auth.js");
import { API } from './api.js';

export const Auth = {
    renderLogin(container, app) {
        container.innerHTML = `
            <div class="min-h-screen flex items-center justify-center p-4">
                <div class="w-full max-w-md">
                    <h1 class="text-3xl font-bold text-center mb-8">MyLofi</h1>
                    <form id="login-form" class="space-y-4">
                        <input type="email" name="email" placeholder="Email" required class="w-full px-4 py-3 rounded-xl border">
                        <input type="password" name="password" placeholder="Пароль" required class="w-full px-4 py-3 rounded-xl border">
                        <button type="submit" class="w-full py-3 bg-primary-600 text-white rounded-xl">Войти</button>
                    </form>
                    <p class="text-center text-sm mt-6">
                        Нет аккаунта? 
                        <button data-action="show-register" class="text-primary-600 font-medium hover:underline">Зарегистрироваться</button>
                    </p>
                </div>
            </div>
        `;
    },
    
    renderRegister(container, app) {
        container.innerHTML = `
            <div class="min-h-screen flex items-center justify-center p-4">
                <div class="w-full max-w-md">
                    <h1 class="text-3xl font-bold text-center mb-8">MyLofi</h1>
                    <form id="register-form" class="space-y-4">
                        <input type="email" name="email" placeholder="Email" required class="w-full px-4 py-3 rounded-xl border">
                        <input type="text" name="full_name" placeholder="Имя" class="w-full px-4 py-3 rounded-xl border">
                        <input type="password" name="password" placeholder="Пароль" required class="w-full px-4 py-3 rounded-xl border">
                        <input type="password" name="password_confirm" placeholder="Подтвердите пароль" required class="w-full px-4 py-3 rounded-xl border">
                        <button type="submit" class="w-full py-3 bg-primary-600 text-white rounded-xl">Зарегистрироваться</button>
                    </form>
                    <p class="text-center text-sm mt-6">
                        Уже есть аккаунт? 
                        <button data-action="show-auth" class="text-primary-600 font-medium hover:underline">Войти</button>
                    </p>
                </div>
            </div>
        `;
    },
    
    async handleLogin(event, app) {
        event.preventDefault();
        const formData = new FormData(event.target);
        
        const params = new URLSearchParams();
        params.append('username', formData.get('email'));
        params.append('password', formData.get('password'));
        
        try {
            const response = await API.post('/auth/login', params, null, true);
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
            app.showToast(error.data?.detail || 'Ошибка входа', 'error');
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
            app.showToast(error.data?.detail || 'Ошибка регистрации', 'error');
        }
    }
};