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
import { Utils, clientTimezone } from './utils.js';
import { Theme } from './theme.js';
import { Admin } from './admin.js';

const TOGGLE_BASE = 'flex-shrink-0 w-11 h-11 rounded-2xl text-xl font-bold transition-all flex items-center justify-center';
const TOGGLE_COMPLETED = 'bg-lime-400 text-zinc-950 border-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.4)]';
const TOGGLE_UNCOMPLETED = 'glass text-surface-400 dark:text-surface-500';

// How long a resume is considered to be the same resume. The app comes back
// through `visibilitychange` and through `focus`, and both fire within a
// fraction of a second of each other.
const RESUME_DEBOUNCE_MS = 1000;

// How long a confirmed session is trusted. A window focus and a visibility
// change report the same resume, and every request checks the token anyway.
const SESSION_REVALIDATE_INTERVAL_MS = 60000;

// Screenshot assets — one primary slide per chapter, plus optional extra
// slides for the chapters that already have several screenshots on disk.
// The phone carousel cross-fades between the slides of the active chapter.
//
// Declared at module scope (not inside renderLanding) so the theme-aware
// helpers `landingImageSrc` / `applyLandingTheme` can read it after a theme
// toggle fires from `handleAction` — a closure over a local `const` inside
// renderLanding would throw ReferenceError on every subsequent toggle.
const SHOWCASE_IMAGES = [
    {
        folder: 'nutrition',
        alt: 'Питание',
        slides: [
            { black: '1.png', white: '1.png' },
            { black: '2.png', white: '2.png' },
            { black: '3.png', white: '3.png' },
            { black: '4.png', white: '4.png' },
            { black: '5.png', white: '5.png' },
        ],
    },
    {
        folder: 'workout',
        alt: 'Тренировки',
        slides: [
            { black: '1.png', white: '1.png' },
            { black: '2.png', white: '2.png' },
            { black: '3.png', white: '3.png' },
            { black: '4.png', white: '4.png' },
            { black: '5.png', white: '5.png' },
            { black: '6.png', white: '6.png' },
        ],
    },
    {
        folder: 'sinergy',
        alt: 'ИИ-Синергия',
        slides: [
            { black: '1.png', white: '1.png' },
            { black: '2.png', white: '2.png' },
        ],
    },
];

const getChapterSlides = (chapterIndex) => SHOWCASE_IMAGES?.[chapterIndex]?.slides || [];

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
        // Set when the user leaves the workout tracking screen on purpose
        // (the back arrow). The resume handler honours it and does not pull
        // the user back into the workout they just closed.
        workoutScreenDismissed: false,
        landingCarouselState: {},
        _showcaseImages: null,
        landingThemeState: { mode: 'system', dark: false },
    },
    
    elements: {},

    /**
     * The live channel to the backend (see RealtimeSocket).
     *
     * It only carries notifications - "this analysis is done" - and never
     * data the REST endpoints do not also serve, so a socket that is down
     * costs the app an instant update and nothing else.
     */
    realtime: null,

    // How often the live channel may renew its token after a refused
    // handshake. One is enough: a second refusal with a fresh token means
    // the session itself is gone.
    _realtimeAuthRetries: 0,

    // The renewal that is currently running, so two callers cannot spend
    // the same refresh token twice.
    _realtimeConnectPromise: null,

    // The resume sequence that is currently running. A resume is seen
    // through several events (`visibilitychange` and `focus`), and all of
    // them have to end up in a single sequence, not in one sequence each.
    _resumePromise: null,

    // When the last resume was handled. A second event within the debounce
    // window is the same resume seen twice and is ignored.
    _lastResumeAt: 0,

    // When the session was last confirmed with the server.
    _lastValidatedAt: 0,
    
     async init() {
        console.log('[App] Initializing...');
        Theme.init();
        this.cacheElements();
        this.Components = Components; // Expose Components for auth modal handling
        this.Auth = Auth; // Expose Auth for components

        try {
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
            Nutrition.init(this);

            // DB init is non-critical
            try {
                await DB.init();
                await this.initSyncEngine();
            } catch (e) {
                console.warn('[App] DB/Sync init failed:', e);
            }

            if (this.state.tokens.access) {
                console.log('[App] Token found, validating...');
                // Defer validation to background to allow cache-first render
                this.validateToken().then(() => this.initSyncEngine()).catch((e) => {
                    console.error('[App] Token validation failed:', e);
                    if (e?.isNetworkError || !navigator.onLine || !this.state.isOnline) {
                        console.warn('[App] Network error during init token validation; retaining offline session.');
                        this.showScreen('main');
                        const { page, workout } = this.loadState();
                        if (workout) {
                            this.state.activeWorkout = workout;
                            this.showPage('workouts');
                        } else {
                            this.showPage(page || 'nutrition');
                        }
                    } else {
                        this.showScreen('landing');
                        this.renderLanding();
                    }
                });
                // Also proactively show main screen if we have cached session
                this.showScreen('main');
                const { page: initialPage, workout: initialWorkout, sessionId: initialSessionId } = this.loadState();
                if (initialWorkout || initialSessionId) {
                    this.state.activeWorkout = initialWorkout || this.state.activeWorkout;
                    if (initialSessionId && !this.state.currentSessionId) {
                        this.state.currentSessionId = initialSessionId;
                    }
                    this.showScreen('main');
                    this.showPage('workouts');
                    try {
                        const sessionId = initialSessionId || this.state.currentSessionId;
                        if (sessionId && window.Workouts && typeof window.Workouts.renderWorkoutScreen === 'function') {
                            let id = sessionId;
                            if (typeof id === 'string') {
                                if (id.startsWith('local-')) {
                                    id = id;
                                } else if (!isNaN(parseInt(id))) {
                                    id = parseInt(id);
                                }
                            }
                            await window.Workouts.renderWorkoutScreen(this.elements.pageContent, this, id);
                        }
                    } catch (e) {
                        console.warn('[App] Failed to auto-resume workout session:', e);
                    }
                } else {
                    this.showPage(initialPage || 'nutrition');
                }
            } else {
                this.showScreen('landing');
                this.renderLanding();
            }

            // Host reachability check on warm init: navigator.onLine is
            // unreliable under L3 blocks and captive portals, so probe the
            // backend /health endpoint and flush any queued mutations if the
            // host is actually reachable.
            await this.checkHostConnectivity();
        } finally {
            // Hide splash screen after auth determination — always, even if
            // rendering or auth check threw an error. Otherwise a UI exception
            // leaves the spinner visible forever.
            this.hideSplash();
        }

        console.log('[App] Initialized');
    },

    async initSyncEngine() {
        const onItemSynced = async (item, response, meta) => {
            try { await Workouts.handleSyncedItem(item, response, meta); } catch (e) { console.error('[App] handleSyncedItem:', e); }
            try { await Camera.handleSyncedMeal(item, response, meta); } catch (e) { console.error('[App] handleSyncedMeal:', e); }
        };
        const onOnline = () => {
            this.state.isOnline = true;
            this.updateNetworkBanner(true);
            // Event-driven refresh: when network returns, flush the sync queue
            // and re-render the active page so pending meals show real results.
            this.checkHostConnectivity().then((reachable) => {
                if (reachable && this.state.tokens.access && !SyncEngine.authFailed) {
                    this.flushOfflineQueue().catch(() => {});
                    this.refreshCurrentView();
                }
            });
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

        window.addEventListener('online', async () => {
            console.log('[App] Network regained, revalidating session');
            // The socket was waiting for exactly this moment.
            this.connectRealtime();
            // Coming back online is a resume in every way that matters: the
            // session has to be alive again and the workout has to be found
            // again, but the view the user is on stays as it is.
            await this.handleAppResume('online');
            this.refreshCurrentView();
        });

        // The app comes back from the background in two different ways:
        // `visibilitychange` on mobile browsers and `focus` on desktop and
        // on iOS Safari PWAs, where the visibility event is unreliable.
        // Both funnel into the same handler, which is single flighted, so a
        // resume never re-renders the view that is already on top.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            this.handleAppResume('visibility');
        });

        window.addEventListener('focus', () => {
            if (document.visibilityState !== 'visible') return;
            this.handleAppResume('focus');
        });

        // Lists rendered from the read cache are stale right after a sync
        window.addEventListener('mylofi:offline-sync', () => {
            this.updateNetworkBanner(true);
            if (this.state.currentScreen !== 'main') return;
            if (['nutrition', 'workouts', 'history', 'statistics', 'templates'].includes(this.state.currentPage)) {
                this.refreshCurrentView();
            }
        });

        // Re-render nutrition instantly when a queued meal finishes syncing
        // (pending → synced) so the carousel updates without a manual refresh.
        window.addEventListener('mylofi:meal-synced', () => {
            if (this.state.currentScreen !== 'main') return;
            if (this.state.currentPage === 'nutrition') {
                this.refreshCurrentView();
            }
        });

        // Sync engine halts and dispatches this when a queued replay hits 401/403
        // after refresh failed. Sign out and go to the landing screen.
        window.addEventListener('mylofi:auth-failed', () => {
            console.warn('[App] Received auth-failed from SyncEngine, signing out');
            this.clearTokens();
            this.showScreen('landing');
            this.renderLanding();
            this.showToast('Сессия истекла. Пожалуйста, войдите снова.', 'info');
        });

        // Background sync completion from the service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'SYNC_COMPLETE') {
                    this.updateNetworkBanner(true);
                    if (this.state.currentScreen === 'main' && ['nutrition', 'workouts', 'history'].includes(this.state.currentPage)) {
                        this.refreshCurrentView();
                    }
                }
            });
        }
    },

    async flushOfflineQueue() {
        // Don't flush if the session is already known to be invalid: the
        // queue items will all get 401/403 and trigger repeated refresh
        // attempts that can never succeed.
        if (!this.state.tokens.access) return;
        if (SyncEngine.authFailed) {
            console.log('[App] Auth session invalid, skipping offline queue flush');
            return;
        }
        try {
            await SyncEngine.processQueue();
        } catch (e) {
            console.error('[App] Offline queue processing failed:', e);
        }
    },

    /**
     * Whether the workout tracking screen is the view on top.
     *
     * The tracking screen is the one view whose state must never be lost:
     * it holds the weights and reps the user typed, the scroll position of
     * the exercise carousel and the running timer. Every re-render of the
     * page throws all of that away, so the resume handler asks this
     * question before it touches anything.
     */
    isWorkoutScreenOpen() {
        return !!this.elements.pageContent?.querySelector('#workout-container');
    },

    /**
     * The workout that is in progress, as the server and the local storage
     * see it.
     *
     * A workout started offline only exists in the local storage until the
     * queue syncs it, so both sources are consulted. Returns null when
     * nothing is running.
     */
    async resolveActiveWorkout() {
        const token = this.state.tokens?.access || null;
        let serverSession = null;
        try {
            // Read fresh: the read cache may still hold a session that was
            // completed minutes ago.
            serverSession = await API.getFresh('/workouts/sessions/active', token);
        } catch (error) {
            console.warn('[App] Active workout lookup failed:', error);
        }

        // A workout started offline lives only in the local storage until
        // the queue syncs it, so both sides are consulted.
        const localSession = Workouts.getActiveLocalSession();
        let active = serverSession;
        let isLocal = false;
        if (!active) {
            active = localSession;
            isLocal = !!active;
        } else if (active.id && Workouts.isSessionClosedLocally(active.id)) {
            // Completed or cancelled offline and not yet replayed on the
            // server: the local decision wins.
            active = null;
        }

        if (!active) return null;
        return {
            sessionId: active.isLocal ? active.key : active.id,
            session: active,
            isLocal,
        };
    },

    /**
     * Check that the session is still alive without touching the view.
     *
     * `validateToken()` re-renders the page it validates, which is exactly
     * what a resume must not do, so the resume path asks this quiet check
     * instead. Returns false when the session is gone for good.
     */
    async revalidateSession() {
        try {
            const user = await API.getFresh('/users/me', this.state.tokens.access);
            if (user) this.state.user = user;
            return true;
        } catch (error) {
            if (error?.isNetworkError || !navigator.onLine) {
                // The network is down: the cached session stays valid.
                return true;
            }
            console.warn('[App] Session revalidation failed:', error);
            // A failed renewal has already signed the user out.
            if (!this.state.tokens?.access) return false;
            this.clearTokens();
            this.showScreen('landing');
            this.renderLanding();
            return false;
        }
    },

    /**
     * Make sure the session is still alive, but not on every single event.
     *
     * A window focus and a visibility change report the same resume, and
     * every request the app makes checks the token anyway, so a session
     * that was confirmed a moment ago does not have to be confirmed again.
     */
    async ensureSessionAlive() {
        if (Date.now() - this._lastValidatedAt < SESSION_REVALIDATE_INTERVAL_MS) return true;
        const alive = await this.revalidateSession();
        if (alive) this._lastValidatedAt = Date.now();
        return alive;
    },

    /**
     * Bring the app back after it was in the background.
     *
     * Single flight: `visibilitychange` and `focus` both report the same
     * resume, and only one of them may run the sequence.
     */
    async handleAppResume(source = 'resume') {
        if (this._resumePromise) return this._resumePromise;
        this._resumePromise = this.runAppResume(source)
            .catch((error) => console.warn('[App] Resume handling failed:', error))
            .finally(() => {
                this._resumePromise = null;
            });
        return this._resumePromise;
    },

    /**
     * The resume sequence itself.
     *
     * A backgrounded tab is frozen by the browser and the socket it held is
     * usually gone, so the resume re-establishes the channel and the
     * session. What it does NOT do is re-render the view: the page the
     * user left is the page they come back to, and the workout tracking
     * screen keeps the values they typed, the position of the carousel and
     * the running timer.
     */
    async runAppResume(source) {
        // A resume is reported by several events in a row; the second one
        // must not start a second sequence.
        const now = Date.now();
        if (now - this._lastResumeAt < RESUME_DEBOUNCE_MS) {
            console.log(`[App] Resume already handled, ignoring "${source}"`);
            return;
        }
        this._lastResumeAt = now;

        if (this.state.currentScreen !== 'main' || !this.state.tokens?.access) return;

        // If the sync engine already flagged the session as invalid (e.g.
        // a 401 on /auth/refresh), don't waste more requests — the user has
        // already been redirected to the landing screen.
        if (SyncEngine.authFailed) return;

        console.log(`[App] App resumed (${source})`);

        // A backgrounded tab can have its socket suspended or dropped by the
        // mobile browser; reconnecting is cheap and the channel heals itself.
        this.connectRealtime();

        const reachable = await this.checkHostConnectivity();
        if (!reachable) {
            // Offline: the view, the local session and the typed values stay
            // as they are, and the timer only has to be woken up.
            this.rearmWorkoutTimer();
            return;
        }

        if (!await this.ensureSessionAlive()) return;

        // The active workout is looked up before anything is rendered: the
        // server knows whether a session is still running, and the local
        // storage knows about the ones that were started offline.
        const active = await this.resolveActiveWorkout();

        if (this.isWorkoutScreenOpen()) {
            if (!active) {
                // The session was completed or cancelled elsewhere - the
                // tracking screen is stale, so fall back to the dashboard.
                console.log('[App] The active workout is gone, leaving the tracking screen');
                this.state.currentSessionId = null;
                this.state.activeWorkout = null;
                this.state.workoutScreenDismissed = false;
                this.saveState();
                this.renderPage('workouts');
                return;
            }

            if (this.isSameActiveSession(active)) {
                // The very same workout is on screen: the DOM stays exactly
                // as it is, and the timer is woken up.
                this.rearmWorkoutTimer(active.session);
                return;
            }

            if (this.state.workoutScreenDismissed) {
                // The user closed the workout on purpose - do not pull them back.
                return;
            }

            // Another workout is running now: the tracking screen is
            // re-rendered for it, still without leaving the page.
            console.log('[App] Another workout is active, switching the tracking screen');
            await this.openWorkoutScreen(active);
            return;
        }

        // The tracking screen is not on top, so the page the user is on
        // stays exactly as it is. The only exception is the workout
        // dashboard with a running workout: the tracking screen is then
        // opened, the same way a cold start opens it.
        if (!active) return;
        if (this.state.currentPage !== 'workouts') return;
        if (this.state.workoutScreenDismissed) return;
        await this.openWorkoutScreen(active);
    },

    /**
     * Open the tracking screen of a workout.
     *
     * The dashboard is skipped on purpose: it would flash up in between and
     * the scroll position of the exercise carousel would be lost.
     */
    async openWorkoutScreen(active) {
        if (active.isLocal) {
            this.state.activeWorkout = this.localWorkoutMarker();
        }
        this.markPageActive('workouts');
        this.saveState();
        await Workouts.renderWorkoutScreen(this.elements.pageContent, this, active.sessionId);
    },

    /**
     * Whether two session references point at the same workout.
     *
     * A server session is a number and a session started offline is a
     * string key, so they are compared as text.
     */
    sameSession(a, b) {
        if (a == null || b == null) return false;
        return String(a) === String(b);
    },

    /**
     * Whether the workout on screen is the one that is still running.
     *
     * A workout started offline keeps its local key until the server knows
     * the session, so the two sides have to be compared through the local
     * session as well - otherwise a synced workout would look like a
     * different one and the tracking screen would be re-rendered.
     */
    isSameActiveSession(active) {
        if (!active) return false;
        if (this.sameSession(active.sessionId, this.state.currentSessionId)) return true;

        const localSession = Workouts.getActiveLocalSession();
        if (!localSession) return false;
        if (active.isLocal) {
            return this.sameSession(localSession.key, active.sessionId);
        }
        // The workout was started offline and has been synced since: the
        // local key and the server id point at the same workout.
        return !!localSession.remoteSessionId
            && this.sameSession(localSession.remoteSessionId, active.sessionId);
    },

    /**
     * Wake the workout timer up after the app was frozen.
     *
     * A backgrounded tab has its timers throttled or suspended by the
     * browser, so the interval that ticks the elapsed time is not running
     * any more. The tick itself is computed from the start of the session,
     * so restarting the interval is enough to get the right value back.
     */
    rearmWorkoutTimer(session = null) {
        if (!this.isWorkoutScreenOpen()) return;
        const active = session || Workouts.currentSession;
        if (!active) return;
        Workouts.startWorkoutTimer(active);
    },

    /**
     * The marker of a workout that was started offline, if there is one.
     *
     * The marker is what tells a cold start that a workout is still
     * running, so it has to survive every navigation.
     */
    localWorkoutMarker() {
        const localSession = Workouts.getActiveLocalSession();
        if (!localSession) return null;
        return { isLocal: true, key: localSession.key };
    },

    /**
     * Re-render the current page after a data change.
     *
     * The workout tracking screen is skipped on purpose: a re-render there
     * would throw away the values the user typed and the position of the
     * exercise carousel.
     */
    refreshCurrentView() {
        if (this.state.currentScreen !== 'main') return;
        if (this.isWorkoutScreenOpen()) return;
        this.renderPage(this.state.currentPage).catch((error) => {
            console.error('[App] View refresh failed:', error);
        });
    },

    /**
     * Highlight a page in the bottom navigation without rendering it.
     */
    markPageActive(pageName) {
        this.state.currentPage = pageName;
        this.elements.navItems?.forEach(item => item.classList.toggle('active', item.dataset.page === pageName));
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
            splash: document.getElementById('app-splash'),
        };
        console.log('[App] Cache elements:', this.elements);
    },

    setupNetworkBanner() {
        this.state.isOnline = navigator.onLine;
        NetworkBanner.init();
    },

    updateNetworkBanner(skipHostCheck = false) {
        NetworkBanner.refresh(skipHostCheck);
    },

    /**
     * Explicit backend host reachability check using a short AbortController
     * timeout. navigator.onLine is unreliable under L3 blocks and captive
     * portals (the interface reports online while HTTP requests time out), so
     * a lightweight GET /health probe is the source of truth.
     *
     * When the host is reachable and the offline banner was visible, this
     * flushes the IndexedDB sync queue and transitions to the clean hidden
     * state. When unreachable, it shows the offline banner immediately.
     */
    async checkHostConnectivity() {
        if (!navigator.onLine) {
            this.state.isOnline = false;
            NetworkBanner.showOffline();
            return false;
        }

        let reachable = false;
        try {
            reachable = await API.checkHostReachable();
        } catch (error) {
            console.warn('[App] Host reachability check failed:', error);
            reachable = false;
        }

        if (reachable) {
            this.state.isOnline = true;
            await NetworkBanner.refresh(true);
            // Only flush the offline queue when the session is still valid.
            // A reachable host with an expired token would make every queued
            // item return 401, so probe /users/me first and bail out (clearing
            // tokens) when the session is gone.
            if (this.state.tokens.access && !SyncEngine.authFailed) {
                const live = await this.ensureSessionAlive();
                if (live) {
                    await this.flushOfflineQueue();
                }
            }
        } else {
            this.state.isOnline = false;
            NetworkBanner.showOffline();
        }

        return reachable;
    },

    isAIOnline() {
        return this.state.isOnline;
    },

    loadTokens() {
        this.state.tokens.access = localStorage.getItem('access_token');
        this.state.tokens.refresh = localStorage.getItem('refresh_token');
        const user = localStorage.getItem('user');
        if (user) {
            try {
                this.state.user = JSON.parse(user);
            } catch (e) {
                this.state.user = null;
            }
        }
    },
    
    saveState() {
        if (this.state.currentPage) {
            localStorage.setItem('last_active_page', this.state.currentPage);
        }
        // A workout that was started offline lives in the local storage
        // until the queue syncs it. Its marker has to survive a navigation:
        // without it a cold start would not find the session any more.
        const activeWorkout = this.state.activeWorkout || this.localWorkoutMarker();
        if (activeWorkout) {
            try {
                localStorage.setItem('active_workout', JSON.stringify(activeWorkout));
            } catch (e) {
                localStorage.removeItem('active_workout');
            }
        } else {
            localStorage.removeItem('active_workout');
        }
        if (this.state.currentSessionId) {
            localStorage.setItem('active_session_id', String(this.state.currentSessionId));
        } else {
            localStorage.removeItem('active_session_id');
        }
    },
    
    loadState() {
        const lastPage = localStorage.getItem('last_active_page');
        const activeWorkout = localStorage.getItem('active_workout');
        const activeSessionId = localStorage.getItem('active_session_id');
        let parsedWorkout = null;
        if (activeWorkout) {
            try {
                parsedWorkout = JSON.parse(activeWorkout);
            } catch (e) {
                parsedWorkout = null;
                localStorage.removeItem('active_workout');
            }
        }
        return {
            page: lastPage || 'nutrition',
            workout: parsedWorkout,
            sessionId: activeSessionId || null
        };
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
        // The live channel is authenticated with the access token, so it
        // goes down with it.
        this.disconnectRealtime();
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
            // The live channel authenticates with the access token, so the
            // socket has to hand the renewed one to its next handshake.
            this.realtime?.setToken(response.access_token);
            // A successful refresh means the session is valid again: clear
            // any auth-failed flag the sync engine may have set.
            window.dispatchEvent(new Event('auth:logged-in'));
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
            const { page, workout, sessionId } = this.loadState();
            if (workout || sessionId) {
                this.state.activeWorkout = workout || this.state.activeWorkout;
                if (sessionId && !this.state.currentSessionId) {
                    this.state.currentSessionId = sessionId;
                }
                this.showPage('workouts');
                try {
                    const sid = sessionId || this.state.currentSessionId;
                    if (sid && window.Workouts && typeof window.Workouts.renderWorkoutScreen === 'function') {
                        let id = sid;
                        if (typeof id === 'string') {
                            if (id.startsWith('local-')) id = id;
                            else if (!isNaN(parseInt(id))) id = parseInt(id);
                        }
                        await window.Workouts.renderWorkoutScreen(this.elements.pageContent, this, id);
                    }
                } catch (e) {
                    console.warn('[App] Failed to auto-resume workout session:', e);
                }
            } else {
                this.showPage(page || 'nutrition');
            }
        } catch (error) {
            console.error('[App] Token validation error:', error);
            if (error?.isNetworkError || !navigator.onLine || !this.state.isOnline) {
                // Temporary network drop on wake/resume: keep user logged in using cached state or tokens
                console.warn('[App] Network error during token validation; retaining offline session.');
                if (!this.state.user) {
                    const cachedUser = localStorage.getItem('user');
                    if (cachedUser) {
                        try { this.state.user = JSON.parse(cachedUser); } catch(e) {}
                    }
                }
                this.showScreen('main');
                const { page, workout, sessionId } = this.loadState();
                if (workout || sessionId) {
                    this.state.activeWorkout = workout || this.state.activeWorkout;
                    if (sessionId && !this.state.currentSessionId) {
                        this.state.currentSessionId = sessionId;
                    }
                    this.showScreen('main');
                    this.showPage('workouts');
                    try {
                        const sid = sessionId || this.state.currentSessionId;
                        if (sid && window.Workouts && typeof window.Workouts.renderWorkoutScreen === 'function') {
                            let id = sid;
                            if (typeof id === 'string') {
                                if (id.startsWith('local-')) id = id;
                                else if (!isNaN(parseInt(id))) id = parseInt(id);
                            }
                            await window.Workouts.renderWorkoutScreen(this.elements.pageContent, this, id);
                        }
                    } catch (e) {
                        console.warn('[App] Failed to auto-resume workout session:', e);
                    }
                } else {
                    this.showPage(page || 'nutrition');
                }
                return;
            }
            // Definite auth failure (401/403 or invalid session)
            this.clearTokens();
            this.showScreen('landing');
            this.renderLanding();
        }
    },
    
    renderLanding() {
        console.log('[App] Rendering landing...');

        /* ============ Landing showcase data (per-chapter phones) ============ */

// Three chapters: nutrition, workouts, and the AI Synergy promo block.
        // The 3rd chapter is a fully-realised section with a live phone
        // carousel served from the sinergy screenshot folder.
        const showcaseChapters = [
            {
                id: 'landing-nutrition',
                index: 0,
                tag: 'ПИТАНИЕ И РАЦИОН',
                title: 'Устал записывать приемы пищи и считать каждый грамм?',
                text: 'Забудь про ручной поиск продуктов в таблицах. Отправь фото еды — умный ИИ мгновенно распознает блюдо, определит КБЖУ и даст экспертный комментарий по качеству рациона.',
                points: [
                    'Фотоприем пищи — и КБЖУ уже в базе. Автоматический трекинг без рутины с возможностью в любой момент отредактировать состав.',
                    'ИИ-отчеты за период. Отслеживание трендов динамики веса и калорийности за неделю или месяц.',
                    'Свой формат общения. Настрой роль ИИ-агента — пусть он общается с тобой в привычной и мотивирующей манере.',
                ],
            },
            {
                id: 'landing-workouts',
                index: 1,
                tag: 'ТРЕНИРОВКИ И СИЛА',
                title: 'Забываешь рабочий вес и темп прошлой тренировки?',
                text: 'Создавай персональные тренировки по готовым шаблонам или добавляй свои упражнения в пару кликов. После завершения сессии ИИ проведет детальный разбор, оценит проделанную работу и подскажет, когда пора менять рабочие веса.',
                points: [
                    'Полный контроль процесса. Рабочие веса, повторы и история подходов всегда под рукой в удобном журнале.',
                    'Автоматические графики динамики. Наглядный анализ прогресса по силе и тоннажу за неделю и месяц.',
                    'Умные подсказки. ИИ-мотивация и персональные рекомендации по адаптации нагрузок.',
                ],
            },
            {
                id: 'landing-ai-synergy',
                index: 2,
                tag: 'ИИ-СИНЕРГИЯ',
                title: 'Союз питания и тренировок в одном ИИ-анализе',
                text: 'ИИ не просто считает калории и подходы — он видит причинно-следственные связи. Узнайте, как дефицит белка или калорий прямо сейчас блокирует рост силы и массы, и получите точечные рекомендации по выходу из застоя.',
                points: [
                    'Связь питания и спорта. Анализ того, как твой рацион влияет на силовые показатели и восстановление.',
                    'Точки роста. Четкое понимание, что именно нужно изменить в плане, чтобы сдвинуть вес с мертвой точки.',
                    'Глубокий ИИ-анализ. Сводные рекомендации на основе одновременного разбора питания и тренировок.',
                ],
            },
        ];

        // Device shell wrapping each chapter's slide stack. aspect-[9/19.5]
        // matches the iPhone 17 Pro Max screen proportions (780x1695 screenshots)
        // so the mockup stays undistorted. Arrows are positioned outside this
        // frame by the chapter markup.
        //
        // The physical body (bezel, Dynamic Island cutout, rounded frame) is
        // ALWAYS graphite-black — it is hardware, not UI. Only the screenshot
        // content inside the screen reacts to the active theme, so the mockup
        // keeps its dark bezel even in light mode.
        const phoneFrame = (screenMarkup) => `
    <div class="landing-phone-frame mx-auto w-[280px] sm:w-[300px]">
        <div class="relative w-full aspect-[9/19.5] rounded-[33px] bg-zinc-950 overflow-hidden border border-black/80 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.6)]">
            <!-- Dynamic Island cutout -->
            <div class="absolute top-2 left-1/2 -translate-x-1/2 w-24 h-5 bg-zinc-950 rounded-full z-30 pointer-events-none border border-black/80"></div>
            ${screenMarkup}
        </div>
    </div>
`;

        // Chapter copy. Each chapter renders its own independent phone block
        // alongside the text in a two-column flex layout: the text and the
        // phone sit side by side on desktop (md:flex-row) and stack vertically
        // on mobile (flex-col). Odd-indexed chapters mirror the order on
        // desktop via md:order-last so the phone leads left on those blocks,
        // creating the Zig-Zag pattern. Arrows sit outside the phone frame so
        // they never overlap the screen.
        const chapterBlock = (chapter) => {
            const chapterIndex = chapter.index;
            const slides = showcaseSlides(chapterIndex);
            const totalSlides = getChapterSlides(chapterIndex).length;
            const hasMultiple = totalSlides > 1;

            const dots = hasMultiple
                ? Array.from({ length: totalSlides }, (_, i) => `
                    <button data-action="chapter-carousel-dot" data-chapter="${chapterIndex}" data-slide="${i}"
                            class="landing-carousel-dot h-1.5 w-1.5 rounded-full bg-surface-400/70 dark:bg-zinc-600/70 transition-all duration-200 hover:bg-lime-400/80 ${i === 0 ? 'opacity-100' : 'opacity-60'}"
                            aria-label="Скриншот ${i + 1} из ${totalSlides}"></button>
                `).join('')
                : '';

            const isMirrored = chapter.index % 2 === 1;

            return `
        <div id="${chapter.id}" data-chapter-index="${chapter.index}"
             class="landing-chapter scroll-mt-20 flex flex-col md:flex-row items-center gap-12 lg:gap-20 py-8 md:py-12">
            <div class="${isMirrored ? 'md:order-last ' : ''}max-w-xl w-full text-left">
                     <span class="mb-4 inline-flex items-center gap-1.5 self-start rounded-full border border-lime-500/20 bg-lime-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-lime-700 dark:text-lime-400">
                        <span class="h-1.5 w-1.5 rounded-full bg-lime-400"></span>
                        ${chapter.tag}
                    </span>
                    <h3 class="mb-4 text-2xl font-bold leading-tight tracking-tight text-surface-900 dark:text-zinc-100 sm:text-3xl">
                        ${chapter.title}
                    </h3>
                    <p class="mb-6 text-sm leading-relaxed text-surface-600 dark:text-zinc-400 sm:text-base">
                        ${chapter.text}
                    </p>
                    <ul class="space-y-2.5">
                        ${chapter.points.map(point => `
                            <li class="flex items-start gap-2.5 text-sm text-surface-500 dark:text-zinc-300">
                                <svg class="mt-0.5 h-4 w-4 flex-shrink-0 text-lime-400" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
                                <span>${point}</span>
                            </li>
                        `).join('')}
                    </ul>
                </div>

                <div class="w-full flex justify-center">
                    <div class="relative inline-block">
                        ${phoneFrame(`
                            <div class="absolute inset-0" data-chapter-slides="${chapter.index}">
                                ${slides}
                            </div>
                        `)}
                        ${hasMultiple ? `
                        <!-- Navigation arrows, positioned strictly outside the phone frame -->
                        <button data-action="chapter-carousel-prev" data-chapter="${chapter.index}" aria-label="Предыдущий скриншот"
                                class="landing-carousel-arrow chapter-carousel-prev absolute -left-10 sm:-left-12 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full flex items-center justify-center text-surface-900/90 dark:text-zinc-100/90 hover:text-lime-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"></path></svg>
                        </button>
                        <button data-action="chapter-carousel-next" data-chapter="${chapter.index}" aria-label="Следующий скриншот"
                                class="landing-carousel-arrow chapter-carousel-next absolute -right-10 sm:-right-12 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full flex items-center justify-center text-surface-900/90 dark:text-zinc-100/90 hover:text-lime-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                        <!-- Pagination dots, below the phone frame -->
                        <div class="landing-carousel-dots absolute -bottom-3 left-0 right-0 flex justify-center pointer-events-none">
                            <div class="flex items-center justify-center gap-1.5">
                                ${dots}
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            `;
        };

        // Renders the slide stack for a chapter's phone frame. Each slide is
        // absolutely positioned so the cross-fade is a pure opacity toggle.
        // Paths are theme-aware: they are rewritten by landingImageSrc() so the
        // carousel always serves the Black or White screenshot set.
        const showcaseSlides = (chapterIndex) => {
            const chapter = SHOWCASE_IMAGES[chapterIndex];
            if (!chapter) return '';
            const slides = getChapterSlides(chapterIndex);
            return slides.map((slide, i) => `
                <img data-chapter="${chapterIndex}" data-slide="${i}" src="${this.landingImageSrc(chapter.folder, slide)}" alt="${chapter.alt}"
                     class="landing-showcase-screen absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ease-in-out ${i === 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
                     ${i === 0 ? '' : 'aria-hidden="true"'} />
            `).join('');
        };

        this.elements.screens.landing.innerHTML = `
            <div class="landing-page h-full w-full overflow-y-auto overflow-x-hidden">
                <div class="relative min-h-full flex flex-col text-surface-900 dark:text-zinc-100 font-sans">
                    <!-- Ambient glow blobs -->
                    <div class="absolute -top-20 -left-24 w-80 h-80 bg-gradient-to-br from-lime-500 to-emerald-600 opacity-[0.04] dark:opacity-[0.08] landing-glow rounded-full pointer-events-none"></div>
                    <div class="absolute -bottom-20 -right-24 w-80 h-80 bg-gradient-to-tl from-lime-400 to-emerald-600 opacity-[0.04] dark:opacity-[0.06] landing-glow rounded-full pointer-events-none"></div>

                    <!-- Sticky header -->
                    <header class="sticky top-0 z-40 border-b border-surface-200 dark:border-zinc-800/60 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md">
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
                                    <span class="text-lg sm:text-xl font-bold text-surface-900 dark:text-zinc-100">MyLofi.live</span>
                                </div>

                                <!-- Desktop navigation -->
                                <div class="hidden md:flex items-center gap-3">
                                    <nav class="flex items-center gap-1 mr-2">
                                        <a href="#landing-nutrition" class="px-3 py-2 text-sm font-medium text-surface-600 dark:text-zinc-400 hover:text-surface-900 dark:hover:text-zinc-100 transition-colors">Питание</a>
                                        <a href="#landing-workouts" class="px-3 py-2 text-sm font-medium text-surface-600 dark:text-zinc-400 hover:text-surface-900 dark:hover:text-zinc-100 transition-colors">Тренировки</a>
                                        <a href="#landing-ai-synergy" class="px-3 py-2 text-sm font-medium text-surface-600 dark:text-zinc-400 hover:text-surface-900 dark:hover:text-zinc-100 transition-colors">ИИ-Синергия</a>
                                    </nav>
                                    <!-- Public theme switcher (Light / Dark / System) -->
                                    <div id="landing-theme" class="flex items-center gap-1 p-1 rounded-xl bg-surface-100 dark:bg-zinc-800/60 border border-surface-200 dark:border-white/5">
                                        <button type="button" data-action="set-theme" data-theme="light" data-landing-theme-btn aria-label="Светлая тема" class="landing-theme-btn w-8 h-8 flex items-center justify-center rounded-lg transition-all">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                                        </button>
                                        <button type="button" data-action="set-theme" data-theme="dark" data-landing-theme-btn aria-label="Тёмная тема" class="landing-theme-btn w-8 h-8 flex items-center justify-center rounded-lg transition-all">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                                        </button>
                                        <button type="button" data-action="set-theme" data-theme="system" data-landing-theme-btn aria-label="Системная тема" class="landing-theme-btn w-8 h-8 flex items-center justify-center rounded-lg transition-all">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                        </button>
                                    </div>
                                    <button data-action="open-feedback-modal" data-category="question"
                                            class="px-4 py-2.5 rounded-xl text-sm font-medium text-surface-500 dark:text-zinc-300 hover:text-lime-500 dark:hover:text-lime-400 hover:bg-surface-100 dark:hover:bg-zinc-900 transition-all">
                                        Обратная связь
                                    </button>
                                    <button data-action="show-auth" class="px-5 py-2.5 rounded-xl border border-surface-200 dark:border-zinc-800 text-sm font-medium text-surface-500 dark:text-zinc-300 hover:text-surface-900 dark:hover:text-zinc-100 hover:border-surface-300 dark:hover:border-zinc-700 hover:bg-surface-100 dark:hover:bg-zinc-900 transition-all">
                                        Войти
                                    </button>
                                    <button data-action="show-register" class="px-5 py-2.5 rounded-xl bg-lime-500 text-zinc-950 text-sm font-semibold shadow-[0_0_20px_rgba(132,204,22,0.25)] hover:bg-lime-400 transition-all btn-press">
                                        Создать дневник
                                    </button>
                                </div>

                                <!-- Mobile hamburger -->
                                <button data-action="toggle-landing-menu" aria-label="Открыть меню" aria-expanded="false" class="md:hidden w-10 h-10 flex items-center justify-center rounded-xl border border-surface-200 dark:border-zinc-800 text-surface-500 dark:text-zinc-300 hover:text-lime-400 hover:border-surface-300 dark:hover:border-zinc-700 transition-colors">
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
                        <div data-landing-menu-backdrop data-action="close-landing-menu" class="landing-menu-backdrop fixed inset-0 z-40 bg-surface-50/70 dark:bg-zinc-950/70 backdrop-blur-sm"></div>
                        <div data-landing-menu-panel class="landing-menu fixed left-0 right-0 top-0 z-50 pt-safe-top bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-b border-surface-200 dark:border-zinc-800 shadow-xl dark:shadow-[0_20px_40px_-20px_rgba(0,0,0,0.9)]">
                            <div class="flex items-center justify-between h-16 px-6">
                                <span class="text-lg font-bold text-surface-900 dark:text-zinc-100">MyLofi.live</span>
                                <button data-action="close-landing-menu" aria-label="Закрыть меню" class="w-10 h-10 flex items-center justify-center rounded-xl border border-surface-200 dark:border-zinc-800 text-surface-500 dark:text-zinc-300 hover:text-lime-400 hover:border-surface-300 dark:hover:border-zinc-700 transition-colors">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"></path>
                                    </svg>
                                </button>
                            </div>
                            <nav class="px-6 pb-6 flex flex-col gap-1">
                                <a data-action="close-landing-menu" href="#landing-nutrition" class="px-4 py-3 rounded-xl text-sm font-medium text-surface-500 dark:text-zinc-300 hover:text-surface-900 dark:hover:text-zinc-100 hover:bg-surface-100 dark:hover:bg-zinc-900 transition-colors">Питание</a>
                                <a data-action="close-landing-menu" href="#landing-workouts" class="px-4 py-3 rounded-xl text-sm font-medium text-surface-500 dark:text-zinc-300 hover:text-surface-900 dark:hover:text-zinc-100 hover:bg-surface-100 dark:hover:bg-zinc-900 transition-colors">Тренировки</a>
                                <a data-action="close-landing-menu" href="#landing-ai-synergy" class="px-4 py-3 rounded-xl text-sm font-medium text-surface-500 dark:text-zinc-300 hover:text-surface-900 dark:hover:text-zinc-100 hover:bg-surface-100 dark:hover:bg-zinc-900 transition-colors">ИИ-Синергия</a>
                                <button data-action="open-feedback-modal" data-category="question"
                                        class="px-4 py-3 rounded-xl text-sm font-medium text-surface-500 dark:text-zinc-300 hover:text-lime-500 dark:hover:text-lime-400 hover:bg-surface-100 dark:hover:bg-zinc-900 transition-colors text-left w-full">
                                    Обратная связь
                                </button>
                                <div class="flex items-center justify-between gap-3 px-1 py-2">
                                    <span class="text-xs font-semibold uppercase tracking-wider text-surface-400 dark:text-zinc-500">Тема</span>
                                    <div id="landing-theme-mobile" class="flex items-center gap-1 p-1 rounded-xl bg-surface-100 dark:bg-zinc-800/60 border border-surface-200 dark:border-white/5">
                                        <button type="button" data-action="set-theme" data-theme="light" data-landing-theme-btn aria-label="Светлая тема" class="landing-theme-btn w-8 h-8 flex items-center justify-center rounded-lg transition-all">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                                        </button>
                                        <button type="button" data-action="set-theme" data-theme="dark" data-landing-theme-btn aria-label="Тёмная тема" class="landing-theme-btn w-8 h-8 flex items-center justify-center rounded-lg transition-all">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                                        </button>
                                        <button type="button" data-action="set-theme" data-theme="system" data-landing-theme-btn aria-label="Системная тема" class="landing-theme-btn w-8 h-8 flex items-center justify-center rounded-lg transition-all">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                        </button>
                                    </div>
                                </div>
                                <div class="h-px bg-surface-200 dark:bg-zinc-800 my-3"></div>
                                <button data-action="show-auth" class="w-full px-4 py-3 rounded-xl border border-surface-200 dark:border-zinc-800 text-sm font-medium text-surface-500 dark:text-zinc-300 hover:text-surface-900 dark:hover:text-zinc-100 hover:bg-surface-100 dark:hover:bg-zinc-900 transition-colors">
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
                            <span class="text-xs font-semibold text-lime-700 dark:text-lime-400 uppercase tracking-wider bg-lime-500/10 border border-lime-500/20 px-3 py-1 rounded-full mb-8">
                                ИИ-нутрициолог и журнал тренировок
                            </span>

                            <h1 class="text-3xl sm:text-4xl lg:text-5xl font-bold text-surface-900 dark:text-zinc-100 tracking-tight leading-tight mb-6 max-w-3xl">
                                Твой умный нутрициолог и журнал тренировок
                            </h1>

                            <p class="text-sm sm:text-base text-surface-600 dark:text-zinc-400 leading-relaxed max-w-2xl mb-10">
                                Контролируй КБЖУ, фиксируй рабочий вес и следи за прогрессом без суеты в лаконичном тёмном интерфейсе
                            </p>

                            <div class="flex flex-col sm:flex-row gap-4">
                                <button data-action="show-register" class="px-6 sm:px-8 py-3.5 rounded-xl bg-lime-500 text-zinc-950 font-semibold shadow-[0_0_20px_rgba(132,204,22,0.25)] hover:bg-lime-400 transition-all btn-press">
                                    Начать использовать
                                </button>
                                <button data-action="show-auth" class="px-6 sm:px-8 py-3.5 rounded-xl border border-surface-200 dark:border-zinc-800 text-surface-300 dark:text-zinc-200 font-medium hover:bg-surface-100 dark:bg-zinc-900 hover:border-surface-300 dark:hover:border-zinc-700 transition-all btn-press">
                                    Уже есть аккаунт
                                </button>
                            </div>
                        </section>

                         <!-- Zig-Zag two-column showcase: text and phone alternate per chapter -->
                         <section class="relative max-w-6xl mx-auto w-full px-6 space-y-12 md:space-y-16">
                             <div class="text-center mb-12 sm:mb-16">
                                  <span class="mb-4 inline-block rounded-full border border-lime-500/20 bg-lime-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-lime-700 dark:text-lime-400">
                                      Как это работает
                                  </span>
                                  <h2 class="mx-auto max-w-2xl text-2xl font-bold leading-tight tracking-tight text-surface-900 dark:text-zinc-100 sm:text-3xl lg:text-4xl">
                                      Два шага, которые убирают рутину
                                  </h2>
                                  <p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-surface-600 dark:text-zinc-400 sm:text-base">
                                      Листайте вниз — каждый раздел показывает своё приложение.
                                  </p>
                             </div>

                             ${showcaseChapters.map(chapterBlock).join('')}
                         </section>

                        <!-- Final CTA -->
                        <section class="max-w-5xl mx-auto w-full px-6 py-16 sm:py-20">
                            <div class="landing-glass rounded-3xl p-8 sm:p-12 text-center shadow-sm dark:shadow-none">
                                <h2 class="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-zinc-100 tracking-tight mb-3 max-w-2xl mx-auto">
                                    Начни свой путь к осознанному фитнесу
                                </h2>
                                <p class="text-sm sm:text-base text-surface-600 dark:text-zinc-400 leading-relaxed max-w-xl mx-auto mb-8">
                                    Один аккаунт — дневник питания, журнал тренировок и ИИ-анализ, работающие вместе.
                                </p>
                                <button data-action="show-register" class="px-6 sm:px-8 py-3.5 rounded-xl bg-lime-500 text-zinc-950 font-semibold shadow-[0_0_20px_rgba(132,204,22,0.25)] hover:bg-lime-400 transition-all btn-press">
                                    Начать использовать
                                </button>
                            </div>
                        </section>
                    </div>

                    <!-- Footer -->
                    <footer class="relative z-10 text-center py-6 px-6 text-xs text-surface-600 dark:text-zinc-500">
                        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
                            <span>© mylofi.live</span>
                            <button data-action="open-feedback-modal" data-category="question"
                                    class="text-surface-400 dark:text-zinc-600 hover:text-lime-500 dark:hover:text-lime-400 transition-colors font-medium text-xs">
                                Обратная связь
                            </button>
                        </div>
                    </footer>
                </div>
            </div>
        `;

        this.initLandingShowcase();
        this.initLandingTheme();
    },

    /**
     * Theme-aware screenshot paths for the landing carousels.
     *
     * The phone mockups are exported twice: a dark-graphite set under
     * static/images/Black/<folder>/... and a light one under
     * static/images/White/<folder>/.... The source of truth for the active
     * theme is the `dark` class on <html> (kept in sync by Theme.apply()),
     * so we read it directly from the DOM instead of trusting a cached flag.
     */
    landingImageSrc(folder, slide) {
        const dark = document.documentElement.classList.contains('dark');
        const set = dark ? 'Black' : 'White';
        const filename = slide && typeof slide === 'object'
            ? (dark ? slide.black : slide.white)
            : slide;
        return `/static/images/${set}/${folder}/${filename}`;
    },

    /**
     * Re-writes every landing carousel <img> src to match the current theme
     * and refreshes the theme-switcher highlight. Safe to call repeatedly.
     */
    applyLandingTheme() {
        const root = this.elements.screens.landing;
        if (!root) return;

        const dark = document.documentElement.classList.contains('dark');
        this.state.landingThemeState = { mode: Theme.getMode(), dark };

        root.querySelectorAll('img.landing-showcase-screen').forEach(img => {
            const ci = Number(img.dataset.chapter);
            const chapter = SHOWCASE_IMAGES[ci];
            if (!chapter) return;
            const slide = chapter.slides[Number(img.dataset.slide)];
            if (!slide) return;
            img.src = this.landingImageSrc(chapter.folder, slide);
        });

        this.updateLandingThemeControls(Theme.getMode());
    },

    /**
     * Initialise the public theme switcher rendered inside the landing header:
     * sync the active highlight, and listen for theme changes (manual toggle
     * or system change routed through Theme) so the screenshots flip too.
     */
    initLandingTheme() {
        this.applyLandingTheme();

        if (!this._landingThemeListener) {
            const handler = () => this.applyLandingTheme();
            this._landingThemeListener = handler;
            document.addEventListener('themechange', handler);
        }
    },

    updateLandingThemeControls(mode) {
        document.querySelectorAll('[data-landing-theme-btn]').forEach(btn => {
            const isActive = btn.dataset.theme === mode;
            btn.classList.toggle('landing-theme-btn-active', isActive);
            btn.classList.toggle('bg-surface-200', isActive);
            btn.classList.toggle('dark:bg-zinc-800', isActive);
            btn.classList.toggle('text-surface-900', isActive);
            btn.classList.toggle('dark:text-zinc-100', isActive);
            btn.classList.toggle('shadow-sm', isActive);
            btn.classList.toggle('text-surface-400', !isActive);
            btn.classList.toggle('dark:text-zinc-500', !isActive);
            btn.setAttribute('aria-pressed', String(isActive));
        });
    },

    /**
     * Landing showcase: every chapter owns an independent phone with its own
     * slide carousel (prev/next arrows and pagination dots). Each chapter's
     * controls are scoped via `data-chapter` so flipping slides in one chapter
     * never affects another. A single delegated listener on the landing root
     * keeps the handlers working across re-renders without re-binding.
     */
    initLandingShowcase() {
        if (this._landingCarouselListener && this.elements.screens.landing) {
            this.elements.screens.landing.removeEventListener('click', this._landingCarouselListener);
            this._landingCarouselListener = null;
        }

        const root = this.elements.screens.landing;
        if (!root) return;

        // Per-chapter slide index, persisted across re-renders so a manual flip
        // survives a re-render.
        if (!this.state.landingCarouselState) this.state.landingCarouselState = {};

        const getSlidesFor = (chapterIndex) =>
            Array.from(root.querySelectorAll(`[data-chapter="${chapterIndex}"][data-slide]`));

        const updateCarouselSlide = (chapterIndex, slideIndex) => {
            // The array length is the single source of truth for every bound
            // below, so the carousel can never outrun the available slides.
            const totalSlides = getChapterSlides(chapterIndex).length;
            if (!totalSlides) return;

            const domSlides = getSlidesFor(chapterIndex);
            let idx = Number(slideIndex);
            if (!Number.isFinite(idx)) idx = 0;
            // Clamp to the real slide count so we never land on an index with
            // no <img> behind it (which would render a blank phone screen).
            // totalSlides - 1 is the last valid index.
            idx = Math.max(0, Math.min(totalSlides - 1, idx));

            this.state.landingCarouselState[chapterIndex] = idx;

            domSlides.forEach(slide => {
                const active = Number(slide.dataset.slide) === idx;
                slide.classList.toggle('opacity-100', active);
                slide.classList.toggle('opacity-0', !active);
                slide.classList.toggle('pointer-events-none', !active);
                slide.classList.toggle('is-active', active);
                if (active) slide.removeAttribute('aria-hidden');
                else slide.setAttribute('aria-hidden', 'true');
            });

            // Sync the pagination dots' active highlight to the current slide.
            // The number of dots was rendered from totalSlides at render time,
            // so here we only flip the highlight per dot.
            const dots = Array.from(root.querySelectorAll(`.landing-carousel-dot[data-chapter="${chapterIndex}"]`));
            dots.forEach((dot, i) => {
                const active = i === idx;
                dot.classList.toggle('is-active-dot', active);
                dot.setAttribute('aria-pressed', String(active));
            });

            const prevBtn = root.querySelector(`.landing-carousel-arrow[data-action="chapter-carousel-prev"][data-chapter="${chapterIndex}"]`);
            const nextBtn = root.querySelector(`.landing-carousel-arrow[data-action="chapter-carousel-next"][data-chapter="${chapterIndex}"]`);
            if (prevBtn) prevBtn.disabled = idx === 0;
            if (nextBtn) nextBtn.disabled = idx >= totalSlides - 1;
        };

        const carouselListener = (e) => {
            const prevBtn = e.target.closest('[data-action="chapter-carousel-prev"]');
            const nextBtn = e.target.closest('[data-action="chapter-carousel-next"]');
            const dotBtn = e.target.closest('[data-action="chapter-carousel-dot"]');
            if (prevBtn) {
                e.preventDefault();
                const ci = Number(prevBtn.dataset.chapter);
                const current = this.state.landingCarouselState[ci] || 0;
                if (current > 0) updateCarouselSlide(ci, current - 1);
            } else if (nextBtn) {
                e.preventDefault();
                const ci = Number(nextBtn.dataset.chapter);
                const totalSlides = getChapterSlides(ci).length;
                const current = this.state.landingCarouselState[ci] || 0;
                if (current < totalSlides - 1) updateCarouselSlide(ci, current + 1);
            } else if (dotBtn) {
                e.preventDefault();
                const ci = Number(dotBtn.dataset.chapter);
                const si = Number(dotBtn.dataset.slide);
                updateCarouselSlide(ci, si);
            }
        };

        root.addEventListener('click', carouselListener);
        this._landingCarouselListener = carouselListener;

        // Initialise every chapter's carousel at slide 0.
        Array.from(root.querySelectorAll('[data-chapter-index]')).forEach(chapterEl => {
            const ci = Number(chapterEl.dataset.chapterIndex);
            if (root.querySelector(`.landing-carousel-arrow[data-chapter="${ci}"]`)) {
                this.state.landingCarouselState[ci] = 0;
                updateCarouselSlide(ci, 0);
            }
        });
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

        // The live channel is authenticated with the access token, so it
        // lives exactly as long as the signed-in shell does.
        if (screenName === 'main') {
            this.connectRealtime();
        } else if (screenName === 'landing') {
            this.disconnectRealtime();
        }

        if (this.elements.bottomNav) {
            this.elements.bottomNav.style.display = (screenName === 'main') ? 'block' : 'none';
        }
    },

    /**
     * Open the live channel used for background-analysis updates.
     *
     * The handshake is authenticated with the access token, so the token is
     * renewed first when it is about to expire: the server checks the token
     * once, during the handshake, and refuses it with a close the socket
     * cannot recover from on its own.
     */
    connectRealtime() {
        // Only one renewal at a time: the server rotates the refresh token,
        // so two parallel renewals would spend the same one twice and the
        // loser would sign the user out.
        if (this._realtimeConnectPromise) return;
        this._realtimeConnectPromise = this.ensureRealtimeToken()
            .then((token) => {
                if (!token) return;
                this.openRealtime(token);
            })
            .catch((error) => {
                console.warn('[App] Live channel could not be opened:', error);
            })
            .finally(() => {
                this._realtimeConnectPromise = null;
            });
    },

    /**
     * The access token the live channel should authenticate with.
     *
     * Returns null when there is no session. A token that is expired or
     * about to expire is refreshed first; `forceRefresh` does it even when
     * the token still looks alive, which is what a refused handshake needs.
     */
    async ensureRealtimeToken(forceRefresh = false) {
        const token = this.state.tokens?.access;
        if (!token) return null;
        if (!forceRefresh && !API.isTokenExpiring(token)) return token;

        console.log('[App] Renewing the access token for the live channel');
        try {
            const refreshed = await this.refreshAccessToken();
            if (!refreshed) return null;
        } catch (error) {
            console.warn('[App] Token renewal for the live channel failed:', error);
            return null;
        }
        return this.state.tokens?.access || null;
    },

    /**
     * Put the socket on the given token and open it.
     *
     * The socket instance is kept across token changes: it carries the
     * reconnect and the heartbeat, and only the token it hands to the
     * handshake has to be current.
     */
    openRealtime(token) {
        // The session can be gone by the time the renewal answers - a
        // logout, a 403 - and a socket opened for it would linger behind
        // for a session that no longer exists.
        if (this.state.tokens?.access !== token) return;

        if (!this.realtime) {
            this.realtime = API.createWebSocket(token);
            this.realtime.on('status', (status) => {
                // A channel that came up has proved its token, so a later
                // refusal is allowed to start the retry budget over.
                if (status === 'open') {
                    this._realtimeAuthRetries = 0;
                    this.state.isOnline = true;
                    NetworkBanner.hide();
                } else if (status === 'closed') {
                    this.state.isOnline = false;
                    NetworkBanner.showOffline();
                }
            });
            window.addEventListener('mylofi:realtime-status', (e) => {
                const status = e?.detail?.status;
                if (status === 'open') {
                    this.state.isOnline = true;
                    NetworkBanner.hide();
                    if (this.state.tokens?.access && this.state.currentScreen === 'main') {
                        this.flushOfflineQueue().catch(() => {});
                        // The workout screen is skipped: a re-render there
                        // would throw away what the user typed.
                        this.refreshCurrentView();
                    }
                } else if (status === 'closed') {
                    this.state.isOnline = false;
                    NetworkBanner.showOffline();
                }
            });
            this.realtime.on('unauthorized', () => {
                // The server refused the token the handshake carried. A
                // renewed one is worth one more attempt; the same one would
                // be refused again.
                if (this._realtimeAuthRetries >= 1) {
                    console.warn('[App] Live channel refused the access token, giving up');
                    this._realtimeAuthRetries = 0;
                    return;
                }
                this._realtimeAuthRetries += 1;
                this.ensureRealtimeToken(true)
                    .then((fresh) => {
                        if (!fresh) return;
                        this.realtime?.setToken(fresh);
                        this.realtime?.connect();
                    })
                    .catch((error) => {
                        console.warn('[App] Live channel re-authentication failed:', error);
                    });
            });
        }

        this.realtime.setToken(token);
        this.realtime.connect();
    },

    disconnectRealtime() {
        this.realtime?.close();
        this.realtime = null;
    },

    hideSplash() {
        const splash = this.elements.splash;
        if (splash) {
            splash.style.opacity = '0';
            splash.style.pointerEvents = 'none';
            setTimeout(() => splash.remove(), 200);
        }
    },
    
    showPage(pageName) {
        console.log(`[App] Showing page: ${pageName}`);
        this.markPageActive(pageName);
        // navigator.onLine is unreliable under L3 blocks and captive portals
        // (the interface reports online while HTTP requests time out), so
        // every page navigation re-probes the backend host and shows the
        // offline banner immediately when the host is unreachable.
        this.checkHostConnectivity().catch(() => {});
        this.saveState();
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
            else if (pageName === 'admin') await Admin.render(container, this);
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
            if (e.target.id === 'forgot-password-form') Auth.handleForgotPassword(e, this, document.querySelector('.auth-modal'));
            if (e.target.id === 'verify-code-form') Auth.handleVerifyCode(e, this, document.querySelector('.auth-modal'));
            if (e.target.id === 'new-password-form') Auth.handleResetPassword(e, this, document.querySelector('.auth-modal'));
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
                this.openAuthModal('login');
                break;
            case 'show-register':
                this.toggleLandingMenu(false);
                this.openAuthModal('register');
                break;
            case 'close-auth-modal':
                this.closeAuthModal();
                break;
            case 'change-password':
                this.openAuthModal('forgot-password', { email: this.state.user?.email });
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
                // The user closed the workout on purpose: the resume handler
                // must not pull them back into it.
                this.state.workoutScreenDismissed = true;
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
                // The landing header has its own compact theme switcher; refresh
                // its highlight and the screenshot carousel immediately after
                // Theme.set() has flipped the `dark` class on <html>.
                this.applyLandingTheme();
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
            case 'show-admin':
                this.showPage('admin');
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
            case 'open-feedback-modal': {
                const category = event.target.closest('[data-action="open-feedback-modal"]')?.dataset.category || 'question';
                const isGuest = !this.state.tokens?.access;
                Profile.openFeedbackModal({ category, isGuest });
                break;
            }
            case 'close-feedback-modal':
                Profile.closeFeedbackModal();
                break;
            case 'submit-feedback':
                // The submit button carries data-action="submit-feedback" and is
                // therefore routed through this global router. Profile.submitFeedback
                // resolves its own modal and per-instance state from
                // Profile._feedbackModalState, so the router needs no payload.
                Profile.submitFeedback();
                break;
            case 'launch-ai-synergy':
                this.launchAiSynergy();
                break;
            case 'open-ai-synergy-modal':
                Nutrition.openAiSynergyModal();
                break;
            case 'close-ai-synergy-modal':
                Nutrition.closeAiSynergyModal();
                break;
            case 'reanalyze-ai-synergy':
                this.reanalyzeAiSynergy();
                break;
            case 'close-ai-synergy-sleep-modal':
                this.closeAiSynergySleepModal();
                break;
            case 'confirm-ai-synergy-sleep':
                await this.confirmAiSynergySleep();
                break;
        }
    },

    _aiSynergySleepModalState: null,

    /**
     * Opens the sleep-input drum-sheet for the AI Synergy widget. The period is
     * already chosen in the widget itself; this sheet only collects the optional
     * average-sleep figure and then hands control back to confirmAiSynergySleep,
     * which performs the analysis and renders the result inside the widget.
     */
    launchAiSynergy() {
        if (!this.elements.screens.main || !this.state.user) {
            this.showToast('Сначала войдите в аккаунт', 'info');
            return;
        }

        // A custom range needs both dates filled in before the analysis can run.
        if (Nutrition._aiSynergyPeriod === 'custom') {
            const data = Nutrition.getAiSynergyRequestData();
            if (!data || !data.start_date || !data.end_date) {
                this.showToast('Укажите кастомный диапазон дат', 'info');
                return;
            }
            // Client-side validation: custom range cannot exceed 90 days
            const start = new Date(data.start_date + 'T00:00:00Z');
            const end = new Date(data.end_date + 'T00:00:00Z');
            const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            if (diffDays > 90) {
                this.showToast('Пользовательский диапазон не может превышать 90 дней', 'error');
                return;
            }
        }

        const host = document.getElementById('modals') || document.body;
        const html = Components.aiSynergySleepModal();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const modalEl = wrapper.firstElementChild;
        host.appendChild(modalEl);

        this._aiSynergySleepModalState = { modalEl };

        // Clicks on the backdrop, close button and confirm button are routed
        // through the document-level data-action listener (handleAction), so
        // there is no need to re-bind them here - doing so would double-fire.
        const escHandler = (e) => { if (e.key === 'Escape') this.closeAiSynergySleepModal(); };
        document.addEventListener('keydown', escHandler);
        modalEl._onEsc = escHandler;

        // Lock body scroll while the sheet is open
        this._aiSynergySleepModalState.bodyWasLocked = document.body.classList.contains('overflow-hidden');
        document.body.classList.add('overflow-hidden');
    },

    closeAiSynergySleepModal() {
        if (!this._aiSynergySleepModalState) return;
        const { modalEl, bodyWasLocked } = this._aiSynergySleepModalState;
        this._aiSynergySleepModalState = null;
        if (modalEl._onEsc) {
            document.removeEventListener('keydown', modalEl._onEsc);
            delete modalEl._onEsc;
        }
        if (!bodyWasLocked) document.body.classList.remove('overflow-hidden');

        const panel = modalEl.querySelector('.drum-sheet-panel');
        if (panel) panel.classList.add('is-closing');
        const backdrop = modalEl.querySelector('.drum-sheet-backdrop');
        if (backdrop) backdrop.classList.add('is-closing');

        setTimeout(() => { modalEl.remove(); }, 220);
    },

    openAuthModal(mode = 'login', ctx = {}) {
        const host = this.elements.modals || document.body;
        const html = Components.authModal(mode, ctx);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const modalEl = wrapper.firstElementChild;
        modalEl._authCtx = ctx;
        host.appendChild(modalEl);

        // Initialize modal event handlers (CSS handles animations)
        Components.initAuthModal(modalEl, this);
    },

    closeAuthModal() {
        const modalEl = this.elements.modals?.querySelector('.auth-modal');
        if (modalEl) {
            return Components.closeAuthModal(modalEl);
        }
        return Promise.resolve();
    },

    async confirmAiSynergySleep() {
        if (!this._aiSynergySleepModalState?.modalEl) return;
        const modalEl = this._aiSynergySleepModalState.modalEl;

        const sleepInput = modalEl.querySelector('#ai-synergy-sleep-input');
        const sleepVal = sleepInput ? parseFloat(sleepInput.value) : NaN;
        const avg_sleep_hours = (!isNaN(sleepVal) && sleepVal >= 4 && sleepVal <= 12)
            ? sleepVal
            : null;

        // Close the sheet before the long request so the user sees the widget
        // flip into its running state underneath.
        this.closeAiSynergySleepModal();

        // Build the request: period selection from the widget + optional sleep.
        const body = { ...Nutrition.getAiSynergyRequestData() };
        if (avg_sleep_hours != null) body.avg_sleep_hours = avg_sleep_hours;

        const { offsetMinutes } = clientTimezone();
        const endpoint = offsetMinutes != null
            ? `/ai/synergy?tz_offset=${encodeURIComponent(offsetMinutes)}`
            : '/ai/synergy';

        Nutrition.setAiSynergyRunning(true);
        try {
            const resultPayload = await API.postImmediate(
                endpoint,
                body,
                this.state.tokens.access
            );
            Nutrition.setAiSynergyResult(resultPayload);
            this.showToast('Анализ ИИ-Синергии завершён', 'success');
        } catch (e) {
            console.error('[App] AI synergy failed:', e);
            Nutrition.setAiSynergyRunning(false);
            this.showToast(e?.message || 'Не удалось выполнить анализ', 'error');
        }
    },

    async reanalyzeAiSynergy() {
        if (!this.state.tokens?.access) {
            this.showToast('Сначала войдите в аккаунт', 'info');
            return;
        }

        const body = { ...Nutrition.getAiSynergyRequestData() };
        body.force = true;

        const { offsetMinutes } = clientTimezone();
        const endpoint = offsetMinutes != null
            ? `/ai/synergy?tz_offset=${encodeURIComponent(offsetMinutes)}`
            : '/ai/synergy';

        const modal = document.querySelector('.ai-synergy-modal');
        if (modal) {
            const originalBody = modal.querySelector('.ai-synergy-modal__body').innerHTML;
            modal.querySelector('.ai-synergy-modal__body').innerHTML = `
                <div class="ai-synergy-modal__loading flex items-center justify-center py-8">
                    <svg class="animate-spin w-6 h-6 text-purple-500" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span class="ml-3 text-sm text-surface-500 dark:text-zinc-400">Пересчитываем…</span>
                </div>
            `;
        }

        Nutrition.setAiSynergyRunning(true);
        try {
            const resultPayload = await API.postImmediate(
                endpoint,
                body,
                this.state.tokens.access
            );
            Nutrition.setAiSynergyResult(resultPayload);
            // Close the modal and re-open it with the fresh result
            Nutrition.closeAiSynergyModal();
            setTimeout(() => {
                Nutrition.openAiSynergyModal();
            }, 50);
            this.showToast('Анализ ИИ-Синергии обновлён', 'success');
        } catch (e) {
            console.error('[App] AI synergy reanalyze failed:', e);
            Nutrition.setAiSynergyRunning(false);
            this.showToast(e?.message || 'Не удалось пересчитать', 'error');
            if (modal) {
                modal.querySelector('.ai-synergy-modal__body').innerHTML = originalBody;
            }
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

        // A session created offline has no server id yet: close it locally and queue the request
        if (Workouts.completeLocalSession(this)) {
            await this.renderPage('workouts');
            return;
        }

        // Flush all active weight and rep inputs before completing
        await this.flushPendingSetEdits();

        const durationSeconds = Workouts.sessionStartTimestamp
            ? Math.max(0, Math.floor((Date.now() - Workouts.sessionStartTimestamp) / 1000))
            : null;

        try {
            await API.post(
                `/workouts/sessions/${sessionId}/complete`,
                durationSeconds !== null ? { duration_seconds: durationSeconds } : null,
                this.state.tokens.access,
            );
            Workouts.forgetAiPlan(sessionId);
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

        if (Workouts.cancelLocalSession(this)) {
            await this.renderPage('workouts');
            return;
        }
        try {
            await API.post(`/workouts/sessions/${sessionId}/cancel`, null, this.state.tokens.access);
            Workouts.forgetAiPlan(sessionId);
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
            // The landing header has its own compact theme switcher; let
            // updateLandingThemeControls own its highlight instead of
            // flattening these buttons into the profile toggle classes.
            if (btn.hasAttribute('data-landing-theme-btn')) return;
            const isActive = btn.dataset.theme === mode;
            btn.className = THEME_OPTION_BASE + ' ' + (isActive ? THEME_OPTION_ACTIVE : THEME_OPTION_IDLE);
            btn.setAttribute('aria-pressed', String(isActive));
        });
        this.updateLandingThemeControls(mode);
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