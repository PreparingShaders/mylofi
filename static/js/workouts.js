console.log("[DEBUG] Loaded workouts.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Utils } from './utils.js';
import { DB } from './db.js';

const TOGGLE_BASE = 'flex-shrink-0 w-11 h-11 rounded-2xl text-xl font-bold transition-all flex items-center justify-center';
const TOGGLE_COMPLETED = 'bg-lime-400 text-zinc-950 border-lime-400 shadow-[0_0_12px_rgba(163,230,53,0.4)]';
const TOGGLE_UNCOMPLETED = 'glass text-surface-400 dark:text-surface-500';
const SET_DIM = ['text-surface-400', 'dark:text-surface-600'];
const SET_NUMBER_IDLE = 'text-surface-500';

// Half the tonnage marker (w-2.5) plus its border, used to keep the marker and
// the guide line inside the plot when the last slot sits at 100%.
const TONNAGE_MARKER_RADIUS = 6;

const LOCK_ICON = '<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>';
const QUICK_GOALS = [
    { value: 'strength', title: 'Сила', subtitle: 'Базовые движения, 3×5' },
    { value: 'hypertrophy', title: 'Набор массы', subtitle: 'Компаундные + изоляция, 3×10' },
    { value: 'endurance', title: 'Выносливость', subtitle: 'Лёгкий вес, много подходов, 2×15' },
];

// Drum picker geometry: must stay in sync with .drum / .drum-item in styles.css.
// The live item height is read from --drum-item-height so compact viewports can
// shrink it without breaking the scroll-snap index math.
const DRUM_ITEM_HEIGHT = 40;
const DRUM_WEIGHT_MAX = 300;
// Decimal drum holds integer tenths (0-9) instead of quarter fractions, so every
// step is exactly representable and never produces `undefined` labels.
const DRUM_TENTHS_MAX = 9;
const DRUM_TENTHS = Array.from({ length: DRUM_TENTHS_MAX + 1 }, (_, i) => i);
const DRUM_WEIGHT_MAX_TENTHS = DRUM_WEIGHT_MAX * 10 + DRUM_TENTHS_MAX;
const DRUM_REPS_MAX = 50;
const DRUM_PRESETS = [1, 2.5, 5];

const drumClampTenths = (tenths) => Math.min(DRUM_WEIGHT_MAX_TENTHS, Math.max(0, Math.round(tenths)));
const drumTenthsToWeight = (tenths) => drumClampTenths(tenths) / 10;
const drumWeightToTenths = (weight) => drumClampTenths((Number(weight) || 0) * 10);
const drumWholeFromTenths = (tenths) => Math.floor(drumClampTenths(tenths) / 10);
const drumTenthsFromTenths = (tenths) => drumClampTenths(tenths) % 10;

let DRUM_KEYDOWN_HANDLER = null;

const LOCAL_SESSION_KEY = 'offline_local_session';
const LOCAL_CLOSED_SESSIONS_KEY = 'offline_closed_sessions';
const LOCAL_SESSION_PLACEHOLDER = '__local_session__';
const TEMP_EXERCISE_ID_BASE = -1000;
const TEMP_SET_ID_BASE = -100000;
const OFFLINE_START_MESSAGE = 'Нет подключения к интернету. Тренировка создана локально и будет синхронизирована при появлении связи';
const OFFLINE_COMPLETE_MESSAGE = 'Тренировка завершена! Сеть недоступна, данные будут синхронизированы при появлении связи';

// Shown instead of the drum picker when a set is already checked off.
const SET_LOCKED_MESSAGE = 'Редактирование заблокировано. Снимите отметку о выполнении';
// How long a set row keeps the .set-row--saved pulse; must match the CSS.
const SET_SAVED_FLASH_MS = 1000;
// Beat between completing the last set of an exercise and advancing the
// carousel, so the save flash is seen before the card scrolls away.
const SET_ADVANCE_DELAY_MS = 350;
// gap-4 between carousel cards, used to derive the horizontal scroll step.
const CAROUSEL_GAP_PX = 16;

// The coach answers at the two ends of a session and both calls are refused
// offline: the plan is wanted before the first set and the verdict right after
// the last one, and neither is worth a queued request the user would read hours
// later. The offline queue stays for what the user typed.
const AI_OFFLINE_MESSAGE = 'ИИ-тренер работает только с подключением к интернету';
// Shown when the plan is asked for and does not arrive. The workout continues
// either way: a plan is an addition to a session, never a condition for it.
const AI_PLAN_UNAVAILABLE_MESSAGE = 'ИИ-план недоступен, тренировка без него';
// Icon-only split action next to "Начать тренировку": the label lives in the
// title and the aria-label so the button is not a mystery on a phone.
const AI_START_ICON = '\u{1F916}';

export const Workouts = {
    app: null,
    workoutTimerInterval: null,
    recentSessions: [],
    stats: null,
    tonnageData: null,
    tonnageState: { period: 'week', filters: { start_date: '', end_date: '', muscle_group: '', exercise_name: '', template_id: '' } },

    // Coach plan for the session in progress, { focus, motivation,
    // recommendations } as the /ai/workout-preview response. Kept on the instance
    // rather than on the session object because it describes the workout the user
    // is doing right now and must not survive into the next one.
    aiPlan: null,
    // Analysis request in flight: the trigger on the workout card disables
    // itself while the cascade is running, so a second tap cannot spend the
    // weekly allowance twice.
    _aiAnalysisLoading: false,
    // Background rest chronometry: when the current session started (from the
    // server's started_at or the local clock) and when the last set of this
    // session was completed. The gap between them is the rest the user actually
    // took before the next set, sent inline with each set's completion PATCH so
    // the coach reads real breaks without a floating timer bar on screen.
    sessionStartTimestamp: null,
    lastSetCompletedAt: null,

    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    getTonnageState() {
        if (!this.tonnageState) {
            this.tonnageState = { period: 'week', filters: { start_date: '', end_date: '', muscle_group: '', exercise_name: '', template_id: '' } };
        }
        if (!this.tonnageState.filters) this.tonnageState.filters = { start_date: '', end_date: '', muscle_group: '', exercise_name: '', template_id: '' };
        return this.tonnageState;
    },

    buildTonnageQuery() {
        const { period, filters } = this.getTonnageState();
        const params = new URLSearchParams({ period });
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== '' && value !== null && value !== undefined) params.set(key, value);
        });
        return `/workouts/tonnage?${params.toString()}`;
    },

    countActiveTonnageFilters() {
        const { filters } = this.getTonnageState();
        return Object.values(filters).filter(v => v !== '' && v !== null && v !== undefined).length;
    },

    // Local mirror of get_filtered_tonnage over the already-loaded history, used
    // when the endpoint is unreachable (offline) so the module is never empty.
    computeLocalTonnage(sessions) {
        const { period, filters } = this.getTonnageState();
        const now = new Date();
        const completed = (sessions || []).filter(s => s.status === 'completed' || !s.status);
        // `all` is unbounded on the server; bound it to the earliest known
        // session so the chart does not open with decades of empty buckets.
        const earliest = completed
            .map(s => new Date(s.completed_at || s.started_at))
            .filter(d => !isNaN(d.getTime()))
            .reduce((min, d) => (min === null || d < min ? d : min), null);

        let start;
        if (filters.start_date) start = new Date(`${filters.start_date}T00:00:00Z`);
        else if (period === 'month') start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        else if (period === 'all') start = earliest ? new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1)) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        else start = new Date(now.getTime() - 7 * 86400000);

        const end = filters.end_date ? new Date(`${filters.end_date}T23:59:59Z`) : now;
        const needle = (filters.exercise_name || '').trim().toLowerCase();
        const templateId = filters.template_id ? parseInt(filters.template_id) : null;

        const bucketMap = new Map();
        const granularity = period === 'all' ? 'month' : 'day';
        const cursor = new Date(start);
        cursor.setUTCHours(0, 0, 0, 0);
        const last = new Date(end);
        last.setUTCHours(0, 0, 0, 0);
        while (cursor <= last) {
            const key = granularity === 'month'
                ? `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
                : cursor.toISOString().slice(0, 10);
            bucketMap.set(key, {
                key,
                label: granularity === 'month'
                    ? `${cursor.toLocaleDateString('ru-RU', { month: 'short', timeZone: 'UTC' })} ${cursor.getUTCFullYear()}`
                    : `${cursor.getUTCDate()} ${cursor.toLocaleDateString('ru-RU', { month: 'short', timeZone: 'UTC' })}`,
                tonnage_kg: 0,
                workouts: 0,
                sets_count: 0,
            });
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }

        let total = 0;
        let workouts = 0;
        let sets = 0;
        (sessions || []).forEach(session => {
            if (session.status && session.status !== 'completed') return;
            if (templateId && session.template_id !== templateId) return;
            const stamp = new Date(session.completed_at || session.started_at);
            if (isNaN(stamp.getTime()) || stamp < start || stamp > end) return;

            let sessionTonnage = 0;
            let sessionSets = 0;
            (session.exercises || []).forEach(ex => {
                if (needle && !(ex.name || '').trim().toLowerCase().includes(needle)) return;
                (ex.sets || []).forEach(set => {
                    if (!set.is_completed) return;
                    sessionTonnage += (set.weight_kg || 0) * (set.reps || 0);
                    sessionSets += 1;
                });
            });
            if (sessionTonnage <= 0) return;

            total += sessionTonnage;
            sets += sessionSets;
            workouts += 1;
            const key = granularity === 'month'
                ? stamp.toISOString().slice(0, 7)
                : stamp.toISOString().slice(0, 10);
            const bucket = bucketMap.get(key);
            if (bucket) {
                bucket.tonnage_kg += sessionTonnage;
                bucket.sets_count += sessionSets;
                bucket.workouts += 1;
            }
        });

        const series = [...bucketMap.values()].map(bucket => ({ ...bucket, tonnage_kg: Math.round(bucket.tonnage_kg * 10) / 10 }));
        return {
            period,
            total_tonnage_kg: Math.round(total * 10) / 10,
            workouts_count: workouts,
            sets_count: sets,
            avg_tonnage_kg: workouts ? Math.round((total / workouts) * 10) / 10 : 0,
            previous_total_tonnage_kg: null,
            delta_kg: null,
            delta_percent: null,
            granularity,
            series,
        };
    },

    renderTonnageModule(data) {
        const { period } = this.getTonnageState();
        const hasFilters = this.countActiveTonnageFilters() > 0;
        const fallback = !data;
        const payload = data || this.computeLocalTonnage(this.recentSessions);
        const total = Math.round(payload.total_tonnage_kg || 0);
        const deltaPercent = payload.delta_percent;

        const tabs = [
            { value: 'week', label: 'Неделя' },
            { value: 'month', label: 'Месяц' },
            { value: 'all', label: 'Всё время' },
        ];

        const streakWeeks = Number(this.stats?.current_streak_weeks) || 0;

        return `
            <div class="glass rounded-2xl p-4">
                <div class="flex justify-between items-center gap-2 mb-3">
                    <div class="flex items-baseline gap-2 min-w-0">
                        <h3 class="text-sm font-semibold text-surface-500 uppercase tracking-wider truncate">Общий тоннаж</h3>
                        ${streakWeeks > 0 ? `<span class="text-[11px] font-semibold text-primary-600 dark:text-primary-400 flex-shrink-0">Серия: ${streakWeeks} нед.</span>` : ''}
                    </div>
                    <button type="button" data-action="tonnage-open-filters"
                            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold flex-shrink-0 ${hasFilters
                                ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                                : 'glass text-surface-500 dark:text-surface-400'}">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 2v-5.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
                        Фильтры${hasFilters ? ` · ${this.countActiveTonnageFilters()}` : ''}
                    </button>
                </div>

                <div class="flex gap-1 p-1 rounded-xl bg-surface-100 dark:bg-white/5 mb-3">
                    ${tabs.map(tab => `
                        <button type="button" data-action="tonnage-period" data-period="${tab.value}"
                                class="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${period === tab.value
                                    ? 'bg-surface-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                                    : 'text-surface-500 dark:text-surface-400'}">
                            ${tab.label}
                        </button>
                    `).join('')}
                </div>

                <div class="grid grid-cols-3 gap-2 text-center mb-3">
                    <div class="bg-surface-50 dark:bg-white/5 p-2.5 rounded-xl">
                        <div class="text-xs text-surface-400">Тоннаж</div>
                        <div class="text-lg font-bold">${(total / 1000).toFixed(total >= 1000 ? 1 : 2)} т</div>
                    </div>
                    <div class="bg-surface-50 dark:bg-white/5 p-2.5 rounded-xl">
                        <div class="text-xs text-surface-400">Тренировок</div>
                        <div class="text-lg font-bold">${payload.workouts_count || 0}</div>
                    </div>
                    <div class="bg-surface-50 dark:bg-white/5 p-2.5 rounded-xl">
                        <div class="text-xs text-surface-400">Ср. за тренировку</div>
                        <div class="text-lg font-bold">${Math.round(payload.avg_tonnage_kg || 0)} кг</div>
                    </div>
                </div>

                ${Components.tonnageLineChart(payload.series)}

                <div class="mt-3 pt-3 border-t border-surface-200 dark:border-white/10 text-xs text-surface-500 dark:text-surface-400 flex items-center justify-between gap-2">
                    <span>${deltaPercent === null || deltaPercent === undefined
                        ? 'Нет данных для сравнения с прошлым периодом'
                        : `К прошлому периоду: <span class="${deltaPercent >= 0 ? 'text-lime-600 dark:text-lime-400' : 'text-rose-500 dark:text-rose-400'} font-semibold">${deltaPercent >= 0 ? '+' : ''}${deltaPercent}%</span>`}</span>
                    <button type="button" data-action="view-statistics"
                            class="flex-shrink-0 text-xs font-semibold text-primary-600 dark:text-primary-400">Вся статистика →</button>
                </div>
                ${fallback ? '<div class="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 text-right">офлайн-данные</div>' : ''}
            </div>
        `;
    },

    bindTonnageModuleEvents(container, app) {
        container.querySelectorAll('[data-action="tonnage-period"]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.getTonnageState().period = btn.dataset.period;
                this.refreshTonnageModule(app)
                    .catch(error => console.warn('[Workouts] Tonnage refresh failed:', error));
            });
        });
        container.querySelectorAll('[data-action="tonnage-open-filters"]').forEach(btn => {
            btn.addEventListener('click', () => this.showTonnageFiltersSheet(app));
        });
        container.querySelectorAll('[data-action="view-statistics"]').forEach(btn => {
            btn.addEventListener('click', () => app.showPage('statistics'));
        });
        container.querySelectorAll('[data-role="tonnage-chart"]').forEach(chart => {
            this.bindTonnageChart(chart);
        });
    },

    // Hover / tap indicators for the tonnage area chart. The chart markup owns
    // the geometry (slot x/y per point); this only drives the marker, the guide
    // line and the readout, and falls back to the last point on pointer leave.
    bindTonnageChart(chart) {
        let points = [];
        try {
            points = JSON.parse(chart.dataset.points || '[]');
        } catch (error) {
            console.warn('[Workouts] Malformed tonnage chart data:', error);
            return;
        }
        if (!points.length) return;

        const marker = chart.querySelector('[data-tonnage-marker]');
        const guide = chart.querySelector('[data-tonnage-guide]');
        const readout = chart.querySelector('[data-tonnage-readout]');
        const surface = chart.querySelector('[data-tonnage-surface]');
        const plot = marker?.parentElement || null;
        const defaultIndex = points.length - 1;

        const formatValue = (value) => `${Math.round(value).toLocaleString('ru-RU')} кг`;

        // The marker is 10px wide and centred on its x, so the first/last slot
        // would push it (and the guide) past the plot on narrow viewports.
        // Inset by the radius as a share of the measured plot width.
        const clampX = (x) => {
            const width = plot?.getBoundingClientRect().width || 0;
            if (!width) return Math.min(100, Math.max(0, x));
            const inset = (TONNAGE_MARKER_RADIUS / width) * 100;
            return Math.min(100 - inset, Math.max(inset, x));
        };

        const show = (index) => {
            const point = points[index];
            if (!point) return;
            const x = clampX(point.x);
            if (marker) {
                marker.style.left = `${x}%`;
                marker.style.top = `${point.y}%`;
                marker.classList.remove('opacity-0');
            }
            if (guide) {
                guide.style.left = `${x}%`;
                guide.classList.remove('opacity-0');
            }
            if (readout) {
                readout.textContent = point.label ? `${point.label}: ${formatValue(point.value)}` : formatValue(point.value);
            }
        };

        chart.querySelectorAll('[data-tonnage-hit]').forEach(hit => {
            const index = Number(hit.dataset.tonnageHit);
            hit.addEventListener('pointerenter', () => show(index));
            // Touch devices have no hover, so a tap pins the same indicator.
            hit.addEventListener('pointerdown', () => show(index));
        });

        surface?.addEventListener('pointerleave', () => show(defaultIndex));

        // Anchor the indicator on the latest point right after mount, so the
        // chart never opens with a missing/misplaced marker.
        show(defaultIndex);
    },

    async refreshTonnageModule(app) {
        const host = document.getElementById('tonnage-module');
        if (!host) return;
        try {
            const data = await API.get(this.buildTonnageQuery(), app.state.tokens.access);
            this.tonnageData = data;
        } catch (error) {
            console.warn('[Workouts] Tonnage request failed, falling back to local history:', error);
            this.tonnageData = null;
        }
        // The dashboard may have navigated away while the request was in flight
        const current = document.getElementById('tonnage-module');
        if (!current) return;
        current.innerHTML = this.renderTonnageModule(this.tonnageData);
        this.bindTonnageModuleEvents(current, app);
    },

    // Bottom sheet with the advanced tonnage filters: date range, muscle group,
    // exercise and source template.
    async showTonnageFiltersSheet(app) {
        this.app = app;
        const state = this.getTonnageState();
        const token = app.state.tokens?.access || null;
        // Re-opening replaces the previous sheet: close it through its own
        // handler so the body scroll lock is released instead of leaking.
        this.closeTonnageFiltersSheet();

        let meta = { muscle_groups: {} };
        let templates = [];
        const exerciseNames = [...new Set(
            (this.recentSessions || []).flatMap(s => (s.exercises || []).map(ex => ex.name).filter(Boolean))
        )].sort((a, b) => a.localeCompare(b, 'ru'));

        // Catalog meta and templates are optional: the sheet must still work
        // offline with whatever is already known client-side.
        if (navigator.onLine !== false) {
            const [metaResult, templatesResult] = await Promise.all([
                API.get('/workouts/exercises/meta', token).catch(() => null),
                API.get('/workouts/templates', token).catch(() => null),
            ]);
            if (metaResult) meta = metaResult;
            if (Array.isArray(templatesResult)) templates = templatesResult;
        }

        const filters = state.filters;
        const groupOptions = Object.entries(meta.muscle_groups || {});

        const sheet = document.createElement('div');
        sheet.id = 'tonnageFiltersSheet';
        sheet.className = 'drum-sheet fixed inset-0 z-[60] pointer-events-auto';
        sheet.innerHTML = `
            <div class="drum-sheet-backdrop absolute inset-0 bg-black/40 dark:bg-black/60" data-action="tonnage-filters-close"></div>
            <div class="drum-sheet-panel absolute bottom-0 left-0 right-0 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 rounded-t-2xl border-t border-zinc-200 dark:border-white/10 flex flex-col drum-sheet-safe" role="dialog" aria-modal="true" aria-labelledby="tonnage-filters-title">
                <div class="w-10 h-1 rounded-full bg-zinc-300 dark:bg-white/20 mx-auto drum-sheet-handle flex-shrink-0"></div>
                <div class="flex items-start justify-between gap-3 px-4 pt-1 pb-2">
                    <div class="min-w-0">
                        <div class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Тоннаж</div>
                        <div id="tonnage-filters-title" class="text-base font-bold">Фильтры</div>
                    </div>
                    <button type="button" data-action="tonnage-filters-close" class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0">✕</button>
                </div>

                <div class="px-4 pb-4 overflow-y-auto space-y-4">
                    <div>
                        <label class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">Период (даты)</label>
                        <div class="grid grid-cols-2 gap-2 mt-1.5">
                            <input type="date" data-filter="start_date" value="${this.escapeHtml(filters.start_date)}"
                                   class="px-3 py-2.5 text-sm glass-input rounded-xl">
                            <input type="date" data-filter="end_date" value="${this.escapeHtml(filters.end_date)}"
                                   class="px-3 py-2.5 text-sm glass-input rounded-xl">
                        </div>
                        <p class="text-[11px] text-zinc-500 mt-1.5">Указанные даты заменяют переключатель «Неделя / Месяц / Всё время».</p>
                    </div>

                    <div>
                        <label class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold" for="tonnage-filter-group">Группа мышц</label>
                        <select id="tonnage-filter-group" data-filter="muscle_group" class="w-full px-3 py-2.5 text-sm glass-input rounded-xl mt-1.5">
                            <option value="">Любая</option>
                            ${groupOptions.map(([slug, label]) => `
                                <option value="${slug}" ${filters.muscle_group === slug ? 'selected' : ''}>${this.escapeHtml(label)}</option>
                            `).join('')}
                        </select>
                    </div>

                    <div>
                        <label class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold" for="tonnage-filter-exercise">Упражнение</label>
                        <input id="tonnage-filter-exercise" type="text" list="tonnage-exercise-options" data-filter="exercise_name"
                               value="${this.escapeHtml(filters.exercise_name)}" placeholder="Любое упражнение"
                               class="w-full px-3 py-2.5 text-sm glass-input rounded-xl mt-1.5">
                        <datalist id="tonnage-exercise-options">
                            ${exerciseNames.map(name => `<option value="${this.escapeHtml(name)}"></option>`).join('')}
                        </datalist>
                    </div>

                    <div>
                        <label class="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold" for="tonnage-filter-template">Шаблон</label>
                        <select id="tonnage-filter-template" data-filter="template_id" class="w-full px-3 py-2.5 text-sm glass-input rounded-xl mt-1.5">
                            <option value="">Любой</option>
                            ${templates.map(t => `
                                <option value="${t.id}" ${String(filters.template_id) === String(t.id) ? 'selected' : ''}>${this.escapeHtml(t.name)}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div class="px-4 pb-4 pt-2 flex gap-2 border-t border-zinc-200 dark:border-white/10">
                    <button type="button" data-action="tonnage-filters-reset"
                            class="flex-1 py-3 rounded-2xl glass text-sm font-semibold">Сбросить</button>
                    <button type="button" data-action="tonnage-filters-apply"
                            class="flex-1 py-3 rounded-2xl bg-lime-500 text-zinc-950 font-bold text-sm shadow-md btn-press">Применить</button>
                </div>
            </div>
        `;

        const onKeydown = (e) => {
            if (e.key === 'Escape') close();
        };
        // Scroll lock: remember whether the body was already locked by another
        // sheet so closing this one never unlocks scrolling we do not own.
        const bodyWasLocked = document.body.classList.contains('overflow-hidden');
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeydown);
            if (!bodyWasLocked) document.body.classList.remove('overflow-hidden');
            sheet.remove();
            if (this._tonnageFiltersClose === close) this._tonnageFiltersClose = null;
        };
        this._tonnageFiltersClose = close;

        sheet.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'tonnage-filters-close') close();
            if (action === 'tonnage-filters-reset') {
                state.filters = { start_date: '', end_date: '', muscle_group: '', exercise_name: '', template_id: '' };
                close();
                this.refreshTonnageModule(app);
            }
            if (action === 'tonnage-filters-apply') {
                sheet.querySelectorAll('[data-filter]').forEach(input => {
                    state.filters[input.dataset.filter] = input.value || '';
                });
                close();
                this.refreshTonnageModule(app);
            }
        });
        document.addEventListener('keydown', onKeydown);

        (document.getElementById('modals') || document.body).appendChild(sheet);
        document.body.classList.add('overflow-hidden');
    },

    // Safe to call when no filters sheet is open.
    closeTonnageFiltersSheet() {
        this._tonnageFiltersClose?.();
    },

    getLocalSession() {
        try {
            const raw = localStorage.getItem(LOCAL_SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('[Workouts] Failed to read local session:', error);
            return null;
        }
    },

    getActiveLocalSession() {
        const session = this.getLocalSession();
        return session && session.status === 'active' ? session : null;
    },

    saveLocalSession(session) {
        try {
            localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
        } catch (error) {
            console.error('[Workouts] Failed to persist local session:', error);
        }
    },

    // Persists live UI edits of a local session without dropping queued patch payloads
    persistLocalSession(session) {
        const stored = this.getLocalSession();
        if (!stored || stored.key !== session.key) return;
        this.saveLocalSession({ ...stored, name: session.name, exercises: session.exercises });
    },

    clearLocalSession() {
        localStorage.removeItem(LOCAL_SESSION_KEY);
    },

    getLocallyClosedSessions() {
        try {
            const raw = localStorage.getItem(LOCAL_CLOSED_SESSIONS_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            return [];
        }
    },

    // Server sessions finished/cancelled while offline must not show as active once back online
    markSessionClosedLocally(sessionId) {
        if (!sessionId) return;
        const closed = this.getLocallyClosedSessions();
        if (!closed.includes(sessionId)) closed.push(sessionId);
        try {
            localStorage.setItem(LOCAL_CLOSED_SESSIONS_KEY, JSON.stringify(closed.slice(-50)));
        } catch (error) {
            console.warn('[Workouts] Failed to persist locally closed sessions:', error);
        }
    },

    isSessionClosedLocally(sessionId) {
        return this.getLocallyClosedSessions().includes(sessionId);
    },

    forgetLocallyClosedSession(sessionId) {
        const closed = this.getLocallyClosedSessions();
        if (!closed.includes(sessionId)) return;
        localStorage.setItem(LOCAL_CLOSED_SESSIONS_KEY, JSON.stringify(closed.filter(id => id !== sessionId)));
    },

    markSessionCompletedLocally(sessionId) {
        this.markSessionClosedLocally(sessionId);
    },

    markSessionCancelledLocally(sessionId) {
        this.markSessionClosedLocally(sessionId);
    },

    // Fetch the exercise catalog, caching to IndexedDB on success and
    // falling back to the local cache when the network is unavailable.
    async fetchExerciseCatalog(token) {
        try {
            const [meta, exercises] = await Promise.all([
                API.get('/workouts/exercises/meta', token),
                API.get('/workouts/exercises', token),
            ]);
            // Persist to IndexedDB for offline use (best-effort, never blocks the UI)
            try {
                await DB.saveExerciseCatalog(exercises);
                if (meta) await DB.saveExerciseCatalogMeta(meta);
            } catch (cacheError) {
                console.warn('[Workouts] Failed to cache exercise catalog:', cacheError);
            }
            return { meta, exercises, fromCache: false };
        } catch (error) {
            console.warn('[Workouts] Exercise catalog fetch failed, trying cache:', error);
            try {
                const [cachedExercises, cachedMeta] = await Promise.all([
                    DB.getExerciseCatalog(),
                    DB.getExerciseCatalogMeta(),
                ]);
                if (cachedExercises && cachedExercises.length > 0) {
                    return {
                        meta: cachedMeta || { muscle_groups: {}, equipment: {} },
                        exercises: cachedExercises,
                        fromCache: true,
                    };
                }
            } catch (cacheError) {
                console.error('[Workouts] Failed to read cached exercise catalog:', cacheError);
            }
            throw error;
        }
    },

    isLocalSession(session) {
        return !!session && session.isLocal === true;
    },

    buildLocalSessionFromTemplate(template) {
        let setCounter = 0;
        const exercises = [...(template.exercises || [])]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((ex, index) => {
                const exerciseId = TEMP_EXERCISE_ID_BASE - index;
                const targetSets = Math.max(1, ex.target_sets || 3);
                return {
                    id: exerciseId,
                    name: ex.name,
                    order: ex.order ?? index,
                    notes: ex.notes ?? null,
                    sets: Array.from({ length: targetSets }, (_, i) => {
                        setCounter += 1;
                        return {
                            id: TEMP_SET_ID_BASE - setCounter,
                            exercise_id: exerciseId,
                            set_number: i + 1,
                            weight_kg: i === 0 ? (ex.target_weight_kg ?? 0) : 0,
                            reps: ex.target_reps || 10,
                            rest_seconds: ex.rest_seconds ?? null,
                            is_completed: false,
                        };
                    }),
                };
            });

        return {
            key: `local-${Date.now()}`,
            isLocal: true,
            status: 'active',
            name: template.name || 'Тренировка',
            started_at: new Date().toISOString(),
            completed_at: null,
            duration_seconds: null,
            exercises,
            pendingPatches: [],
            remoteSessionId: null,
            setIdMap: {},
        };
    },

    recordLocalSetPatch(sessionKey, setId, patch) {
        const session = this.getLocalSession();
        if (!session || session.key !== sessionKey) return;
        const pending = session.pendingPatches || [];
        const existing = pending.find(item => item.setId === setId);
        if (existing) {
            Object.assign(existing.patch, patch);
        } else {
            pending.push({ setId, patch: { ...patch } });
        }
        session.pendingPatches = pending;
        this.saveLocalSession(session);
    },

    mapLocalSetId(session, setId) {
        if (!this.isLocalSession(session)) return setId;
        return session.setIdMap?.[String(setId)] ?? null;
    },

    // Queue items referring to a not-yet-synced local session are rewritten once the
    // real session (and its set ids) are known; `false` means "not ready yet".
    resolveQueuedItem(item) {
        if (!item?.offlineSessionKey) return item;
        if (!item.endpoint.includes(LOCAL_SESSION_PLACEHOLDER)) return item;
        const session = this.getLocalSession();
        const remoteSessionId = session?.remoteSessionId ?? null;
        if (!remoteSessionId) {
            // The session creation was dropped: let the request fail instead of blocking the queue
            return session?.createFailed ? item : false;
        }
        return {
            ...item,
            endpoint: item.endpoint.replace(LOCAL_SESSION_PLACEHOLDER, String(remoteSessionId)),
        };
    },

    async handleSyncedItem(item, response, { failed = false } = {}) {
        if (!item?.offlineSessionKey) {
            const closedMatch = item?.endpoint?.match(/^\/workouts\/sessions\/(\d+)\/(complete|cancel)$/);
            if (closedMatch && !failed) this.forgetLocallyClosedSession(parseInt(closedMatch[1]));
            return;
        }
        const session = this.getLocalSession();
        if (!session || session.key !== item.offlineSessionKey) {
            this.clearLocalSession();
            return;
        }

        if (failed && !session.remoteSessionId) {
            session.createFailed = true;
            this.saveLocalSession(session);
        }

        if (!failed && response?.id && !session.remoteSessionId) {
            const remoteExercises = response.exercises || [];
            const findRemoteExercise = (localEx, exIndex) =>
                remoteExercises.find(remote => remote.name === localEx.name) || remoteExercises[exIndex];

            // The server creates exercises in template order, which may differ from the local one
            const setIdMap = {};
            (session.exercises || []).forEach((localEx, exIndex) => {
                const remoteEx = findRemoteExercise(localEx, exIndex);
                if (!remoteEx) return;
                (localEx.sets || []).forEach((localSet, setIndex) => {
                    const remoteSet = (remoteEx.sets || [])[setIndex];
                    if (remoteSet) setIdMap[String(localSet.id)] = remoteSet.id;
                });
            });

            session.remoteSessionId = response.id;
            session.setIdMap = setIdMap;
            const pendingPatches = session.pendingPatches || [];
            session.pendingPatches = [];
            this.saveLocalSession(session);

            const token = this.app?.state?.tokens?.access || null;

            // Replay offline edits against the real sets before any queued complete/cancel request
            for (const { setId, patch } of pendingPatches) {
                const realSetId = setIdMap[String(setId)];
                if (!realSetId) {
                    console.warn('[Workouts] Skipping offline patch for unmapped set', setId);
                    continue;
                }
                await API.enqueueRequest('PATCH', `/workouts/sets/${realSetId}`, patch, token, { prepend: true });
            }

            const localOrder = (session.exercises || []).map(ex => ex.name);
            const remoteOrder = remoteExercises.map(ex => ex.name);
            const orderChanged = remoteOrder.length === localOrder.length
                && remoteOrder.some((name, i) => name !== localOrder[i]);
            if (orderChanged) {
                const reordered = (session.exercises || []).map((localEx, i) => {
                    const remoteEx = findRemoteExercise(localEx, i);
                    return remoteEx ? { id: remoteEx.id, order: i } : null;
                }).filter(Boolean);
                await API.enqueueRequest('PATCH', `/workouts/sessions/${response.id}`, { exercises: reordered }, token, { prepend: true });
            }

            console.log(`[Workouts] Local session "${session.key}" synced to session ${response.id}`);
            window.dispatchEvent(new CustomEvent('mylofi:local-session-synced', {
                detail: { sessionId: response.id },
            }));
        }

        if (!(await API.readQueue()).some(queued => queued.offlineSessionKey === session.key)) {
            this.clearLocalSession();
        }
    },

    async startLocalSessionFromTemplate(app, template, createEndpoint) {
        const session = this.buildLocalSessionFromTemplate(template);
        this.saveLocalSession(session);
        await API.markQueuedRequest('POST', createEndpoint, { offlineSessionKey: session.key });
        app?.showToast(OFFLINE_START_MESSAGE, 'info');
        return session;
    },

    completeLocalSession(app) {
        const session = this.getActiveLocalSession();
        if (!session) return false;
        const token = app?.state?.tokens?.access || null;
        session.status = 'completed';
        session.completed_at = new Date().toISOString();
        session.duration_seconds = this.getElapsedSeconds(session);
        this.saveLocalSession(session);
        API.enqueueRequest(
            'POST',
            `/workouts/sessions/${LOCAL_SESSION_PLACEHOLDER}/complete`,
            null,
            token,
            { offlineSessionKey: session.key }
        );
        app?.showToast(OFFLINE_COMPLETE_MESSAGE, 'info');
        return true;
    },

    cancelLocalSession(app) {
        const session = this.getActiveLocalSession();
        if (!session) return false;
        const token = app?.state?.tokens?.access || null;
        session.status = 'cancelled';
        this.saveLocalSession(session);
        API.enqueueRequest(
            'POST',
            `/workouts/sessions/${LOCAL_SESSION_PLACEHOLDER}/cancel`,
            null,
            token,
            { offlineSessionKey: session.key }
        );
        return true;
    },

    async render(container, app) {
        this.app = app;
        try {
        this.stopWorkoutTimer();
        // The filters sheet lives in the shared #modals host, so release its
        // scroll lock if it survived a navigation.
        this.closeTonnageFiltersSheet();
        let activeSession;
        let stats = null;
        let templates = [];
        let historyData = { sessions: [] };
        try {
            [activeSession, stats, templates, historyData] = await Promise.all([
                API.get('/workouts/sessions/active', app.state.tokens.access).catch(() => null),
                API.get('/workouts/statistics', app.state.tokens.access).catch(() => null),
                API.get('/workouts/templates', app.state.tokens.access).catch(() => []),
                API.get('/workouts/history?limit=100', app.state.tokens.access).catch(() => ({ sessions: [] })),
            ]);
        } catch (error) {
            console.error('[Workouts] Load error:', error);
        }

        // A workout started offline lives only in localStorage until it is synced
        if (!activeSession) {
            activeSession = this.getActiveLocalSession();
        } else if (activeSession.id && this.isSessionClosedLocally(activeSession.id)) {
            // Completed offline and not yet replayed on the server
            activeSession = null;
        }

        const recentSessions = (historyData?.sessions || []).filter(s => s.status === 'completed');
        this.recentSessions = recentSessions;
        // Kept on the instance so the tonnage module can surface the streak
        // without rendering a second, redundant stats block.
        this.stats = stats;

        const hasActiveSession = !!activeSession;
        const activeMetrics = this.getWorkoutMetrics(activeSession || { exercises: [] });
        const activePercent = activeMetrics.total > 0
            ? Math.round((activeMetrics.completed / activeMetrics.total) * 100)
            : 0;
        const records = this.getPersonalRecords(recentSessions);

        const templatesWidget = `
            <div class="mb-6">
                <div class="flex justify-between items-center mb-3">
                    <h3 class="text-sm font-semibold text-surface-500 uppercase tracking-wider">Мои тренировки</h3>
                    <span class="text-xs text-primary-600 dark:text-primary-400 font-medium">${templates.length} шт.</span>
                </div>
                ${templates.length === 0
                    ? `<div class="glass rounded-2xl p-5 text-center">
                        <p class="text-sm text-surface-500 dark:text-surface-400 mb-3">Пока нет своих тренировок</p>
                        <button data-action="show-build-workout" class="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold">Собрать первую →</button>
                    </div>`
                    : `<div class="flex overflow-x-auto snap-x snap-mandatory gap-2.5 pb-2 scrollbar-none -mx-4 px-4">
                    ${templates.map(t => `
                        <div class="min-w-[198px] max-w-[216px] snap-center glass border ${hasActiveSession ? 'border-surface-200/70 dark:border-white/10 opacity-60' : ''} rounded-2xl p-3.5 flex flex-col justify-between shadow-sm">
                            <div class="flex-1 cursor-pointer" data-action="view-template" data-template-id="${t.id}">
                                <h4 class="font-bold text-sm truncate mb-1" title="${this.escapeHtml(t.name)}">${this.escapeHtml(t.name)}</h4>
                                <p class="text-[11px] text-surface-500 dark:text-surface-400 mb-1.5">${t.exercises.length} упр.</p>
                                <div class="text-[10px] text-surface-400 truncate mb-2.5">
                                    ${t.exercises.map(ex => ex.name).join(', ')}
                                </div>
                            </div>
                            <div class="flex gap-1.5">
                                <button data-action="start-template" data-template-id="${t.id}" ${hasActiveSession ? 'disabled' : ''}
                                        class="flex-1 min-w-0 py-1.5 flex items-center justify-center gap-1.5 ${hasActiveSession ? 'bg-surface-200 dark:bg-white/10 text-surface-500 dark:text-surface-400 cursor-not-allowed' : 'bg-primary-600 text-white'} rounded-xl text-[11px] font-semibold text-center shadow-sm">
                                    ${hasActiveSession ? `${LOCK_ICON}<span>Активна тренировка</span>` : '<span>Начать тренировку →</span>'}
                                </button>
                                <button data-action="start-template-ai" data-template-id="${t.id}" ${hasActiveSession ? 'disabled' : ''}
                                        title="Начать с ИИ-тренером" aria-label="Начать с ИИ-тренером"
                                        class="flex-shrink-0 w-9 py-1.5 flex items-center justify-center rounded-xl text-[13px] ${hasActiveSession ? 'bg-surface-200 dark:bg-white/10 text-surface-500 dark:text-surface-400 cursor-not-allowed' : 'bg-surface-800 dark:bg-white dark:text-zinc-950'} shadow-sm">
                                    ${AI_START_ICON}
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>`}
            </div>
        `;

        let html = `
            <div class="p-4">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">Тренировки</h2>
                </div>

                <div id="tonnage-module" class="mb-6">
                    ${this.renderTonnageModule(this.tonnageData)}
                </div>

                ${activeSession
                    ? `<div class="bg-lime-50 dark:bg-lime-900/20 border border-lime-200 dark:border-lime-800 rounded-xl p-4 mb-6 shadow-sm">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="font-semibold text-lime-700 dark:text-lime-300">Активная тренировка</h3>
                            <span class="flex items-center gap-1.5 text-sm font-mono tabular-nums text-lime-700 dark:text-lime-300">
                                <span class="w-2.5 h-2.5 rounded-full bg-lime-500 animate-pulse"></span>
                                <span id="dashboard-workout-timer">${this.formatTimer(this.getElapsedSeconds(activeSession))}</span>
                            </span>
                        </div>
                        <p class="text-sm text-surface-600 dark:text-surface-300 mb-3">${this.escapeHtml(activeSession.name || 'Без названия')}</p>
                        <div class="mb-3">
                            <div class="flex items-center justify-between gap-2 mb-1">
                                <span class="text-xs font-semibold text-surface-600 dark:text-surface-300">Сделано ${activeMetrics.completed} из ${activeMetrics.total} подходов (${activePercent}%)</span>
                                <span class="text-xs font-semibold text-surface-600 dark:text-surface-300">${Math.round(activeMetrics.tonnage)} кг</span>
                            </div>
                            <div class="h-2 w-full rounded-full bg-surface-200 dark:bg-white/10 overflow-hidden">
                                <div class="h-full rounded-full bg-surface-800 dark:bg-zinc-100 transition-all duration-300" style="width: ${activePercent}%"></div>
                            </div>
                        </div>
                        <button data-action="resume-workout" data-session-id="${activeSession.isLocal ? activeSession.key : activeSession.id}"
                                class="w-full py-2.5 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl text-sm font-semibold shadow-md">
                            Продолжить тренировку →
                        </button>
                    </div>`
                    : ''}

                ${templatesWidget}

                <div class="mb-6">
                    <h3 class="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">Быстрый старт</h3>
                    <div class="flex overflow-x-auto snap-x snap-mandatory gap-2.5 pb-3 scrollbar-none -mx-4 px-4">
                        <!-- Card 1: Build Custom -->
                        <div class="min-w-[216px] max-w-[234px] snap-center glass border rounded-2xl p-3.5 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="show-build-workout">
                            <div>
                                <div class="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-2.5">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                                </div>
                                <h4 class="font-bold text-base mb-1">Собрать тренировку</h4>
                                <p class="text-[11px] text-surface-500 dark:text-surface-400">Создать и сохранить свой шаблон из каталога (220+)</p>
                            </div>
                            <span class="mt-3 text-[11px] font-semibold bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2.5 py-1.5 rounded-xl text-center">Создать шаблон →</span>
                        </div>

                        <!-- Card 2: Quick Start -->
                        <div class="min-w-[216px] max-w-[234px] snap-center glass border ${hasActiveSession ? 'border-surface-200/70 dark:border-white/10' : ''} rounded-2xl p-3.5 flex flex-col justify-between shadow-sm ${hasActiveSession ? 'opacity-60' : 'cursor-pointer btn-press'}" data-action="${hasActiveSession ? '' : 'quick-start-workout'}">
                            <div>
                                <div class="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-2.5">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                </div>
                                <h4 class="font-bold text-base mb-1">Быстрый старт</h4>
                                <p class="text-[11px] text-surface-500 dark:text-surface-400">Готовая тренировка под цель: сила, масса или выносливость</p>
                            </div>
                            ${hasActiveSession
                                ? `<span class="mt-3 text-[11px] font-semibold bg-surface-200 dark:bg-white/5 text-surface-500 dark:text-surface-400 px-2.5 py-1.5 rounded-xl text-center flex items-center justify-center gap-1.5">${LOCK_ICON}<span>Активна тренировка</span></span>`
                                : '<span class="mt-3 text-[11px] font-semibold bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2.5 py-1.5 rounded-xl text-center">Начать сразу →</span>'}
                        </div>

                        <!-- Card 3: History -->
                        <div class="min-w-[216px] max-w-[234px] snap-center glass border rounded-2xl p-3.5 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="view-history">
                            <div>
                                <div class="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-2.5">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                </div>
                                <h4 class="font-bold text-base mb-1">История</h4>
                                <p class="text-[11px] text-surface-500 dark:text-surface-400">${recentSessions.length > 0 ? `Завершено ${recentSessions.length} тренировок, детальный разбор` : 'Хронология тренировок и разбор каждой'}</p>
                            </div>
                            <span class="mt-3 text-[11px] font-semibold bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2.5 py-1.5 rounded-xl text-center">Открыть историю →</span>
                        </div>

                        <!-- Card 4: Personal Records -->
                        <div class="min-w-[216px] max-w-[234px] snap-center glass border rounded-2xl p-3.5 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="view-records">
                            <div>
                                <div class="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-2.5">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-1l2 2 4-4m-5.5-8.5L19 3l2 2-3 3-2-2z"/></svg>
                                </div>
                                <h4 class="font-bold text-base mb-1">Личные рекорды (PR)</h4>
                                <p class="text-[11px] text-surface-500 dark:text-surface-400">${records.length > 0 ? `Максимумы по ${records.length} упражнениям` : 'Максимальные веса по упражнениям'}</p>
                            </div>
                            <span class="mt-3 text-[11px] font-semibold bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-2.5 py-1.5 rounded-xl text-center">Смотреть рекорды →</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        this.bindTonnageModuleEvents(container, app);
        // Fire-and-forget: the module already rendered from the local history
        // fallback, so the dashboard stays interactive while the API call runs.
        this.refreshTonnageModule(app).catch(error =>
            console.warn('[Workouts] Tonnage refresh failed:', error));

        container.querySelectorAll('[data-action="show-build-workout"]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showBuildWorkout(app);
            });
        });
        container.querySelectorAll('[data-action="quick-start-workout"]').forEach(el => {
            el.addEventListener('click', () => this.showQuickStartModal(app));
        });
        container.querySelectorAll('[data-action="view-records"]').forEach(el => {
            el.addEventListener('click', () => this.renderPersonalRecords(container, app, records));
        });
        container.querySelectorAll('[data-action="view-templates"]').forEach(el => {
            el.addEventListener('click', () => app.showPage('templates'));
        });
        container.querySelector('[data-action="resume-workout"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const sessionId = e.currentTarget.dataset.sessionId;
            this.renderWorkoutScreen(container, app, sessionId.startsWith('local-') ? sessionId : parseInt(sessionId));
        });

        container.querySelectorAll('[data-action="view-template"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const templateId = parseInt(e.currentTarget.dataset.templateId);
                const template = templates.find(t => t.id === templateId);
                if (template) {
                    this.renderTemplateDetails(container, app, template);
                }
            });
        });

        container.querySelectorAll('[data-action="start-template"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const button = e.currentTarget;
                const templateId = parseInt(button.dataset.templateId);
                const originalHtml = button.innerHTML;

                button.disabled = true;
                button.innerHTML = '<span>Запуск...</span>';

                // Запускаем API запрос СРАЗУ, параллельно с отсчетом
                const startEndpoint = `/workouts/templates/${templateId}/start`;
                const sessionPromise = API.post(startEndpoint, {}, app.state.tokens.access);

                // Запускаем отсчет
                this.renderCountdown(container, () => {});

                try {
                    const session = await sessionPromise;

                    // Рендерим экран
                    await this.renderWorkoutScreen(container, app, session.id);
                } catch (err) {
                    const template = templates.find(t => t.id === templateId);
                    if (err?.offlineQueued && template) {
                        const localSession = await this.startLocalSessionFromTemplate(app, template, startEndpoint);
                        await this.renderWorkoutScreen(container, app, localSession.key);
                        return;
                    }
                    console.error('Start template error:', err);
                    app.showToast(err.message || 'Ошибка запуска', 'error');
                    if (button) {
                        button.disabled = false;
                        button.innerHTML = originalHtml;
                    }
                }
            });
        });

        container.querySelectorAll('[data-action="start-template-ai"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const templateId = parseInt(btn.dataset.templateId);
                await this.startTemplateWithAi(container, app, templateId);
            });
        });

        if (activeSession) {
            this.startWorkoutTimer(activeSession, 'dashboard-workout-timer');
        }
        } catch (error) {
            console.error('[Workouts] Render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки данных');
        }
    },

    getElapsedSeconds(session) {
        if (!session || !session.started_at) return 0;
        const startTime = new Date(session.started_at).getTime();
        if (isNaN(startTime)) return 0;
        return Math.max(0, Math.floor((Date.now() - startTime) / 1000));
    },

    getPersonalRecords(sessions) {
        const best = new Map();

        (sessions || []).forEach(session => {
            (session.exercises || []).forEach(ex => {
                (ex.sets || []).forEach(set => {
                    const weight = set.weight_kg || 0;
                    if (!set.is_completed || weight <= 0 || !set.reps) return;
                    const key = ex.name.trim().toLowerCase();
                    // Epley: оценочный максимум на 1 повтор
                    const e1rm = weight * (1 + set.reps / 30);
                    const current = best.get(key);
                    if (!current || e1rm > current.e1rm) {
                        best.set(key, {
                            name: ex.name,
                            weight_kg: weight,
                            reps: set.reps,
                            e1rm,
                            date: session.completed_at || session.started_at || null,
                        });
                    }
                });
            });
        });

        return [...best.values()].sort((a, b) => b.e1rm - a.e1rm);
    },

    formatTimer(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    startWorkoutTimer(session, elementId = 'workout-timer') {
        this.stopWorkoutTimer();
        if (!session || !session.started_at) return;

        const startTime = new Date(session.started_at).getTime();
        if (isNaN(startTime)) return;
        const timerEl = document.getElementById(elementId);
        if (!timerEl) return;

        const updateTimer = () => {
            const el = document.getElementById(elementId);
            if (!el) {
                this.stopWorkoutTimer();
                return;
            }
            el.textContent = this.formatTimer(Math.floor((Date.now() - startTime) / 1000));
        };

        updateTimer();
        this.workoutTimerInterval = setInterval(updateTimer, 1000);
    },

    stopWorkoutTimer() {
        if (this.workoutTimerInterval) {
            clearInterval(this.workoutTimerInterval);
            this.workoutTimerInterval = null;
        }
    },

    async renderCountdown(container, onComplete) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center modal-backdrop transition-opacity';
        overlay.innerHTML = `
            <div id="countdown" class="text-7xl font-bold text-white tabular-nums animate-pulse">3</div>
        `;
        document.body.appendChild(overlay);

        let count = 3;
        const display = overlay.querySelector('#countdown');
        
        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                display.textContent = count;
            } else {
                clearInterval(interval);
                document.body.removeChild(overlay);
                onComplete();
            }
        }, 1000);
    },

    // ===== AI workout coach =====

    /**
     * The coach's plan for one session, kept on the instance so the exercise
     * cards can look up their own targets while the screen renders. Returns the
     * payload on success and null on anything else - offline, quota, a model
     * that did not answer - because the workout starts with or without it.
     */
    async loadAiPlan(app, body) {
        if (navigator.onLine === false) {
            app.showToast(AI_OFFLINE_MESSAGE, 'info');
            return null;
        }
        try {
            const payload = await API.postImmediate('/ai/workout-preview', body, app.state.tokens.access);
            if (payload?.available) return payload;
            app.showToast(payload?.reason || AI_PLAN_UNAVAILABLE_MESSAGE, 'info');
            return null;
        } catch (err) {
            // Never surfaced as an error toast: the workout is what the user came
            // for, and a plan that did not arrive is not a failure.
            console.warn('[Workouts] AI plan failed:', err);
            app.showToast(AI_PLAN_UNAVAILABLE_MESSAGE, 'info');
            return null;
        }
    },

    /**
     * Starts a template's session with the coach's plan already in hand.
     *
     * The start endpoint is called with `with_ai_plan=true`, which enqueues a
     * background task that generates and stores the plan on the session. The plan
     * is fetched in parallel from the preview endpoint, which reads the stored
     * plan if it is already available (or generates it on demand). The plan is
     * awaited only as far as the screen is: a plan that fails costs the badges,
     * never the workout. The offline branch falls back to the local session
     * exactly like the plain start - the plan needs a connection, the session
     * does not.
     */
    async startTemplateWithAi(container, app, templateId) {
        if (isNaN(templateId) || templateId == null) return;
        const token = app.state.tokens.access;
        const startEndpoint = `/workouts/templates/${templateId}/start`;

        this.renderCountdown(container, () => {});

        const sessionPromise = API.post(startEndpoint, { with_ai_plan: true }, token);

        try {
            const session = await sessionPromise;
            const sessionId = session.id;
            // Try to read the stored plan; if the background task has not stored
            // it yet, the preview endpoint falls back to generating it on the fly.
            const plan = await this.loadAiPlan(app, { session_id: sessionId, template_id: templateId, name: session.name });
            this.aiPlan = plan ? { ...plan, sessionId } : null;
            await this.renderWorkoutScreen(container, app, sessionId);
        } catch (err) {
            console.error('[Workouts] Start with AI error:', err);
            app.showToast(err?.message || 'Ошибка запуска', 'error');
            await this.render(container, app);
        }
    },

    /** The quick-start variants are chosen by goal, so the goal travels with the plan. */
    async startQuickWorkoutWithAi(app, goal) {
        if (navigator.onLine === false) {
            app.showToast(AI_OFFLINE_MESSAGE, 'info');
            return;
        }
        const token = app.state.tokens.access;
        const goalLabel = (QUICK_GOALS.find(g => g.value === goal) || {}).title;

        this.renderCountdown(app.elements.pageContent, () => {});

        try {
            const { session_id: sessionId } = await API.post(
                '/workouts/sessions/quick-start',
                { goal, with_ai_plan: true },
                token,
            );
            // Read the stored plan; the preview endpoint generates it on demand
            // if the background task has not stored it yet.
            const plan = await this.loadAiPlan(app, { goal, name: `Быстрый старт: ${goalLabel}`, session_id: sessionId });
            this.aiPlan = plan ? { ...plan, sessionId } : null;
            await this.renderWorkoutScreen(app.elements.pageContent, app, sessionId);
        } catch (err) {
            console.error('[Workouts] Quick start with AI error:', err);
            app.showToast(err?.message || 'Ошибка быстрого старта', 'error');
            await this.render(app.elements.pageContent, app);
        }
    },

    /**
     * The plan for one exercise card, matched by name the way the server matched
     * it: session exercises are free-text names, so the comparison trims and folds
     * case rather than testing equality.
     */
    findAiPlanFor(exerciseName) {
        const wanted = String(exerciseName || '').trim().toLowerCase();
        if (!wanted || !this.aiPlan) return null;
        return (this.aiPlan.recommendations || [])
            .find(r => String(r?.name || '').trim().toLowerCase() === wanted) || null;
    },

    /** The stored verdict of a session, or null when there is none to read. */
    async loadAiAnalysis(app, sessionId, { quiet = true } = {}) {
        try {
            return await API.get(`/ai/workout-summary/${sessionId}`, app.state.tokens.access);
        } catch (err) {
            console.warn('[Workouts] AI analysis read failed:', err);
            if (!quiet) app.showToast(err?.message || 'Не удалось загрузить разбор', 'error');
            return null;
        }
    },

    /**
     * Ask the model for the verdict on a finished session.
     *
     * The trigger disables itself for the duration so a second tap cannot spend
     * the weekly allowance twice, and the answer is never treated as an error:
     * `available: false` carries the reason - a spent quota, a session without
     * weighted sets, a model that failed - and the card shows that line instead.
     *
     * `rerender` is called with the payload so the caller can swap the card in
     * place rather than reloading the screen underneath the user.
     */
    async analyzeWorkout(app, sessionId, { force = false, notes = null, rerender = null } = {}) {
        const id = parseInt(sessionId);
        if (isNaN(id)) return null;
        if (this._aiAnalysisLoading) return null;
        if (navigator.onLine === false) {
            app.showToast(AI_OFFLINE_MESSAGE, 'info');
            return null;
        }

        this._aiAnalysisLoading = true;
        try {
            const payload = await API.postImmediate(
                `/ai/workout-summary/${id}`,
                { notes, force },
                app.state.tokens.access
            );
            // A verdict that was just written invalidates the cached read of it.
            API.invalidateReadCache(`/ai/workout-summary/${id}`);
            if (payload?.available) {
                app.showToast(force ? 'Разбор пересчитан' : 'Тренировка разобрана', 'success');
            } else {
                app.showToast(payload?.reason || 'Не удалось разобрать тренировку', 'info');
            }
            if (rerender) rerender(payload);
            return payload;
        } catch (err) {
            console.error('[Workouts] AI analysis failed:', err);
            app.showToast(err?.offlineQueued ? AI_OFFLINE_MESSAGE : (err?.message || 'Не удалось разобрать тренировку'), 'error');
            return null;
        } finally {
            this._aiAnalysisLoading = false;
        }
    },

    /**
     * Poll the summary endpoint until the background analysis lands.
     *
     * The complete endpoint returns 202 immediately when `with_ai_analysis=true`;
     * the verdict is produced by a background task. This caller polls the read
     * endpoint with exponential backoff, up to a few minutes, so the user sees the
     * coach's verdict as soon as it is ready rather than on the next page load.
     */
    async pollForAiAnalysis(app, sessionId, { timeoutMs = 180000, intervalMs = 3000 } = {}) {
        const id = parseInt(sessionId);
        if (isNaN(id)) return null;

        const start = Date.now();
        let delay = intervalMs;

        while (Date.now() - start < timeoutMs) {
            const payload = await this.loadAiAnalysis(app, id, { quiet: true });
            if (payload) return payload;

            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 2, 15000);
        }

        app.showToast('ИИ-разбор ещё готовится, проверьте историю позже', 'info');
        return null;
    },

    /**
     * Finish a session and have the coach read it, in one press.
     *
     * The workout is completed first and on its own terms: if the completion
     * fails, or the session was started offline and has no server id yet, the
     * analysis is skipped and the plain flow takes over - a verdict is never
     * worth a lost workout. Only after the session is safely stored is the
     * cascade asked, and its answer is a modal over the dashboard rather than a
     * second screen.
     */
    async completeWorkoutWithAi(app, event) {
        const sessionKey = event.target.closest('[data-session-id]')?.dataset.sessionId;
        const sessionId = parseInt(sessionKey, 10);

        // A session started offline lives in localStorage until it syncs, so it
        // has no id the coach could read. Say so instead of completing silently.
        if (isNaN(sessionId)) {
            app.showToast('ИИ-разбор недоступен: тренировка ещё не синхронизирована', 'info');
            await app.handleCompleteWorkout(event);
            return;
        }
        if (navigator.onLine === false) {
            app.showToast(AI_OFFLINE_MESSAGE, 'info');
            await app.handleCompleteWorkout(event);
            return;
        }

        if (!await Components.confirmModal({
            title: 'Завершить и разобрать с ИИ?',
            message: 'Тренировка будет закрыта, а ИИ-тренер разберёт её и покажет вердикт. На Free это один разбор в 7 дней.',
            confirmText: 'Завершить и разобрать',
            confirmClass: 'bg-primary-600 hover:bg-primary-700 text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 font-semibold shadow-md',
            cancelText: 'Назад'
        })) return;

        // The coach reads the completed sets, so every typed value goes out
        // before the session closes.
        await app.flushPendingSetEdits();

        // The verdict takes tens of seconds, so the button says what is actually
        // happening instead of looking already finished. Every path below
        // re-renders the screen, which is what puts the button back.
        const button = event.target.closest('[data-action="complete-workout-ai"]');
        if (button) {
            button.disabled = true;
            button.classList.add('opacity-70', 'cursor-wait');
            button.innerHTML = `
                <span class="btn-spinner" aria-hidden="true"></span>
                <span>ИИ анализирует тренировку...</span>
            `;
        }

        try {
            await API.post(`/workouts/sessions/${sessionId}/complete`, { with_ai_analysis: true }, app.state.tokens.access);
        } catch (err) {
            console.error('[Workouts] Complete with AI failed:', err);
            app.showToast(err?.offlineQueued ? OFFLINE_COMPLETE_MESSAGE : (err?.message || 'Ошибка завершения тренировки'), 'error');
            await app.renderPage('workouts');
            return;
        }

        app.showToast('Тренировка завершена! ИИ-тренер формирует разбор в истории.', 'success');
        app.state.currentPage = 'history';
        app.elements.navItems.forEach(item => item.classList.toggle('active', item.dataset.page === 'history'));
        await this.renderHistoryDetail(app.elements.pageContent, app, sessionId);
    },

    /**
     * The verdict on its own, right after the last set: a modal over the app so
     * the read is immediate and the workout screen underneath is untouched. The
     * same card is rendered inline in the history, so there is one card and one
     * breakdown.
     *
     * It opens the way every other modal in the app opens - backdrop fading in,
     * panel scaling up from 95% - and closes the same way, so the verdict that
     * the user waited for lands as the app's own surface rather than as a sheet
     * that just appears.
     */
    showAiSummaryModal(app, payload, { title = 'Разбор тренировки' } = {}) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 flex items-end sm:items-center justify-center modal-backdrop pointer-events-auto opacity-0 transition-opacity duration-200';
        modal.innerHTML = `
            <div data-ai-summary-panel class="glass-strong rounded-t-3xl sm:rounded-3xl p-5 w-full sm:max-w-md max-h-[85vh] overflow-y-auto transform transition-all duration-200 scale-95 opacity-0">
                <div class="flex justify-between items-center mb-3">
                    <h3 class="text-lg font-bold truncate">${this.escapeHtml(title)}</h3>
                    <button type="button" data-action="close-ai-summary" class="text-surface-500 hover:text-surface-900 dark:text-surface-400 p-1" aria-label="Закрыть">✕</button>
                </div>
                <div id="ai-summary-card">
                    ${Components.aiWorkoutCard(payload, { title: 'Разбор от ИИ-тренера' })}
                </div>
            </div>
        `;
        const panel = modal.querySelector('[data-ai-summary-panel]');

        let settled = false;
        const close = () => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKeydown);
            // Same exit as confirmModal: reverse the entrance, then drop the node
            // once the transition has finished, so the panel does not vanish
            // mid-animation.
            modal.classList.remove('opacity-100');
            panel.classList.remove('scale-100', 'opacity-100');
            panel.classList.add('scale-95', 'opacity-0');
            setTimeout(() => modal.remove(), 200);
        };
        const onKeydown = (e) => {
            if (e.key === 'Escape') close();
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('[data-action="close-ai-summary"]').addEventListener('click', close);
        document.addEventListener('keydown', onKeydown);
        (document.getElementById('modals') || document.body).appendChild(modal);
        requestAnimationFrame(() => {
            modal.classList.add('opacity-100');
            panel.classList.remove('scale-95', 'opacity-0');
            panel.classList.add('scale-100', 'opacity-100');
        });
        return modal;
    },

    async renderTemplateDetails(container, app, template) {
        this.app = app;
        const html = `
            <div class="p-4">
                <div class="flex items-center justify-between mb-4">
                    <button data-action="back-to-workouts" class="text-surface-500 hover:text-surface-900">←</button>
                    <h2 class="text-xl font-bold">${template.name}</h2>
                    <div class="flex gap-2">
                        <button data-action="edit-template" data-template-id="${template.id}" class="text-surface-500 hover:text-primary-600">✏️</button>
                        <button data-action="delete-template" data-template-id="${template.id}" class="text-surface-500 hover:text-red-500">🗑️</button>
                    </div>
                </div>

                <div class="glass rounded-xl p-4">
                    <h3 class="font-semibold mb-3">Упражнения (${template.exercises.length})</h3>
                    <ul class="space-y-2">
                        ${template.exercises.map(ex => `
                            <li class="text-sm py-2 border-b  last:border-0">
                                ${ex.name} - ${ex.target_sets} подх. × ${ex.target_reps} повт.
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        `;
        container.innerHTML = html;

        container.querySelector('[data-action="back-to-workouts"]').addEventListener('click', () => {
            this.render(container, app);
        });

        container.querySelector('[data-action="edit-template"]').addEventListener('click', () => {
            this.showEditTemplateModal(app, template);
        });

        container.querySelector('[data-action="delete-template"]').addEventListener('click', async () => {
            if (!await Components.confirmModal({
                title: 'Удалить шаблон?',
                message: `Шаблон «${template.name}» будет удалён безвозвратно.`,
                confirmText: 'Удалить',
                confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md',
                cancelText: 'Назад'
            })) return;
            try {
                await API.delete(`/workouts/templates/${template.id}`, app.state.tokens.access);
                app.showToast('Шаблон удален', 'info');
                this.render(container, app);
            } catch (err) {
                app.showToast(err.message || 'Ошибка удаления', 'error');
            }
        });
    },

    async renderWorkoutScreen(container, app, sessionId) {
        this.app = app;
        try {
        this.stopWorkoutTimer();
        let session;
        let historyData = { sessions: [] };
        const localSession = this.getActiveLocalSession();
        const wantsLocal = localSession && (sessionId === localSession.key || !sessionId);

        if (wantsLocal) {
            session = localSession;
            historyData = await API.get('/workouts/history?limit=50', app.state.tokens.access).catch(() => ({ sessions: [] }));
        } else {
            try {
                const url = sessionId ? `/workouts/sessions/${sessionId}` : '/workouts/sessions/active';
                [session, historyData] = await Promise.all([
                    API.get(url, app.state.tokens.access),
                    API.get('/workouts/history?limit=50', app.state.tokens.access).catch(() => ({ sessions: [] }))
                ]);
            } catch (error) {
                console.error('[Workouts] Session/History load error:', error);
                session = this.getActiveLocalSession();
                if (!session) {
                    app.showToast('Ошибка загрузки данных', 'error');
                    return;
                }
            }
        }
        if (!session) {
            app.showToast('Нет активной тренировки', 'info');
            return;
        }
        // The plan belongs to the session it was made for: resuming that one keeps
        // the badges, and starting any other workout drops them.
        if (this.aiPlan && String(this.aiPlan.sessionId) !== String(session.id)) {
            this.aiPlan = null;
        }
        app.state.currentSessionId = session.isLocal ? session.key : session.id;

        // Anchor the silent rest clock to when the session started, falling back
        // to the local clock for sessions that never got a server timestamp.
        const sessionStart = session.started_at ? new Date(session.started_at).getTime() : Date.now();
        this.sessionStartTimestamp = sessionStart;
        this.lastSetCompletedAt = null;

        const completedHistorySessions = [...(historyData?.sessions || [])]
            .filter(s => s.status === 'completed')
            .sort((a, b) => new Date(a.started_at) - new Date(b.started_at));

const exerciseCards = (session.exercises || []).map((ex, index, arr) => {
            const historyPoints = completedHistorySessions
                .map(s => {
                    const matchEx = (s.exercises || []).find(e => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase());
                    if (!matchEx) return null;
                    const tonnage = (matchEx.sets || []).reduce((sum, set) => sum + ((set.weight_kg || 0) * (set.reps || 0)), 0);
                    return tonnage > 0 ? tonnage : null;
                })
                .filter(v => v != null && v > 0)
                .slice(-10);

            return `
             <div class="workout-card snap-center glass rounded-3xl p-4 flex flex-col space-y-4" data-exercise-id="${ex.id}">
                <div class="flex justify-between items-start mb-4 gap-2">
                    <h3 class="font-bold text-lg text-surface-900 dark:text-surface-50 leading-tight flex-1 min-w-0 break-words" title="${ex.name}">${ex.name}</h3>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        <button type="button" data-action="move-ex-up" data-ex-id="${ex.id}" class="w-8 h-8 glass rounded-xl text-xs font-bold hover:bg-surface-200 transition-colors ${index === 0 ? 'opacity-30 cursor-not-allowed' : ''}">▲</button>
                        <button type="button" data-action="move-ex-down" data-ex-id="${ex.id}" class="w-8 h-8 glass rounded-xl text-xs font-bold hover:bg-surface-200 transition-colors ${index === arr.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}">▼</button>
                    </div>
                </div>

                  <div class="min-h-[140px]">
                      ${Components.sparkline(historyPoints, 72)}
                  </div>

                 ${Components.aiWorkoutPlanBadge(this.findAiPlanFor(ex.name))}

                 <div class="space-y-2">
                    ${(ex.sets || []).map(set => {
                        let prevText = '—';
                        
                        // Сортируем завершенные сессии по дате (новейшие первые)
                        const sortedSessions = [...completedHistorySessions].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
                        
                        // Ищем последнюю завершенную сессию, где есть это упражнение (исключая текущую)
                        const prevSession = sortedSessions.find(s => 
                            s.id !== session.id && 
                            (s.exercises || []).some(e => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase())
                        );
                        
                        if (prevSession) {
                            const pastEx = (prevSession.exercises || []).find(e => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase());
                            if (pastEx) {
                                const pastSets = [...(pastEx.sets || [])].sort((a, b) => a.set_number - b.set_number);
                                const pastSet = pastSets.find(s => s.set_number === set.set_number) || pastSets[set.set_number - 1];
                                if (pastSet && pastSet.weight_kg != null && pastSet.reps != null) {
                                    prevText = `${pastSet.weight_kg}×${pastSet.reps}`;
                                }
                            }
                        }

                        return `
                             <div class="flex items-center gap-2 glass p-2 rounded-2xl" data-set-id="${set.id}">
                                 <span class="font-bold w-6 text-center text-xs ${set.is_completed ? SET_DIM.join(' ') : SET_NUMBER_IDLE}">${set.set_number}</span>
                                 
                                 <div class="w-14 flex flex-col items-center justify-center flex-shrink-0" title="Прошлый подход">
                                     <label class="text-[9px] text-surface-500 uppercase font-semibold text-center">Пред.</label>
                                     <span class="text-[11px] font-semibold text-surface-600 dark:text-surface-300 h-10 flex items-center justify-center truncate leading-tight">${prevText}</span>
                                 </div>

                                 <div class="flex-1 min-w-[60px] flex flex-col">
                                     <label class="text-[9px] text-surface-500 uppercase font-semibold text-center">Вес</label>
                                     <input type="number" min="0" step="0.1" placeholder="—" inputmode="none" readonly
                                            value="${set.weight_kg != null && set.weight_kg > 0 ? set.weight_kg : ''}"
                                            class="w-full h-12 text-center text-xl font-bold rounded-xl glass-input focus:border-primary-500 focus:outline-none cursor-pointer ${set.is_completed ? SET_DIM.join(' ') : ''}"
                                            data-field="weight">
                                 </div>

                                 <div class="flex-1 min-w-[60px] flex flex-col">
                                     <label class="text-[9px] text-surface-500 uppercase font-semibold text-center">Повт</label>
                                     <input type="number" min="1" placeholder="—" inputmode="none" readonly
                                            value="${set.reps != null && set.reps > 0 ? set.reps : ''}"
                                            class="w-full h-12 text-center text-xl font-bold rounded-xl glass-input focus:border-primary-500 focus:outline-none cursor-pointer ${set.is_completed ? SET_DIM.join(' ') : ''}"
                                            data-field="reps">
                                 </div>

                                  <button data-action="toggle-set" data-completed="${set.is_completed ? 'true' : 'false'}"
                                          class="${TOGGLE_BASE} ${set.is_completed ? TOGGLE_COMPLETED : TOGGLE_UNCOMPLETED}">
                                      ✓
                                  </button>
                             </div>
                    `;
                    }).join('')}
                </div>
            </div>
        `}).join('');

        // Cards
        const sessionKey = session.isLocal ? session.key : session.id;
        const cancelCard = `
            <div class="workout-card snap-center glass rounded-2xl p-6 flex flex-col items-center justify-center min-h-[520px]">
                <button data-action="cancel-workout" data-session-id="${sessionKey}"
                        class="w-full py-5 border-2 border-dashed border-red-300 dark:border-red-700 rounded-2xl text-red-600 font-bold text-base">
                    Отменить тренировку
                </button>
            </div>
        `;
        const completeCard = `
            <div class="workout-card snap-center glass rounded-2xl p-6 flex flex-col items-center justify-center gap-3 min-h-[520px]">
                <button data-action="complete-workout-ai" data-session-id="${sessionKey}"
                        class="w-full py-5 border-2 border-dashed border-primary-500/60 dark:border-primary-400/40 rounded-2xl text-primary-600 dark:text-primary-400 font-bold text-base btn-press">
                    Завершить и разобрать с ИИ
                </button>
                <button data-action="complete-workout" data-session-id="${sessionKey}"
                        class="w-full py-5 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-2xl font-bold text-base">
                    Завершить тренировку
                </button>
            </div>
        `;
        const allCards = [cancelCard, ...exerciseCards, completeCard];

        const initialMetrics = this.getWorkoutMetrics(session);
        const initialPercent = initialMetrics.total > 0
            ? Math.round((initialMetrics.completed / initialMetrics.total) * 100)
            : 0;

        let html = `
            <div class="p-4 pt-12" id="workout-container">
                <div class="flex items-center justify-between mb-3">
                    <button data-action="back-to-workouts" class="text-surface-500 hover:text-surface-900 dark:text-surface-400 text-lg">←</button>
                    <h2 class="text-xl font-bold text-center flex-1 ${!session.name ? 'truncate' : ''}">${session.name || 'Тренировка'}</h2>
                     <span id="workout-timer" class="text-sm text-lime-600 dark:text-lime-400 font-mono tabular-nums">00:00</span>
                </div>

                <div class="mb-6">
                    <div class="flex items-center justify-between gap-2 mb-1">
                        <span id="workout-progress-text" class="text-xs font-semibold text-surface-600 dark:text-surface-300">Сделано ${initialMetrics.completed} из ${initialMetrics.total} подходов (${initialPercent}%)</span>
                        <span id="workout-total-tonnage" class="text-xs font-semibold text-surface-600 dark:text-surface-300">Суммарный тоннаж: ${Math.round(initialMetrics.tonnage)} кг</span>
                    </div>
                    <div class="h-2 w-full rounded-full bg-surface-200 dark:bg-white/10 overflow-hidden">
                        <div id="workout-progress-bar" class="h-full rounded-full bg-surface-800 dark:bg-zinc-100 transition-all duration-300" style="width: ${initialPercent}%"></div>
                    </div>
                </div>

                <div class="flex overflow-x-auto gap-4 pb-6 px-4 -mx-4 workout-carousel" id="carousel">
                    ${allCards.join('')}
                </div>
                
             </div>
        `;
        container.innerHTML = html;
        
        // Scroll to first exercise (index 1 in allCards)
        setTimeout(() => {
            const carousel = document.getElementById('carousel');
            if (carousel) {
                const cardWidth = carousel.querySelector('.snap-center').offsetWidth + CAROUSEL_GAP_PX;
                carousel.scrollLeft = cardWidth; 
            }
        }, 100);

        // Event listeners for workout screen
        this.bindWorkoutScreenEvents(container, app, session);

        // Start live timer
        this.startWorkoutTimer(session);
        } catch (error) {
            console.error('[Workouts] Workout screen render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки тренировки');
        }
    },

    getWorkoutMetrics(session) {
        let total = 0;
        let completed = 0;
        let tonnage = 0;
        (session.exercises || []).forEach(ex => {
            (ex.sets || []).forEach(set => {
                total += 1;
                if (set.is_completed) {
                    completed += 1;
                    tonnage += (set.weight_kg || 0) * (set.reps || 0);
                }
            });
        });
        return { total, completed, tonnage };
    },

    findSetInSession(session, setId) {
        for (const ex of (session.exercises || [])) {
            const set = (ex.sets || []).find(s => s.id === setId);
            if (set) return set;
        }
        return null;
    },

    updateWorkoutMetricsUI(session) {
        const { total, completed, tonnage } = this.getWorkoutMetrics(session);
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

        const bar = document.getElementById('workout-progress-bar');
        if (bar) bar.style.width = `${percent}%`;

        const text = document.getElementById('workout-progress-text');
        if (text) text.textContent = `Сделано ${completed} из ${total} подходов (${percent}%)`;

        const tonnageEl = document.getElementById('workout-total-tonnage');
        if (tonnageEl) tonnageEl.textContent = `Суммарный тоннаж: ${Math.round(tonnage)} кг`;
    },

    // Lime pulse on a set row confirming the save. The class is dropped after
    // SET_SAVED_FLASH_MS, and the reflow lets a second save restart the keyframe.
    flashSetSaved(row) {
        if (!row) return;
        row.classList.remove('set-row--saved');
        void row.offsetWidth;
        row.classList.add('set-row--saved');
        clearTimeout(row._savedFlashTimer);
        row._savedFlashTimer = setTimeout(() => {
            row.classList.remove('set-row--saved');
            row._savedFlashTimer = null;
        }, SET_SAVED_FLASH_MS);
    },

    isExerciseComplete(session, exerciseId) {
        const exercise = (session.exercises || []).find(ex => String(ex.id) === String(exerciseId));
        const sets = exercise?.sets || [];
        return sets.length > 0 && sets.every(set => set.is_completed);
    },

    // Moves the snap carousel one card forward, clamped so it never overshoots
    // the last card (the "complete workout" card closes the carousel).
    advanceCarousel(card) {
        const carousel = document.getElementById('carousel');
        if (!carousel || !card) return;
        const max = carousel.scrollWidth - carousel.clientWidth;
        if (max <= 0) return;
        const left = Math.min(card.offsetWidth + CAROUSEL_GAP_PX, max - carousel.scrollLeft);
        if (left <= 0) return;
        carousel.scrollBy({ left, behavior: 'smooth' });
    },

    // Scrolls forward only when the toggled set finished the whole exercise.
    // Completion is re-checked when the timer fires, so a reverted patch or a
    // quick uncheck cancels the move, and a re-rendered card is skipped.
    scheduleCarouselAdvance(session, row) {
        const card = row?.closest('[data-exercise-id]');
        if (!card) return;
        const exerciseId = card.dataset.exerciseId;
        setTimeout(() => {
            if (!card.isConnected) return;
            if (!this.isExerciseComplete(session, exerciseId)) return;
            this.advanceCarousel(card);
        }, SET_ADVANCE_DELAY_MS);
    },

    bindWorkoutScreenEvents(container, app, session) {
        const isLocal = this.isLocalSession(session);
        const sessionId = isLocal ? session.key : session.id;
        const token = app.state.tokens.access;

        // Toggle set completion
        container.querySelectorAll('[data-action="toggle-set"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const button = e.currentTarget;
                const row = button.closest('[data-set-id]');
                if (!row) {
                    console.error('Row not found for set');
                    return;
                }
                const card = row.closest('[data-exercise-id]');
                const setId = parseInt(row.dataset.setId);
                if (isNaN(setId)) {
                    console.error('Invalid setId found:', row.dataset.setId);
                    return;
                }
                
                const weightInput = row.querySelector('[data-field="weight"]');
                const repsInput = row.querySelector('[data-field="reps"]');
                const weight_kg = weightInput ? parseFloat(weightInput.value) : null;
                const reps = repsInput ? parseInt(repsInput.value) : null;

                const wasCompleted = button.dataset.completed === 'true';
                const isCompleted = !wasCompleted;

                const applyToggleState = (completed) => {
                    const sessionSet = this.findSetInSession(session, setId);
                    if (sessionSet) {
                        sessionSet.is_completed = completed;
                        sessionSet.weight_kg = isNaN(weight_kg) ? null : weight_kg;
                        sessionSet.reps = isNaN(reps) ? null : reps;
                    }
                    this.updateWorkoutMetricsUI(session);
                    if (completed) {
                        button.dataset.completed = 'true';
                        button.className = TOGGLE_BASE + ' ' + TOGGLE_COMPLETED;
                        button.textContent = '✓';


                        row.querySelector('span.font-bold').classList.add(...SET_DIM);
                        row.querySelectorAll('input').forEach(inp => inp.classList.add(...SET_DIM));
                        row.querySelectorAll('label').forEach(lbl => lbl.classList.add(...SET_DIM));

                        // Completing a set locks its weight/reps until the
                        // check is cleared; the carousel moves on only through
                        // scheduleCarouselAdvance below.
                        button.disabled = false;
                    }
                    else {
                        button.dataset.completed = 'false';
                        button.className = TOGGLE_BASE + ' ' + TOGGLE_UNCOMPLETED;

                        row.querySelector('span.font-bold').classList.remove(...SET_DIM);
                        row.querySelector('span.font-bold').classList.add(SET_NUMBER_IDLE);
                        row.querySelectorAll('input').forEach(inp => inp.classList.remove(...SET_DIM));
                        row.querySelectorAll('label').forEach(lbl => lbl.classList.remove(...SET_DIM));

                        button.textContent = '✓';
                        button.disabled = false;
                    }
                };

                button.disabled = true;
                button.textContent = '...';
                // Optimistic local update so the UI reacts instantly, even offline
                applyToggleState(isCompleted);
                if (isCompleted) {
                    this.flashSetSaved(row);
                    this.scheduleCarouselAdvance(session, row);
                }
                const payload = {
                    is_completed: isCompleted,
                    weight_kg: isNaN(weight_kg) ? null : weight_kg,
                    reps: isNaN(reps) ? null : reps
                };
                // Background rest chronometry: the gap between the last completed
                // set (or the session start, for the first set) and now is the
                // rest this set took. Measured silently and sent inline so the
                // coach reads real breaks without a floating timer bar on screen.
                if (isCompleted) {
                    const referenceAt = this.lastSetCompletedAt || this.sessionStartTimestamp;
                    if (referenceAt && this.sessionStartTimestamp) {
                        const restSeconds = Math.round((Date.now() - referenceAt) / 1000);
                        payload.rest_time_seconds = Math.max(0, restSeconds);
                    }
                    this.lastSetCompletedAt = Date.now();
                } else {
                    this.lastSetCompletedAt = null;
                }
                if (isLocal) {
                    this.persistLocalSession(session);
                    this.recordLocalSetPatch(session.key, setId, payload);
                    button.disabled = false;
                    button.textContent = '✓';
                    return;
                }
                try {
                    await API.patch(`/workouts/sets/${setId}`, payload, token);
                } catch (err) {
                    if (err?.offlineQueued) {
                        // Silent: the global network banner reflects offline/syncing status
                    } else {
                        applyToggleState(wasCompleted);
                        app.showToast(err.message || 'Ошибка', 'error');
                    }
                    button.disabled = false;
                    button.textContent = '✓';
                }
            });
        });

        // Save weight/reps: instant local update while typing, debounced network sync, flush on blur
        const DEBOUNCE_MS = 400;
        const pendingTimers = new Map();

        const applyLocalValue = (input) => {
            const row = input.closest('[data-set-id]');
            if (!row) return null;
            const setId = parseInt(row.dataset.setId);
            const field = input.dataset.field;
            const value = field === 'weight' ? parseFloat(input.value) : parseInt(input.value);
            if (isNaN(value)) return null;

            const sessionSet = this.findSetInSession(session, setId);
            if (sessionSet) {
                sessionSet[field === 'weight' ? 'weight_kg' : 'reps'] = value;
                this.updateWorkoutMetricsUI(session);
            }
            return { row, setId, field, value };
        };

        const propagateWeightToNextSet = (row, value) => {
            const exerciseContainer = row.closest('.bg-white, .dark\\:bg-surface-800');
            if (!exerciseContainer) return;
            const rows = exerciseContainer.querySelectorAll('[data-set-id]');
            let foundCurrent = false;
            for (const r of rows) {
                if (foundCurrent) {
                    const nextWeightInput = r.querySelector('[data-field="weight"]');
                    if (nextWeightInput && !nextWeightInput.value) {
                        nextWeightInput.value = value;
                        const nextSetId = parseInt(r.dataset.setId);
                        const nextSessionSet = this.findSetInSession(session, nextSetId);
                        if (nextSessionSet) nextSessionSet.weight_kg = value;
                        if (isLocal) {
                            this.persistLocalSession(session);
                            this.recordLocalSetPatch(session.key, nextSetId, { weight_kg: value });
                        } else {
                            API.patch(`/workouts/sets/${nextSetId}`, { weight_kg: value }, token).catch(() => {});
                        }
                    }
                    break;
                }
                if (r === row) foundCurrent = true;
            }
        };

        const persistSet = async (input) => {
            const parsed = applyLocalValue(input);
            if (!parsed) return;
            const { row, setId, field, value } = parsed;

            if (field === 'weight') {
                propagateWeightToNextSet(row, value);
            }

            if (isLocal) {
                this.persistLocalSession(session);
                this.recordLocalSetPatch(session.key, setId, { [field]: value });
                return;
            }

            try {
                await API.patch(`/workouts/sets/${setId}`, { [field]: value }, token);
            } catch (err) {
                if (err?.offlineQueued) {
                    // Silent: the global network banner reflects offline/syncing status
                } else {
                    app.showToast(err.message || 'Ошибка сохранения', 'error');
                }
            }
        };

        const scheduleSave = (input, immediate) => {
            const row = input.closest('[data-set-id]');
            if (!row) return;
            const key = `${row.dataset.setId}:${input.dataset.field}`;

            const run = () => {
                pendingTimers.delete(key);
                return persistSet(input);
            };

            const existing = pendingTimers.get(key);
            if (existing) {
                clearTimeout(existing);
                pendingTimers.delete(key);
            }

            if (immediate) {
                run();
            } else {
                pendingTimers.set(key, setTimeout(run, DEBOUNCE_MS));
            }
        };

        container.querySelectorAll('[data-field="weight"], [data-field="reps"]').forEach(input => {
            input.addEventListener('input', () => applyLocalValue(input));
            input.addEventListener('change', () => scheduleSave(input, false));
            input.addEventListener('blur', () => scheduleSave(input, true));
        });

        // Weight/reps are entered through the drum picker bottom sheet, never the
        // native keyboard (inputs stay readOnly and inputmode="none"). A completed
        // set is locked: the guard runs synchronously before the sheet opens, so a
        // finished set cannot be rewritten until the checkmark is cleared.
        container.querySelectorAll('[data-field="weight"], [data-field="reps"]').forEach(input => {
            const openPicker = (e) => {
                e?.preventDefault();
                const row = input.closest('[data-set-id]');
                const toggle = row?.querySelector('[data-action="toggle-set"]');
                if (toggle?.dataset.completed === 'true') {
                    app?.showToast(SET_LOCKED_MESSAGE, 'info');
                    return;
                }
                input.blur();
                this.openDrumPicker(input, { app });
            };
            input.addEventListener('click', openPicker);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') openPicker(e);
            });
        });

        // Complete workout
        // Handled by App.js

        // Cancel workout
        // Handled by App.js

        // Move exercise up/down in active session
        container.querySelectorAll('[data-action="move-ex-up"], [data-action="move-ex-down"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.currentTarget.closest('[data-exercise-id]');
                const exId = parseInt(e.currentTarget.dataset.exId);
                const isUp = e.currentTarget.dataset.action === 'move-ex-up';
                const exercises = [...session.exercises];
                const idx = exercises.findIndex(ex => ex.id === exId);
                if (idx === -1) return;
                const targetIdx = isUp ? idx - 1 : idx + 1;
                if (targetIdx < 0 || targetIdx >= exercises.length) return;

                card.classList.add('scale-[1.02]', 'bg-primary-50/50', 'dark:bg-primary-900/20', 'transition-all', 'duration-300');

                const temp = exercises[idx];
                exercises[idx] = exercises[targetIdx];
                exercises[targetIdx] = temp;

                if (isLocal) {
                    session.exercises = exercises;
                    exercises.forEach((ex, i) => { ex.order = i; });
                    this.persistLocalSession(session);
                    await this.renderWorkoutScreen(container, app, sessionId);
                    return;
                }

                try {
                    await API.patch(`/workouts/sessions/${sessionId}`, {
                        exercises: exercises.map((ex, i) => ({ id: ex.id, order: i }))
                    }, token);
                    await this.renderWorkoutScreen(container, app, sessionId);
                } catch (err) {
                    app.showToast(err.message || 'Ошибка изменения порядка', 'error');
                }
            });
        });

        // Back button
        container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.stopWorkoutTimer();
            app.showPage('workouts');
        });
    },

    // Writes a value into a set input and replays the native input/change events
    // so the debounced persistence pipeline of bindWorkoutScreenEvents runs.
    setInputValue(input, value) {
        if (!input) return;
        const next = value == null ? '' : String(value);
        if (input.value === next) return;
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    },

    // Renders a weight in tenths without float noise: 12.5 -> "12.5", 12 -> "12".
    formatDrumWeight(value) {
        return drumTenthsToWeight(drumWeightToTenths(value)).toFixed(1).replace(/\.0$/, '') || '0';
    },

    // Drum picker bottom sheet: whole weight (0-300), tenths (.0-.9) and reps (1-50).
    openDrumPicker(input, { app } = {}) {
        if (!input) return;
        document.getElementById('drumPickerModal')?.remove();
        if (DRUM_KEYDOWN_HANDLER) {
            document.removeEventListener('keydown', DRUM_KEYDOWN_HANDLER);
            DRUM_KEYDOWN_HANDLER = null;
        }

        const field = input.dataset.field === 'reps' ? 'reps' : 'weight';
        const row = input.closest('[data-set-id]');
        const card = input.closest('[data-exercise-id]');
        const weightInput = row?.querySelector('[data-field="weight"]') || null;
        const repsInput = row?.querySelector('[data-field="reps"]') || null;

        const exerciseName = (card?.querySelector('h3')?.textContent || '').trim();
        const setNumber = (row?.querySelector('span.font-bold')?.textContent || '').trim();

        const startWeight = Math.max(0, parseFloat(weightInput?.value) || 0);
        const startReps = Math.min(DRUM_REPS_MAX, Math.max(1, parseInt(repsInput?.value, 10) || 1));

        let weightTenths = drumWeightToTenths(startWeight);
        let reps = startReps;

        const modal = document.createElement('div');
        modal.id = 'drumPickerModal';
        modal.className = 'drum-sheet fixed inset-0 z-[60] pointer-events-auto';
        modal.innerHTML = `
            <div class="drum-sheet-backdrop absolute inset-0 bg-black/40 dark:bg-black/60" data-action="drum-picker-close"></div>
            <div class="drum-sheet-panel absolute bottom-0 left-0 right-0 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 rounded-t-2xl border-t border-zinc-200 dark:border-white/10 flex flex-col drum-sheet-safe">
                <div class="w-10 h-1 rounded-full bg-zinc-300 dark:bg-white/20 mx-auto drum-sheet-handle flex-shrink-0"></div>
                <div class="flex items-start justify-between gap-3 px-4 pt-1 pb-2 drum-sheet-header">
                    <div class="min-w-0">
                        <div class="drum-sheet-eyebrow text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-semibold truncate">${exerciseName}</div>
                        <div class="drum-sheet-title text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">${field === 'reps' ? 'Повторения' : 'Вес'}${setNumber ? ` · подход ${setNumber}` : ''}</div>
                    </div>
                    <button type="button" data-action="drum-picker-close" class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0">✕</button>
                </div>

                <div class="px-4 drum-sheet-presets ${field === 'reps' ? 'hidden' : ''}" data-role="drum-presets">
                    <div class="flex flex-wrap gap-2">
                        ${DRUM_PRESETS.map(delta => `
                            <button type="button" data-preset="${delta}" class="drum-preset-btn flex-1 min-w-0 whitespace-nowrap py-2 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700 dark:bg-white/5 dark:border-white/10 dark:text-zinc-200 text-sm font-semibold btn-press">
                                +${String(delta).replace('.', ',')} кг
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="flex gap-3 px-5 mt-2 mb-1 drum-sheet-labels">
                    <div class="flex-1 text-[10px] uppercase tracking-wider text-zinc-500 text-center font-semibold">Вес</div>
                    <div class="flex-1 text-[10px] uppercase tracking-wider text-zinc-500 text-center font-semibold">Повторения</div>
                </div>

                <div class="relative px-4 drum-sheet-picker">
                    <div class="drum-overlay-line"></div>
                    <div class="flex gap-3">
                        <div class="flex-1 flex gap-1 min-w-0 ${field === 'reps' ? 'drum-group-dim' : ''}" data-drum-group="weight">
                            <div class="flex-1 min-w-0 drum drum-value text-2xl" data-drum="whole"></div>
                            <div class="w-12 flex-shrink-0 drum drum-value text-2xl" data-drum="tenths"></div>
                        </div>
                        <div class="flex-1 min-w-0 drum drum-value text-2xl ${field === 'weight' ? 'drum-group-dim' : ''}" data-drum-group="reps" data-drum="reps"></div>
                    </div>
                    <div class="drum-mask drum-mask-top"></div>
                    <div class="drum-mask drum-mask-bottom"></div>
                </div>

                <div class="px-4 mt-2 drum-sheet-actions">
                    <button type="button" data-action="drum-picker-save" class="drum-save-btn w-full py-3 rounded-2xl bg-lime-500 text-zinc-950 font-bold text-sm shadow-md btn-press">
                        Сохранить подход
                    </button>
                </div>
            </div>
        `;

        const onKeydown = (e) => {
            if (e.key === 'Escape') close();
        };

        const close = () => {
            if (DRUM_KEYDOWN_HANDLER) document.removeEventListener('keydown', DRUM_KEYDOWN_HANDLER);
            DRUM_KEYDOWN_HANDLER = null;
            input.classList.remove('drum-source-active');
            modal.remove();
        };

        const fillDrum = (name, values, formatter) => {
            const drum = modal.querySelector(`[data-drum="${name}"]`);
            if (!drum) return null;
            drum.innerHTML = values.map((v, i) => `<div class="drum-item">${formatter(v, i)}</div>`).join('');
            return drum;
        };

        const wholeDrum = fillDrum('whole', Array.from({ length: DRUM_WEIGHT_MAX + 1 }, (_, i) => i), v => String(v));
        const tenthsDrum = fillDrum('tenths', DRUM_TENTHS, v => `.${v}`);
        const repsDrum = fillDrum('reps', Array.from({ length: DRUM_REPS_MAX }, (_, i) => i + 1), v => String(v));

        // Live item height so the compact (36px) layout keeps index math exact.
        const getItemHeight = (drum) => {
            const css = parseFloat(getComputedStyle(drum).getPropertyValue('--drum-item-height'));
            return Number.isFinite(css) && css > 0 ? css : DRUM_ITEM_HEIGHT;
        };

        // Snap offset: with padding == (clientHeight - itemHeight) / 2 the first and
        // last items both reach the indicator, so index maps linearly to scrollTop.
        const getBaseOffset = (drum) => {
            const padTop = parseFloat(getComputedStyle(drum).paddingTop) || 0;
            return padTop + getItemHeight(drum) / 2 - drum.clientHeight / 2;
        };

        const getIndex = (drum) => {
            const count = drum?.children.length || 0;
            if (!count) return 0;
            const itemHeight = getItemHeight(drum);
            return Math.min(count - 1, Math.max(0, Math.round((drum.scrollTop - getBaseOffset(drum)) / itemHeight)));
        };

        const scrollToIndex = (drum, index, smooth = true) => {
            const count = drum?.children.length || 0;
            if (!count) return;
            const clamped = Math.min(count - 1, Math.max(0, index));
            drum.scrollTo({ top: getBaseOffset(drum) + clamped * getItemHeight(drum), behavior: smooth ? 'smooth' : 'auto' });
        };

        // Opacity/scale fade around the centered selection
        const refreshDrum = (drum) => {
            const count = drum?.children.length || 0;
            if (!count) return 0;
            const index = getIndex(drum);
            Array.from(drum.children).forEach((item, i) => {
                const distance = Math.abs(i - index);
                item.style.opacity = Math.max(0.15, 1 - distance * 0.28).toFixed(2);
                item.style.transform = `scale(${(1 - Math.min(distance, 4) * 0.06).toFixed(3)})`;
                item.classList.toggle('is-selected', distance === 0);
            });
            return index;
        };

        const syncFromDrums = () => {
            weightTenths = drumClampTenths(getIndex(wholeDrum) * 10 + getIndex(tenthsDrum));
            reps = getIndex(repsDrum) + 1;
            return weightTenths;
        };

        const onScroll = (drum) => {
            if (drum._drumRaf) return;
            drum._drumRaf = requestAnimationFrame(() => {
                drum._drumRaf = null;
                refreshDrum(drum);
                syncFromDrums();
            });
        };

        [wholeDrum, tenthsDrum, repsDrum].forEach(drum => {
            if (!drum) return;
            drum.addEventListener('scroll', () => onScroll(drum), { passive: true });
        });

        // Presets move the weight in tenths, carrying into the next whole kg
        // automatically (e.g. 9.7 + 5 -> 14.7).
        const applyPreset = (delta) => {
            const nextTenths = drumClampTenths(weightTenths + drumWeightToTenths(delta));
            scrollToIndex(wholeDrum, drumWholeFromTenths(nextTenths));
            scrollToIndex(tenthsDrum, drumTenthsFromTenths(nextTenths));
            syncFromDrums();
        };

        const save = () => {
            syncFromDrums();
            const weight = drumTenthsToWeight(weightTenths);
            if (field === 'weight' && weightInput) this.setInputValue(weightInput, this.formatDrumWeight(weight));
            if (repsInput) this.setInputValue(repsInput, reps);
            // No toast and no focus/scroll jump: the sheet closes in place, the
            // row keeps its completed state and the pulse confirms the write.
            this.flashSetSaved(row);
            close();
        };

        modal.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'drum-picker-close') close();
            if (action === 'drum-picker-save') save();
            const preset = e.target.closest('[data-preset]')?.dataset.preset;
            if (preset) applyPreset(parseFloat(preset));
        });
        DRUM_KEYDOWN_HANDLER = onKeydown;
        document.addEventListener('keydown', onKeydown);

        (document.getElementById('modals') || document.body).appendChild(modal);
        input.classList.add('drum-source-active');

        // Position drums on the current values without animation, then paint.
        // Double rAF so the sheet has been laid out before clientHeight is read.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const startTenths = drumWeightToTenths(startWeight);
            scrollToIndex(wholeDrum, drumWholeFromTenths(startTenths), false);
            scrollToIndex(tenthsDrum, drumTenthsFromTenths(startTenths), false);
            scrollToIndex(repsDrum, startReps - 1, false);
            [wholeDrum, tenthsDrum, repsDrum].forEach(refreshDrum);
            syncFromDrums();
        }));
    },

    // Chronological history: newest first, grouped by month, with a
    // "load more" page that keeps the sessions already on screen.
    async renderHistory(container, app, { limit = 20, append = false } = {}) {
        this.app = app;
        this.stopWorkoutTimer();

        const historyState = this.historyState || { limit: limit, total: 0, sessions: [] };
        if (!append) historyState.limit = limit;
        this.historyState = historyState;

        let data;
        try {
            data = await API.get(`/workouts/history?limit=${historyState.limit}`, app.state.tokens.access);
        } catch (error) {
            console.error('[Workouts] History load error:', error);
            if (!append) container.innerHTML = Components.errorState('Ошибка загрузки истории');
            else this.renderHistoryList(container, app, historyState, true);
            return;
        }

        if (!data) {
            container.innerHTML = Components.errorState('Данные истории недоступны');
            return;
        }

        historyState.sessions = (data?.sessions || [])
            .slice()
            .sort((a, b) => new Date(b.completed_at || b.started_at) - new Date(a.completed_at || a.started_at));
        historyState.total = data?.total || 0;

        this.renderHistoryList(container, app, historyState, false);
    },

    renderHistoryList(container, app, historyState, failed) {
        const sessions = historyState.sessions || [];
        const hasMore = sessions.length < (historyState.total || 0);
        this.recentSessions = sessions.filter(s => s.status === 'completed');

        const groups = new Map();
        sessions.forEach(session => {
            const stamp = new Date(session.completed_at || session.started_at);
            const label = isNaN(stamp.getTime())
                ? 'Без даты'
                : stamp.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(session);
        });

        const statusLabel = (status) =>
            status === 'completed' ? 'Завершена' : status === 'cancelled' ? 'Отменена' : 'Активна';

        const groupBlocks = [...groups.entries()].map(([label, items]) => `
            <div class="mb-5">
                <h3 class="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">${this.escapeHtml(label)}</h3>
                <div class="space-y-2">
                    ${items.map(session => {
                        const metrics = this.getWorkoutMetrics(session);
                        const stamp = new Date(session.completed_at || session.started_at);
                        // The coach only reads a session that was actually done, so
                        // an active or cancelled row never offers the analysis.
                        const analyzable = (session.status === 'completed' || !session.status)
                            && metrics.completed > 0
                            && !isNaN(parseInt(session.id));
                        return `
                            <div class="glass rounded-2xl p-4 cursor-pointer btn-press" data-action="open-history-session" data-session-id="${session.id}">
                                <div class="flex items-start justify-between gap-3">
                                    <div class="min-w-0 flex-1">
                                        <h4 class="font-semibold text-sm truncate" title="${this.escapeHtml(session.name || 'Тренировка')}">${this.escapeHtml(session.name || 'Тренировка')}</h4>
                                        <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
                                            ${isNaN(stamp.getTime()) ? '—' : `${Utils.formatDate(stamp.toISOString())} · ${Utils.formatTime(stamp.toISOString())}`}
                                        </p>
                                    </div>
                                    <div class="text-right flex-shrink-0">
                                        <p class="text-sm font-bold text-primary-600 dark:text-primary-400">${Math.round(metrics.tonnage)} кг</p>
                                        <p class="text-[11px] text-surface-400">${metrics.completed}/${metrics.total} подх.</p>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2 mt-2 text-[11px] text-surface-400">
                                    <span>${Utils.formatDuration(session.duration_seconds || 0)}</span>
                                    <span>·</span>
                                    <span>${(session.exercises || []).length} упр.</span>
                                    <span>·</span>
                                    <span>${statusLabel(session.status)}</span>
                                    ${analyzable ? `<button type="button" data-action="history-analyze-ai" data-session-id="${session.id}"
                                            class="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold ${session.has_ai_analysis ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400' : 'bg-surface-100 dark:bg-white/5 text-surface-500 dark:text-surface-400'}">
                                            <span>${AI_START_ICON}</span>
                                            <span>${session.has_ai_analysis ? 'Пересчитать' : 'Разобрать'}</span>
                                        </button>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');

        const html = `
            <div class="p-4">
                <div class="flex items-center mb-4">
                    <button data-action="back-to-workouts" class="mr-3 text-surface-500 hover:text-surface-900">←</button>
                    <h2 class="text-xl font-bold">История тренировок</h2>
                </div>

                ${failed
                    ? '<div class="text-xs text-amber-600 dark:text-amber-400 mb-3">Не удалось обновить список, показаны ранее загруженные данные</div>'
                    : ''}

                ${sessions.length === 0
                    ? `<div class="text-center py-8 text-surface-400">Ещё нет тренировок. Начните первую!</div>`
                    : `${groupBlocks}
                        ${hasMore ? '<button type="button" data-action="history-load-more" class="w-full py-2.5 glass rounded-xl text-sm font-semibold">Показать ещё</button>' : ''}`}
            </div>
        `;

        container.innerHTML = html;

        container.querySelectorAll('[data-action="history-analyze-ai"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // The row itself opens the session detail; the coach button is a
                // sibling action, so the click must not travel up to it.
                e.stopPropagation();
                const sessionId = parseInt(e.currentTarget.dataset.sessionId);
                if (!isNaN(sessionId)) this.analyzeWorkout(app, sessionId);
            });
        });

        container.querySelectorAll('[data-action="open-history-session"]').forEach(card => {
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                const sessionId = parseInt(e.currentTarget.dataset.sessionId);
                if (!isNaN(sessionId)) this.renderHistoryDetail(container, app, sessionId);
            });
        });

        container.querySelector('[data-action="history-load-more"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            historyState.limit += 20;
            this.renderHistory(container, app, { limit: historyState.limit, append: true });
        });
    },

    // Detailed history for one session: summary metrics, delta vs the previous
    // session, generated summary and per-exercise tonnage / e1RM trend lines.
    async renderHistoryDetail(container, app, sessionId) {
        this.app = app;
        this.stopWorkoutTimer();
        container.innerHTML = Components.loadingSpinner();

        let detail;
        try {
            detail = await API.get(`/workouts/history/${sessionId}`, app.state.tokens.access);
        } catch (error) {
            console.error('[Workouts] History detail load error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки тренировки');
            return;
        }

        if (!detail) {
            container.innerHTML = Components.errorState('Тренировка не найдена');
            return;
        }

        const metrics = detail.metrics || {};
        const deltaPercent = detail.delta?.percent;
        const statusLabel = detail.status === 'completed' ? 'Завершена' : detail.status === 'cancelled' ? 'Отменена' : 'Активна';

        // Compact trend badge for the tonnage KPI tile: a single pill that names
        // the delta and the comparison session, so the tile reads as one line
        // instead of a separate block under the grid.
        const tonnageTrend = deltaPercent === null || deltaPercent === undefined
            ? `<span class="text-[10px] text-surface-400 dark:text-surface-500">Нет сравнения</span>`
            : `<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${deltaPercent >= 0
                ? 'text-lime-600 dark:text-lime-400 bg-lime-500/10 dark:bg-lime-400/10'
                : 'text-rose-500 dark:text-rose-400 bg-rose-500/10 dark:bg-rose-400/10'}">
                    <span>${deltaPercent >= 0 ? '▲' : '▼'}</span>
                    <span class="tabular-nums">${deltaPercent >= 0 ? '+' : ''}${deltaPercent}%</span>
                    <span class="font-normal opacity-70 truncate max-w-[80px]">к прошлой</span>
                </span>`;

        const exerciseBlocks = (detail.exercises || []).map(exercise => {
            const tonnagePoints = (exercise.tonnage_series || []).map(point => point.value);
            const e1rmPoints = (exercise.e1rm_series || []).map(point => point.value);
            return `
                <div class="glass rounded-2xl p-4">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <h4 class="font-semibold text-sm min-w-0 flex-1 break-words" title="${this.escapeHtml(exercise.name)}">${this.escapeHtml(exercise.name)}</h4>
                        <span class="text-sm font-bold text-primary-600 dark:text-primary-400 flex-shrink-0">${Math.round(exercise.tonnage_kg || 0)} кг</span>
                    </div>

                    <div class="grid grid-cols-3 gap-2 text-center mb-3">
                        <div class="bg-surface-50 dark:bg-white/5 p-2 rounded-xl">
                            <div class="text-[10px] text-surface-400">Подходы</div>
                            <div class="text-sm font-bold">${exercise.completed_sets}/${exercise.total_sets}</div>
                        </div>
                        <div class="bg-surface-50 dark:bg-white/5 p-2 rounded-xl">
                            <div class="text-[10px] text-surface-400">Повторений</div>
                            <div class="text-sm font-bold">${exercise.reps || 0}</div>
                        </div>
                        <div class="bg-surface-50 dark:bg-white/5 p-2 rounded-xl">
                            <div class="text-[10px] text-surface-400">≈1 ПМ</div>
                            <div class="text-sm font-bold">${Math.round(exercise.best_e1rm || 0)} кг</div>
                        </div>
                    </div>

                    <div class="space-y-3">
                        ${tonnagePoints.length > 0 ? Components.sparkline(tonnagePoints, 60, 'Тоннаж по упражнению (кг)') : ''}
                        ${e1rmPoints.length > 0 ? Components.sparkline(e1rmPoints, 60, 'Оценка 1 ПМ (кг)') : ''}
                    </div>

                    ${(exercise.sets || []).length > 0 ? `
                        <div class="mt-3 space-y-1">
                            ${exercise.sets.map(set => `
                                <div class="flex items-center gap-2 text-xs ${set.is_completed ? '' : 'text-surface-400'}">
                                    <span class="w-5 text-center font-semibold">${set.set_number}</span>
                                    <span class="font-mono ${set.is_completed ? '' : 'line-through'}">${set.weight_kg ?? '—'}×${set.reps ?? '—'}</span>
                                    ${set.rpe ? `<span class="text-surface-400">RPE ${set.rpe}</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="p-4">
                <div class="flex items-center gap-3 mb-4">
                    <button data-action="history-detail-back" class="text-surface-500 hover:text-surface-900 text-lg">←</button>
                    <h2 class="text-xl font-bold truncate flex-1" title="${this.escapeHtml(detail.name || 'Тренировка')}">${this.escapeHtml(detail.name || 'Тренировка')}</h2>
                </div>

                <p class="text-xs text-surface-500 dark:text-surface-400 mb-4">
                    ${detail.completed_at
                        ? `${Utils.formatDate(detail.completed_at)} · ${Utils.formatTime(detail.completed_at)}`
                        : 'Дата завершения не указана'}
                    · ${statusLabel}
                </p>

                <div class="grid grid-cols-2 gap-2 mb-4">
                    <div class="glass rounded-2xl p-3">
                        <p class="text-xs text-surface-500 dark:text-surface-400">Тоннаж</p>
                        <p class="text-2xl font-bold">${Math.round(metrics.tonnage_kg || 0)} кг</p>
                        ${tonnageTrend}
                    </div>
                    <div class="glass rounded-2xl p-3">
                        <p class="text-xs text-surface-500 dark:text-surface-400">Длительность</p>
                        <p class="text-2xl font-bold">${Math.round(metrics.duration_min || 0)} мин</p>
                    </div>
                    <div class="glass rounded-2xl p-3">
                        <p class="text-xs text-surface-500 dark:text-surface-400">Подходы</p>
                        <p class="text-2xl font-bold">${metrics.completed_sets || 0}<span class="text-sm font-normal text-surface-400">/${metrics.total_sets || 0}</span></p>
                    </div>
                    <div class="glass rounded-2xl p-3">
                        <p class="text-xs text-surface-500 dark:text-surface-400">Выполнено</p>
                        <p class="text-2xl font-bold">${metrics.completion_percent || 0}%</p>
                    </div>
                </div>

                <div id="ai-workout-detail"></div>

                <h3 class="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">
                    Упражнения (${(detail.exercises || []).length})
                </h3>
                ${(detail.exercises || []).length === 0
                    ? '<div class="text-center py-6 text-surface-400 text-sm">В тренировке нет упражнений</div>'
                    : `<div class="space-y-3">${exerciseBlocks}</div>`}
            </div>
        `;

        container.querySelector('[data-action="history-detail-back"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.renderHistory(container, app, { limit: this.historyState?.limit || 20 });
        });

        // The verdict is a separate read from the session detail (it has its own
        // quota and its own empty state), so the screen renders first and the card
        // lands in its slot without the detail waiting on it.
        await this.mountAiDetailCard(container, app, detail.id);
    },

    /**
     * Puts the coach's verdict of a session into the history detail screen.
     *
     * A second analysis is a rewrite of the stored verdict (`force=true`), which is
     * why the trigger reads "Пересчитать разбор" once there is one. The card is
     * swapped in place when the answer arrives, so the session's metrics, trends
     * and set list underneath are not re-rendered under the user's thumb.
     */
    async mountAiDetailCard(container, app, sessionId) {
        const host = container.querySelector('#ai-workout-detail');
        if (!host) return null;

        const MAX_AI_POLL_ATTEMPTS = 5;
        const AI_POLL_INTERVAL_MS = 1500;

        let payload = await this.loadAiAnalysis(app, sessionId);
        if (!payload) {
            host.remove();
            return null;
        }

        const draw = (current, busy = false) => {
            host.innerHTML = Components.aiWorkoutCard(current, { allowAnalyze: true, busy });
            const trigger = host.querySelector('[data-action="analyze-workout-ai"]');
            trigger?.addEventListener('click', async (e) => {
                e.stopPropagation();
                trigger.disabled = true;
                const next = await this.analyzeWorkout(app, sessionId, {
                    force: current?.available === true,
                    rerender: (result) => draw(result),
                });
                if (!next) draw(current);
            });
        };

        if (!payload.available) {
            host.innerHTML = `
                <section class="ai-workout ai-workout--empty glass rounded-3xl" aria-label="РАЗБОР ОТ ИИ-ТРЕНЕРА">
                    <div class="ai-workout__head">
                        <span class="ai-workout__title">
                            <svg class="ai-workout__icon" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z"/></svg>
                            РАЗБОР ОТ ИИ-ТРЕНЕРА
                        </span>
                    </div>
                    <div class="space-y-2 mt-3">
                        <div class="animate-pulse bg-surface-200 dark:bg-white/10 rounded-xl h-4 w-3/4"></div>
                        <div class="animate-pulse bg-surface-200 dark:bg-white/10 rounded-xl h-4 w-1/2"></div>
                        <div class="animate-pulse bg-surface-200 dark:bg-white/10 rounded-xl h-4 w-2/3"></div>
                        <div class="animate-pulse bg-surface-200 dark:bg-white/10 rounded-xl h-4 w-1/3"></div>
                    </div>
                    <p class="ai-workout__empty">ИИ-тренер формирует разбор...</p>
                </section>
            `;

            for (let attempt = 1; attempt <= MAX_AI_POLL_ATTEMPTS; attempt++) {
                await new Promise(resolve => setTimeout(resolve, AI_POLL_INTERVAL_MS));
                payload = await this.loadAiAnalysis(app, sessionId);
                if (payload?.available) break;
            }

            if (payload?.available) {
                draw(payload);
            }
            return payload;
        }

        draw(payload);
        return payload;
    },

    showQuickStartModal(app) {
        this.app = app;
        const modal = document.createElement('div');
        modal.id = 'quick-start-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto';
        modal.innerHTML = `
            <div class="glass-strong rounded-2xl p-6 mx-4 max-w-sm w-full">
                <div class="flex justify-between items-center mb-1">
                    <h3 class="text-lg font-bold">Быстрый старт</h3>
                    <button type="button" data-action="close-quick-start" class="text-surface-500 hover:text-surface-900 dark:text-surface-400 p-1">✕</button>
                </div>
                <p class="text-xs text-surface-500 dark:text-surface-400 mb-4">
                    Выберите цель — упражнения и подходы подставятся автоматически, веса берутся из прошлых тренировок.
                </p>
                <div class="space-y-2">
                    ${QUICK_GOALS.map(goal => `
                        <div class="glass rounded-2xl p-1.5 flex items-center gap-1.5">
                            <button type="button" data-goal="${goal.value}"
                                    class="flex-1 min-w-0 flex items-center justify-between gap-3 p-2 rounded-2xl text-left btn-press">
                                <span class="min-w-0">
                                    <span class="block font-semibold text-sm">${goal.title}</span>
                                    <span class="block text-[11px] text-surface-500 dark:text-surface-400">${goal.subtitle}</span>
                                </span>
                                <span class="text-surface-300 flex-shrink-0">→</span>
                            </button>
                            <button type="button" data-goal-ai="${goal.value}"
                                    title="Начать с ИИ-тренером" aria-label="Начать ${goal.title} с ИИ-тренером"
                                    class="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-2xl text-base bg-surface-800 dark:bg-white dark:text-zinc-950 btn-press">
                                ${AI_START_ICON}
                            </button>
                        </div>
                    `).join('')}
                </div>
                <p class="text-[11px] text-surface-500 dark:text-surface-400 mt-3">
                    Кнопка с роботом запускает ту же тренировку и просит ИИ-тренер подобрать вес, повторы и отдых под вашу историю.
                </p>
            </div>
        `;

        const onKeydown = (e) => {
            if (e.key === 'Escape') close();
        };
        const close = () => {
            document.removeEventListener('keydown', onKeydown);
            modal.remove();
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });
        modal.querySelector('[data-action="close-quick-start"]').addEventListener('click', close);
        modal.querySelectorAll('[data-goal]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const goal = btn.dataset.goal;
                close();
                await this.startQuickWorkout(app, goal);
            });
        });
        modal.querySelectorAll('[data-goal-ai]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const goal = btn.dataset.goalAi;
                close();
                await this.startQuickWorkoutWithAi(app, goal);
            });
        });
        document.addEventListener('keydown', onKeydown);

        (document.getElementById('modals') || document.body).appendChild(modal);
    },

    async startQuickWorkout(app, goal) {
        this.app = app;
        this.stopWorkoutTimer();

        // Exercises for a quick start are picked by the server, so it requires a connection
        if (navigator.onLine === false) {
            app.showToast('Быстрый старт требует подключения к интернету. Выберите шаблон — он работает офлайн', 'info');
            return;
        }

        // Запускаем API запрос СРАЗУ, параллельно с отсчетом
        const sessionPromise = API.post('/workouts/sessions/quick-start', { goal }, app.state.tokens.access);
        this.renderCountdown(app.elements.pageContent, () => {});

        try {
            const { session_id } = await sessionPromise;
            await this.renderWorkoutScreen(app.elements.pageContent, app, session_id);
        } catch (err) {
            console.error('Quick start error:', err);
            app.showToast(err?.offlineQueued ? 'Быстрый старт требует подключения к интернету. Выберите шаблон — он работает офлайн' : (err.message || 'Ошибка быстрого старта'), 'error');
            await this.render(app.elements.pageContent, app);
        }
    },

    renderPersonalRecords(container, app, records = null) {
        this.app = app;
        this.stopWorkoutTimer();
        const list = records || this.getPersonalRecords(this.recentSessions || []);

        container.innerHTML = `
            <div class="p-4">
                <div class="flex items-center mb-4">
                    <button data-action="back-to-workouts" class="mr-3 text-surface-500 hover:text-surface-900 dark:text-surface-400">←</button>
                    <h2 class="text-xl font-bold">Личные рекорды</h2>
                </div>

                ${list.length === 0
                    ? '<div class="text-center py-8 text-surface-400">Рекордов пока нет. Завершите тренировку с весами.</div>'
                    : `<div class="space-y-2">
                        ${list.map(record => `
                            <div class="glass rounded-2xl p-4 flex items-center justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <h3 class="font-semibold text-sm truncate" title="${record.name}">${record.name}</h3>
                                    <p class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                                        ${record.reps} повт.${record.date ? ` · ${Utils.formatDate(record.date)}` : ''}
                                    </p>
                                </div>
                                <div class="text-right flex-shrink-0">
                                    <p class="text-lg font-bold text-primary-600 dark:text-primary-400">${record.weight_kg} кг</p>
                                    <p class="text-[11px] text-surface-400">≈${Math.round(record.e1rm)} кг на 1 повтор</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>`}
            </div>
        `;

        container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.render(container, app);
        });
    },

    async renderTemplatesScreen(container, app) {
        this.app = app;
        try {
            const [templates, activeSession] = await Promise.all([
                API.get('/workouts/templates', app.state.tokens.access),
                API.get('/workouts/sessions/active', app.state.tokens.access).catch(() => null)
            ]);
            const safeTemplates = templates || [];
            const hasActiveSession = !!activeSession || !!this.getActiveLocalSession();
            let html = `
                <div class="p-4">
                    <div class="flex items-center justify-between mb-4">
                        <button data-action="back-to-workouts" class="text-surface-500 hover:text-surface-900">←</button>
                        <h2 class="text-xl font-bold">Шаблоны</h2>
                        <button data-action="create-template" class="px-4 py-2 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl text-sm font-medium">+ Создать</button>
                    </div>
                    <div class="space-y-3">
                        ${safeTemplates.map(t => `
                            <div class="glass rounded-xl p-4 flex justify-between items-center gap-3 ${hasActiveSession ? 'opacity-60' : ''}">
                                <div class="min-w-0">
                                    <h3 class="font-semibold truncate">${t.name}</h3>
                                    <p class="text-xs text-surface-400">${t.exercises.length} упр.</p>
                                </div>
                                <div class="flex items-center gap-1.5 flex-shrink-0">
                                    <button data-action="start-template-ai" data-template-id="${t.id}" ${hasActiveSession ? 'disabled' : ''}
                                            title="Начать с ИИ-тренером" aria-label="Начать ${this.escapeHtml(t.name)} с ИИ-тренером"
                                            class="w-8 h-8 flex items-center justify-center rounded-lg text-sm ${hasActiveSession ? 'bg-surface-200 dark:bg-white/10 text-surface-500 dark:text-surface-400 cursor-not-allowed' : 'bg-surface-800 dark:bg-white dark:text-zinc-950'}">
                                        ${AI_START_ICON}
                                    </button>
                                    <button data-action="start-template" data-template-id="${t.id}" ${hasActiveSession ? 'disabled' : ''}
                                            class="px-3 py-1.5 flex items-center gap-1.5 ${hasActiveSession ? 'bg-surface-200 dark:bg-white/10 text-surface-500 dark:text-surface-400 cursor-not-allowed' : 'bg-primary-600 text-white'} rounded text-xs">
                                        ${hasActiveSession ? `${LOCK_ICON}<span>Активна тренировка</span>` : '<span>Начать</span>'}
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            container.innerHTML = html;
            container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                app.showPage('workouts');
            });
            container.querySelector('[data-action="create-template"]')?.addEventListener('click', () => {
                this.showCreateTemplateModal(app);
            });
        container.querySelectorAll('[data-action="view-template"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const templateId = parseInt(e.currentTarget.dataset.templateId);
                const template = templates.find(t => t.id === templateId);
                if (template) {
                    this.renderTemplateDetails(container, app, template);
                }
            });
        });

        container.querySelectorAll('[data-action="start-template"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const button = e.currentTarget;
                const templateId = parseInt(button.dataset.templateId);
                const originalHtml = button.innerHTML;
                
                button.disabled = true;
                button.innerHTML = '<span>Запуск...</span>';
                
                // Запускаем API запрос СРАЗУ, параллельно с отсчетом
                const startEndpoint = `/workouts/templates/${templateId}/start`;
                const sessionPromise = API.post(startEndpoint, {}, app.state.tokens.access);

                // Запускаем отсчет
                this.renderCountdown(container, () => {});

                try {
                    const session = await sessionPromise;

                    // Рендерим экран (не блокируя отсчет)
                    this.renderWorkoutScreen(app.elements.pageContent, app, session.id);
                } catch (err) {
                    const template = templates.find(t => t.id === templateId);
                    if (err?.offlineQueued && template) {
                        const localSession = await this.startLocalSessionFromTemplate(app, template, startEndpoint);
                        await this.renderWorkoutScreen(app.elements.pageContent, app, localSession.key);
                        return;
                    }
                    app.showToast(err.message || 'Ошибка запуска', 'error');
                    button.disabled = false;
                    button.innerHTML = originalHtml;
                }
            });
        });

        container.querySelectorAll('[data-action="start-template-ai"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const templateId = parseInt(btn.dataset.templateId);
                await this.startTemplateWithAi(container, app, templateId);
            });
        });
        } catch (err) {
            console.error('[Workouts] Templates screen error:', err);
            container.innerHTML = Components.errorState('Ошибка загрузки шаблонов');
        }
    },

    async renderStatisticsScreen(container, app) {
        this.app = app;
        try {
            const stats = await API.get('/workouts/statistics', app.state.tokens.access);
            if (!stats) {
                container.innerHTML = Components.errorState('Данные статистики недоступны');
                return;
            }
            let html = `
                <div class="p-4">
                    <div class="flex items-center mb-4">
                        <button data-action="back-to-workouts" class="mr-3 text-surface-500 hover:text-surface-900">←</button>
                        <h2 class="text-xl font-bold">Статистика</h2>
                    </div>
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4">
                            <p class="text-sm text-primary-700 dark:text-primary-300">Всего тренировок</p>
                            <p class="text-3xl font-bold text-primary-900 dark:text-primary-100">${stats?.total_workouts || 0}</p>
                        </div>
                        <div class="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4">
                            <p class="text-sm text-primary-700 dark:text-primary-300">На этой неделе</p>
                            <p class="text-3xl font-bold text-primary-900 dark:text-primary-100">${stats?.workouts_this_week || 0}</p>
                        </div>
                        <div class="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4">
                            <p class="text-sm text-primary-700 dark:text-primary-300">В этом месяце</p>
                            <p class="text-3xl font-bold text-primary-900 dark:text-primary-100">${stats?.workouts_this_month || 0}</p>
                        </div>
                        <div class="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4">
                            <p class="text-sm text-primary-700 dark:text-primary-300">Серия (недель)</p>
                            <p class="text-3xl font-bold text-primary-900 dark:text-primary-100">${stats?.current_streak_weeks || 0}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="glass rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Общий объём</p>
                            <p class="text-2xl font-bold">${stats?.total_volume_kg?.toLocaleString() || 0} кг</p>
                        </div>
                        <div class="glass rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Всего подходов</p>
                            <p class="text-2xl font-bold">${stats?.total_sets || 0}</p>
                        </div>
                        <div class="glass rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Общее время</p>
                            <p class="text-2xl font-bold">${stats?.total_duration_hours || 0} ч</p>
                        </div>
                        <div class="glass rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Средняя тренировка</p>
                            <p class="text-2xl font-bold">${stats?.avg_workout_duration_min || 0} мин</p>
                        </div>
                    </div>
                    ${stats?.top_exercises?.length > 0 ? `
                        <div class="mb-6">
                            <h3 class="font-semibold mb-3">Топ упражнений по объёму</h3>
                            <div class="space-y-2">
                                ${stats.top_exercises.map((ex, i) => `
                                    <div class="glass rounded-xl p-3 flex justify-between items-center">
                                        <div class="flex items-center gap-3">
                                            <span class="text-sm text-surface-400 w-6">${i + 1}.</span>
                                            <span class="font-medium">${ex.name}</span>
                                        </div>
                                        <div class="text-right">
                                            <p class="text-sm font-semibold">${ex.volume_kg.toLocaleString()} кг</p>
                                            <p class="text-xs text-surface-400">${ex.sets} подходов</p>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
            container.innerHTML = html;
            container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                app.showPage('workouts');
            });
        } catch (err) {
            app.showToast('Ошибка загрузки статистики', 'error');
        }
    },

    // Fullscreen builder sheet: the name/muscle-group block collapses out of the way
    // once the exercise catalog is scrolled, leaving the search bar, list and footer
    // pinned. Hysteresis (20px to collapse, 5px to expand) avoids flicker on rubber-band.
    bindCollapsibleHeader(sheet) {
        const header = sheet?.querySelector('#bw-collapsible-header');
        const list = sheet?.querySelector('#bw-exercise-list');
        if (!header || !list) return;

        const COLLAPSE_AT = 20;
        const EXPAND_AT = 5;
        const HIDE = ['max-h-0', 'opacity-0', 'pointer-events-none', 'mb-0'];
        const SHOW = ['max-h-96', 'opacity-100', 'mb-3'];

        let collapsed = false;
        const setCollapsed = (next) => {
            if (next === collapsed) return;
            collapsed = next;
            HIDE.forEach(c => header.classList.toggle(c, next));
            SHOW.forEach(c => header.classList.toggle(c, !next));
        };

        list.addEventListener('scroll', () => {
            // Keep the block pinned while one of its inputs is focused, otherwise the
            // on-screen keyboard scroll would collapse it out from under the caret.
            if (header.contains(document.activeElement)) return;
            const y = list.scrollTop;
            if (!collapsed && y > COLLAPSE_AT) setCollapsed(true);
            else if (collapsed && y <= EXPAND_AT) setCollapsed(false);
        }, { passive: true });

        header.addEventListener('focusin', () => setCollapsed(false));
    },

    closeBuildModal() {
        const m = document.getElementById('build-modal');
        if (m) m.remove();
        const cm = document.getElementById('create-ex-modal');
        if (cm) cm.remove();
        const tm = document.getElementById('template-modal');
        if (tm) tm.remove();
    },

    async showBuildWorkout(app) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };
        let exercises = [];
        let selected = [];
        let filterGroup = '';
        let search = '';

        const buildHtml = () => `
            <div id="build-modal" class="fixed inset-0 z-50 flex items-end justify-center min-h-screen p-0 sm:p-4 modal-backdrop pointer-events-auto">
                <div id="bw-sheet" class="w-full max-w-lg h-[100dvh] sm:h-[90vh] flex flex-col rounded-t-2xl sm:rounded-3xl bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-white/10 shadow-2xl pt-safe-top" role="dialog" aria-modal="true" aria-labelledby="bw-title">
                    <div class="w-12 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mt-2 mb-1 flex-shrink-0"></div>

                    <div class="px-4 pb-2 flex justify-between items-start gap-3 flex-shrink-0">
                        <div class="min-w-0">
                            <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">Шаблон</div>
                            <h3 id="bw-title" class="text-base font-bold">Собрать тренировку</h3>
                        </div>
                        <button type="button" data-action="close-build-workout" class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0">✕</button>
                    </div>

                    <div id="bw-collapsible-header"
                         class="px-4 pb-1 flex-shrink-0 space-y-2.5 max-h-96 opacity-100 mb-3 overflow-hidden transition-all duration-300 ease-in-out origin-top">
                        <div>
                            <label class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1" for="bw-name">Название тренировки</label>
                            <input id="bw-name" type="text" placeholder="Название тренировки" value="Моя тренировка"
                                   class="w-full px-3 py-2.5 text-sm glass-input rounded-xl font-medium">
                        </div>

                        <div>
                            <label class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1" for="bw-group">Группа мышц</label>
                            <select id="bw-group" class="w-full px-3 py-2.5 text-sm glass-input rounded-xl"></select>
                        </div>
                    </div>

                    <div class="px-4 pb-2 flex-shrink-0 z-10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md">
                        <div>
                            <label class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1" for="bw-search">Поиск и добавление</label>
                            <div class="flex items-center gap-2">
                                <input id="bw-search" type="text" placeholder="Поиск упражнения..."
                                       class="flex-1 min-w-0 px-3 py-2.5 text-sm glass-input rounded-xl">
                                <button id="bw-add-own" type="button" title="Добавить своё упражнение"
                                        class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl bg-lime-500 text-zinc-950 font-bold text-xl shadow-md btn-press">+</button>
                            </div>
                        </div>
                    </div>

                    <div id="bw-exercise-list" class="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-2">
                        <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">Доступные упражнения</div>
                        <div id="bw-list" class="space-y-2"></div>
                    </div>

                    <div class="sticky bottom-0 p-4 border-t border-zinc-200 dark:border-white/10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md flex items-center gap-2 flex-shrink-0 drum-sheet-safe">
                        <button type="button" id="bw-reset"
                                class="flex-1 py-3 rounded-2xl glass text-sm font-semibold">Сбросить</button>
                        <button id="bw-next"
                                class="flex-1 py-3 rounded-2xl bg-lime-500 text-zinc-950 font-bold text-sm shadow-md btn-press disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none" disabled>
                            Далее (выбрано: 0)
                        </button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML = buildHtml();
        const groupEl = document.getElementById('bw-group');
        const searchEl = document.getElementById('bw-search');
        const listEl = document.getElementById('bw-list');
        const nextBtn = document.getElementById('bw-next');
        const resetBtn = document.getElementById('bw-reset');
        const ownBtn = document.getElementById('bw-add-own');
        this.bindCollapsibleHeader(document.getElementById('bw-sheet'));

        const renderGroupOptions = () => {
            groupEl.innerHTML = '';
            const allOpt = document.createElement('option');
            allOpt.value = '';
            allOpt.textContent = 'Любая';
            groupEl.appendChild(allOpt);
            Object.entries(meta.muscle_groups || {}).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                groupEl.appendChild(opt);
            });
            groupEl.value = filterGroup;
        };

        const updateCreateLabel = () => {
            nextBtn.disabled = selected.length === 0;
            nextBtn.textContent = `Далее (выбрано: ${selected.length})`;
        };

        const renderList = () => {
            const rows = exercises.filter(ex => {
                const g = !filterGroup || ex.muscle_group === filterGroup;
                const s = !search || ex.name.toLowerCase().includes(search.toLowerCase());
                return g && s;
            });
            listEl.innerHTML = rows.map(ex => {
                const isSelected = selected.includes(ex.id);
                const groupLabel = meta.muscle_groups?.[ex.muscle_group] || ex.muscle_group;
                const equipmentLabel = meta.equipment?.[ex.equipment] || ex.equipment;
                return `
                <label class="flex items-center gap-3 p-3.5 cursor-pointer rounded-2xl border transition-all ${isSelected ? 'border-lime-500 bg-lime-500/10 dark:bg-lime-900/20' : 'glass hover:border-zinc-300 dark:hover:border-white/20'}">
                    <div class="flex-1 min-w-0 text-left">
                        <div class="font-semibold text-sm text-left text-zinc-900 dark:text-zinc-100 truncate">${ex.name}</div>
                        <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-left">
                            <span class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-lg bg-zinc-500/10 dark:bg-white/5 text-zinc-500 dark:text-zinc-400">${groupLabel}</span>
                            <span class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-lg bg-lime-500/15 text-lime-600 dark:text-lime-300">${equipmentLabel}</span>
                        </div>
                    </div>
                    <span class="flex-shrink-0 w-6 h-6 rounded-lg border flex items-center justify-center text-[11px] font-bold transition-all ${isSelected ? 'bg-lime-500 border-lime-500 text-zinc-950' : 'border-zinc-300 dark:border-white/15 text-transparent'}">✓</span>
                    <input type="checkbox" data-id="${ex.id}" class="sr-only"
                           ${isSelected ? 'checked' : ''}>
                </label>`;
            }).join('') || '<div class="text-sm text-zinc-400 dark:text-zinc-500 text-center py-6">Ничего не найдено</div>';

            listEl.querySelectorAll('input[data-id]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = parseInt(e.target.dataset.id);
                    if (e.target.checked) { selected.push(id); }
                    else { selected = selected.filter(i => i !== id); }
                    updateCreateLabel();
                    renderList();
                });
            });
        };

        groupEl.addEventListener('change', () => {
            filterGroup = groupEl.value;
            renderList();
        });
        resetBtn.addEventListener('click', () => {
            selected = [];
            renderList();
            updateCreateLabel();
        });
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            renderList();
        });
        ownBtn.addEventListener('click', () => {
            this.showCreateExerciseModal(app, (newEx) => {
                exercises.push(newEx);
                selected.push(newEx.id);
                renderList();
                updateCreateLabel();
            });
        });
        nextBtn.addEventListener('click', () => {
            const selectedExercises = selected.map(id => exercises.find(ex => ex.id === id)).filter(Boolean);
            const templateName = document.getElementById('bw-name')?.value.trim() || 'Мой шаблон';
            this.renderConfigurationScreen(app, selectedExercises, async (configuredExercises) => {
                const saveBtn = document.getElementById('bw-save-final');
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Сохраняем...';
                }
                const payload = {
                    name: templateName,
                    exercises: configuredExercises
                };
                try {
                    await API.post('/workouts/templates', payload, token);
                    this.closeBuildModal();
                    await this.render(app.elements.pageContent, app);
                    app.showToast('Шаблон тренировки сохранен!', 'success');
                } catch (err) {
                    app.showToast(err.message || 'Ошибка сохранения шаблона', 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Сохранить';
                    }
                }
            }, null);
        });

        try {
            const { meta: resMeta, exercises: resExercises } = await this.fetchExerciseCatalog(token);
            meta = resMeta;
            exercises = resExercises;
            renderGroupOptions();
            renderList();
        } catch (err) {
            // Only show an error toast if there is genuinely no cached catalog to fall back to
            try {
                const cachedCount = await DB.getExerciseCatalogCount();
                if (cachedCount > 0) {
                    app.showToast('Каталог загружен из кэша (оффлайн)', 'info');
                    return;
                }
            } catch (cacheError) {
                // ignore
            }
            app.showToast(err.message || 'Ошибка загрузки каталога', 'error');
        }
    },

    renderConfigurationScreen(app, selectedExercises, onSave, template = null) {
        const modal = document.getElementById('build-modal');
        const content = document.getElementById('bw-sheet') || modal.querySelector('.flex.flex-col');
        
        const findTemplateEx = (exName) => template?.exercises.find(te => te.name === exName);

        content.innerHTML = `
            <div class="w-12 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mt-2 mb-1 flex-shrink-0"></div>
            <div class="px-4 pb-2 flex justify-between items-start gap-3 flex-shrink-0">
                <h3 class="text-base font-bold">Настройка упражнений и порядка</h3>
                <button type="button" data-action="close-build-workout" class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0">✕</button>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-2" id="config-list">
                ${selectedExercises.map((ex, i) => {
                    const te = findTemplateEx(ex.name);
                    return `
                    <div class="glass p-3.5 rounded-2xl flex items-center justify-between gap-3" data-ex-id="${ex.id}" data-index="${i}">
                        <div class="flex-1 min-w-0">
                            <h4 class="font-bold mb-2 truncate text-sm">${ex.name}</h4>
                            <div class="grid grid-cols-2 gap-2">
                                <div>
                                    <label class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Подходы</label>
                                    <input type="number" inputmode="numeric" value="${te?.target_sets || 3}" class="w-full px-2.5 py-2 text-sm glass-input rounded-xl cfg-sets">
                                </div>
                                <div>
                                    <label class="text-[10px] uppercase tracking-wider text-surface-500 font-semibold">Повт.</label>
                                    <input type="number" inputmode="numeric" value="${te?.target_reps || 10}" class="w-full px-2.5 py-2 text-sm glass-input rounded-xl cfg-reps">
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-col gap-1.5 flex-shrink-0">
                            <button type="button" data-action="cfg-move-up" aria-label="Выше" class="px-3 py-2 glass rounded-xl text-sm font-bold hover:bg-surface-300 dark:hover:bg-white/10 transition-colors">▲</button>
                            <button type="button" data-action="cfg-move-down" aria-label="Ниже" class="px-3 py-2 glass rounded-xl text-sm font-bold hover:bg-surface-300 dark:hover:bg-white/10 transition-colors">▼</button>
                        </div>
                    </div>
                `}).join('')}
            </div>
            <div class="sticky bottom-0 p-4 border-t border-zinc-200 dark:border-white/10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md flex-shrink-0 drum-sheet-safe">
                <button id="bw-save-final" class="w-full py-3 bg-lime-500 text-zinc-950 font-bold text-sm rounded-2xl shadow-md btn-press">Сохранить</button>
            </div>
        `;

        content.querySelectorAll('[data-action="cfg-move-up"], [data-action="cfg-move-down"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.currentTarget.closest('[data-ex-id]');
                const isUp = e.currentTarget.dataset.action === 'cfg-move-up';
                const cards = Array.from(content.querySelectorAll('[data-ex-id]'));
                const idx = cards.indexOf(card);
                const targetIdx = isUp ? idx - 1 : idx + 1;
                if (targetIdx < 0 || targetIdx >= cards.length) return;

                const targetCard = cards[targetIdx];

                card.classList.add('scale-[1.02]', 'bg-primary-50', 'dark:bg-primary-900/40', 'transition-all', 'duration-300');
                targetCard.classList.add('transition-all', 'duration-300');

                if (isUp) {
                    targetCard.before(card);
                } else {
                    targetCard.after(card);
                }

                setTimeout(() => {
                    card.classList.remove('scale-[1.02]', 'bg-primary-50', 'dark:bg-primary-900/40');
                }, 400);
            });
        });

        document.getElementById('bw-save-final').addEventListener('click', () => {
            const items = content.querySelectorAll('[data-ex-id]');
            const configured = Array.from(items).map((item, i) => ({
                name: item.querySelector('h4').textContent,
                order: i,
                target_sets: parseInt(item.querySelector('.cfg-sets').value),
                target_reps: parseInt(item.querySelector('.cfg-reps').value),
                target_weight_kg: null,
                rest_seconds: 90
            }));
            onSave(configured);
        });
    },

    async showEditTemplateModal(app, template) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };
        let exercises = [];
        let selected = [];
        let filterGroup = '';
        let search = '';

        const buildHtml = () => `
            <div id="build-modal" class="fixed inset-0 z-50 flex items-end justify-center min-h-screen p-0 sm:p-4 modal-backdrop pointer-events-auto">
                <div id="bw-sheet" class="w-full max-w-lg h-[100dvh] sm:h-[90vh] flex flex-col rounded-t-2xl sm:rounded-3xl bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-white/10 shadow-2xl pt-safe-top" role="dialog" aria-modal="true" aria-labelledby="bw-title">
                    <div class="w-12 h-1 bg-zinc-300 dark:bg-zinc-700 rounded-full mx-auto mt-2 mb-1 flex-shrink-0"></div>

                    <div class="px-4 pb-2 flex justify-between items-start gap-3 flex-shrink-0">
                        <div class="min-w-0">
                            <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">Шаблон</div>
                            <h3 id="bw-title" class="text-base font-bold">Редактировать шаблон</h3>
                        </div>
                        <button type="button" data-action="close-build-workout" class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0">✕</button>
                    </div>

                    <div id="bw-collapsible-header"
                         class="px-4 pb-1 flex-shrink-0 space-y-2.5 max-h-96 opacity-100 mb-3 overflow-hidden transition-all duration-300 ease-in-out origin-top">
                        <div>
                            <label class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1" for="bw-name">Название тренировки</label>
                            <input id="bw-name" type="text" placeholder="Название тренировки" value="${this.escapeHtml(template.name || '')}"
                                   class="w-full px-3 py-2.5 text-sm glass-input rounded-xl font-medium">
                        </div>

                        <div>
                            <label class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1" for="bw-group">Группа мышц</label>
                            <select id="bw-group" class="w-full px-3 py-2.5 text-sm glass-input rounded-xl"></select>
                        </div>
                    </div>

                    <div class="px-4 pb-2 flex-shrink-0 z-10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md">
                        <div>
                            <label class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1" for="bw-search">Поиск и добавление</label>
                            <div class="flex items-center gap-2">
                                <input id="bw-search" type="text" placeholder="Поиск упражнения..."
                                       class="flex-1 min-w-0 px-3 py-2.5 text-sm glass-input rounded-xl">
                                <button id="bw-add-own" type="button" title="Добавить своё упражнение"
                                        class="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl bg-lime-500 text-zinc-950 font-bold text-xl shadow-md btn-press">+</button>
                            </div>
                        </div>
                    </div>

                    <div id="bw-exercise-list" class="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-2">
                        <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold">Доступные упражнения</div>
                        <div id="bw-list" class="space-y-2"></div>
                    </div>

                    <div class="sticky bottom-0 p-4 border-t border-zinc-200 dark:border-white/10 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md flex items-center gap-2 flex-shrink-0 drum-sheet-safe">
                        <button type="button" id="bw-reset"
                                class="flex-1 py-3 rounded-2xl glass text-sm font-semibold">Сбросить</button>
                        <button id="bw-next"
                                class="flex-1 py-3 rounded-2xl bg-lime-500 text-zinc-950 font-bold text-sm shadow-md btn-press disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none" disabled>
                            Далее (выбрано: 0)
                        </button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML = buildHtml();
        const groupEl = document.getElementById('bw-group');
        const searchEl = document.getElementById('bw-search');
        const listEl = document.getElementById('bw-list');
        const nextBtn = document.getElementById('bw-next');
        const resetBtn = document.getElementById('bw-reset');
        const ownBtn = document.getElementById('bw-add-own');
        this.bindCollapsibleHeader(document.getElementById('bw-sheet'));

        const renderGroupOptions = () => {
            groupEl.innerHTML = '';
            const allOpt = document.createElement('option');
            allOpt.value = '';
            allOpt.textContent = 'Любая';
            groupEl.appendChild(allOpt);
            Object.entries(meta.muscle_groups || {}).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                groupEl.appendChild(opt);
            });
            groupEl.value = filterGroup;
        };

        const updateCreateLabel = () => {
            if (nextBtn) {
                nextBtn.disabled = selected.length === 0;
                nextBtn.textContent = `Далее (выбрано: ${selected.length})`;
            }
        };

        const renderList = () => {
            const rows = exercises.filter(ex => {
                const g = !filterGroup || ex.muscle_group === filterGroup;
                const s = !search || ex.name.toLowerCase().includes(search.toLowerCase());
                return g && s;
            });
            listEl.innerHTML = rows.map(ex => {
                const isSelected = selected.includes(ex.id);
                const groupLabel = meta.muscle_groups?.[ex.muscle_group] || ex.muscle_group;
                const equipmentLabel = meta.equipment?.[ex.equipment] || ex.equipment;
                return `
                <label class="flex items-center gap-3 p-3.5 cursor-pointer rounded-2xl border transition-all ${isSelected ? 'border-lime-500 bg-lime-500/10 dark:bg-lime-900/20' : 'glass hover:border-zinc-300 dark:hover:border-white/20'}">
                    <div class="flex-1 min-w-0 text-left">
                        <div class="font-semibold text-sm text-left text-zinc-900 dark:text-zinc-100 truncate">${ex.name}</div>
                        <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-left">
                            <span class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-lg bg-zinc-500/10 dark:bg-white/5 text-zinc-500 dark:text-zinc-400">${groupLabel}</span>
                            <span class="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-lg bg-lime-500/15 text-lime-600 dark:text-lime-300">${equipmentLabel}</span>
                        </div>
                    </div>
                    <span class="flex-shrink-0 w-6 h-6 rounded-lg border flex items-center justify-center text-[11px] font-bold transition-all ${isSelected ? 'bg-lime-500 border-lime-500 text-zinc-950' : 'border-zinc-300 dark:border-white/15 text-transparent'}">✓</span>
                    <input type="checkbox" data-id="${ex.id}" class="sr-only"
                           ${isSelected ? 'checked' : ''}>
                </label>`;
            }).join('') || '<div class="text-sm text-zinc-400 dark:text-zinc-500 text-center py-6">Ничего не найдено</div>';

            listEl.querySelectorAll('input[data-id]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = parseInt(e.target.dataset.id);
                    if (e.target.checked) { selected.push(id); }
                    else { selected = selected.filter(i => i !== id); }
                    updateCreateLabel();
                    renderList();
                });
            });
        };

        groupEl.addEventListener('change', () => {
            filterGroup = groupEl.value;
            renderList();
        });
        resetBtn.addEventListener('click', () => {
            selected = [];
            renderList();
            updateCreateLabel();
        });
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            renderList();
        });
        ownBtn.addEventListener('click', () => {
            this.showCreateExerciseModal(app, (newEx) => {
                exercises.push(newEx);
                selected.push(newEx.id);
                renderList();
                updateCreateLabel();
            });
        });

        nextBtn.addEventListener('click', () => {
            const selectedExercises = exercises.filter(ex => selected.includes(ex.id));
            const templateName = document.getElementById('bw-name')?.value.trim() || template.name || 'Мой шаблон';
            
            // Fix sorting: match original template exercise order
            selectedExercises.sort((a, b) => {
                const idxA = template.exercises.findIndex(te => te.name === a.name);
                const idxB = template.exercises.findIndex(te => te.name === b.name);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });

            this.renderConfigurationScreen(app, selectedExercises, async (configuredExercises) => {
                const saveBtn = document.getElementById('bw-save-final');
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Сохраняем...';
                }
                const payload = {
                    name: templateName,
                    exercises: configuredExercises
                };
                try {
                    await API.patch(`/workouts/templates/${template.id}`, payload, token);
                    this.closeBuildModal();
                    await this.render(app.elements.pageContent, app);
                    app.showToast('Шаблон обновлен!', 'success');
                } catch (err) {
                    app.showToast(err.message || 'Ошибка обновления', 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Сохранить';
                    }
                }
            }, template);
        });

        try {
            const { meta: resMeta, exercises: resExercises } = await this.fetchExerciseCatalog(token);
            meta = resMeta;
            exercises = resExercises;
            selected = (template.exercises || []).map(te => {
                const found = exercises.find(ex => ex.name === te.name);
                return found ? found.id : null;
            }).filter(Boolean);
            renderGroupOptions();
            renderList();
            updateCreateLabel();
        } catch (err) {
            try {
                const cachedCount = await DB.getExerciseCatalogCount();
                if (cachedCount > 0) {
                    app.showToast('Каталог загружен из кэша (оффлайн)', 'info');
                    return;
                }
            } catch (cacheError) {
                // ignore
            }
            app.showToast(err.message || 'Ошибка загрузки каталога', 'error');
        }
    },

    showCreateExerciseModal(app, onCreated) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };

        const html = `
            <div id="create-ex-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto">
                <div class="glass-strong rounded-2xl p-6 mx-4 max-w-sm w-full">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold">Новое упражнение</h3>
                        <button data-action="close-build-workout" class="text-surface-500 hover:text-surface-900 dark:text-surface-400">✕</button>
                    </div>
                    <div class="space-y-3">
                        <input id="ce-name" type="text" placeholder="Название"
                                class="w-full px-3 py-2 text-sm glass-input rounded">
                        <select id="ce-group"
                                class="w-full px-3 py-2 text-sm glass-input rounded"></select>
                        <select id="ce-equipment"
                                class="w-full px-3 py-2 text-sm glass-input rounded"></select>
                        <label class="flex items-center gap-2 text-sm">
                            <input id="ce-compound" type="checkbox" checked> Компаундное
                        </label>
                        <textarea id="ce-desc" placeholder="Описание (необязательно)"
                                  class="w-full px-3 py-2 text-sm glass-input rounded"></textarea>
                    </div>
                    <div class="flex gap-2 mt-5">
                        <button data-action="close-build-workout"
                                class="flex-1 py-2 border border-surface-300 dark:border-white/10 rounded-xl text-sm font-medium">Отмена</button>
                        <button id="ce-save"
                                class="flex-1 py-2 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl text-sm font-medium">Сохранить</button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML += html;
        const groupEl = document.getElementById('ce-group');
        const equipEl = document.getElementById('ce-equipment');
        const saveBtn = document.getElementById('ce-save');

        const renderOptions = () => {
            groupEl.innerHTML = '';
            Object.entries(meta.muscle_groups).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                groupEl.appendChild(opt);
            });
            equipEl.innerHTML = '';
            Object.entries(meta.equipment).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                equipEl.appendChild(opt);
            });
        };

        saveBtn.addEventListener('click', async () => {
            const payload = {
                name: document.getElementById('ce-name').value.trim(),
                muscle_group: groupEl.value,
                equipment: equipEl.value,
                is_compound: document.getElementById('ce-compound').checked,
                description: document.getElementById('ce-desc').value.trim() || undefined,
            };
            if (!payload.name || !payload.muscle_group || !payload.equipment) {
                app.showToast('Заполните название, группу мышц и снаряжение', 'error');
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Сохраняю...';
            try {
                const created = await API.post('/workouts/exercises', payload, token);
                const m = document.getElementById('create-ex-modal');
                if (m) m.remove();
                onCreated(created);
            } catch (err) {
                app.showToast(err.message || 'Ошибка сохранения', 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Сохранить';
            }
        });

        (async () => {
            try {
                meta = await API.get('/workouts/exercises/meta', token);
                renderOptions();
            } catch (err) {
                app.showToast(err.message || 'Ошибка загрузки справочника', 'error');
            }
        })();
    },

    async showCreateTemplateModal(app) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };
        let exercises = [];
        let selected = [];
        let filterGroup = '';
        let search = '';

        const renderGroupOptions = () => {
            groupEl.innerHTML = '<option value="">Все группы мышц</option>';
            Object.entries(meta.muscle_groups).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                if (slug === filterGroup) opt.selected = true;
                groupEl.appendChild(opt);
            });
        };

        const renderList = () => {
            const rows = exercises.filter(ex => {
                const g = !filterGroup || ex.muscle_group === filterGroup;
                const s = !search || ex.name.toLowerCase().includes(search.toLowerCase());
                return g && s;
            });
            listEl.innerHTML = rows.map(ex => `
                <label class="flex items-center gap-2 p-2 cursor-pointer hover:bg-surface-100 dark:hover:bg-white/10 rounded">
                    <input type="checkbox" data-id="${ex.id}"
                           ${selected.includes(ex.id) ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="font-medium">${ex.name}</div>
                        <div class="text-xs text-surface-500 dark:text-surface-400">
                            ${meta.muscle_groups[ex.muscle_group] || ex.muscle_group} · ${meta.equipment[ex.equipment] || ex.equipment} · ${ex.is_compound ? 'компаунд' : 'изоляция'}
                        </div>
                    </div>
                </label>
            `).join('') || '<div class="text-sm text-surface-400">Ничего не найдено</div>';
            listEl.querySelectorAll('input[data-id]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = parseInt(e.target.dataset.id);
                    if (e.target.checked) { selected.push(id); }
                    else { selected = selected.filter(i => i !== id); }
                    createBtn.disabled = selected.length === 0;
                });
            });
        };

        const html = `
            <div id="template-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto">
                <div class="glass-strong rounded-2xl mx-4 max-w-2xl w-full max-h-[85vh] flex flex-col">
                    <div class="p-5 border-b ">
                        <div class="flex justify-between items-center">
                            <h3 class="text-lg font-bold">Создать шаблон тренировки</h3>
                            <button data-action="close-template-modal" class="text-surface-500 hover:text-surface-900 dark:text-surface-400">✕</button>
                        </div>
                        <div class="grid grid-cols-2 gap-3 mt-3">
                            <input id="tmpl-name" type="text" placeholder="Название шаблона" value="Мой шаблон"
                                   class="px-3 py-2 text-sm glass-input rounded">
                            <input id="tmpl-desc" type="text" placeholder="Описание (необязательно)"
                                   class="px-3 py-2 text-sm glass-input rounded">
                        </div>
                    </div>
                    <div class="p-4 border-b ">
                        <div class="flex items-center gap-2 mb-2 flex-wrap">
                            <select id="tmpl-group"
                                    class="px-2 py-1 text-sm glass-input rounded">
                                <option value="">Все группы мышц</option>
                            </select>
                            <input id="tmpl-search" type="text" placeholder="Поиск упражнения"
                                   class="flex-1 px-2 py-1 text-sm glass-input rounded">
                            <button id="tmpl-add-own" type="button" title="Добавить своё упражнение"
                                    class="px-2 py-1 border border-surface-300 dark:border-white/10 rounded text-surface-500 hover:text-surface-900">+</button>
                        </div>
                        <div id="tmpl-list" class="space-y-1 overflow-y-auto max-h-72"></div>
                    </div>
                    <div class="p-4 border-t  flex gap-2">
                        <button id="tmpl-create"
                                class="flex-1 py-2 bg-primary-600 text-white dark:bg-white dark:text-zinc-950 rounded-xl text-sm font-medium" disabled>
                            Создать шаблон
                        </button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML = html;
        const groupEl = document.getElementById('tmpl-group');
        const searchEl = document.getElementById('tmpl-search');
        const listEl = document.getElementById('tmpl-list');
        const createBtn = document.getElementById('tmpl-create');
        const ownBtn = document.getElementById('tmpl-add-own');

        groupEl.addEventListener('change', () => {
            filterGroup = groupEl.value;
            renderList();
        });
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            renderList();
        });
        ownBtn.addEventListener('click', () => {
            this.showCreateExerciseModal(app, (newEx) => {
                exercises.push(newEx);
                selected.push(newEx.id);
                renderList();
                createBtn.disabled = selected.length === 0;
            });
        });
        createBtn.addEventListener('click', async () => {
            if (selected.length === 0) return;
            createBtn.disabled = true;
            createBtn.textContent = 'Создаём...';
            // For template creation, we need to fetch full exercise details
            const selectedExercises = exercises.filter(ex => selected.includes(ex.id));
            const payload = {
                name: document.getElementById('tmpl-name').value.trim() || 'Мой шаблон',
                description: document.getElementById('tmpl-desc').value.trim() || undefined,
                exercises: selectedExercises.map((ex, i) => ({
                    name: ex.name,
                    order: i,
                    target_sets: 3,
                    target_reps: 10,
                    target_weight_kg: null,
                    rest_seconds: 90,
                    notes: `${ex.muscle_group} / ${ex.equipment}`,
                })),
            };
            try {
                await API.post('/workouts/templates', payload, token);
                const m = document.getElementById('template-modal');
                if (m) m.remove();
                app.showToast('Шаблон создан!', 'success');
                await this.renderTemplatesScreen(app.elements.pageContent, app);
            } catch (err) {
                app.showToast(err.message || 'Ошибка создания шаблона', 'error');
                createBtn.disabled = false;
                createBtn.textContent = 'Создать шаблон';
            }
        });
        document.querySelector('[data-action="close-template-modal"]')?.addEventListener('click', () => {
            const m = document.getElementById('template-modal');
            if (m) m.remove();
        });

        try {
            const { meta: resMeta, exercises: resExercises } = await this.fetchExerciseCatalog(token);
            meta = resMeta;
            exercises = resExercises;
            renderGroupOptions();
            renderList();
        } catch (err) {
            try {
                const cachedCount = await DB.getExerciseCatalogCount();
                if (cachedCount > 0) {
                    app.showToast('Каталог загружен из кэша (оффлайн)', 'info');
                    return;
                }
            } catch (cacheError) {
                // ignore
            }
            app.showToast(err.message || 'Ошибка загрузки каталога', 'error');
        }
    }
};
