console.log("[DEBUG] Loaded auth.js");
import { API } from './api.js';

export const Auth = {
    renderLogin(container, app) {
        container.innerHTML = `
            <div class="min-h-screen flex items-center justify-center p-4">
                <div class="w-full max-w-sm glass rounded-2xl p-5 sm:p-6">
                    <h1 class="text-2xl font-bold text-center mb-6">MyLofi</h1>
                    <form id="login-form" class="space-y-3">
                        <input type="email" name="email" placeholder="Email" required autocomplete="email" class="w-full px-4 py-2.5 rounded-xl glass-input">
                        <input type="password" name="password" placeholder="Пароль" required autocomplete="current-password" class="w-full px-4 py-2.5 rounded-xl glass-input">
                        <button type="submit" class="w-full py-2.5 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl font-semibold">Войти</button>
                    </form>
                    <p class="text-center text-sm mt-4">
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
                <div class="w-full max-w-sm glass rounded-2xl p-5 sm:p-6">
                    <h1 class="text-2xl font-bold text-center mb-6">MyLofi</h1>
                    <form id="register-form" class="space-y-3">
                        <input type="email" name="email" placeholder="Email" required autocomplete="email" class="w-full px-4 py-2.5 rounded-xl glass-input">
                        <input type="text" name="full_name" placeholder="Имя" autocomplete="name" class="w-full px-4 py-2.5 rounded-xl glass-input">
                        <input type="password" name="password" placeholder="Пароль" required autocomplete="new-password" class="w-full px-4 py-2.5 rounded-xl glass-input">
                        <input type="password" name="password_confirm" placeholder="Подтвердите пароль" required autocomplete="new-password" class="w-full px-4 py-2.5 rounded-xl glass-input">
                        <button type="submit" class="w-full py-2.5 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl font-semibold">Зарегистрироваться</button>
                    </form>
                    <p class="text-center text-sm mt-4">
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
        const status = error?.status;
        const detail = error?.data?.detail;

        // 401 / 400 from the login endpoint almost always means bad creds.
        if (status === 401 || status === 400) {
            if (typeof detail === 'string' && detail) {
                const lower = detail.toLowerCase();
                if (lower.includes('не найден') || lower.includes('not found') ||
                    lower.includes('нет такого') || lower.includes('user not found') ||
                    lower.includes('incorrect') || lower.includes('неверн')) {
                    return 'Неверный email или пароль';
                }
            }
            return 'Неверный email или пароль';
        }
        if (status === 422) {
            if (typeof detail === 'string' && detail) return detail;
            return 'Проверьте правильность введённых данных';
        }
        if (status === 0 || error?.name === 'TypeError' || error?.message === 'Failed to fetch') {
            return 'Ошибка соединения с сервером. Проверьте подключение к интернету.';
        }
        if (typeof detail === 'string' && detail) return detail;
        if (Array.isArray(detail) && detail.length) {
            const first = detail[0];
            if (first?.msg) return first.msg;
        }
        if (typeof error?.data?.message === 'string' && error.data.message) return error.data.message;
        if (typeof error?.message === 'string' && error.message) {
            // Strip the raw HTTP line we attach in api.js for a friendlier read.
            const msg = error.message;
            if (msg.startsWith('HTTP 401') || msg.startsWith('HTTP 400')) return 'Неверный email или пароль';
            if (msg.startsWith('HTTP 422')) return 'Проверьте правильность введённых данных';
            if (msg.startsWith('HTTP 5')) return 'Сервер временно недоступен. Попробуйте позже.';
            return msg;
        }
        return 'Неизвестная ошибка';
    },
    
    showError(app, message) {
        console.error('[Auth] Error:', message);
        // Render the message inside the open auth modal's inline banner so the
        // user sees the reason right above the fields. Do NOT also fire a
        // showToast here — the banner already covers the same UI area and a
        // second toast would duplicate the message on screen.
        const banner = document.querySelector('.auth-modal [data-auth-error]');
        if (banner) {
            banner.textContent = message;
            banner.classList.remove('hidden');
        }
        if (!banner && !app?.elements?.toastContainer) {
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
            // Store tokens in localStorage for instant cold-start on next visit.
            // On iOS standalone PWAs, localStorage may be evicted, but the
            // HttpOnly refresh_token cookie survives and is used for recovery.
            if (response?.access_token) {
                app.state.tokens.access = response.access_token;
                app.state.tokens.refresh = response.refresh_token;
                app.saveTokens();
            }
            const user = await API.get('/users/me', app.state.tokens.access);
            app.state.user = user;
            app.saveTokens();
            
            // Close auth modal if open, then transition to the main app.
            // Await the modal's exit animation so the screen switch doesn't
            // race with the modal still fading out. If the modal is already
            // gone (or Components isn't loaded yet) just proceed.
            const authModal = document.querySelector('.auth-modal');
            if (authModal && app.Components?.closeAuthModal) {
                await app.Components.closeAuthModal(authModal);
            } else if (authModal) {
                authModal.remove();
            }
            
            app.showScreen('main');
            app.showPage('nutrition');
            // Notify the sync engine that auth is valid again so it can
            // resume flushing any pending queue.
            window.dispatchEvent(new Event('auth:logged-in'));
        } catch (error) {
            console.error('[Auth] Login error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    },

    async handleRegister(event, app) {
        event.preventDefault();
        const formData = new FormData(event.target);

        try {
            const response = await API.post('/auth/register', {
                email: formData.get('email'),
                password: formData.get('password'),
                full_name: formData.get('full_name')
            });

            const modalEl = document.querySelector('.auth-modal');
            if (response?.status === 'verification_required' || response?.requires_verification) {
                const email = response?.email || formData.get('email');
                if (modalEl && app.Components?._switchAuthForm) {
                    app.Components._switchAuthForm(modalEl, 'verify-code', {
                        email: email,
                        purpose: 'register'
                    });
                }
                return;
            }

            if (!response?.access_token) {
                throw new Error('Сервер не вернул токен доступа');
            }
            app.state.tokens.access = response.access_token;
            app.state.tokens.refresh = response.refresh_token;
            app.saveTokens();
            const user = await API.get('/users/me', app.state.tokens.access);
            app.state.user = user;
            app.saveTokens();

            app.showToast('Аккаунт создан', 'success');

            const authModal = document.querySelector('.auth-modal');
            if (authModal && app.Components?.closeAuthModal) {
                await app.Components.closeAuthModal(authModal);
            }

            app.showScreen('main');
            app.showPage('nutrition');
            window.dispatchEvent(new Event('auth:logged-in'));
        } catch (error) {
            console.error('[Auth] Register error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    },

    async handleVerifyCode(event, app, modalEl) {
        event.preventDefault();
        const ctx = modalEl._authCtx || {};
        const email = ctx.email || '';
        const purpose = ctx.purpose || 'register';
        const code = modalEl.querySelector('[data-auth-code-value]')?.value || '';

        if (code.length !== 6) {
            this.showError(app, 'Введите 6-значный код');
            return;
        }

        try {
            if (purpose === 'register') {
                const response = await API.post('/auth/verify-register', { email, code });
                if (!response?.access_token) {
                    throw new Error('Сервер не вернул токен доступа');
                }
                app.state.tokens.access = response.access_token;
                app.state.tokens.refresh = response.refresh_token;
                app.saveTokens();
                const user = await API.get('/users/me', app.state.tokens.access);
                app.state.user = user;
                app.saveTokens();

                app.showToast('Аккаунт создан', 'success');

                await app.Components.closeAuthModal(modalEl);
                app.showScreen('main');
                app.showPage('nutrition');
                window.dispatchEvent(new Event('auth:logged-in'));
            } else if (purpose === 'reset_password') {
                const response = await API.post('/auth/verify-reset-code', { email, code });
                ctx.code = code;
                if (app.Components?._switchAuthForm) {
                    app.Components._switchAuthForm(modalEl, 'new-password', ctx);
                }
            }
        } catch (error) {
            console.error('[Auth] Verify code error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    },

    async handleForgotPassword(event, app, modalEl) {
        event.preventDefault();
        const formData = new FormData(event.target);
        const email = formData.get('email');

        try {
            await API.post('/auth/forgot-password', { email });
            if (app.Components?._switchAuthForm) {
                app.Components._switchAuthForm(modalEl, 'verify-code', {
                    email: email,
                    purpose: 'reset_password'
                });
            }
        } catch (error) {
            console.error('[Auth] Forgot password error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    },

    async handleResendCode(email, purpose, app, modalEl) {
        try {
            await API.post('/auth/resend-code', { email, purpose });
            app.showToast('Код отправлен повторно', 'success');
            modalEl._authCtx = { email, purpose };
            if (app.Components?.initResendTimer) {
                app.Components.initResendTimer(modalEl);
            }
        } catch (error) {
            console.error('[Auth] Resend code error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    },

    async handleResetPassword(event, app, modalEl) {
        event.preventDefault();
        const formData = new FormData(event.target);
        const ctx = modalEl._authCtx || {};
        const email = ctx.email || '';
        const code = ctx.code || '';

        const password = formData.get('password');
        const passwordConfirm = formData.get('password_confirm');

        if (password !== passwordConfirm) {
            this.showError(app, 'Пароли не совпадают');
            return;
        }

        try {
            const response = await API.post('/auth/reset-password', {
                email,
                code,
                new_password: password
            });

            if (response?.access_token) {
                app.state.tokens.access = response.access_token;
                app.state.tokens.refresh = response.refresh_token;
                app.saveTokens();
                const user = await API.get('/users/me', app.state.tokens.access);
                app.state.user = user;
                app.saveTokens();

                app.showToast('Пароль изменён', 'success');

                await app.Components.closeAuthModal(modalEl);
                app.showScreen('main');
                app.showPage('nutrition');
                window.dispatchEvent(new Event('auth:logged-in'));
            } else {
                app.showToast('Пароль изменён', 'success');
                if (app.Components?._switchAuthForm) {
                    app.Components._switchAuthForm(modalEl, 'login');
                }
            }
        } catch (error) {
            console.error('[Auth] Reset password error:', error);
            this.showError(app, this.extractErrorMessage(error));
        }
    }
};