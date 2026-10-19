console.log("[DEBUG] Loaded network.js");
import { API } from './api.js';
import { SyncEngine } from './sync.js';

const OFFLINE_MESSAGE = 'Офлайн-режим: данные сохранятся локально';
const RESTORED_MESSAGE = 'Связь восстановлена. Синхронизируем...';
const HIDE_DELAY_MS = 3000;

const OFFLINE_ICON = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.9a10 10 0 015.2-2.7"></path>
    <path d="M2 8.8a15 15 0 013.9-2.2"></path>
    <path d="M13.4 10.6a10 10 0 015.6 2.3"></path>
    <path d="M8.5 16.5a5 5 0 017 0"></path>
    <path d="M8.5 19.5a.5.5 0 001 0"></path>
    <line x1="2" y1="2" x2="22" y2="22"></line>
</svg>`;

const RESTORED_ICON = `<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M2 8.8a15 15 0 0114.6-3.4"></path>
    <path d="M2 12.9a10 10 0 018.9-3.1"></path>
    <path d="M2 16.9a5 5 0 016.2-1.9"></path>
    <path d="M12.5 19.5a.5.5 0 001 0"></path>
    <path d="M20 12.5l2 2 4-4"></path>
</svg>`;

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

        this.refresh();
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
        this.el.querySelector('.network-status-banner__text').textContent = isOffline
            ? OFFLINE_MESSAGE
            : RESTORED_MESSAGE;
    },

    showOffline() {
        this.clearTimers();
        this.state = 'offline';
        this.mount();
        this.render('offline');
        this.el.classList.add('is-visible');
        document.body.classList.add('has-network-banner');
    },

    showRestored() {
        this.clearTimers();
        this.state = 'restored';
        this.mount();
        this.render('restored');
        this.el.classList.add('is-visible');
        document.body.classList.add('has-network-banner');

        SyncEngine.processQueue().catch((error) => {
            console.warn('[NetworkBanner] processQueue failed:', error);
        });

        this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY_MS);
    },

    hide() {
        this.clearTimers();
        this.state = 'hidden';
        if (this.el) this.el.classList.remove('is-visible');
        document.body.classList.remove('has-network-banner');
    },

    // Re-evaluate state without interrupting a freshly shown "restored" message.
    // When online, performs an explicit host reachability check to detect L3
    // blocks and captive portals where navigator.onLine is unreliable.
    async refresh(skipHostCheck = false) {
        if (navigator.onLine === false) {
            if (this.state !== 'offline') {
                this.showOffline();
            }
            return this.state;
        }

        if (skipHostCheck) {
            if (this.state !== 'hidden') {
                this.showRestored();
            }
            return this.state;
        }

        const reachable = await API.checkHostReachable();
        if (!reachable) {
            if (this.state !== 'offline') {
                this.showOffline();
            }
        } else if (this.state !== 'hidden') {
            this.showRestored();
        }
        return this.state;
    },
};
