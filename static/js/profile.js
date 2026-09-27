console.log("[DEBUG] Loaded profile.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Theme } from './theme.js';

export const THEME_OPTION_ACTIVE = 'bg-white dark:bg-zinc-100 text-surface-900 dark:text-zinc-950 shadow-sm';
export const THEME_OPTION_IDLE = 'text-surface-500 dark:text-zinc-400 hover:text-surface-900 dark:hover:text-zinc-200';

const THEME_OPTIONS = [
    {
        mode: 'light',
        label: 'Светлая',
        icon: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`,
    },
    {
        mode: 'dark',
        label: 'Тёмная',
        icon: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>`,
    },
    {
        mode: 'system',
        label: 'Системная',
        icon: `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>`,
    },
];

function renderThemeSwitcher() {
    const current = Theme.getMode();
    const options = THEME_OPTIONS.map(({ mode, label, icon }) => {
        const isActive = mode === current;
        const cls = 'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all '
            + (isActive ? THEME_OPTION_ACTIVE : THEME_OPTION_IDLE);
        return `
            <button type="button" data-action="set-theme" data-theme="${mode}" aria-pressed="${isActive}" class="${cls}">
                ${icon}
                <span>${label}</span>
            </button>
        `;
    }).join('');

    return `
        <div class="glass rounded-2xl p-4 mb-4">
            <h3 class="font-semibold mb-1">Оформление</h3>
            <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">
                Тёмная тема использует графитовое стекло и следует системным настройкам, если выбрана системная тема.
            </p>
            <div class="flex gap-2 p-1 rounded-2xl bg-surface-100 dark:bg-zinc-800/60 border border-surface-200 dark:border-white/5">
                ${options}
            </div>
        </div>
    `;
}

export const Profile = {
    app: null,

    async render(container, app) {
        this.app = app;
        let user;
        try {
            user = await API.get('/users/me', this.app.state.tokens.access);
        } catch (error) {
            console.error('[Profile] Load error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки профиля');
            return;
        }

        container.innerHTML = `
            <div class="p-4">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-xl font-bold">Профиль</h2>
                    <button data-action="logout"
                            class="text-red-500 text-sm font-medium">
                        Выйти
                    </button>
                </div>

                <div class="glass rounded-2xl p-4 mb-4">
                    <h3 class="font-semibold mb-3">Данные пользователя</h3>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">
                        <span class="text-surface-500">Email:</span> ${user.email}
                    </p>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">
                        <span class="text-surface-500">Имя:</span> ${user.full_name || '—'}
                    </p>
                    <p class="text-sm text-surface-600 dark:text-surface-300">
                        <span class="text-surface-500">Роль:</span> ${user.role}
                    </p>
                </div>

                <div class="glass rounded-2xl p-4 mb-4">
                    <h3 class="font-semibold mb-3">Целевые макросы</h3>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">
                        <span class="text-surface-500">Калории:</span> ${user.target_calories || '—'} ккал
                    </p>
                    <p class="text-sm text-surface-600 dark:text-surface-300">
                        <span class="text-surface-500">Вес:</span> ${user.target_weight_kg || user.weight_kg || '—'} кг
                    </p>
                </div>

                ${renderThemeSwitcher()}

                <div class="text-xs text-surface-400 text-center">
                    Зарегистрирован: ${user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}
                </div>
            </div>
        `;
    }
};
