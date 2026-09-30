console.log("[DEBUG] Loaded profile.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Theme } from './theme.js';
import { Utils } from './utils.js';

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

// Quota-backed limits get a progress bar. The rest are weekly cooldowns or
// PRO-only gates, so they read better as a short note than as a near-empty bar.
const QUOTA_CODES = ['meal_ai', 'workout_templates'];
const GATE_CODES = ['workout_ai', 'nutrition_ai', 'combined_ai'];

const GENDER_LABELS = {
    male: 'Мужской',
    female: 'Женский',
};

const ACTIVITY_LABELS = {
    sedentary: 'Минимальная',
    light: 'Низкая',
    moderate: 'Средняя',
    active: 'Высокая',
    athlete: 'Очень высокая',
};

const GOAL_LABELS = {
    lose: 'Снизить вес',
    maintain: 'Поддерживать',
    gain: 'Набрать вес',
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

function renderGateRow(entry) {
    const label = USAGE_LABELS[entry.code] || entry.code;
    const tone = entry.allowed === false
        ? 'text-surface-500 dark:text-zinc-400'
        : 'text-surface-600 dark:text-zinc-300';

    return `
        <li class="flex items-start gap-2 text-xs">
            <span class="${tone} mt-0.5 flex-shrink-0">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${entry.allowed === false ? 'M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z' : 'M5 13l4 4L19 7'}"/></svg>
            </span>
            <span class="min-w-0">
                <span class="font-medium text-surface-700 dark:text-zinc-200">${label}.</span>
                <span class="${tone}">${entry.message}</span>
            </span>
        </li>
    `;
}

const PRO_FEATURES = [
    'Безлимитное распознавание блюд по фото',
    'Любое число шаблонов тренировок',
    'ИИ-анализ тренировки и питания без ожидания',
    'Комбинированный ИИ-анализ',
];

function renderProPlan() {
    const features = PRO_FEATURES.map((feature) => `
        <li class="flex items-start gap-2 text-sm text-surface-600 dark:text-zinc-300">
            <span class="text-lime-500 dark:text-lime-400 mt-0.5 flex-shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
            </span>
            <span class="min-w-0">${feature}</span>
        </li>
    `).join('');

    return `
        <div class="glass tariff-pro-card rounded-2xl p-4 mb-4">
            <div class="flex items-center justify-between gap-3 mb-3">
                <h3 class="font-semibold">Тариф</h3>
                <span class="plan-badge plan-badge--pro">PRO Member</span>
            </div>
            <p class="text-sm text-surface-600 dark:text-zinc-300 mb-3">
                Все ограничения сняты. Работайте без лимитов и очередей.
            </p>
            <ul class="flex flex-col gap-2">${features}</ul>
            <button type="button" data-action="toggle-pro"
                    class="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-surface-700 dark:text-zinc-200 font-semibold text-sm transition-all btn-press">
                <span>Сбросить до Free (Dev)</span>
            </button>
        </div>
    `;
}

function renderFreePlan(usage) {
    const limits = usage?.limits || {};
    const quotaRows = QUOTA_CODES
        .filter((code) => limits[code])
        .map((code) => renderUsageRow(limits[code]))
        .join('');
    const gateRows = GATE_CODES
        .filter((code) => limits[code])
        .map((code) => renderGateRow(limits[code]))
        .join('');

    return `
        <div class="glass rounded-2xl p-4 mb-4">
            <div class="flex items-center justify-between gap-3 mb-3">
                <h3 class="font-semibold">Тариф</h3>
                <span class="plan-badge plan-badge--free">Free Plan</span>
            </div>
            <div class="usage-list">${quotaRows}</div>
            ${gateRows ? `<ul class="flex flex-col gap-2 pt-1">${gateRows}</ul>` : ''}
            <button type="button" data-action="activate-pro"
                    class="w-full mt-4 flex items-center justify-center gap-2 py-3 rounded-xl bg-lime-500 hover:bg-lime-400 text-zinc-950 font-semibold text-sm transition-all btn-press">
                <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16v2m-1-1h2m-7 6v4m-1-1h2m9-3v2m-1-1h2M9 14l6-6m-8 8l8-8"/></svg>
                <span>Активировать PRO</span>
            </button>
        </div>
    `;
}

function renderPlan(usage) {
    return usage?.is_premium ? renderProPlan() : renderFreePlan(usage);
}

function anthropometricRow(label, value) {
    return `
        <div class="flex items-baseline justify-between gap-3 py-1.5">
            <span class="text-xs text-surface-500 dark:text-zinc-400 flex-shrink-0">${label}</span>
            <span class="text-sm font-medium text-surface-700 dark:text-zinc-200 text-right min-w-0 truncate">${value}</span>
        </div>
    `;
}

function formatMacro(value, unit) {
    if (value === null || value === undefined) return '—';
    // Stored targets are grams with one decimal; drop a trailing ",0" so
    // whole numbers read the same as the live preview in the sheet.
    const rounded = Math.round(Number(value) * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
    return `${text} ${unit}`;
}

function renderAnthropometrics(user) {
    const gender = user.gender || null;
    const activity = user.activity_level || null;
    const goal = user.goal || null;
    const isComplete = !!(gender && user.age && user.height_cm && user.weight_kg);

    const rows = isComplete ? [
        anthropometricRow('Пол', GENDER_LABELS[gender] || '—'),
        anthropometricRow('Возраст', `${user.age} лет`),
        anthropometricRow('Рост', `${user.height_cm} см`),
        anthropometricRow('Вес', `${user.weight_kg} кг`),
        anthropometricRow('Целевой вес', user.target_weight_kg ? `${user.target_weight_kg} кг` : '—'),
        anthropometricRow('Активность', ACTIVITY_LABELS[activity] || '—'),
        anthropometricRow('Цель', GOAL_LABELS[goal] || '—'),
    ].join('') : '';

    const targets = [
        anthropometricRow('Калории', user.target_calories ? `${user.target_calories} ккал` : '—'),
        anthropometricRow('Белки', formatMacro(user.target_protein_g, 'г')),
        anthropometricRow('Жиры', formatMacro(user.target_fat_g, 'г')),
        anthropometricRow('Углеводы', formatMacro(user.target_carbs_g, 'г')),
    ].join('');

    return `
        <div class="glass rounded-2xl p-4 mb-4">
            <div class="flex items-center justify-between gap-3 mb-3">
                <h3 class="font-semibold">Антропометрия и КБЖУ</h3>
                <button type="button" data-action="edit-anthropometrics"
                        class="text-xs font-semibold text-lime-600 dark:text-lime-400 flex-shrink-0">
                    ${isComplete ? 'Изменить' : 'Заполнить'}
                </button>
            </div>
            ${isComplete
                ? `<div class="divide-y divide-surface-200 dark:divide-white/5">${rows}</div>`
                : '<p class="text-sm text-surface-500 dark:text-zinc-400 mb-3">Укажите пол, возраст, рост и вес, чтобы рассчитать норму по формуле Миффлина-Сан Жеора.</p>'
            }
            <div class="divide-y divide-surface-200 dark:divide-white/5 ${isComplete ? 'mt-3 pt-1 border-t border-surface-200 dark:border-white/10' : ''}">
                ${targets}
            </div>
        </div>
    `;
}

function renderTargetPreview(targets) {
    if (!targets) {
        return `
            <p class="text-xs text-surface-500 dark:text-zinc-400 text-center">
                Заполните пол, возраст, рост и вес, чтобы увидеть расчёт.
            </p>
        `;
    }

    const cell = (label, value, strong) => `
        <div class="text-center">
            <div class="text-[11px] uppercase tracking-wider text-surface-500 dark:text-zinc-400 font-semibold">${label}</div>
            <div class="${strong
                ? 'text-lg font-bold text-lime-600 dark:text-lime-400'
                : 'text-sm font-semibold text-surface-800 dark:text-zinc-100'} mt-0.5">${value}</div>
        </div>
    `;

    return `
        <div class="grid grid-cols-3 gap-2">
            ${cell('Калории', `${targets.calories} ккал`, true)}
            ${cell('Белки', `${targets.protein_g} г`)}
            ${cell('Жиры', `${targets.fat_g} г`)}
            ${cell('Углеводы', `${targets.carbs_g} г`)}
            ${cell('Базовый обмен', `${targets.bmr} ккал`)}
            ${cell('С учётом активности', `${targets.tdee} ккал`)}
        </div>
    `;
}

export const Profile = {
    app: null,
    user: null,
    _anthroState: null,
    _anthroClosing: null,

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

        this.user = user;

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
                    <p class="text-sm text-surface-600 dark:text-zinc-300 mb-1">
                        <span class="text-surface-500">Email:</span> ${user.email}
                    </p>
                    <p class="text-sm text-surface-600 dark:text-zinc-300 mb-1">
                        <span class="text-surface-500">Имя:</span> ${user.full_name || '—'}
                    </p>
                    <p class="text-sm text-surface-600 dark:text-zinc-300">
                        <span class="text-surface-500">Роль:</span> ${user.role}
                    </p>
                </div>

                ${renderPlan(usage)}

                ${renderAnthropometrics(user)}

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
    },

    async togglePro(container) {
        const token = this.app.state.tokens.access;
        try {
            const usage = await API.post('/users/me/toggle-pro', {}, token);
            this.app.showToast(usage?.is_premium ? 'Тариф PRO включён (Dev)' : 'Тариф сброшен до Free (Dev)', 'info');
            await this.render(container, this.app);
        } catch (error) {
            if (error?.offlineQueued) {
                this.app.showToast('Нет связи. Переключение тарифа применится при появлении сети', 'info');
                return;
            }
            console.error('[Profile] Toggle PRO error:', error);
            this.app.showToast(error?.data?.detail || error?.message || 'Не удалось переключить тариф', 'error');
        }
    },

    openAnthropometricsModal() {
        // Guard on the closing element too, so a tap during the slide-out
        // animation cannot stack a second sheet on top of the first.
        if (this._anthroState || this._anthroClosing) return;

        const modalHtml = Components.anthropometricsModal(this.user || {});
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        const modalEl = modalContainer.firstElementChild;
        document.body.appendChild(modalEl);

        this._anthroState = {
            modalEl,
            panelEl: modalEl.querySelector('.drum-sheet-panel'),
            bodyWasLocked: document.body.classList.contains('overflow-hidden'),
        };
        document.body.classList.add('overflow-hidden');

        this.bindAnthropometricsModalEvents(modalEl);
        this.updateAnthropometricsPreview();
    },

    closeAnthropometricsModal() {
        if (!this._anthroState) return;

        const { modalEl, panelEl, onKeydown, bodyWasLocked } = this._anthroState;
        this._anthroState = null;
        if (onKeydown) {
            document.removeEventListener('keydown', onKeydown);
        }
        if (!bodyWasLocked) {
            document.body.classList.remove('overflow-hidden');
        }

        // Slide the panel back out before removing it, mirroring the drum sheet.
        panelEl?.classList.add('is-closing');
        modalEl.querySelector('.drum-sheet-backdrop')?.classList.add('is-closing');

        this._anthroClosing = modalEl;
        setTimeout(() => {
            modalEl.remove();
            if (this._anthroClosing === modalEl) {
                this._anthroClosing = null;
            }
        }, 220);
    },

    bindAnthropometricsModalEvents(modalEl) {
        const state = this._anthroState;

        // Backdrop closes the sheet; the ✕ button sits inside the panel and is
        // bound directly so panel clicks never bubble into the backdrop handler.
        modalEl.querySelector('.drum-sheet-backdrop')?.addEventListener('click', () => {
            this.closeAnthropometricsModal();
        });
        modalEl.querySelector('.drum-sheet-panel [data-action="close-anthropometrics-modal"]')?.addEventListener('click', () => {
            this.closeAnthropometricsModal();
        });

        const onKeydown = (e) => {
            if (e.key === 'Escape') this.closeAnthropometricsModal();
        };
        state.onKeydown = onKeydown;
        document.addEventListener('keydown', onKeydown);

        // Text and select inputs recalculate on every change.
        modalEl.querySelectorAll('[data-field]').forEach((input) => {
            input.addEventListener('input', () => this.updateAnthropometricsPreview());
            input.addEventListener('change', () => this.updateAnthropometricsPreview());
        });

        // Gender and goal chips are a single-select group each.
        modalEl.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-action="set-anthro-gender"], [data-action="set-anthro-goal"]');
            if (!chip || !modalEl.contains(chip)) return;
            const group = chip.getAttribute('data-action') === 'set-anthro-gender'
                ? 'set-anthro-gender'
                : 'set-anthro-goal';
            modalEl.querySelectorAll(`[data-action="${group}"]`).forEach((other) => {
                other.setAttribute('aria-pressed', String(other === chip));
            });
            this.updateAnthropometricsPreview();
        });

        modalEl.querySelector('#anthro-submit')?.addEventListener('click', () => {
            this.saveAnthropometrics();
        });
    },

    readAnthropometricsForm(modalEl) {
        const value = (name) => modalEl.querySelector(`[data-field="${name}"]`)?.value ?? '';
        return {
            gender: modalEl.querySelector('[data-action="set-anthro-gender"][aria-pressed="true"]')?.dataset.value || 'male',
            goal: modalEl.querySelector('[data-action="set-anthro-goal"][aria-pressed="true"]')?.dataset.value || 'maintain',
            age: value('age'),
            height: value('height'),
            weight: value('weight'),
            target_weight: value('target_weight'),
            activity: value('activity'),
        };
    },

    getAnthropometricsTargets(modalEl) {
        const form = this.readAnthropometricsForm(modalEl);
        return {
            form,
            targets: Utils.calculateKBZhU({
                weight: form.weight,
                height: form.height,
                age: form.age,
                gender: form.gender,
                activity: form.activity,
                goal: form.goal,
            }),
        };
    },

    updateAnthropometricsPreview() {
        const state = this._anthroState;
        if (!state) return;

        const { targets } = this.getAnthropometricsTargets(state.modalEl);
        const preview = state.modalEl.querySelector('#anthro-preview');
        if (preview) {
            preview.innerHTML = renderTargetPreview(targets);
        }
        // The save button stays disabled until the formula has all four inputs,
        // so an incomplete form can never reach the API.
        const submit = state.modalEl.querySelector('#anthro-submit');
        if (submit) {
            submit.disabled = !targets;
        }
    },

    async saveAnthropometrics() {
        const state = this._anthroState;
        if (!state) return;

        const { form, targets } = this.getAnthropometricsTargets(state.modalEl);
        if (!targets) {
            this.app.showToast('Заполните пол, возраст, рост и вес', 'error');
            return;
        }

        const targetWeight = parseFloat(form.target_weight);
        const submit = state.modalEl.querySelector('#anthro-submit');
        if (submit) submit.disabled = true;

        try {
            await API.patch('/users/me/anthropometrics', {
                gender: form.gender,
                age: parseInt(form.age, 10),
                height_cm: parseFloat(form.height),
                weight_kg: parseFloat(form.weight),
                activity_level: form.activity,
                goal: form.goal,
                target_weight_kg: Number.isFinite(targetWeight) ? targetWeight : null,
            }, this.app.state.tokens.access);

            this.closeAnthropometricsModal();
            this.app.showToast('Целевая норма КБЖУ обновлена', 'success');
            await this.render(this.app.elements.pageContent, this.app);
        } catch (error) {
            console.error('[Profile] Save anthropometrics error:', error);
            this.app.showToast(
                error?.data?.detail?.detail || error?.data?.detail || error?.message || 'Не удалось сохранить антропометрию',
                'error'
            );
            // Re-enable the button so the user can retry without reopening.
            const retry = this._anthroState?.modalEl.querySelector('#anthro-submit');
            if (retry) retry.disabled = false;
        }
    }
};
