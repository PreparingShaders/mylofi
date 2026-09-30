console.log("[DEBUG] Loaded profile.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Theme } from './theme.js';

export const THEME_OPTION_BASE = 'flex items-center justify-center gap-1 px-1 py-2 rounded-lg text-[11px] sm:text-xs font-medium transition-all min-w-0';
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
        const cls = THEME_OPTION_BASE + ' ' + (isActive ? THEME_OPTION_ACTIVE : THEME_OPTION_IDLE);
        return `
            <button type="button" data-action="set-theme" data-theme="${mode}" aria-pressed="${isActive}" class="${cls}">
                <span class="flex-shrink-0">${icon.replace('class="w-4 h-4"', 'class="w-3.5 h-3.5"')}</span>
                <span class="truncate">${label}</span>
            </button>
        `;
    }).join('');

    return `
        <div class="glass rounded-2xl p-3 mb-4">
            <h3 class="font-semibold mb-2 px-1">Оформление</h3>
            <div class="grid grid-cols-3 gap-1 p-1 text-xs rounded-xl bg-surface-100 dark:bg-zinc-800/60 border border-surface-200 dark:border-white/5">
                ${options}
            </div>
        </div>
    `;
}

const USAGE_LABELS = {
    meal_ai: 'Распознавание блюд по фото',
    workout_templates: 'Шаблоны тренировок',
    workout_ai: 'ИИ-анализ тренировки',
    nutrition_ai: 'ИИ-анализ питания',
    combined_ai: 'Комбинированный ИИ-анализ',
};

function formatQuota(entry) {
    if (entry.limit === null || entry.limit === undefined) {
        return 'Без ограничений';
    }
    return `${entry.used} из ${entry.limit}`;
}

function formatReset(entry) {
    if (!entry.resets_at) return '';
    const date = new Date(entry.resets_at);
    if (Number.isNaN(date.getTime())) return '';
    return `Обновление: ${date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

function renderUsageRow(entry) {
    const label = USAGE_LABELS[entry.code] || entry.code;
    const percent = Math.max(0, Math.min(entry.percent_used || 0, 100));
    const barClass = entry.allowed === false
        ? 'usage-bar__fill usage-bar__fill--limit'
        : (percent >= 80 ? 'usage-bar__fill usage-bar__fill--warn' : 'usage-bar__fill');
    const meta = [formatQuota(entry), formatReset(entry)].filter(Boolean).join(' · ');

    return `
        <div class="mb-3 last:mb-0">
            <div class="flex items-baseline justify-between gap-3 mb-1.5">
                <span class="text-sm font-medium text-surface-700 dark:text-zinc-200 truncate">${label}</span>
                <span class="text-[11px] text-surface-500 dark:text-zinc-400 flex-shrink-0">${meta}</span>
            </div>
            <div class="usage-bar" role="progressbar" aria-label="${label}" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
                <div class="${barClass}" style="width: ${percent}%"></div>
            </div>
            ${entry.allowed === false ? `<p class="text-[11px] text-surface-500 dark:text-zinc-400 mt-1">${entry.message}</p>` : ''}
        </div>
    `;
}

function renderPlan(usage) {
    const isPremium = !!usage?.is_premium;
    const badgeClass = isPremium ? 'plan-badge plan-badge--pro' : 'plan-badge plan-badge--free';
    const badgeText = isPremium ? 'PRO Member' : 'Free Plan';
    const limits = usage?.limits || {};
    const rows = ['meal_ai', 'workout_templates', 'workout_ai', 'nutrition_ai', 'combined_ai']
        .filter((code) => limits[code])
        .map((code) => renderUsageRow(limits[code]))
        .join('');

    const activateButton = isPremium ? '' : `
        <button type="button" data-action="activate-pro"
                class="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl bg-lime-500 hover:bg-lime-400 text-zinc-950 font-semibold text-sm transition-all btn-press">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16v2m-1-1h2m-7 6v4m-1-1h2m9-3v2m-1-1h2M9 14l6-6m-8 8l8-8"/></svg>
            <span>Активировать PRO</span>
        </button>
    `;

    return `
        <div class="glass rounded-2xl p-4 mb-4">
            <div class="flex items-center justify-between gap-3 mb-3">
                <h3 class="font-semibold">Тариф</h3>
                <span class="${badgeClass}">${badgeText}</span>
            </div>
            <div class="usage-list">${rows}</div>
            ${activateButton}
        </div>
    `;
}

export const Profile = {
    app: null,

    async render(container, app) {
        this.app = app;
        let user;
        let usage = null;
        try {
            user = await API.get('/users/me', this.app.state.tokens.access);
        } catch (error) {
            console.error('[Profile] Load error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки профиля');
            return;
        }

        // Usage data is non-critical: the profile still renders without it.
        try {
            usage = await API.get('/users/me/usage', this.app.state.tokens.access);
        } catch (error) {
            console.warn('[Profile] Usage load error:', error);
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

                ${renderThemeSwitcher()}

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

                ${renderPlan(usage)}

                <div class="glass rounded-2xl p-4 mb-4">
                    <h3 class="font-semibold mb-3">Целевые макросы</h3>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">
                        <span class="text-surface-500">Калории:</span> ${user.target_calories || '—'} ккал
                    </p>
                    <p class="text-sm text-surface-600 dark:text-surface-300">
                        <span class="text-surface-500">Вес:</span> ${user.target_weight_kg || user.weight_kg || '—'} кг
                    </p>
                </div>

                <div class="text-xs text-surface-400 text-center">
                    Зарегистрирован: ${user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}
                </div>
            </div>
        `;
    },

    async activatePro(container) {
        const token = this.app.state.tokens.access;
        try {
            await API.post('/users/me/activate-pro', {}, token);
            this.app.showToast('PRO активирован', 'success');
            await this.render(container, this.app);
        } catch (error) {
            if (error?.offlineQueued) {
                this.app.showToast('Нет связи. Активация PRO применится при появлении сети', 'info');
                return;
            }
            console.error('[Profile] Activate PRO error:', error);
            this.app.showToast(error?.data?.detail || error?.message || 'Не удалось активировать PRO', 'error');
        }
    }
};
