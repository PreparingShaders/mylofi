console.log("[DEBUG] Loaded theme.js");

const STORAGE_KEY = 'theme';
const MODES = ['light', 'dark', 'system'];
const DARK_META = '#09090b';
const LIGHT_META = '#fafafa';

const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export const Theme = {
    STORAGE_KEY,
    MODES,

    getMode() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return MODES.includes(stored) ? stored : 'system';
        } catch (error) {
            return 'system';
        }
    },

    isDark() {
        const mode = this.getMode();
        if (mode === 'dark') return true;
        if (mode === 'light') return false;
        return !!(mql && mql.matches);
    },

    apply() {
        const dark = this.isDark();
        document.documentElement.classList.toggle('dark', dark);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', dark ? DARK_META : LIGHT_META);
    },

    set(mode) {
        if (!MODES.includes(mode)) return;
        try {
            if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, mode);
        } catch (error) {
            console.warn('[Theme] Unable to persist preference:', error);
        }

        document.documentElement.classList.add('theme-anim');
        this.apply();
        setTimeout(() => document.documentElement.classList.remove('theme-anim'), 300);

        document.dispatchEvent(new CustomEvent('themechange', {
            detail: { mode, dark: this.isDark() },
        }));
    },

    init() {
        this.apply();

        if (mql) {
            const onSystemChange = () => {
                if (this.getMode() === 'system') this.apply();
            };
            if (mql.addEventListener) mql.addEventListener('change', onSystemChange);
            else if (mql.addListener) mql.addListener(onSystemChange);
        }
    },
};
