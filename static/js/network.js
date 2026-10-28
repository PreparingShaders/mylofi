console.log("[DEBUG] Loaded network.js");
import { API } from './api.js';
import { SyncEngine } from './sync.js';

const OFFLINE_MESSAGE = 'Офлайн-режим: данные сохранятся локально';
const RESTORED_MESSAGE = 'Связь восстановлена. Синхронизируем...';
const HIDE_DELAY_MS = 3000;
const SAFE_AREA_PROBE_ID = 'network-banner-safe-area-probe';

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
    offlineDebounceTimer: null,
    OFFLINE_DEBOUNCE_MS: 3000,

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.mount();

        window.addEventListener('offline', () => this.showOffline());
        // The safe-area inset follows the orientation, so the banner's own
        // height has to be re-measured when the viewport changes.
        window.addEventListener('resize', () => this.syncHeight());
        window.addEventListener('orientationchange', () => this.syncHeight());

        this.refresh();
    },

    mount() {
        if (this.el && document.body.contains(this.el)) {
            this.syncHeight();
            return;
        }

        const existing = document.getElementById('network-banner');
        if (existing) {
            this.el = existing;
            this.syncHeight();
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
        this.syncHeight();
    },

    /**
     * env(safe-area-inset-top) in pixels - no API exposes it, so it is read
     * from a hidden probe that carries the very same padding declaration.
     */
    safeAreaTop() {
        let probe = document.getElementById(SAFE_AREA_PROBE_ID);
        if (!probe) {
            probe = document.createElement('div');
            probe.id = SAFE_AREA_PROBE_ID;
            probe.setAttribute('aria-hidden', 'true');
            probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);';
            document.body.appendChild(probe);
        }
        return parseFloat(getComputedStyle(probe).paddingTop) || 0;
    },

    /**
     * Height of the banner WITHOUT the safe-area inset it already carries,
     * published as --network-banner-height for the page layout.
     *
     * The app shell reserves that inset with its own spacer, so the page
     * content only has to clear the banner's own box; counting the inset a
     * second time is what pushed the page header far down the screen. The
     * measured value keeps the layout honest when the message wraps onto a
     * second line or the font size changes.
     */
    syncHeight() {
        const el = this.el;
        if (!el || !document.body.contains(el)) return;
        // An empty banner has no content row yet - measuring it would publish
        // a height that is smaller than the one it grows into.
        const text = el.querySelector('.network-status-banner__text');
        if (text && !text.textContent.trim()) return;
        const height = Math.max(0, el.offsetHeight - this.safeAreaTop());
        if (!height) return;
        document.documentElement.style.setProperty('--network-banner-height', `${height}px`);
    },

    clearTimers() {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        if (this.offlineDebounceTimer) {
            clearTimeout(this.offlineDebounceTimer);
            this.offlineDebounceTimer = null;
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
        // A different message can take another line, so the height the page
        // layout has to clear is re-measured.
        this.syncHeight();
    },

    showOffline() {
        this.clearTimers();
        this.state = 'offline';
        this.mount();
        // Debounce: wait before showing to avoid flashing on brief disconnects
        this.offlineDebounceTimer = setTimeout(() => {
            if (this.state === 'offline') {
                this.render('offline');
                this.el.classList.add('is-visible');
                document.body.classList.add('has-network-banner');
            }
        }, this.OFFLINE_DEBOUNCE_MS);
    },

    showRestored() {
        this.clearTimers();
        this.state = 'restored';
        this.mount();
        this.render('restored');
        this.el.classList.add('is-visible');
        document.body.classList.add('has-network-banner');

        SyncEngine.processQueue().catch((error) => {
            if (SyncEngine.authFailed) return;
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
