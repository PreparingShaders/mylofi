console.log("[DEBUG] Loaded app.js");
import { API } from './api.js';
import { Auth } from './auth.js';
import { Nutrition } from './nutrition.js';
import { Workouts } from './workouts.js';
import { Profile } from './profile.js';
import { Camera } from './camera.js';
import { DB } from './db.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

const App = {
    state: {
        user: null,
        tokens: { access: null, refresh: null },
        currentPage: 'nutrition',
        currentScreen: 'landing',
        isOnline: navigator.onLine,
        pendingPhotos: [],
        activeWorkout: null,
    },
    
    elements: {},
    
    async init() {
        console.log('[App] Initializing...');
        this.cacheElements();
        
        // Проверка элементов перед продолжением
        if (!this.elements.screens.landing) {
            console.error('[App] Critical error: Landing screen element not found!');
            return;
        }
        
        await DB.init();
        this.loadTokens();
        this.setupEventListeners();
        
        if (this.state.tokens.access) {
            console.log('[App] Token found, validating...');
            await this.validateToken();
        } else {
            console.log('[App] No token, showing landing...');
            this.showScreen('landing');
            this.renderLanding();
        }
        
        console.log('[App] Initialized');
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
            <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <h1 class="text-4xl font-bold mb-4">MyLofi</h1>
                <p class="mb-8">Трекер питания и тренировок</p>
                <button data-action="show-auth" class="w-full py-3 bg-primary-600 text-white rounded-xl">Войти</button>
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
        } catch (error) {
            console.error('[App] Render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки');
        }
    },
    
    showToast(message, type) { console.log(`[Toast] ${type}: ${message}`); },

    setupEventListeners() {
        document.addEventListener('submit', (e) => {
            if (e.target.id === 'login-form') Auth.handleLogin(e, this);
            if (e.target.id === 'register-form') Auth.handleRegister(e, this);
        });
        
        document.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action) this.handleAction(action, e);
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
                Auth.renderRegister(this.elements.screens.auth, this);
                break;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
export { App };