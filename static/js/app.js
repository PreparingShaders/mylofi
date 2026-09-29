console.log("[DEBUG] Loaded app.js");
import { API } from './api.js';
import { Auth } from './auth.js';
import { Nutrition } from './nutrition.js';
import { Workouts } from './workouts.js';
import { Profile, THEME_OPTION_BASE, THEME_OPTION_ACTIVE, THEME_OPTION_IDLE } from './profile.js';
import { Camera } from './camera.js';
import { DB } from './db.js';
import { SyncEngine } from './sync.js';
import { NetworkBanner } from './network.js';
import { Components } from './components.js';
import { Utils } from './utils.js';
import { Theme } from './theme.js';

const TOGGLE_BASE = 'flex-shrink-0 w-11 h-11 rounded-2xl text-xl font-bold transition-all flex items-center justify-center';
const TOGGLE_COMPLETED = 'bg-lime-400 text-zinc-950 border-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.4)]';
const TOGGLE_UNCOMPLETED = 'glass text-surface-400 dark:text-surface-500';

const App = {
    state: {
        user: null,
        tokens: { access: null, refresh: null },
        currentPage: 'nutrition',
        currentScreen: 'landing',
        isOnline: navigator.onLine,
        pendingPhotos: [],
        activeWorkout: null,
        currentSessionId: null,
    },
    
    elements: {},
    
    async init() {
        console.log('[App] Initializing...');
        Theme.init();
        this.cacheElements();

        // Проверка элементов перед продолжением
        if (!this.elements.screens.landing) {
            console.error('[App] Critical error: Landing screen element not found!');
            return;
        }

        // Render landing immediately so user sees something
        this.showScreen('landing');
        this.renderLanding();
        this.setupEventListeners();
        this.setupOfflineSync();
        this.loadTokens();
        this.setupNetworkBanner();

        // DB init is non-critical
        try {
            await DB.init();
            await this.initSyncEngine();
        } catch (e) {
            console.warn('[App] DB/Sync init failed:', e);
        }

        if (this.state.tokens.access) {
            console.log('[App] Token found, validating...');
            try {
                await this.validateToken();
                await this.initSyncEngine();
            } catch (e) {
                console.error('[App] Token validation failed:', e);
                this.showScreen('landing');
                this.renderLanding();
            }
        }

        await this.flushOfflineQueue();

        console.log('[App] Initialized');
    },

    async initSyncEngine() {
        const onItemSynced = async (item, response, meta) => {
            try { await Workouts.handleSyncedItem(item, response, meta); } catch (e) { console.error('[App] handleSyncedItem:', e); }
            try { await Camera.handleSyncedMeal(item, response, meta); } catch (e) { console.error('[App] handleSyncedMeal:', e); }
        };
        const onOnline = () => {
            this.state.isOnline = true;
            this.updateNetworkBanner();
        };
        SyncEngine.setReplayFn((item) => API.replayQueuedItem(item));
        SyncEngine.setHooks({
            itemResolver: (item) => Workouts.resolveQueuedItem(item),
            onItemSynced,
            onOnline,
        });
        SyncEngine.init({
            replayFn: (item) => API.replayQueuedItem(item),
            itemResolver: (item) => Workouts.resolveQueuedItem(item),
            onItemSynced,
            onOnline,
        });
    },

    setupOfflineSync() {
        window.addEventListener('offline', () => {
            this.state.isOnline = false;
            this.updateNetworkBanner();
            console.log('[App] Network lost, requests will be queued locally');
        });

        // Lists rendered from the read cache are stale right after a sync
        window.addEventListener('mylofi:offline-sync', () => {
            this.updateNetworkBanner();
            if (this.state.currentScreen !== 'main') return;
            if (['nutrition', 'workouts', 'history', 'statistics', 'templates'].includes(this.state.currentPage)) {
                this.renderPage(this.state.currentPage);
            }
        });

        // Re-render nutrition instantly when a queued meal finishes syncing
        // (pending → synced) so the carousel updates without a manual refresh.
        window.addEventListener('mylofi:meal-synced', () => {
            if (this.state.currentScreen !== 'main') return;
            if (this.state.currentPage === 'nutrition') {
                this.renderPage('nutrition');
            }
        });

        // Background sync completion from the service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'SYNC_COMPLETE') {
                    this.updateNetworkBanner();
                    if (this.state.currentScreen === 'main' && ['nutrition', 'workouts', 'history'].includes(this.state.currentPage)) {
                        this.renderPage(this.state.currentPage);
                    }
                }
            });
        }
    },

    async flushOfflineQueue() {
        if (!this.state.tokens.access) return;
        try {
            await SyncEngine.processQueue();
        } catch (e) {
            console.error('[App] Offline queue processing failed:', e);
        }
    },
    
    cacheElements() {
        this.elements = {
            screens: {
                landing: document.getElementById('screen-landing'),
                auth: document.getElementById('screen-auth'),
                main: document.getElementById('screen-main'),
            },
            pageContent: document.getElementById('page-content'),
            bottomNav: document.getElementById('bottom-nav'),
            navItems: document.querySelectorAll('.nav-item'),
            toastContainer: document.getElementById('toast-container'),
            modals: document.getElementById('modals'),
        };
        console.log('[App] Cache elements:', this.elements);
    },

    setupNetworkBanner() {
        NetworkBanner.init();
    },

    updateNetworkBanner() {
        NetworkBanner.refresh();
    },

    isAIOnline() {
        return this.state.isOnline;
    },

    loadTokens() {
        this.state.tokens.access = localStorage.getItem('access_token');
        this.state.tokens.refresh = localStorage.getItem('refresh_token');
        const user = localStorage.getItem('user');
        if (user) this.state.user = JSON.parse(user);
    },
    
    saveTokens() {
        localStorage.setItem('access_token', this.state.tokens.access);
        localStorage.setItem('refresh_token', this.state.tokens.refresh);
        localStorage.setItem('user', JSON.stringify(this.state.user));
    },
    
    clearTokens() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        this.state.tokens = { access: null, refresh: null };
        this.state.user = null;
    },

    async refreshAccessToken() {
        if (!this.state.tokens.refresh) {
            console.error('[App] No refresh token available');
            return false;
        }
        try {
            const response = await API.post('/auth/refresh', { refresh_token: this.state.tokens.refresh });
            this.state.tokens.access = response.access_token;
            this.state.tokens.refresh = response.refresh_token;
            this.saveTokens();
            return true;
        } catch (error) {
            console.error('[App] Token refresh failed:', error);
            // Network errors should not wipe tokens — the user is still authenticated,
            // just temporarily offline. Re-throw so handleUnauthorized can preserve them.
            if (error?.isNetworkError) {
                throw error;
            }
            this.clearTokens();
            return false;
        }
    },
    
    async validateToken() {
        try {
            const user = await API.get('/users/me', this.state.tokens.access);
            this.state.user = user;
            this.showScreen('main');
            this.showPage('nutrition');
        } catch (error) {
            console.error('[App] Token validation failed:', error);
            this.showScreen('landing');
            this.renderLanding();
        }
    },
    
    renderLanding() {
        console.log('[App] Rendering landing...');
        this.elements.screens.landing.innerHTML = `
            <div class="landing-page min-h-screen flex flex-col text-zinc-100 font-sans relative overflow-hidden">
                <!-- Ambient glow blobs -->
                <div class="absolute -top-20 -left-24 w-80 h-80 bg-gradient-to-br from-purple-500 to-indigo-600 opacity-[0.08] landing-glow rounded-full pointer-events-none"></div>
                <div class="absolute -bottom-20 -right-24 w-80 h-80 bg-gradient-to-tl from-fuchsia-500 to-purple-600 opacity-[0.06] landing-glow rounded-full pointer-events-none"></div>

                <div class="relative z-10 flex-1 flex flex-col max-w-5xl mx-auto px-6 pt-safe-top">
                    <!-- Header -->
                    <header class="flex items-center justify-between h-16">
                        <div class="flex items-center gap-3">
                            <div class="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20">
                                <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 8A6 6 0 006 8c0 4-3 6-3 6h18s-3-2-3-6"></path>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 18a2 2 0 100 4 2 2 0 000-4zm4 0a2 2 0 100 4 2 2 0 000-4z"></path>
                                </svg>
                                <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse-purple shadow-lg shadow-purple-500/50"></div>
                            </div>
                            <span class="text-xl font-bold text-zinc-100">MyLofi.live</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <button data-action="show-auth" class="px-5 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:border-white/20 transition-all">
                                Войти
                            </button>
                            <button data-action="show-register" class="px-5 py-2.5 rounded-xl bg-purple-600 text-white text-sm font-semibold shadow-lg shadow-purple-500/30 hover:bg-purple-700 transition-all btn-press">
                                Начать
                            </button>
                        </div>
                    </header>

                    <!-- Hero Section -->
                    <section class="flex-1 flex flex-col items-center text-center py-12">
                        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full landing-glass border border-white/10 mb-8">
                            <span class="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                            <span class="text-xs font-medium text-zinc-300">Трекинг в твоём собственном ритме</span>
                        </div>

                        <h1 class="text-4xl sm:text-5xl font-bold text-zinc-100 mb-6 max-w-2xl leading-tight">
                            Твой умный нутрициолог и журнал тренировок
                        </h1>

                        <p class="text-lg text-zinc-400 max-w-xl mb-10 leading-relaxed">
                            Контролируй КБЖУ, фиксируй рабочий вес и следи за прогрессом без суеты и лишнего шума в стильном тёмном интерфейсе
                        </p>

                        <div class="flex flex-col sm:flex-row gap-4">
                            <button data-action="show-register" class="px-8 py-3.5 rounded-xl bg-purple-600 text-white font-semibold shadow-lg shadow-purple-500/30 hover:bg-purple-700 transition-all btn-press">
                                Создать дневник
                            </button>
                            <button data-action="show-auth" class="px-8 py-3.5 rounded-xl border border-white/10 text-zinc-200 font-medium hover:bg-white/5 transition-all btn-press">
                                Уже есть аккаунт
                            </button>
                        </div>
                    </section>

                    <!-- Features Grid -->
                    <section class="grid grid-cols-1 md:grid-cols-3 gap-6 pb-12">
                        <div class="landing-glass-strong rounded-2xl p-6 border border-white/10">
                            <div class="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-4">
                                <svg class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0019.07 7H20a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 000 6z"></path>
                                </svg>
                            </div>
                            <h3 class="text-lg font-semibold text-zinc-100 mb-2">Учёт питания</h3>
                            <p class="text-sm text-zinc-400 leading-relaxed">Быстрый подсчёт калорий и макронутриентов, анализ блюд через ИИ и наглядный дневник рациона.</p>
                        </div>

                        <div class="landing-glass-strong rounded-2xl p-6 border border-white/10">
                            <div class="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-4">
                                <svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"></path>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"></path>
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v6M2.5 12h19"></path>
                                </svg>
                            </div>
                            <h3 class="text-lg font-semibold text-zinc-100 mb-2">Дневник зала</h3>
                            <p class="text-sm text-zinc-400 leading-relaxed">Удобный ввод подходов, повторов и весов, отслеживание прогрессирующей нагрузки.</p>
                        </div>

                        <div class="landing-glass-strong rounded-2xl p-6 border border-white/10">
                            <div class="w-12 h-12 rounded-xl bg-fuchsia-500/10 flex items-center justify-center mb-4">
                                <svg class="w-6 h-6 text-fuchsia-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"></path>
                                </svg>
                            </div>
                            <h3 class="text-lg font-semibold text-zinc-100 mb-2">Lofi-философия</h3>
                            <p class="text-sm text-zinc-400 leading-relaxed">Тёмная тема по умолчанию, лаконичный дизайн без визуального шума для полного фокуса на результате.</p>
                        </div>
                    </section>
                </div>

                <!-- Footer -->
                <footer class="text-center py-6 text-xs text-zinc-500">
                    © mylofi.live — Осознанный фитнес и нутрициология
                </footer>
            </div>
        `;
    },
    
    showScreen(screenName) {
        console.log(`[App] Showing screen: ${screenName}`);
        if (!this.elements.screens[screenName]) {
            console.error(`[App] Screen ${screenName} not found!`);
            return;
        }
        
        Object.values(this.elements.screens).forEach(screen => {
            if (screen) screen.classList.add('hidden');
        });
        
        this.elements.screens[screenName].classList.remove('hidden');
        this.state.currentScreen = screenName;
        
        if (this.elements.bottomNav) {
            this.elements.bottomNav.style.display = (screenName === 'main') ? 'block' : 'none';
        }
    },
    
    showPage(pageName) {
        console.log(`[App] Showing page: ${pageName}`);
        this.state.currentPage = pageName;
        this.elements.navItems.forEach(item => item.classList.toggle('active', item.dataset.page === pageName));
        this.renderPage(pageName);
    },
    
    async renderPage(pageName) {
        const container = this.elements.pageContent;
        if (!container) return;
        container.innerHTML = Components.loadingSpinner();
        try {
            if (pageName === 'nutrition') await Nutrition.render(container, this);
            else if (pageName === 'workouts') await Workouts.render(container, this);
            else if (pageName === 'camera') await Camera.render(container, this);
            else if (pageName === 'profile') await Profile.render(container, this);
            else if (pageName === 'history') await Workouts.renderHistory(container, this);
            else if (pageName === 'statistics') await Workouts.renderStatisticsScreen(container, this);
            else if (pageName === 'templates') await Workouts.renderTemplatesScreen(container, this);
        } catch (error) {
            console.error('[App] Render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки');
        }
    },

    setupEventListeners() {
        document.addEventListener('submit', (e) => {
            if (e.defaultPrevented) return;
            if (e.target.id === 'login-form') Auth.handleLogin(e, this);
            if (e.target.id === 'register-form') Auth.handleRegister(e, this);
        });

        document.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action) this.handleAction(action, e);

            const navItem = e.target.closest('.nav-item');
            if (navItem && navItem.dataset.page) {
                this.showPage(navItem.dataset.page);
            }
        });
    },

    async handleAction(action, event) {
        console.log(`[App] Action: ${action}`);
        switch (action) {
            case 'show-auth':
                this.showScreen('auth');
                Auth.renderLogin(this.elements.screens.auth, this);
                break;
            case 'show-register':
                this.showScreen('auth');
                Auth.renderRegister(this.elements.screens.auth, this);
                break;
            case 'view-history':
                this.showPage('history');
                break;
            case 'back-to-workouts':
                this.showPage('workouts');
                break;
            case 'show-build-workout':
                Workouts.showBuildWorkout(this);
                break;
            case 'resume-workout': {
                const sessionId = event.target.closest('[data-session-id]')?.dataset.sessionId;
                await Workouts.renderWorkoutScreen(this.elements.pageContent, this, sessionId ? parseInt(sessionId) : null);
                break;
            }
            case 'toggle-set':
                await this.handleToggleSet(event);
                break;
            case 'complete-workout':
                await this.handleCompleteWorkout(event);
                break;
            case 'cancel-workout':
                await this.handleCancelWorkout(event);
                break;
            case 'close-build-workout':
                Workouts.closeBuildModal();
                break;
            case 'set-theme': {
                const option = event.target.closest('[data-action="set-theme"]');
                const mode = option?.dataset.theme;
                if (!mode) break;
                Theme.set(mode);
                this.updateThemeControls(mode);
                this.showToast(
                    mode === 'system' ? 'Тема: системная' : (mode === 'dark' ? 'Тема: тёмная' : 'Тема: светлая'),
                    'info'
                );
                break;
            }
            case 'logout':
                this.clearTokens();
                this.showScreen('landing');
                this.renderLanding();
                break;
        }
    },

    async handleToggleSet(event) {
        const btn = event.target.closest('[data-action="toggle-set"]');
        const row = btn?.closest('[data-set-id]');
        if (!btn || !row) return;
        
        const set_id = row.dataset.setId;
        if (!set_id) return;
        
        const weightInput = row.querySelector('[data-field="weight"]');
        const repsInput = row.querySelector('[data-field="reps"]');
        const weight_kg = weightInput ? parseFloat(weightInput.value) : null;
        const reps = repsInput ? parseInt(repsInput.value) : null;

        const wasCompleted = btn.dataset.completed === 'true';
        const payload = { 
            is_completed: !wasCompleted,
            weight_kg: isNaN(weight_kg) ? null : weight_kg,
            reps: isNaN(reps) ? null : reps
        };
        
        // Update UI immediately (optimistic)
        btn.disabled = true;
        btn.textContent = '...';

        const applyState = (completed) => {
            btn.dataset.completed = String(completed);
            btn.className = TOGGLE_BASE + ' ' + (completed ? TOGGLE_COMPLETED : TOGGLE_UNCOMPLETED);
            const weightField = row.querySelector('[data-field="weight"]');
            const repsField = row.querySelector('[data-field="reps"]');
            if (weightField) weightField.readOnly = completed;
            if (repsField) repsField.readOnly = completed;
        };

        try {
            await API.patch(`/workouts/sets/${set_id}`, payload, this.state.tokens.access);

            // Update UI state
            applyState(!wasCompleted);
            if (!wasCompleted) {
                // Auto-scroll to next exercise if last set of current exercise
                const exerciseContainer = row.closest('.snap-center');
                const allSets = exerciseContainer.querySelectorAll('[data-action="toggle-set"]');
                const allCompleted = Array.from(allSets).every(b => b.dataset.completed === 'true');
                if (allCompleted) {
                    const carousel = document.getElementById('carousel');
                    if (carousel) {
                        const cardWidth = exerciseContainer.offsetWidth + 16; // 16 is gap
                        carousel.scrollBy({ left: cardWidth, behavior: 'smooth' });
                    }
                }
            }
            btn.textContent = '✓';
            btn.disabled = false;
        } catch (e) {
            if (e?.offlineQueued) {
                // Keep the optimistic state: the request is replayed from the sync queue.
                // Silent — the global network banner reflects offline/syncing status.
                applyState(!wasCompleted);
            } else {
                this.showToast(e.message || 'Ошибка обновления сета', 'error');
            }
            btn.disabled = false;
            btn.textContent = '✓';
        }
    },

    async handleCompleteWorkout(event) {
        const sessionId = event.target.closest('[data-session-id]')?.dataset.sessionId;
        if (!await Components.confirmModal({
            title: 'Завершить тренировку?',
            message: 'Все невыполненные подходы не будут сохранены.',
            confirmText: 'Завершить',
            confirmClass: 'bg-primary-600 hover:bg-primary-700 text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 font-semibold shadow-md',
            cancelText: 'Назад'
        })) return;

        // A session created offline has no server id yet: close it locally and queue the request
        if (Workouts.completeLocalSession(this)) {
            await this.renderPage('workouts');
            return;
        }

        // Flush all active weight and rep inputs before completing
        const inputs = document.querySelectorAll('[data-set-id] input[data-field]');
        const promises = Array.from(inputs).map(async input => {
            const row = input.closest('[data-set-id]');
            if (!row) return;
            const setId = parseInt(row.dataset.setId);
            const field = input.dataset.field;
            const value = field === 'weight' ? parseFloat(input.value) : parseInt(input.value);
            if (!isNaN(value)) {
                await API.patch(`/workouts/sets/${setId}`, { [field]: value }, this.state.tokens.access).catch(() => {});
            }
        });
        await Promise.all(promises);

        try {
            await API.post(`/workouts/sessions/${sessionId}/complete`, null, this.state.tokens.access);
            this.showToast('Тренировка завершена!', 'success');
        } catch (e) {
            if (e?.offlineQueued) {
                // Session is closed locally, the request goes out as soon as the network is back
                await Workouts.markSessionCompletedLocally(sessionId);
                this.showToast('Тренировка завершена! Сеть недоступна, данные будут синхронизированы при появлении связи', 'info');
                await this.renderPage('workouts');
                return;
            }
            this.showToast(e.message || 'Ошибка завершения тренировки', 'error');
            return;
        }
        await this.renderPage('workouts');
    },

    async handleCancelWorkout(event) {
        const sessionId = event.target.closest('[data-session-id]')?.dataset.sessionId;
        if (!await Components.confirmModal({
            title: 'Сбросить тренировку?',
            message: 'Прогресс этой сессии будет полностью утерян.',
            confirmText: 'Сбросить тренировку',
            confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md',
            cancelText: 'Назад'
        })) return;
        if (Workouts.cancelLocalSession(this)) {
            await this.renderPage('workouts');
            return;
        }
        try {
            await API.post(`/workouts/sessions/${sessionId}/cancel`, null, this.state.tokens.access);
            this.showToast('Тренировка отменена', 'info');
        } catch (e) {
            if (e?.offlineQueued) {
                await Workouts.markSessionCancelledLocally(sessionId);
                this.showToast('Тренировка отменена', 'info');
                await this.renderPage('workouts');
                return;
            }
            this.showToast(e.message || 'Ошибка отмены тренировки', 'error');
            return;
        }
        await this.renderPage('workouts');
    },

    updateThemeControls(mode) {
        document.querySelectorAll('[data-action="set-theme"]').forEach(btn => {
            const isActive = btn.dataset.theme === mode;
            btn.className = THEME_OPTION_BASE + ' ' + (isActive ? THEME_OPTION_ACTIVE : THEME_OPTION_IDLE);
            btn.setAttribute('aria-pressed', String(isActive));
        });
    },

    showToast(message, type = 'info') {
        console.log(`[Toast] ${type}: ${message}`);
        const container = this.elements.toastContainer;
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast-enter px-4 py-2 rounded-xl text-sm font-medium shadow-lg pointer-events-auto
            ${type === 'error' ? 'bg-red-500 text-white' : ''}
            ${type === 'success' ? 'bg-primary-600 text-white dark:bg-zinc-100 dark:text-zinc-950' : ''}
            ${type === 'info' ? 'bg-primary-600 text-white dark:bg-zinc-100 dark:text-zinc-950' : ''}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.remove('toast-enter');
            toast.classList.add('toast-exit');
            setTimeout(() => container.removeChild(toast), 200);
        }, 3000);
    },
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
export { App };