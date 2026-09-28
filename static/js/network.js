console.log("[DEBUG] Loaded network.js");
import { SyncEngine } from './sync.js';

const OFFLINE_MESSAGE = 'Нет тырнета, но он нам и не нужен (работаем оффлайн)';
const RESTORED_MESSAGE = 'Связь восстановлена. Синхронизируем данные...';
const HIDE_DELAY_MS = 3000;

const OFFLINE_ICON = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <line x1="2" y1="2" x2="22" y2="22"></line>
    <path d="M8.5 16.5a5 5 0 017 0"></path>
    <path d="M5 12.9a10 10 0 015.2-2.7"></path>
    <path d="M2 8.8a15 15 0 013.9-2.2"></path>
    <path d="M13.4 10.6a10 10 0 015.6 2.3"></path>
    <path d="M8.5 19.5a.5.5 0 001 0"></path>
</svg>`;

const RESTORED_ICON = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 8.8a15 15 0 0114.6-3.4"></path>
    <path d="M2 12.9a10 10 0 018.9-3.1"></path>
    <path d="M2 16.9a5 5 0 016.2-1.9"></path>
    <path d="M12.5 19.5a.5.5 0 001 0"></path>
    <path d="M20 12.5l2 2 4-4"></path>
</svg>`;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const NetworkBanner = {
    el: null,
    initialized: false,
    hideTimer: null,
    state: 'hidden',

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.mount();

        window.addEventListener('offline', () => this.showOffline());
        window.addEventListener('online', () => this.showRestored());

        if (navigator.onLine === false) this.showOffline();
    },

    mount() {
        if (this.el && document.body.contains(this.el)) return;

        const existing = document.getElementById('network-banner');
        if (existing) {
            this.el = existing;
            return;
        }

        const el = document.createElement('div');
        el.id = 'network-banner';
        el.className = 'network-status-banner';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML = '<span class="network-status-banner__icon"></span><span class="network-status-banner__text"></span>';
        document.body.appendChild(el);
        this.el = el;
    },

    clearTimers() {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    },

    render(state) {
        if (!this.el) return;
        const isOffline = state === 'offline';
        this.el.classList.toggle('network-status-banner--offline', isOffline);
        this.el.classList.toggle('network-status-banner--restored', !isOffline);
        this.el.querySelector('.network-status-banner__icon').innerHTML = isOffline ? OFFLINE_ICON : RESTORED_ICON;
        this.el.querySelector('.network-status-banner__text').textContent = escapeHtml(
            isOffline ? OFFLINE_MESSAGE : RESTORED_MESSAGE
        );
    },

    showOffline() {
        this.clearTimers();
        this.state = 'offline';
        this.mount();
        this.render('offline');
        this.el.classList.add('is-visible');
    },

    showRestored() {
        this.clearTimers();
        this.state = 'restored';
        this.mount();
        this.render('restored');
        this.el.classList.add('is-visible');

        SyncEngine.processQueue().catch((error) => {
            console.warn('[NetworkBanner] processQueue failed:', error);
        });

        this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
    },

    hide() {
        this.clearTimers();
        this.state = 'hidden';
        if (this.el) this.el.classList.remove('is-visible');
    },

    // Re-evaluate state without interrupting a freshly shown "restored" message.
    refresh() {
        if (navigator.onLine === false) {
            this.showOffline();
        }
    },
};
