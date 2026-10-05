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
        const card = (icon, title, text, extra = '') => `
            <article class="landing-glass-strong rounded-2xl p-6 shadow-sm">
                <div class="w-12 h-12 rounded-xl bg-lime-500/10 text-lime-400 flex items-center justify-center mb-4">
                    ${icon}
                </div>
                <h3 class="text-base sm:text-lg font-semibold text-zinc-100 mb-2">${title}</h3>
                <p class="text-sm text-zinc-400 leading-relaxed">${text}</p>
                ${extra}
            </article>
        `;

        this.elements.screens.landing.innerHTML = `
            <div class="landing-page h-full w-full overflow-y-auto overflow-x-hidden">
                <div class="relative min-h-full flex flex-col text-zinc-100 font-sans">
                    <!-- Ambient glow blobs -->
                    <div class="absolute -top-20 -left-24 w-80 h-80 bg-gradient-to-br from-lime-500 to-emerald-600 opacity-[0.08] landing-glow rounded-full pointer-events-none"></div>
                    <div class="absolute -bottom-20 -right-24 w-80 h-80 bg-gradient-to-tl from-lime-400 to-emerald-600 opacity-[0.06] landing-glow rounded-full pointer-events-none"></div>

                    <!-- Sticky header -->
                    <header class="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md">
                        <div class="max-w-5xl mx-auto w-full px-6">
                            <div class="flex items-center justify-between h-16">
                                <div class="flex items-center gap-3">
                                    <div class="relative flex items-center justify-center w-10 h-10 rounded-xl bg-lime-500/10 border border-lime-500/20 shadow-[0_0_20px_rgba(132,204,22,0.18)]">
                                        <svg class="w-5 h-5 text-lime-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 8A6 6 0 006 8c0 4-3 6-3 6h18s-3-2-3-6"></path>
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 18a2 2 0 100 4 2 2 0 000-4zm4 0a2 2 0 100 4 2 2 0 000-4z"></path>
                                        </svg>
                                        <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-lime-500 animate-pulse-lime shadow-lg shadow-lime-500/50"></div>
                                    </div>
                                    <span class="text-lg sm:text-xl font-bold text-zinc-100">MyLofi.live</span>
                                </div>

                                <!-- Desktop navigation -->
                                <div class="hidden md:flex items-center gap-3">
                                    <nav class="flex items-center gap-1 mr-2">
                                        <a href="#landing-nutrition" class="px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">Питание</a>
                                        <a href="#landing-workouts" class="px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">Тренировки</a>
                                        <a href="#landing-synergy" class="px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors">ИИ-Синергия</a>
                                    </nav>
                                    <button data-action="show-auth" class="px-5 py-2.5 rounded-xl border border-zinc-800 text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 hover:bg-zinc-900 transition-all">
                                        Войти
                                    </button>
                                    <button data-action="show-register" class="px-5 py-2.5 rounded-xl bg-lime-500 text-zinc-950 text-sm font-semibold shadow-[0_0_20px_rgba(132,204,22,0.25)] hover:bg-lime-400 transition-all btn-press">
                                        Создать дневник
                                    </button>
                                </div>

                                <!-- Mobile hamburger -->
                                <button data-action="toggle-landing-menu" aria-label="Открыть меню" aria-expanded="false" class="md:hidden w-10 h-10 flex items-center justify-center rounded-xl border border-zinc-800 text-zinc-300 hover:text-lime-400 hover:border-zinc-700 transition-colors">
                                    <svg class="landing-menu-icon-bars w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M4 12h16M4 17h16"></path>
                                    </svg>
                                    <svg class="landing-menu-icon-close w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </header>

                    <!-- Mobile menu overlay -->
                    <div data-landing-menu class="md:hidden">
                        <div data-landing-menu-backdrop data-action="close-landing-menu" class="landing-menu-backdrop fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm"></div>
                        <div data-landing-menu-panel class="landing-menu fixed left-0 right-0 top-0 z-50 pt-safe-top bg-zinc-950/95 backdrop-blur-xl border-b border-zinc-800 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.9)]">
                            <div class="flex items-center justify-between h-16 px-6">
                                <span class="text-lg font-bold text-zinc-100">MyLofi.live</span>
                                <button data-action="close-landing-menu" aria-label="Закрыть меню" class="w-10 h-10 flex items-center justify-center rounded-xl border border-zinc-800 text-zinc-300 hover:text-lime-400 hover:border-zinc-700 transition-colors">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"></path>
                                    </svg>
                                </button>
                            </div>
                            <nav class="px-6 pb-6 flex flex-col gap-1">
                                <a data-action="close-landing-menu" href="#landing-nutrition" class="px-4 py-3 rounded-xl text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">Питание</a>
                                <a data-action="close-landing-menu" href="#landing-workouts" class="px-4 py-3 rounded-xl text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">Тренировки</a>
                                <a data-action="close-landing-menu" href="#landing-synergy" class="px-4 py-3 rounded-xl text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">ИИ-Синергия</a>
                                <div class="h-px bg-zinc-800 my-3"></div>
                                <button data-action="show-auth" class="w-full px-4 py-3 rounded-xl border border-zinc-800 text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 transition-colors">
                                    Войти
                                </button>
                                <button data-action="show-register" class="w-full px-4 py-3 rounded-xl bg-lime-500 text-zinc-950 text-sm font-semibold shadow-[0_0_20px_rgba(132,204,22,0.25)] hover:bg-lime-400 transition-all btn-press">
                                    Создать дневник
                                </button>
                            </nav>
                        </div>
                    </div>

                    <!-- Page body -->
                    <div class="relative z-10 flex-1 w-full">

                        <!-- Hero -->
                        <section class="max-w-5xl mx-auto w-full px-6 pt-16 pb-20 sm:pt-24 sm:pb-24 flex flex-col items-center text-center">
                            <span class="text-xs font-semibold text-lime-400 uppercase tracking-wider bg-lime-500/10 border border-lime-500/20 px-3 py-1 rounded-full mb-8">
                                ИИ-нутрициолог и журнал тренировок
                            </span>

                            <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold text-zinc-100 tracking-tight leading-tight mb-6 max-w-3xl">
                                Твой умный нутрициолог и журнал тренировок
                            </h1>

                            <p class="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-2xl mb-10">
                                Контролируй КБЖУ, фиксируй рабочий вес и следи за прогрессом без суеты в лаконичном тёмном интерфейсе
                            </p>

                            <div class="flex flex-col sm:flex-row gap-4">
                                <button data-action="show-register" class="px-6 sm:px-8 py-3.5 rounded-xl bg-lime-500 text-zinc-950 font-semibold shadow-[0_0_20px_rgba(132,204,22,0.25)] hover:bg-lime-400 transition-all btn-press">
                                    Начать использовать
                                </button>
                                <button data-action="show-auth" class="px-6 sm:px-8 py-3.5 rounded-xl border border-zinc-800 text-zinc-200 font-medium hover:bg-zinc-900 hover:border-zinc-700 transition-all btn-press">
                                    Уже есть аккаунт
                                </button>
                            </div>
                        </section>

                        <!-- Section 1: Питание -->
                        <section id="landing-nutrition" class="scroll-mt-20 max-w-5xl mx-auto w-full px-6 py-16 sm:py-20">
                            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Питание и рацион</p>
                            <h2 class="text-2xl sm:text-3xl font-bold text-zinc-100 tracking-tight mb-3 max-w-2xl">
                                Глубокая ИИ-оценка качества еды, а не просто цифры
                            </h2>
                            <p class="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-2xl mb-10">
                                Одно фото — и в дневнике появляется не только расклад по КБЖУ, но и полный разбор того, что ты ешь.
                            </p>

                            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0019.07 7H20a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 000 6z"></path>
                                    </svg>`,
                                    'КБЖУ из фото',
                                    'Сфотографируй блюдо — ИИ распознает состав и сразу добавит калории, белки, жиры и углеводы в дневник.')}
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                    </svg>`,
                                    'Оценка качества еды',
                                    'Разбор жирнокислотного состава, чистоты ингредиентов и нутриентной плотности каждого приёма пищи.')}
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                                    </svg>`,
                                    'Итоговый балл 0–100',
                                    'Оценка влияния рациона на здоровье: насколько блюдо насыщает, а насколько перегружает организм.')}
                            </div>
                        </section>

                        <!-- Section 2: Тренировки -->
                        <section id="landing-workouts" class="scroll-mt-20 max-w-5xl mx-auto w-full px-6 py-16 sm:py-20">
                            <p class="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Тренировки и объём</p>
                            <h2 class="text-2xl sm:text-3xl font-bold text-zinc-100 tracking-tight mb-3 max-w-2xl">
                                Прогрессивная нагрузка под контролем
                            </h2>
                            <p class="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-2xl mb-10">
                                Собери свою программу, фиксируй каждую рабочую сессию и видишь, как растёт объём от недели к неделе.
                            </p>

                            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v6M2.5 12h19"></path>
                                    </svg>`,
                                    'Конструктор и журнал',
                                    'Собери собственную программу тренировок и фиксируй подходы, повторы и рабочий вес в пару касаний.')}
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V5m0 14a2 2 0 100 4 2 2 0 000-4zm0-14a2 2 0 100-4 2 2 0 000 4zm6 0v14m0 0a2 2 0 100 4 2 2 0 000-4zm0-18a2 2 0 100-4 2 2 0 000 4z"></path>
                                    </svg>`,
                                    'Тоннаж и прогрессия',
                                    'Общий объём, количество подходов и серия недель подряд — динамика нагрузки без ручных расчётов.')}
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                    </svg>`,
                                    'Разбор и восстановление',
                                    'Автоматический анализ выполненной тренировки и персональные рекомендации по восстановлению.',
                                    '<span class="inline-flex items-center mt-4 text-[10px] font-semibold uppercase tracking-wider text-lime-400 bg-lime-500/10 border border-lime-500/20 px-2.5 py-1 rounded-full">Скоро</span>')}
                            </div>
                        </section>

                        <!-- Section 3: Синергия -->
                        <section id="landing-synergy" class="scroll-mt-20 max-w-5xl mx-auto w-full px-6 py-16 sm:py-20">
                            <p class="text-xs font-semibold text-lime-400 uppercase tracking-wider mb-2">Уникальная синергия</p>
                            <h2 class="text-2xl sm:text-3xl font-bold text-zinc-100 tracking-tight mb-3 max-w-2xl">
                                Связка питания и тренировок в одном ИИ-ядре
                            </h2>
                            <p class="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-2xl mb-10">
                                MyLofi анализирует не два журнала по отдельности, а их взаимосвязь — то, что не умеет ни одно изолированное приложение.
                            </p>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5"></path>
                                    </svg>`,
                                    'Сквозной анализ данных',
                                    'ИИ сопоставляет твой рацион с фактической нагрузкой и видит картину целиком, а не два разрыва журнала.')}
                                ${card(`
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                                    </svg>`,
                                    'Точечные корректировки',
                                    'Находит узкие места и слабые звенья восстановления, подсказывая, сколько калорий или объёма добавить именно тебе.')}
                            </div>
                        </section>

                        <!-- Final CTA -->
                        <section class="max-w-5xl mx-auto w-full px-6 py-16 sm:py-20">
                            <div class="landing-glass rounded-3xl p-8 sm:p-12 text-center shadow-sm">
                                <h2 class="text-2xl sm:text-3xl font-bold text-zinc-100 tracking-tight mb-3 max-w-2xl mx-auto">
                                    Начни свой путь к осознанному фитнесу
                                </h2>
                                <p class="text-sm sm:text-base text-zinc-400 leading-relaxed max-w-xl mx-auto mb-8">
                                    Один аккаунт — дневник питания, журнал тренировок и ИИ-анализ, работающие вместе.
                                </p>
                                <button data-action="show-register" class="px-6 sm:px-8 py-3.5 rounded-xl bg-lime-500 text-zinc-950 font-semibold shadow-[0_0_20px_rgba(132,204,22,0.25)] hover:bg-lime-400 transition-all btn-press">
                                    Начать использовать
                                </button>
                            </div>
                        </section>
                    </div>

                    <!-- Footer -->
                    <footer class="relative z-10 text-center py-6 px-6 text-xs text-zinc-500">
                        © mylofi.live
                    </footer>
                </div>
            </div>
        `;
    },

    toggleLandingMenu(force) {
        const root = this.elements.screens.landing;
        if (!root) return;
        const toggleBtn = root.querySelector('[data-action="toggle-landing-menu"]');
        const backdrop = root.querySelector('[data-landing-menu-backdrop]');
        const panel = root.querySelector('[data-landing-menu-panel]');
        if (!toggleBtn || !backdrop || !panel) return;

        const isOpen = force ?? !panel.classList.contains('is-open');
        panel.classList.toggle('is-open', isOpen);
        backdrop.classList.toggle('is-open', isOpen);
        toggleBtn.classList.toggle('is-open', isOpen);
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
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
        // Any page change tears the workout screen down, so a break still being
        // timed is over: record the seconds that were actually taken instead of
        // letting the interval keep counting against a bar nobody can see.
        Workouts.stopRestTimer({ app: this });
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

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.toggleLandingMenu(false);
        });
    },

    async handleAction(action, event) {
        console.log(`[App] Action: ${action}`);
        switch (action) {
            case 'show-auth':
                this.toggleLandingMenu(false);
                this.showScreen('auth');
                Auth.renderLogin(this.elements.screens.auth, this);
                break;
            case 'show-register':
                this.toggleLandingMenu(false);
                this.showScreen('auth');
                Auth.renderRegister(this.elements.screens.auth, this);
                break;
            case 'toggle-landing-menu':
                this.toggleLandingMenu();
                break;
            case 'close-landing-menu':
                this.toggleLandingMenu(false);
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
            case 'complete-workout-ai':
                await Workouts.completeWorkoutWithAi(this, event);
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
            case 'activate-pro':
                await Profile.activatePro(this.elements.pageContent);
                break;
            case 'toggle-pro':
                await Profile.togglePro(this.elements.pageContent);
                break;
            case 'edit-anthropometrics':
                Profile.openAnthropometricsModal();
                break;
            case 'set-ai-persona':
                Profile.setPersona(
                    this.elements.pageContent,
                    event.target.closest('[data-action="set-ai-persona"]')?.dataset.value
                );
                break;
            case 'save-ai-persona':
                await Profile.savePersona(this.elements.pageContent);
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
        };

        try {
            await API.patch(`/workouts/sets/${set_id}`, payload, this.state.tokens.access);

            // Update UI state. Weight/reps stay editable when completed and the
            // carousel is never moved automatically.
            applyState(!wasCompleted);
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

        // The session ends here, so the break still running belongs to it: record
        // the seconds that were actually taken before anything is closed.
        Workouts.stopRestTimer({ app: this });

        // A session created offline has no server id yet: close it locally and queue the request
        if (Workouts.completeLocalSession(this)) {
            await this.renderPage('workouts');
            return;
        }

        // Flush all active weight and rep inputs before completing
        await this.flushPendingSetEdits();

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

    /**
     * Push every weight and rep the user has typed but not yet sent, so the
     * numbers a verdict is written about are the ones on screen. Shared by both
     * completion paths: the coach reads the completed sets, so a value still
     * sitting in an input would be analysed as the previous one.
     */
    async flushPendingSetEdits() {
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

        // The session ends here, so the break still running belongs to it: record
        // the seconds that were actually taken before anything is closed.
        Workouts.stopRestTimer({ app: this });

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