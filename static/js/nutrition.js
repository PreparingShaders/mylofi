import { API } from './api.js';
import { DB } from './db.js';
import { SyncEngine, getFriendlyEndpointLabel } from './sync.js';
import { Components } from './components.js';
import { Utils, clientTimezone, isTempMealId } from './utils.js';
import { Camera } from './camera.js';
import { MealCard } from './mealCard.js';
import { PeriodSheet, NewMealSheet, EditMealSheet, AiSynergySleepSheet } from './baseSheet.js';
import { DEFAULT_TARGETS, PERIODS, PERIOD_TABS } from './constants.js';


// Day / 7 days / month are one-tap presets; the custom period is opened as a
// range sheet by the icon tab.

export const Nutrition = {
    app: null,
    _mealCard: null,

    // Structured state object replacing 20+ loose properties
    _state: {
        // UI state
        ui: {
            selectedDate: null,
            selectedPeriod: 'day',
            customRange: { start: null, end: null },
        },
        // Modal/sheet state
        modals: {
            newMeal: null,
            newMealClosing: null,
            period: null,
            periodClosing: null,
            editMeal: null,
            editMealClosing: null,
            aiSynergyModal: null,
        },
        // Cache
        cache: {
            meals: new Map(),
            dailySummary: null,
        },
        // AI Synergy state
        aiSynergy: {
            period: '14',
            customRange: { start: '', end: '' },
            result: null,
            running: false,
        },
        // Flags
        flags: {
            dailySummaryLoading: false,
            dailySummaryExpanded: false,
            mealSubmitInFlight: false,
            scrollTargetMealId: null,
            expandedCompositions: new Set(),
        },
    },

/**
     * Whether a sheet or a modal currently covers the page.
     *
     * A render tears those down, so a live update that arrives while one is
     * open has to wait: the user is in the middle of something, and closing
     * their sheet would throw away what they typed.
     */
    hasOpenOverlay() {
        return Boolean(
            this._state.modals.newMeal || this._state.modals.newMealClosing
            || this._state.modals.period || this._state.modals.periodClosing
            || this._state.modals.editMeal || this._state.modals.editMealClosing
            || this._state.modals.aiSynergyModal
        );
    },

init(app) {
        this.app = app;
        this.Components = Components;
        this._mealCard = new MealCard(this);
        window.addEventListener('mylofi:sync-completed', async (event) => {
            try {
                if (this.app?.state?.currentPage !== 'nutrition') return;
                if (this._state.flags.mealSubmitInFlight) return;
                if (this.hasOpenOverlay()) return;
                const container = this.app.elements?.pageContent;
                if (!container) return;
                await this.updateCarouselInPlace();
            } catch (error) {
                console.error('[Nutrition] sync-completed handler error:', error);
            }
        });

        // The server pushes the moment a background analysis lands. The card
        // in the carousel is still the "analysing" one at that point, so the
        // page is re-rendered to show the real result.
        window.addEventListener('mylofi:meal-update', async (event) => {
            try {
                const status = event?.detail?.status;
                if (status !== 'completed' && status !== 'failed') return;
                if (this.app?.state?.currentPage !== 'nutrition') return;
                if (this._state.flags.mealSubmitInFlight) return;
                if (this.hasOpenOverlay()) return;
                const container = this.app.elements?.pageContent;
                if (!container) return;
                await this.updateCarouselInPlace();
            } catch (error) {
                console.error('[Nutrition] meal-update handler error:', error);
            }
        });
    },

    /**
     * Fetch the latest saved synergy report so state survives page reloads.
     * Called on init and on every day-view render. Never throws:
     * the nutrition page must render even when the report cannot be fetched.
     */
async loadAiSynergyReport() {
        if (this._state.ui.selectedPeriod !== 'day') return null;
        const token = this.app.state.tokens.access;
        const user = this.app.state.user || {};
        if (!user?.is_premium) {
            this._state.aiSynergy.result = null;
            return null;
        }

        try {
            const periodType = this.getAiSynergyPeriodType();
            const endpoint = `/ai/synergy?period_type=${encodeURIComponent(periodType)}`;
            const data = await API.dedupeGet(endpoint, token);
            if (data && data.available && data.verdict) {
                this._state.aiSynergy.result = {
                    success: true,
                    analyzed_at: data.analyzed_at,
                    period_days: data.period_days,
                    period_type: data.period_type,
                    metrics_snapshot: data.metrics_snapshot || {},
                    verdict: data.verdict,
                };
            } else {
                this._state.aiSynergy.result = null;
            }
            return this._state.aiSynergy.result;
        } catch (error) {
            console.warn('[Nutrition] Saved synergy report unavailable:', error?.message);
            this._state.aiSynergy.result = null;
            return null;
        }
    },

    /** Populate the widget from a saved report without a model call. */
    setAiSynergyResultFromSaved(payload) {
        this._state.aiSynergy.result = payload;
        this._state.aiSynergy.running = false;
        this.renderAiSynergyWidget();
    },

    /**
     * Today's date as YYYY-MM-DD, in the user's own calendar. Every date in this
     * module is a plain calendar day, so all arithmetic on them runs in UTC:
     * shifting with local time would move the selected day across a DST
     * boundary. Only the *source* of today's date is local - the API is asked
     * for the same day with `tz_offset`, so a meal eaten at 00:30 stays on the
     * page the user is looking at instead of landing on the neighbouring one.
     */
    todayISO() {
        const now = new Date();
        return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    },

    /**
     * Endpoint with the device offset attached, so the server resolves the day
     * bounds in local time. A device that reports no offset asks for UTC days,
     * which is what it did before.
     */
    withTimezone(endpoint) {
        const { offsetMinutes } = clientTimezone();
        if (offsetMinutes === null) return endpoint;
        const separator = endpoint.includes('?') ? '&' : '?';
        return `${endpoint}${separator}tz_offset=${encodeURIComponent(offsetMinutes)}`;
    },

    shiftDate(dateISO, days) {
        const date = new Date(`${dateISO}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    },

    /** Monday of the week the date belongs to (matches the backend week bounds). */
    startOfWeek(dateISO) {
        const date = new Date(`${dateISO}T00:00:00Z`);
        return this.shiftDate(dateISO, -((date.getUTCDay() + 6) % 7));
    },

    monthBounds(dateISO) {
        const date = new Date(`${dateISO}T00:00:00Z`);
        const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
        const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
        return {
            start: start.toISOString().slice(0, 10),
            end: end.toISOString().slice(0, 10),
        };
    },

    /** Same day of the neighbouring month, clamped to that month's length. */
    shiftMonth(dateISO, delta) {
        const date = new Date(`${dateISO}T00:00:00Z`);
        const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
        const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
        return target.toISOString().slice(0, 10);
    },

    formatDayMonthISO(dateISO) {
        if (!dateISO) return '';
        return new Date(`${String(dateISO).slice(0, 10)}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    },

    formatMonthYear(dateISO) {
        const date = new Date(`${dateISO}T00:00:00`);
        const month = date.toLocaleDateString('ru-RU', { month: 'long' });
        return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
    },

    /**
     * Effective window of the selected period, always ending no later than
     * today. The week and month follow the preset bounds, the custom period
     * follows the sheet, and the day is the anchor itself.
     */
    periodRange() {
        const today = this.todayISO();
        const anchor = this._state.ui.selectedDate && this._state.ui.selectedDate <= today ? this._state.ui.selectedDate : today;

        if (this._state.ui.selectedPeriod === 'week') {
            const start = this.startOfWeek(anchor);
            const weekEnd = this.shiftDate(start, 6);
            return { start, end: weekEnd > today ? today : weekEnd };
        }

        if (this._state.ui.selectedPeriod === 'month') {
            const { start, end } = this.monthBounds(anchor);
            return { start, end: end > today ? today : end };
        }

        if (this._state.ui.selectedPeriod === 'custom') {
            let start = this._state.ui.customRange?.start;
            let end = this._state.ui.customRange?.end;
            if (!start || !end) {
                end = anchor;
                start = this.shiftDate(end, -6);
            }
            if (start > end) [start, end] = [end, start];
            return { start, end: end > today ? today : end };
        }

        return { start: anchor, end: anchor };
    },

    /** Anchor the arrows would move to, or null when the step is not possible. */
    stepAnchor(delta) {
        const today = this.todayISO();
        let next = null;
        if (this._state.ui.selectedPeriod === 'day') {
            next = this.shiftDate(this._state.ui.selectedDate, delta);
        } else if (this._state.ui.selectedPeriod === 'week') {
            next = this.shiftDate(this._state.ui.selectedDate, delta * 7);
        } else if (this._state.ui.selectedPeriod === 'month') {
            next = this.shiftMonth(this._state.ui.selectedDate, delta);
        }
        if (!next || next > today) return null;
        return next;
    },

    canStepForward() {
        return this.stepAnchor(1) !== null;
    },

    /**
     * Meals plus their totals for the selected period. The day keeps the
     * /nutrition/logs endpoint; every wider period uses the range endpoint.
     * Pending local meals and failed sync items come from IndexedDB either way.
     */
    async loadData() {
        const token = this.app.state.tokens.access;
        const { start, end } = this.periodRange();
        const endpoint = this._state.ui.selectedPeriod === 'day'
            ? `/nutrition/logs?date=${start}`
            : `/nutrition/meals?start_date=${start}&end_date=${end}`;

        let data = null;
        let fromCache = false;

        try {
            data = await API.get(this.withTimezone(endpoint), token);
        } catch (error) {
            console.warn('[Nutrition] API unavailable, falling back to local data:', error?.message);
            fromCache = true;
        }

        const serverMeals = (data && Array.isArray(data.meals)) ? data.meals : [];
        const summary = data
            ? {
                  calories: data.total_calories || 0,
                  protein: data.total_protein_g || 0,
                  fat: data.total_fat_g || 0,
                  carbs: data.total_carbs_g || 0,
              }
            : { calories: 0, protein: 0, fat: 0, carbs: 0 };

        const targets = data
            ? {
                  target_calories: data.target_calories ?? null,
                  target_protein: data.target_protein_g ?? null,
                  target_fat: data.target_fat_g ?? null,
                  target_carbs: data.target_carbs_g ?? null,
              }
            : { target_calories: null, target_protein: null, target_fat: null, target_carbs: null };

        let pendingMeals = [];
        let failedItems = [];
        try {
            const [pm, fi] = await Promise.all([
                DB.getMealsByStatus(DB.SYNC_STATUS.PENDING).catch(() => []),
                SyncEngine.getFailedItems().catch(() => []),
            ]);
            pendingMeals = pm || [];
            failedItems = fi || [];
            // Exclude locally-cached meals whose server status is already FAILED:
            // a failed analysis is permanently done, not "awaiting sync", and would
            // otherwise inflate the "Ожидают синхронизации" counter.
            pendingMeals = pendingMeals.filter(
                (m) => {
                    const s = typeof m.status === 'string' ? m.status.toLowerCase() : '';
                    return s !== 'failed' && s !== 'completed';
                }
            );
            // Deduplicate: filter out pending meals that have already been
            // resolved by the sync engine (i.e. their temp id was replaced
            // with a real server id and a matching server meal exists).
            // This prevents showing both the "Анализируем..." pending card
            // and the final processed card side-by-side after a successful
            // offline queue flush.
            if (Array.isArray(serverMeals) && serverMeals.length > 0) {
                const serverIds = new Set(
                    serverMeals.map(m => String(m.id)).filter(Boolean)
                );
                pendingMeals = pendingMeals.filter(pm => {
                    const mealId = String(pm.id ?? '');
                    const tempId = pm.tempId ? String(pm.tempId) : null;
                    if (tempId && serverIds.has(tempId)) return false;
                    if (pm.resolved && serverIds.has(mealId)) return false;
                    return true;
                });
            }
        } catch (error) {
            console.warn('[Nutrition] Failed to read pending/failed items:', error);
        }

        return { serverMeals, summary, targets, pendingMeals, failedItems, fromCache };
    },

    /**
     * Averaged figures for the selected period, or null in the day period where
     * the day payload already carries the totals. The endpoints return per-day
     * averages plus a dense daily series, so the payload is only normalised
     * into the summary shape the ring expects.
     */
async loadPeriodData() {
        if (this._state.ui.selectedPeriod === 'day') return null;

        const token = this.app.state.tokens.access;
        const { start, end } = this.periodRange();

        let endpoint = null;
        if (this._state.ui.selectedPeriod === 'week') {
            endpoint = `/nutrition/week?date=${this._state.ui.selectedDate}`;
        } else if (this._state.ui.selectedPeriod === 'month') {
            endpoint = `/nutrition/month?date=${this._state.ui.selectedDate}`;
        } else {
            endpoint = `/nutrition/range?start_date=${start}&end_date=${end}`;
        }

        try {
            const data = await API.dedupeGet(this.withTimezone(endpoint), token);
            if (data && typeof data === 'object') {
                return {
                    calories: Number(data.avg_calories) || Number(data.total_calories) || 0,
                    protein: Number(data.avg_protein_g) || Number(data.total_protein_g) || 0,
                    fat: Number(data.avg_fat_g) || Number(data.total_fat_g) || 0,
                    carbs: Number(data.avg_carbs_g) || Number(data.total_carbs_g) || 0,
                    target_calories: data.target_calories ?? null,
                    target_protein_g: data.target_protein_g ?? null,
                    target_fat_g: data.target_fat_g ?? null,
                    target_carbs_g: data.target_carbs_g ?? null,
                    start_date: data.start_date ?? start,
                    end_date: data.end_date ?? end,
                    days: data.days ?? null,
                    active_days: data.active_days ?? null,
                    series: Array.isArray(data.series) ? data.series : [],
                };
            }
        } catch (error) {
            console.warn('[Nutrition] Period average unavailable:', error?.message);
        }
        return null;
    },

    /**
     * Day the recap card is about.
     *
     * A recap of today can never exist - the day is still being eaten - so while
     * the header says "Сегодня" the card stands in for the day that *is*
     * finished: yesterday. Any other date the user browses to names itself, which
     * is why this is one lookup and not a flag threaded through the render.
     */
    recapDate() {
        const today = this.todayISO();
        if (this._state.ui.selectedDate && this._state.ui.selectedDate >= today) return this.shiftDate(today, -1);
        return this._state.ui.selectedDate;
    },

    /** True while the card is standing in for yesterday behind a "Сегодня" header. */
    recapIsYesterday() {
        return Boolean(this._state.ui.selectedDate) && this._state.ui.selectedDate >= this.todayISO();
    },

    /**
     * Everything the recap card is rendered with, shared by the page render and
     * the in-place swap after a regeneration: the date it names (concise -
     * "Итог • 7 окт" for the day standing in behind a "Сегодня" header),
     * whether its day is finished enough to generate, the wording of that
     * trigger, and whether the verdict prose is expanded. One place, so the
     * card can never claim a different day than the request it rode on.
     */
    recapCardOptions() {
        const date = this.recapDate();
        const isYesterday = this.recapIsYesterday();
        return {
            dateLabel: isYesterday
                ? `Итог • ${this.formatDayMonthISO(date)}`
                : this.formatDayMonthISO(date),
            allowGenerate: Boolean(date) && date < this.todayISO(),
            generateLabel: isYesterday ? 'Сформировать итог за вчера' : 'Сформировать итог дня',
            expanded: this._state.flags.dailySummaryExpanded,
        };
    },

    /**
     * AI recap of the card's day (yesterday while "Today" is selected).
     *
     * Only the day view asks for it: a recap covers one calendar day, so a week
     * or a month window has no single day to recap and the card is left out
     * entirely. The endpoint generates it on demand for a finished day, and a day
     * without a recap answers with `available: false` plus a reason rather than an
     * error - the card renders that reason, so a failed generation costs the user
     * nothing but a quiet line.
     *
     * Never throws: the nutrition page must render even when the recap cannot be
     * fetched, and it is already reading two other endpoints here.
     */
async loadDailySummary() {
        if (this._state.ui.selectedPeriod !== 'day') return null;

        const token = this.app.state.tokens.access;
        const endpoint = `/nutrition/daily-summary?date=${encodeURIComponent(this.recapDate())}`;
        try {
            const data = await API.dedupeGet(this.withTimezone(endpoint), token);
            const summary = (data && typeof data === 'object') ? data : null;
            this._state.cache.dailySummary = summary;
            return summary;
        } catch (error) {
            console.warn('[Nutrition] Daily summary unavailable:', error?.message);
            this._state.cache.dailySummary = null;
            return null;
        }
    },

    /**
     * Manual recap trigger, bound to both actions on the daily-summary
     * card: "Сформировать итог..." on a finished day without a recap, and
     * the refresh glyph on a stored one. Both ask the endpoint with
     * `force=true` for the same day the card names, so the day is re-read and
     * the stored row rewritten in place - the card then swaps in the fresh
     * payload without a reload.
     *
     * Never throws: a failed generation toasts and leaves the card as it
     * was, exactly like the read path it rides on.
     */
    async generateDailySummary(isRegeneration = false) {
        if (this._state.flags.dailySummaryLoading) return;
        const container = this.app.elements.pageContent;
        const section = container.querySelector('.daily-summary');
        if (!section) return;

        if (isRegeneration && this._state.cache.dailySummary && this._state.cache.dailySummary.available === true) {
            this.app.showToast('Анализ за сегодня уже готов! Повторный перерасчет будет доступен завтра.', 'info');
            return;
        }

        this._state.flags.dailySummaryLoading = true;
        this.setDailySummaryBusy(section, true);

const token = this.app.state.tokens.access;
        const endpoint = `/nutrition/daily-summary?date=${encodeURIComponent(this.recapDate())}&force=true`;
        try {
            // Invalidate cache BEFORE re-fetching so no stale data can be served during the race window
            API.invalidateReadCache('/nutrition/daily-summary');
            const data = await API.get(this.withTimezone(endpoint), token);
            const payload = (data && typeof data === 'object') ? data : null;
            this._state.cache.dailySummary = payload;
            if (payload) {
                this.renderDailySummaryCard(payload);
                if (payload.available) {
                    this.app.showToast(
                        payload.regenerated ? 'Итог дня пересчитан' : 'Итог дня сформирован',
                        'success'
                    );
                }
            }
        } catch (error) {
            console.warn('[Nutrition] Daily summary generation failed:', error?.message);
            this.app.showToast('Не удалось сформировать итог дня', 'error');
        } finally {
            this._state.flags.dailySummaryLoading = false;
            const current = container.querySelector('.daily-summary');
            if (current) this.setDailySummaryBusy(current, false);
        }
    },

    /**
     * Swap the daily-summary card for a freshly rendered one in place,
     * so a regenerated recap lands without reloading the page (and
     * without disturbing the carousel or the date the user picked).
     */
    renderDailySummaryCard(payload) {
        const container = this.app.elements.pageContent;
        const section = container.querySelector('.daily-summary');
        if (!section) return;

        const host = document.createElement('div');
        host.innerHTML = Components.dailySummaryCard(payload, this.recapCardOptions());
        const fresh = host.firstElementChild;
        if (fresh) {
            section.replaceWith(fresh);
            this.bindDailySummary();
            this.syncDailySummaryToggles();
        }
    },

    /**
     * Busy state for the card's own triggers: the generate button grows
     * a spinner and its label, the refresh glyph starts spinning. Both
     * are disabled for the duration of the request.
     */
    setDailySummaryBusy(section, busy) {
        const generate = section.querySelector('[data-action="generate-daily-summary"]');
        if (generate) {
            generate.disabled = busy;
            if (busy) {
                generate.dataset.idleHtml = generate.innerHTML;
                generate.innerHTML = `
                    <svg class="animate-spin daily-summary__generate-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Формируем итог...</span>`;
            } else if (generate.dataset.idleHtml) {
                generate.innerHTML = generate.dataset.idleHtml;
                delete generate.dataset.idleHtml;
            }
        }

        const refresh = section.querySelector('[data-action="regenerate-daily-summary"]');
        if (refresh) {
            refresh.disabled = busy;
            refresh.querySelector('svg')?.classList.toggle('animate-spin', busy);
        }
    },

    /** Both recap triggers on the card ask for the same regeneration. */
    bindDailySummary() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('[data-action="generate-daily-summary"]').forEach((btn) => {
            btn.onclick = () => this.generateDailySummary(false);
        });
        container.querySelectorAll('[data-action="regenerate-daily-summary"]').forEach((btn) => {
            btn.onclick = () => {
                if (this._state.cache.dailySummary && this._state.cache.dailySummary.available === true) {
                    this.app.showToast('Анализ за сегодня уже готов! Повторный перерасчет будет доступен завтра.', 'info');
                    return;
                }
                this.generateDailySummary(true);
            };
        });
        container.querySelectorAll('[data-action="toggle-daily-summary"]').forEach((btn) => {
            btn.onclick = () => this.toggleDailySummary(btn);
        });
    },

    /**
     * Expand or collapse the verdict prose in place: only the clamp and the
     * toggle label change, so the card keeps its slot and its handlers. The
     * choice is remembered, so a regeneration or a poll re-render restores
     * it instead of snapping back to the two-line preview.
     */
    toggleDailySummary(button) {
        const section = button.closest('.daily-summary');
        const text = section?.querySelector('.daily-summary__text');
        if (!section || !text) return;

        const collapsed = text.classList.toggle('is-collapsed');
        this._state.flags.dailySummaryExpanded = !collapsed;
        button.setAttribute('aria-expanded', String(!collapsed));
        button.textContent = collapsed ? 'Развернуть ▾' : 'Свернуть ▴';
    },

    /**
     * A verdict that already fits the two-line preview has nothing to
     * expand, so its toggle stays hidden rather than opening to the same
     * text. Runs after every render of the card, regeneration included.
     */
    syncDailySummaryToggles() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('.daily-summary').forEach((section) => {
            const text = section.querySelector('.daily-summary__text');
            const toggle = section.querySelector('.daily-summary__toggle');
            if (!text || !toggle) return;
            if (text.classList.contains('is-collapsed')) {
                // The clamped box is exactly two lines tall, so a taller
                // scroll height means the prose continues past the preview.
                toggle.hidden = text.scrollHeight <= text.clientHeight + 1;
            } else {
                toggle.hidden = false;
            }
        });
    },

    /**
     * Rebuilds the AI Synergy widget in place from the module's current
     * state, then re-binds its controls. The widget is small and rebuilt
     * only on real state changes (period pick, analysis start/finish),
     * never on the meal poll loop, so the in-place swap keeps the rest of
     * the page (carousel + daily summary) untouched.
     */
    renderAiSynergyWidget() {
        const container = this.app.elements.pageContent;
        const existing = container.querySelector('.ai-synergy-widget');
        if (!existing) return;

        const html = Components.aiSynergyWidget({
            period: this._state.aiSynergy.period,
            customStart: this._state.aiSynergy.customRange.start,
            customEnd: this._state.aiSynergy.customRange.end,
            todayISO: this.todayISO(),
            isPremium: !!this.app.state.user?.is_premium,
            isRunning: this._state.aiSynergy.running,
            hasResult: !!this._state.aiSynergy.result,
            result: this._state.aiSynergy.result,
        });

        const host = document.createElement('div');
        host.innerHTML = html.trim();
        const fresh = host.firstElementChild;
        if (fresh) {
            existing.replaceWith(fresh);
            this.bindAiSynergyWidget();
        }
    },

    /**
     * Request payload describing the selected period: either a day count
     * (14 / 30) or an explicit date range for a custom window. Matches the
     * AISynergyRequest schema, so the backend can aggregate exactly what the
     * user picked.
     */
    getAiSynergyRequestData() {
        if (this._state.aiSynergy.period === 'custom') {
            const start = this._state.aiSynergy.customRange.start;
            const end = this._state.aiSynergy.customRange.end;
            // The date inputs enforce bounds; guard against an empty field
            // slipping through so the server never sees a half-range.
            if (start && end) return { start_date: start, end_date: end };
            if (start) return { start_date: start, end_date: start };
            if (end) return { start_date: end, end_date: end };
            return null;
        }
        return { period_days: Number(this._state.aiSynergy.period) };
    },

    /**
     * Resolve the period_type label the backend stores reports under, mirroring
     * `_resolve_period_type` in ai_synergy_service.py so the saved-report GET
     * returns the row for the period the widget is actually showing.
     */
    getAiSynergyPeriodType() {
        if (this._state.aiSynergy.period === 'custom') {
            const start = this._state.aiSynergy.customRange.start;
            const end = this._state.aiSynergy.customRange.end;
            if (start && end) {
                const spanDays = Math.max(1, (
                    new Date(end + 'T00:00:00Z').getTime() -
                    new Date(start + 'T00:00:00Z').getTime()
                ) / 86400000);
                return spanDays <= 31 ? 'month' : 'custom';
            }
        }
        const periodDays = Number(this._state.aiSynergy.period);
        return periodDays >= 30 ? 'month' : 'week';
    },

    /** Period chip handler: update the model and refresh the shell. */
    async selectAiSynergyPeriod(period) {
        if (this._state.aiSynergy.running) return;
        if (period === 'custom' && this._state.aiSynergy.period !== 'custom') {
            this._state.aiSynergy.customRange = { start: this.todayISO(), end: this.todayISO() };
        }
        this._state.aiSynergy.period = period;
        // A new period is a fresh context: drop any verdict from the previous run.
        this._state.aiSynergy.result = null;
        this.renderAiSynergyWidget();

        // Pull the saved report for the new period so the widget shows a verdict
        // instead of an empty launch button, mirroring the initial-load behaviour.
        await this.loadAiSynergyReport();
        this.renderAiSynergyWidget();
    },

    /** Reads the custom date inputs back into the model. */
    syncAiSynergyCustomRange() {
        const container = this.app.elements.pageContent;
        const widget = container.querySelector('.ai-synergy-widget');
        if (!widget) return;
        const startInput = widget.querySelector('[data-ai-synergy-date="start"]');
        const endInput = widget.querySelector('[data-ai-synergy-date="end"]');
        const start = startInput?.value ?? '';
        const end = endInput?.value ?? '';
        this._state.aiSynergy.customRange = { start, end };

        // Client-side validation: show error if custom range exceeds 90 days
        if (start && end) {
            const startDate = new Date(start + 'T00:00:00Z');
            const endDate = new Date(end + 'T00:00:00Z');
            const diffDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            const isInvalid = diffDays > 90;
            startInput?.classList.toggle('border-red-500', isInvalid);
            endInput?.classList.remove('border-red-500');
        } else {
            startInput?.classList.remove('border-red-500');
            endInput?.classList.remove('border-red-500');
        }
    },

    /** Swaps the widget into the running (spinner) state. */
    setAiSynergyRunning(running) {
        this._state.aiSynergy.running = running;
        this.renderAiSynergyWidget();
    },

    /** Renders the analysis verdict inside the widget after the API answers. */
    setAiSynergyResult(payload) {
        this._state.aiSynergy.result = payload;
        this._state.aiSynergy.running = false;
        this.renderAiSynergyWidget();
    },

    /** Open the full-screen AI Synergy modal. */
    openAiSynergyModal() {
        if (!this._state.aiSynergy.result) return;
        const container = this.app.elements.pageContent;

        // Close any existing modal first
        this.closeAiSynergyModal();

        const html = Components.aiSynergyModal(this._state.aiSynergy.result);
        const host = document.createElement('div');
        host.innerHTML = html.trim();
        const modalEl = host.firstElementChild;
        document.body.appendChild(modalEl);

        this._state.modals.aiSynergyModal = modalEl;

        // Prevent background scroll while modal is open
        document.body.classList.add('overflow-hidden');

        // Focus trap: close on backdrop click or Escape
        const onKeydown = (e) => {
            if (e.key === 'Escape') this.closeAiSynergyModal();
        };
        document.addEventListener('keydown', onKeydown);
        modalEl._onKeydown = onKeydown;

        // Backdrop click handler
        modalEl.addEventListener('click', (e) => {
            if (e.target === modalEl || e.target.classList.contains('ai-synergy-modal__backdrop')) {
                this.closeAiSynergyModal();
            }
        });
    },

    /** Close the full-screen AI Synergy modal. */
    closeAiSynergyModal() {
        if (!this._state.modals.aiSynergyModal) return;

        const onKeydown = this._state.modals.aiSynergyModal._onKeydown;
        if (onKeydown) {
            document.removeEventListener('keydown', onKeydown);
        }

        document.body.classList.remove('overflow-hidden');
        this._state.modals.aiSynergyModal.remove();
        this._state.modals.aiSynergyModal = null;
    },

    /** Re-binds the widget's controls after an in-place re-render. */
    bindAiSynergyWidget() {
        const container = this.app.elements.pageContent;
        const widget = container.querySelector('.ai-synergy-widget');
        if (!widget) return;

        // Period chips: the document-level data-action listener has no case for
        // "ai-synergy-period", so the chip handler lives here. Chips are rebuilt
        // on every render, so they are re-bound each time.
        widget.querySelectorAll('[data-action="ai-synergy-period"]').forEach((btn) => {
            btn.onclick = () => this.selectAiSynergyPeriod(btn.dataset.period);
        });

        // Reflect the live selection on the chips (aria-pressed + active look).
        widget.querySelectorAll('.ai-synergy__chip').forEach((chip) => {
            const active = chip.dataset.period === this._state.aiSynergy.period;
            chip.setAttribute('aria-pressed', String(active));
            chip.classList.toggle('is-active', active);
        });

        // Custom date inputs keep the model in sync as the user edits them so the
        // request always carries the latest window.
        widget.querySelectorAll('[data-ai-synergy-date]').forEach((input) => {
            input.addEventListener('change', () => this.syncAiSynergyCustomRange());
            input.addEventListener('input', () => this.syncAiSynergyCustomRange());
        });

        // The launch button (data-action="launch-ai-synergy") and the modal
        // trigger (data-action="open-ai-synergy-modal") are handled by the
        // document-level delegated listener, so they intentionally stay
        // un-bound here to avoid a double dispatch.
    },

    /**
     * Newest ordering key for a meal. Timestamps arrive as ISO strings,
     * so they must be parsed before comparing (a raw "-" on strings yields NaN
     * and leaves the list in its original order).
     */
    mealTimestamp(meal) {
        const raw = meal?.eaten_at || meal?.updated_at || meal?.created_at;
        if (!raw) return 0;
        const ts = new Date(raw).getTime();
        return Number.isFinite(ts) ? ts : 0;
    },

    formatDateLabel(dateISO) {
        if (dateISO === this.todayISO()) return 'Сегодня';
        return Utils.formatDate(dateISO);
    },

    /** Human label for the date header: it names the whole selected period. */
    periodLabel() {
        if (this._state.ui.selectedPeriod === 'day') {
            return this.formatDateLabel(this._state.ui.selectedDate);
        }
        if (this._state.ui.selectedPeriod === 'month') {
            return this.formatMonthYear(this._state.ui.selectedDate);
        }
        // Week and custom both name the exact window they load, so the header
        // and the caption under the ring can never disagree.
        const { start, end } = this.periodRange();
        return start === end
            ? this.formatDayMonthISO(start)
            : `${this.formatDayMonthISO(start)} — ${this.formatDayMonthISO(end)}`;
    },

    /** One caption line under the ring: the covered range and how full it is. */
    periodCaption(periodData) {
        if (this._state.ui.selectedPeriod === 'day') return { range: 'День', coverage: '' };

        const days = Number(periodData?.days) || 0;
        const activeDays = Number(periodData?.active_days) || 0;
        const coverage = days ? `${activeDays}/${days} дн.` : (activeDays ? `${activeDays} дн.` : '');

        if (!periodData) {
            return this._state.ui.selectedPeriod === 'custom'
                ? { range: 'Диапазон: нет данных', coverage: '' }
                : { range: 'Нет данных', coverage: '' };
        }

        const start = this.formatDayMonthISO(periodData.start_date);
        const end = this.formatDayMonthISO(periodData.end_date);
        const range = start === end ? start : `${start} — ${end}`;
        return { range, coverage };
    },

    renderDateNav(fromCache = false) {
        // The custom period is defined by its own range, so there is no
        // neighbouring window to step into.
        const showArrows = this._state.ui.selectedPeriod !== 'custom';
        const canGoNext = this.canStepForward();

        const arrow = (direction) => {
            const isNext = direction === 'next';
            const disabled = isNext && !canGoNext;
            const icon = isNext
                ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>';
            const label = isNext ? 'Следующий период' : 'Предыдущий период';
            return `
                <button id="date-${direction}" data-action="date-${direction}" aria-label="${label}" ${disabled ? 'disabled' : ''}
                        class="btn-press w-9 h-9 rounded-xl glass flex items-center justify-center text-surface-700 dark:text-surface-300 shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : ''}">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
                </button>
            `;
        };

        const spacer = '<span class="w-9 shrink-0"></span>';

        return `
            <div class="flex items-center justify-between gap-2" id="date-nav">
                ${showArrows ? arrow('prev') : spacer}
                <button type="button" id="date-picker-trigger" data-action="open-period-sheet"
                        class="btn-press flex flex-col items-center min-w-0 px-1" aria-label="Выбрать дату или диапазон">
                    <span class="text-lg font-bold text-surface-900 dark:text-zinc-100 truncate max-w-[62vw]">${this.periodLabel()}</span>
                    <span class="text-[11px] text-amber-500" id="date-offline-hint" ${fromCache ? '' : 'hidden'}>Оффлайн</span>
                </button>
                ${showArrows ? arrow('next') : spacer}
            </div>
        `;
    },

    renderPeriodTabs() {
        return Components.periodTabs(PERIOD_TABS.map((tab) => ({
            ...tab,
            active: this._state.ui.selectedPeriod === tab.value,
        })));
    },

    /**
     * One dashboard slide for the selected period: the Mercedes ring plus a
     * caption under it naming the window the ring covers and how many of its days
     * carry meals. The caption box sizes itself from the two lines (see
     * .nutrition-ring__caption), so each line keeps its own line-height instead of
     * sharing one fixed line box that let them overlap.
     */
    renderNutritionSlide(summary, targets, qualityScore, caption) {
        const range = caption?.range || '';
        const coverage = caption?.coverage || '';
        return `
            ${Components.mercedesComboRing(summary, targets, qualityScore)}
            <div class="nutrition-ring__caption text-center text-surface-400 dark:text-surface-500">
                ${range ? `<div class="nutrition-ring__caption-range">${range}</div>` : ''}
                ${coverage ? `<div class="nutrition-ring__caption-coverage">${coverage}</div>` : ''}
            </div>
        `;
    },

    /**
     * Period figures: the per-day averages the payload already returns, plus
     * the mean AI quality across the days that actually carry meals. Missing
     * payload means the ring falls back to zeros instead of silently rendering
     * another period's numbers.
     */
    periodAverage(periodData) {
        if (!periodData) {
            return { summary: { calories: 0, protein: 0, fat: 0, carbs: 0 }, qualityScore: null, hasData: false };
        }

        const series = Array.isArray(periodData.series) ? periodData.series : [];
        const scores = series
            .filter(day => Number(day.meals_count) > 0)
            .map(day => Utils.computeQualityScore({
                calories: day.calories,
                protein: day.protein_g,
                fat: day.fat_g,
                carbs: day.carbs_g,
            }))
            .filter(score => score !== null && Number.isFinite(score));

        return {
            summary: {
                calories: Number(periodData.calories) || 0,
                protein: Number(periodData.protein) || 0,
                fat: Number(periodData.fat) || 0,
                carbs: Number(periodData.carbs) || 0,
            },
            qualityScore: scores.length
                ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
                : null,
            hasData: series.length > 0,
        };
    },

    /**
     * Period switcher. The custom tab opens the range sheet instead of
     * switching straight away, since it still needs a range to be useful -
     * tapping it again reopens the sheet so the range stays editable.
     */
    async setPeriod(period) {
        if (!PERIODS.includes(period)) return;
        if (period === 'custom') {
            this.openPeriodSheet();
            return;
        }
        if (period === this._state.ui.selectedPeriod) return;
        this._state.ui.selectedPeriod = period;
        await this.render(this.app.elements.pageContent, this.app);
    },

    /** Arrow navigation: one day, one week or one month depending on period. */
    async stepPeriod(delta) {
        const next = this.stepAnchor(delta);
        if (!next) return;
        this._state.ui.selectedDate = next;
        await this.render(this.app.elements.pageContent, this.app);
    },

/**
     * Period picker sheet. Only the single day needs one date input; every wider
     * period edits a range, so the sheet always exposes the start and the end.
     */
    openPeriodSheet() {
        if (this._state.modals.period || this._state.modals.periodClosing) return;

        const today = this.todayISO();
        const { start, end } = this.periodRange();
        const isRange = this._state.ui.selectedPeriod !== 'day';

        this._state.modals.period = new PeriodSheet(this, { today, start, end, isRange });
        this._state.modals.period.open();
        this._state.modals.periodClosing = this._state.modals.period.modalEl;
    },

closePeriodSheet() {
        if (this._state.modals.period) {
            this._state.modals.period.close();
            this._state.modals.period = null;
        }
        if (this._state.modals.periodClosing) {
            this._state.modals.periodClosing = null;
        }
    },

    bindPeriodSheetEvents(state) {
        // Now handled by PeriodSheet class
    },

/** Quick ranges offered by the custom period sheet. */
    presetRange(preset, today) {
        if (preset === 'today') return { start: today, end: today };
        if (preset === 'week') return { start: this.startOfWeek(today), end: today };
        if (preset === '30') return { start: this.shiftDate(today, -29), end: today };
        return null;
    },

    /**
     * Build the complete page HTML structure.
     */
    buildPageHtml({ fromCache, dashboard, pendingSorted, synergyStackSlot, sortedMeals, cardOptions, failedItems, totalMeals }) {
        const carouselHtml = this.renderCarouselHtml({ pendingSorted, synergyStackSlot, sortedMeals, cardOptions, totalMeals });
        const pendingBannerHtml = pendingSorted.length > 0
            ? `
            <div class="shrink-0 mb-1">
                <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    Ожидают синхронизации: ${pendingSorted.length}
                </span>
            </div>
            `
            : '';

        const failedItemsHtml = failedItems.length > 0
            ? `
            <div class="viewport-content px-4 pb-2 -mx-4" id="failed-items-section">
                <div class="glass rounded-xl p-3 mb-2 border border-red-500/20">
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wider">Ошибка синхронизации</h3>
                        <button id="clear-failed" class="text-xs text-red-500 hover:text-red-400">Очистить все</button>
                    </div>
                    ${failedItems.map((item) => Components.failedSyncItem(item)).join('')}
                    <button id="retry-failed" class="w-full py-2 mt-1 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl">Повторить всё</button>
                </div>
            </div>
            `
            : '';

        return `
            <div class="single-viewport px-4 pt-4 pb-20">
                <!-- HEADER -->
                <div class="viewport-header p-1 pt-0 pb-2">
                    ${this.renderDateNav(fromCache)}

                    <!-- Period dashboard: day, 7 days, month or custom range -->
                    <div class="mt-2">${dashboard}</div>
                </div>

                <!-- PENDING SYNC BANNER -->
                ${pendingBannerHtml}

                ${carouselHtml}

                ${failedItemsHtml}
            </div>
        `;
    },

    /**
     * Render just the carousel HTML for targeted updates.
     */
    renderCarouselHtml({ pendingSorted, synergyStackSlot, sortedMeals, cardOptions, totalMeals }) {
        return `
            <div class="meal-carousel" id="meal-carousel">
                ${synergyStackSlot}
                ${Components.addMealActionCard()}
                ${pendingSorted.map((meal) => this._mealCard.render(meal, cardOptions)).join('')}
                ${sortedMeals.map((meal) => this._mealCard.render(meal, cardOptions)).join('')}
                ${totalMeals === 0 ? Components.mealCarouselEmptyState() : ''}
            </div>
        `;
    },

    /**
     * Update the carousel in place without a full page re-render.
     * Used by poll updates (meal-analysis completion, sync events).
     */
    async updateCarouselInPlace() {
        const container = this.app.elements.pageContent;
        if (!container) return;

        // Save current scroll position
        const carousel = container.querySelector('#meal-carousel');
        const previousCarouselLeft = carousel?.scrollLeft ?? 0;

        // Fetch only the data needed for the carousel
        const loaded = await this.loadData();
        const { serverMeals, pendingMeals, failedItems } = loaded;

        const user = this.app.state.user || {};
        const sortedMeals = serverMeals
            .slice()
            .sort((a, b) => this.mealTimestamp(b) - this.mealTimestamp(a));

        const pendingSorted = pendingMeals
            .slice()
            .sort((a, b) => this.mealTimestamp(b) - this.mealTimestamp(a));

        // Update meals cache
        this._state.cache.meals = new Map();
        for (const meal of sortedMeals) {
            if (meal.id != null) this._state.cache.meals.set(String(meal.id), meal);
        }
        for (const meal of pendingSorted) {
            if (meal.id != null) this._state.cache.meals.set(String(meal.id), meal);
        }

        const totalMeals = sortedMeals.length + pendingSorted.length;
        const showDate = this._state.ui.selectedPeriod !== 'day';
        const cardOptions = { showDate };

        // Build synergy stack slot (day view only)
        let synergyStackSlot = '';
        if (this._state.ui.selectedPeriod === 'day') {
            // Get latest daily summary for the recap card
            const dailySummary = this._state.cache.dailySummary;
            const dailySummaryHtml = dailySummary
                ? Components.dailySummaryCard(dailySummary, this.recapCardOptions())
                : '';
            synergyStackSlot = `<div class="ai-synergy-stack-slot snap-center shrink-0">
                       ${dailySummaryHtml}
                       ${Components.aiSynergyWidget({
                           period: this._state.aiSynergy.period,
                           customStart: this._state.aiSynergy.customRange.start,
                           customEnd: this._state.aiSynergy.customRange.end,
                           todayISO: this.todayISO(),
                           isPremium: !!user?.is_premium,
                           isRunning: this._state.aiSynergy.running,
                           hasResult: !!this._state.aiSynergy.result,
                           result: this._state.aiSynergy.result,
                       })}
                   </div>`;
        }

        // Render new carousel HTML
        const carouselHtml = this.renderCarouselHtml({ pendingSorted, synergyStackSlot, sortedMeals, cardOptions, totalMeals });

        // Replace carousel in place
        const carouselContainer = container.querySelector('#meal-carousel');
        if (carouselContainer) {
            carouselContainer.outerHTML = carouselHtml;
        }

        // Update pending sync banner
        const pendingBannerContainer = container.querySelector('.shrink-0.mb-1');
        const newPendingBannerHtml = pendingSorted.length > 0
            ? `
            <div class="shrink-0 mb-1">
                <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    Ожидают синхронизации: ${pendingSorted.length}
                </span>
            </div>
            `
            : '';

        if (pendingBannerContainer) {
            if (pendingSorted.length > 0) {
                pendingBannerContainer.outerHTML = newPendingBannerHtml;
            } else {
                pendingBannerContainer.remove();
            }
        } else if (pendingSorted.length > 0) {
            // Insert after header
            const header = container.querySelector('.viewport-header');
            if (header) {
                header.insertAdjacentHTML('afterend', newPendingBannerHtml);
            }
        }

        // Update failed items section
        const failedSection = container.querySelector('#failed-items-section');
        const newFailedItemsHtml = failedItems.length > 0
            ? `
            <div class="viewport-content px-4 pb-2 -mx-4" id="failed-items-section">
                <div class="glass rounded-xl p-3 mb-2 border border-red-500/20">
                    <div class="flex items-center justify-between mb-2">
                        <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wider">Ошибка синхронизации</h3>
                        <button id="clear-failed" class="text-xs text-red-500 hover:text-red-400">Очистить все</button>
                    </div>
                    ${failedItems.map((item) => Components.failedSyncItem(item)).join('')}
                    <button id="retry-failed" class="w-full py-2 mt-1 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl">Повторить всё</button>
                </div>
            </div>
            `
            : '';

        if (failedSection) {
            if (failedItems.length > 0) {
                failedSection.outerHTML = newFailedItemsHtml;
            } else {
                failedSection.remove();
            }
        } else if (failedItems.length > 0) {
            // Insert before end of viewport
            const viewport = container.querySelector('.single-viewport');
            if (viewport) {
                viewport.insertAdjacentHTML('beforeend', newFailedItemsHtml);
            }
        }

        // Re-bind event handlers for new elements
        this.bindMealActions();
        this.bindFailedItems();
        this.bindAddMealModal();
        this.bindDailySummary();
        this.syncDailySummaryToggles();
        this.bindAiSynergyWidget();

        // Restore scroll position
        this.settleCarouselScroll(previousCarouselLeft);
    },

    async render(container, app, dateOverride = null) {
        this.app = app;
        if (dateOverride) {
            this._state.ui.selectedDate = dateOverride;
        }
        if (!this._state.ui.selectedDate) {
            this._state.ui.selectedDate = this.todayISO();
        }
        if (!PERIODS.includes(this._state.ui.selectedPeriod)) {
            this._state.ui.selectedPeriod = 'day';
        }

        // Close any open modal before re-rendering
        this.closeNewMealModal();
        this.closePeriodSheet();
        this.closeEditMealModal();

        // The carousel is rebuilt from scratch below, so the place the user
        // scrolled to has to be read before the first innerHTML swap wipes it.
        const previousCarouselLeft = container.querySelector('#meal-carousel')?.scrollLeft ?? null;

        container.innerHTML = Components.loadingSpinner();

        let serverMeals = [];
        let pendingMeals = [];

        try {
            // The period summary is only needed outside the day view, and the day
            // recap only inside it; all four requests fly in parallel.
            const periodDataPromise = this.loadPeriodData();
            const dailySummaryPromise = this.loadDailySummary();
            const synergyReportPromise = (this._state.ui.selectedPeriod === 'day'
                && !this._state.aiSynergy.running)
                ? this.loadAiSynergyReport()
                : Promise.resolve(null);
            const loadDataPromise = this.loadData();
            const [loaded, periodData, dailySummary] = await Promise.all([
                loadDataPromise,
                periodDataPromise,
                dailySummaryPromise,
            ]);
            await synergyReportPromise;
            const { summary, targets: apiTargets, failedItems, fromCache } = loaded;
            serverMeals = loaded.serverMeals;
            pendingMeals = loaded.pendingMeals;

            const user = this.app.state.user || {};
            const resolveTarget = (apiValue, userValue, fallback) => {
                if (Number.isFinite(Number(apiValue)) && Number(apiValue) > 0) return Number(apiValue);
                if (Number.isFinite(Number(userValue)) && Number(userValue) > 0) return Number(userValue);
                return fallback;
            };

const targets = {
                target_calories: resolveTarget(apiTargets?.target_calories, user.target_calories, DEFAULT_TARGETS.CALORIES),
                target_protein: resolveTarget(apiTargets?.target_protein, user.target_protein_g, DEFAULT_TARGETS.PROTEIN),
                target_fat: resolveTarget(apiTargets?.target_fat, user.target_fat_g, DEFAULT_TARGETS.FAT),
                target_carbs: resolveTarget(apiTargets?.target_carbs, user.target_carbs_g, DEFAULT_TARGETS.CARBS),
            };

            // LIFO: the most recent meal is the first tile after the action card.
            const sortedMeals = serverMeals
                .slice()
                .sort((a, b) => this.mealTimestamp(b) - this.mealTimestamp(a));

            const pendingSorted = pendingMeals
                .slice()
                .sort((a, b) => this.mealTimestamp(b) - this.mealTimestamp(a));

            // Index every meal with an id so the edit modal can look it up
            // without a dedicated single-meal GET endpoint.
            this._state.cache.meals = new Map();
            for (const meal of sortedMeals) {
                if (meal.id != null) this._state.cache.meals.set(String(meal.id), meal);
            }
            for (const meal of pendingSorted) {
                if (meal.id != null) this._state.cache.meals.set(String(meal.id), meal);
            }

            const totalMeals = sortedMeals.length + pendingSorted.length;
            // Wider periods need the eaten date on every card, otherwise tiles
            // from different days are indistinguishable in the carousel.
            const showDate = this._state.ui.selectedPeriod !== 'day';

            const cardOptions = { showDate };

            const period = this.periodAverage(periodData);
            // The day ring reads the day totals; wider periods read the per-day
            // average, which keeps them comparable with the same daily targets.
            // A missing period payload therefore falls back to zeros rather than
            // re-labelling the day's totals as a week or a month.
            const isDayPeriod = this._state.ui.selectedPeriod === 'day';
            const ringSummary = isDayPeriod ? summary : period.summary;
            const qualityScore = isDayPeriod
                ? (totalMeals > 0 ? Utils.computeQualityScore(summary) : null)
                : period.qualityScore;
            const ringTargets = periodData
                ? {
                      target_calories: resolveTarget(periodData.target_calories, user.target_calories, targets.target_calories),
                      target_protein: resolveTarget(periodData.target_protein_g, user.target_protein_g, targets.target_protein),
                      target_fat: resolveTarget(periodData.target_fat_g, user.target_fat_g, targets.target_fat),
                      target_carbs: resolveTarget(periodData.target_carbs_g, user.target_carbs_g, targets.target_carbs),
                  }
                : targets;

            const dashboard = Components.nutritionDashboardCard({
                title: 'Питание',
                tabs: this.renderPeriodTabs(),
                body: this.renderNutritionSlide(ringSummary, ringTargets, qualityScore, this.periodCaption(periodData)),
            });

            // On a user-triggered render (page switch, date step) in the day
            // view, the saved synergy report is awaited alongside the other
            // day-view requests (see synergyReportPromise above) so the verdict
            // is already on screen instead of an empty launch button. A
            // first-time visit or a non-premium user simply shows the launch
            // button - loadAiSynergyReport never throws.

            // The recap card lives inside the carousel as its first snap slot in
            // the day view. Its chip names the concrete day rather than reusing the
            // header label: the recap is a stored record of that date, and the
            // header says only "Сегодня". A finished day also earns the manual
            // generation trigger; a day still being eaten never does. Wider periods
            // have no single day to recap, so the card is left out of the carousel.
            const dailySummaryHtml = (this._state.ui.selectedPeriod === 'day' && dailySummary)
                ? Components.dailySummaryCard(dailySummary, this.recapCardOptions())
                : '';

            // First carousel slot in the day view: the daily recap card
            // stacked directly above the AI Synergy widget. The two blocks
            // flow vertically inside one snap slot, so the recap's
            // collapse/expand simply reflows the synergy block below it -
            // no tab switcher, no swapped panes. Wider periods have no
            // single day to recap and no cross-analysis to show, so the
            // slot is left out of the carousel entirely.
            const synergyStackSlot = (this._state.ui.selectedPeriod === 'day')
                ? `<div class="ai-synergy-stack-slot snap-center shrink-0">
                       ${dailySummaryHtml}
                       ${Components.aiSynergyWidget({
                           period: this._state.aiSynergy.period,
                           customStart: this._state.aiSynergy.customRange.start,
                           customEnd: this._state.aiSynergy.customRange.end,
                           todayISO: this.todayISO(),
                           isPremium: !!user?.is_premium,
                           isRunning: this._state.aiSynergy.running,
                           hasResult: !!this._state.aiSynergy.result,
                           result: this._state.aiSynergy.result,
                       })}
                   </div>`
                : '';

            // Build the page HTML (header, carousel, failed items)
            const pageHtml = this.buildPageHtml({
                fromCache,
                dashboard,
                pendingSorted,
                synergyStackSlot,
                sortedMeals,
                cardOptions,
                failedItems,
                totalMeals,
            });

            container.innerHTML = pageHtml;

            this.bindDateNav();
            this.bindPeriodTabs();
            this.bindAddMealModal();
            this.bindMealActions();
            this.bindFailedItems();
            this.bindDailySummary();
            this.syncDailySummaryToggles();
            this.bindAiSynergyWidget();

            // Every poll tick rebuilds the carousel too, so the position is put
            // back here instead of snapping to the add tile every 3 seconds.
            this.settleCarouselScroll(previousCarouselLeft);

        } catch (error) {
            console.error('[Nutrition] Render error:', error);
            // Extract technical error details for debugging
            let errorMessage = 'Ошибка загрузки данных';
            if (error?.status) {
                errorMessage += ` (HTTP ${error.status})`;
            }
            if (error?.message) {
                errorMessage += `: ${error.message}`;
            }
            if (error?.data?.detail) {
                const detail = typeof error.data.detail === 'string' ? error.data.detail : JSON.stringify(error.data.detail);
                errorMessage += ` — ${detail}`;
            }
            // Log full error details for mobile Safari debugging
            console.error('[Nutrition] Detailed error for debugging:', {
                status: error?.status,
                message: error?.message,
                data: error?.data,
                isNetworkError: error?.isNetworkError,
                offlineQueued: error?.offlineQueued,
                stack: error?.stack,
                timestamp: new Date().toISOString()
            });
            container.innerHTML = Components.errorState(errorMessage);
        }
    },
bindDateNav() {
        const container = this.app.elements.pageContent;
        const prev = container.querySelector('#date-prev');
        const next = container.querySelector('#date-next');
        const trigger = container.querySelector('#date-picker-trigger');

        if (prev) {
            prev.onclick = () => this.stepPeriod(-1);
        }
        if (next) {
            next.onclick = () => this.stepPeriod(1);
        }
        if (trigger) {
            trigger.onclick = () => this.openPeriodSheet();
        }
    },

    bindPeriodTabs() {
        const container = this.app.elements.pageContent;
        container.querySelectorAll('[data-action="set-period"]').forEach((btn) => {
            btn.onclick = () => this.setPeriod(btn.dataset.period);
        });
    },

    bindAddMealModal() {
        const container = this.app.elements.pageContent;

        // The action tile lives inside the carousel, so bind every match.
        container.querySelectorAll('[data-action="open-add-meal-modal"]').forEach((btn) => {
            btn.onclick = () => this.openNewMealModal();
        });
    },

openNewMealModal() {
        if (this._state.modals.newMeal || this._state.modals.newMealClosing) return;

        this._state.modals.newMeal = new NewMealSheet(this);
        this._state.modals.newMeal.open();
        this._state.modals.newMealClosing = this._state.modals.newMeal.modalEl;
    },

    closeNewMealModal() {
        if (this._state.modals.newMeal) {
            this._state.modals.newMeal.close();
            this._state.modals.newMeal = null;
        }
        if (this._state.modals.newMealClosing) {
            this._state.modals.newMealClosing = null;
        }
    },

bindNewMealModalEvents(modalEl) {
        // Now handled by NewMealSheet class
    },

    handleNewMealFileSelect(file, modalEl, state) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.app.showToast('Выберите изображение', 'error');
            return;
        }

        state.selectedFile = file;

        const previewContainer = modalEl.querySelector('#new-meal-preview-container');
        const preview = modalEl.querySelector('#new-meal-img');
        const sourceBtns = modalEl.querySelector('#new-meal-source-btns');

        // Revoke the previous preview so re-picking a photo does not leak.
        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
        }
        state.previewUrl = URL.createObjectURL(file);

        preview.src = state.previewUrl;
        previewContainer.classList.remove('hidden');
        sourceBtns.classList.add('hidden');

        this.updateNewMealSubmitState(modalEl, state);
    },

    clearNewMealImage(modalEl, state) {
        const previewContainer = modalEl.querySelector('#new-meal-preview-container');
        const preview = modalEl.querySelector('#new-meal-img');
        const sourceBtns = modalEl.querySelector('#new-meal-source-btns');
        const photoInput = modalEl.querySelector('#new-meal-photo-input');

        if (state.previewUrl) {
            URL.revokeObjectURL(state.previewUrl);
            state.previewUrl = null;
        }
        preview.removeAttribute('src');
        previewContainer.classList.add('hidden');
        sourceBtns.classList.remove('hidden');
        photoInput.value = '';
        state.selectedFile = null;

        this.updateNewMealSubmitState(modalEl, state);
    },

    updateNewMealSubmitState(modalEl, state) {
        const submitBtn = modalEl.querySelector('#new-meal-submit');
        if (submitBtn) {
            const hasFile = !!state.selectedFile;
            const hasMealType = !!state.selectedMealType;
            submitBtn.disabled = !(hasFile && hasMealType);
        }
    },

    async handleNewMealSubmit(modalEl, state) {
        // Prevent double-submit
        if (this._state.flags.mealSubmitInFlight) return;
        this._state.flags.mealSubmitInFlight = true;

        try {
            if (!state.selectedFile || !state.selectedMealType) return;

            // Disable submit button immediately - before any async work
            const submitBtn = modalEl.querySelector('#new-meal-submit');
            submitBtn.disabled = true;
            submitBtn.innerHTML = `
                <svg class="animate-spin w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span class="text-sm font-semibold">Подготовка...</span>
            `;

            const isOffline = !window.App?.state?.isOnline || !navigator.onLine;
            if (isOffline) {
                const notesInput = modalEl.querySelector('#new-meal-notes');
                const notes = notesInput ? notesInput.value.trim() || null : null;
                await Camera.queueOfflineMeal(state.selectedFile, notes, state.selectedMealType);
                this.app.showToast('Сохранено локально. Отправим при появлении связи', 'info');
                this.closeNewMealModal();
                this._state.flags.scrollTargetMealId = null;
                await this.render(this.app.elements.pageContent, this.app, this._state.ui.selectedDate);
                return;
            }

            // Validate file before sending
            if (!state.selectedFile.type.startsWith('image/')) {
                this.app.showToast('Выберите изображение', 'error');
                return;
            }

            // Show the blurred loading overlay synchronously to
            // eliminate UI jumping and lock the modal during the upload.
            const overlayState = Camera.showLoadingOverlay(modalEl);

            const notesInput = modalEl.querySelector('#new-meal-notes');
            const notes = notesInput ? notesInput.value.trim() || null : null;
            const token = this.app.state.tokens.access;

            const formData = new FormData();
            formData.append('file', state.selectedFile, state.selectedFile.name || 'photo.webp');
            formData.append('meal_type', state.selectedMealType);
            if (notes) formData.append('notes', notes);
            // The instant of the shot plus the device's offset: the server buckets
            // meals into the user's local days, and it can only do that if it is
            // told where local midnight is.
            for (const [key, value] of Object.entries(Camera.mealTimeFields())) {
                formData.append(key, value);
            }

            // The analysis takes tens of seconds, so the carousel gets its slot
            // before the request leaves; the id it scrolls to is only known once
            // the server (or the local queue) has answered.
            let newMealId = null;
            let uploadedOnline = false;
            this.showAnalyzingSkeleton();

            try {
                const response = await API.post('/nutrition/photos', formData, token, true);
                newMealId = response?.meal_id ?? null;
                uploadedOnline = Boolean(newMealId);
                this.app.showToast('Фото загружено, идёт анализ', 'success');
                // The sheet and its overlay stay up: the 201 only means the
                // background analysis started, not that it finished.
            } catch (error) {
                if (error?.isNetworkError || error?.offlineQueued) {
                    try {
                        newMealId = await Camera.queueOfflineMeal(state.selectedFile, notes, state.selectedMealType);
                        this.app.showToast('Нет связи. Фото сохранено локально и будет загружено при появлении связи', 'info');
                    } catch (qerr) {
                        console.error('[Nutrition] Offline queue failed:', qerr);
                        this.app.showToast(qerr?.message || 'Не удалось сохранить оффлайн', 'error');
                        newMealId = null;
                        uploadedOnline = false;
                    }
                } else {
                    console.error('[Nutrition] Upload error:', error);
                    this.app.showToast(error.data?.detail || error.message || 'Ошибка загрузки', 'error');
                }
            } finally {
                this.removeAnalyzingSkeleton();
                submitBtn.disabled = false;
                submitBtn.innerHTML = `
                    <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                    <span class="text-sm font-semibold">Отправить / Анализировать</span>
                `;
            }

            // The overlay stays up through the whole analysis: the meal status
            // is polled until the background task lands a terminal status, and
            // only then does the checkmark appear. An offline-queued meal has
            // nothing to poll yet - it syncs later - and a failed upload leaves
            // nothing to wait for.
            if (uploadedOnline) {
                const outcome = await Camera.pollMealAnalysisStatus(newMealId, token);
                if (outcome === 'completed') {
                    Camera.markLoadingComplete(overlayState.overlay);
                    await new Promise((resolve) => setTimeout(resolve, 500));
                } else {
                    Camera.reportAnalysisOutcome(outcome, this.app);
                }
            }

            Camera.hideLoadingOverlay(overlayState);
            this.closeNewMealModal();

            // The reload brings the real card (pending, then analysed); the carousel only
            // knows its id once the render that produced it is done, so the target
            // is handed over instead of scrolled to here.
            this._state.flags.scrollTargetMealId = newMealId;
            await this.render(this.app.elements.pageContent, this.app, this._state.ui.selectedDate);
        } catch (err) {
            console.error('[Nutrition] handleNewMealSubmit error:', err);
            try { this.removeAnalyzingSkeleton(); } catch (_) {}
            const submitBtn = modalEl && modalEl.querySelector('#new-meal-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span class="text-sm font-semibold">Создать</span>';
            }
            try { Camera.hideLoadingOverlay(modalEl); } catch (_) {}
            this.app.showToast(err?.message || 'Не удалось сохранить блюдо', 'error');
        } finally {
            this._state.flags.mealSubmitInFlight = false;
        }
    },

    /**
     * Claim a carousel slot for the meal being uploaded. The tile is inserted
     * after the add tile and scrolled to, so the wait happens on a card instead
     * of on a screen that does not react.
     */
    showAnalyzingSkeleton() {
        const carousel = this.app.elements.pageContent.querySelector('#meal-carousel');
        if (!carousel || carousel.querySelector('[data-meal-skeleton]')) return;

        const holder = document.createElement('div');
        holder.innerHTML = Components.mealCardAnalyzingSkeleton();
        const slot = holder.firstElementChild;
        if (!slot) return;

        // The add-meal action tile is always the first real slot (or the second
        // in the day view, right after the daily-summary slot); the new meal lands
        // immediately after it so it never appears between the recap and the
        // action card.
        const actionTile = carousel.querySelector('.meal-action-slot');
        carousel.insertBefore(slot, actionTile ? actionTile.nextElementSibling : (carousel.firstElementChild || null));
        this.scrollCarouselToSlot(slot);
    },

    /**
     * Drop the optimistic tile. It only lives until the next render, which
     * replaces the whole carousel, but an upload that failed without a reload
     * would otherwise leave a spinner behind forever.
     */
    removeAnalyzingSkeleton() {
        this.app.elements.pageContent.querySelector('#meal-carousel [data-meal-skeleton]')?.remove();
    },

    /** Centre a carousel slot without disturbing the rest of the layout. */
    scrollCarouselToSlot(slot, behavior = 'smooth') {
        const carousel = slot?.closest('.meal-carousel');
        if (!slot || !carousel) return;

        // Rect deltas rather than offsetLeft: the carousel is not a positioned
        // ancestor, so offsetLeft would be measured against a further ancestor.
        const carouselBox = carousel.getBoundingClientRect();
        const slotBox = slot.getBoundingClientRect();
        const centered = carousel.scrollLeft
            + (slotBox.left - carouselBox.left)
            - (carousel.clientWidth - slotBox.width) / 2;
        const max = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        const target = Math.max(0, Math.min(centered, max));

        if (typeof carousel.scrollTo === 'function') {
            carousel.scrollTo({ left: target, behavior });
        } else {
            carousel.scrollLeft = target;
        }
    },

    /**
     * Put the carousel where it belongs after a re-render.
     *
     * The carousel element is recreated by every render - including each poll
     * tick - so without this the user's place is lost every few seconds while a
     * meal is being analysed. A pending target (the meal just added, whose id
     * only the server knows) wins over the remembered offset and is consumed on
     * use, so it scrolls exactly once.
     */
    settleCarouselScroll(previousLeft) {
        const carousel = this.app.elements.pageContent.querySelector('#meal-carousel');
        if (!carousel) return;

        const targetId = this._state.flags.scrollTargetMealId;
        this._state.flags.scrollTargetMealId = null;
        if (targetId !== null && targetId !== undefined) {
            const slot = carousel.querySelector(`.meal-card-slot[data-meal-id="${targetId}"]`);
            if (slot) {
                this.scrollCarouselToSlot(slot);
                return;
            }
        }

        if (previousLeft === null || previousLeft === undefined || previousLeft === 0) {
            const addSlot = carousel.querySelector('.meal-action-slot');
            if (addSlot) {
                this.scrollCarouselToSlot(addSlot, 'instant');
                return;
            }
        }

        const max = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        carousel.scrollLeft = Math.max(0, Math.min(previousLeft || 0, max));
    },

bindFailedItems() {
        const container = this.app.elements.pageContent;

        // Individual retry buttons for each failed sync item
        container.querySelectorAll('[data-action="retry-failed-sync-item"]').forEach((btn) => {
            btn.onclick = async () => {
                const itemId = btn.dataset.syncItemId;
                if (!itemId) return;
                btn.disabled = true;
                btn.innerHTML = `<svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                try {
                    // Reset the item status to PENDING so it gets picked up by processQueue
                    await DB.updateSyncQueue(Number(itemId), {
                        status: DB.SYNC_STATUS.PENDING,
                        retryCount: 0,
                        error: null,
                        updatedAt: Date.now(),
                    });
                    await SyncEngine.processQueue();
                } catch (e) {
                    console.error('[Nutrition] Retry failed sync item:', e);
                }
                await this.updateCarouselInPlace();
            };
        });

        // Individual delete buttons for each failed sync item
        container.querySelectorAll('[data-action="delete-failed-sync-item"]').forEach((btn) => {
            btn.onclick = async () => {
                const itemId = btn.dataset.syncItemId;
                if (!itemId) return;
                try {
                    await DB.deleteSyncQueue(Number(itemId));
                    // Also delete the local meal if it exists
                    const item = await DB.get('sync_queue', Number(itemId));
                    if (item?.tempId) {
                        await DB.deleteMeal(item.tempId);
                    }
                } catch (e) {
                    console.error('[Nutrition] Delete failed sync item:', e);
                }
                await this.updateCarouselInPlace();
            };
        });

        const retryBtn = container.querySelector('#retry-failed');
        if (retryBtn) {
            retryBtn.onclick = async () => {
                retryBtn.disabled = true;
                retryBtn.textContent = 'Синхронизация...';
                try {
                    await SyncEngine.processQueue();
                } catch (e) {
                    console.error('[Nutrition] Retry failed:', e);
                }
                await this.updateCarouselInPlace();
            };
        }

        const clearBtn = container.querySelector('#clear-failed');
        if (clearBtn) {
            clearBtn.onclick = async () => {
                await SyncEngine.clearQueue();
                await this.updateCarouselInPlace();
            };
        }
    },

    /**
     * Expand or collapse one composition list.
     *
     * The list attribute is the whole state: the CSS rules reveal the overflow
     * items and pick the control's wording, so no card content is rebuilt and
     * the carousel keeps its scroll position.
     */
    setCompositionExpanded(list, expanded) {
        if (!list) return;
        list.dataset.expanded = String(expanded);
        list.querySelectorAll('[data-composition-toggle]').forEach((toggle) => {
            toggle.setAttribute('aria-expanded', String(expanded));
        });
    },

    /**
     * Edit/delete handlers for every card action button. The meal card is one
     * monolithic block, so both handlers keep the default action intact and
     * only stop the click from bubbling any further.
     */
    bindMealActions() {
        const container = this.app.elements.pageContent;

        // Every render rebuilds the cards, the poll loop included, so an open
        // composition would snap shut while the user is reading it. The open
        // meal ids are restored right after the handlers are attached.
        container.querySelectorAll('[data-composition]').forEach((list) => {
            const mealId = list.closest('[data-meal-id]')?.dataset.mealId;
            if (mealId && this._state.flags.expandedCompositions.has(String(mealId))) {
                this.setCompositionExpanded(list, true);
            }
        });

        container.querySelectorAll('[data-composition-toggle]').forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const list = btn.closest('[data-composition]');
                if (!list) return;
                const expanded = list.dataset.expanded !== 'true';
                this.setCompositionExpanded(list, expanded);

                const mealId = list.closest('[data-meal-id]')?.dataset.mealId;
                if (mealId) {
                    const id = String(mealId);
                    if (expanded) this._state.flags.expandedCompositions.add(id);
                    else this._state.flags.expandedCompositions.delete(id);
                }
            };
        });

        container.querySelectorAll('[data-action="edit-meal"]').forEach((btn) => {
            btn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const mealId = btn.dataset.mealId;
                this.openEditMealModal(mealId);
            };
        });

        container.querySelectorAll('[data-action="delete-meal"]').forEach((btn) => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const mealId = btn.dataset.mealId;
                const confirmed = await Components.confirmModal({
                    title: 'Удалить блюдо?',
                    message: 'Это действие нельзя отменить.',
                    confirmText: 'Удалить',
                    confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md',
                    cancelText: 'Отмена',
                });
                if (confirmed) {
                    try {
                        const token = this.app.state.tokens.access;

                        // NEW: Handle temp IDs locally - no network request
                        if (isTempMealId(mealId)) {
                            console.log('[Nutrition] Deleting local temp meal:', mealId);
                            // Delete from meals store
                            await DB.deleteMeal(mealId);
                            // Delete any pending sync queue items for this temp ID
                            const queueItems = await DB.getAll('sync_queue');
                            for (const item of queueItems) {
                                if (item.tempId === mealId && item.status === DB.SYNC_STATUS.PENDING) {
                                    await DB.deleteSyncQueue(item.id);
                                    console.log('[Nutrition] Deleted pending sync queue item for temp meal:', item.id);
                                }
                            }
                            this.app.showToast('Блюдо удалено', 'success');
                            await this.render(this.app.elements.pageContent, this.app, this._state.ui.selectedDate);
                            return;
                        }

                        // Real ID - send to backend
                        await API.deleteMeal(mealId, token);
                        await this.loadData();
                        this.render(this.app.elements.pageContent, this.app);
                    } catch (error) {
                        console.error('[Nutrition] Delete error:', error);
                        this.app.showToast('Ошибка удаления', 'error');
                    }
                }
            };
        });

        container.querySelectorAll('[data-action="retry-analysis"]').forEach((btn) => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const mealId = btn.dataset.mealId;
                await this.retryMealAnalysis(mealId, btn);
            };
        });
    },

    async retryMealAnalysis(mealId, btnEl) {
        // NEW: Temp IDs can't retry analysis - not synced yet
        if (isTempMealId(mealId)) {
            this.app.showToast('Блюдо еще не синхронизировано. Дождитесь загрузки.', 'info');
            return;
        }

        const token = this.app.state.tokens.access;
        const disabled = (v) => {
            if (btnEl) {
                btnEl.disabled = v;
                btnEl.innerHTML = v
                    ? `${Components.mealActionIcon('retry')}<span class="animate-spin border-2 border-white/20 border-t-white rounded-full w-3 h-3"></span>`
                    : Components.mealActionIcon('retry');
            }
        };
        disabled(true);
        try {
            await API.post(`/nutrition/meals/${mealId}/retry-analysis`, {}, token);
            this.app.showToast('Анализ запущен повторно', 'success');
            this.render(this.app.elements.pageContent, this.app);
        } catch (error) {
            if (error?.isNetworkError) {
                this.app.showToast('Нет связи. Попробуйте снова', 'error');
            } else {
                this.app.showToast(error?.data?.detail || 'Ошибка повторного запуска', 'error');
            }
            console.error('[Nutrition] Retry analysis error:', error);
        } finally {
            disabled(false);
        }
    },

/**
     * Edit meal modal: bottom sheet pre-filled with the current meal data,
     * following the same drum-sheet open/close lifecycle as the new-meal sheet.
     */
    openEditMealModal(mealId) {
        if (this._state.modals.editMeal || this._state.modals.editMealClosing) return;

        const meal = this._state.cache.meals.get(String(mealId));
        if (!meal) {
            this.app.showToast('Не удалось загрузить данные блюда', 'error');
            return;
        }

        this._state.modals.editMeal = new EditMealSheet(this, mealId);
        this._state.modals.editMeal.open();
        this._state.modals.editMealClosing = this._state.modals.editMeal.modalEl;
    },

    closeEditMealModal() {
        if (this._state.modals.editMeal) {
            this._state.modals.editMeal.close();
            this._state.modals.editMeal = null;
        }
        if (this._state.modals.editMealClosing) {
            this._state.modals.editMealClosing = null;
        }
    },

    bindEditMealModalEvents(modalEl, state) {
        // Now handled by EditMealSheet class
    },

    /**
     * Gather edited fields, PATCH the meal, then re-render so the card and the
     * daily summary ring/totals both update in place without a page reload.
     * Fields are always sent (null when blank) so clearing one drops the stored
     * value instead of leaving a stale figure.
     */
    async handleEditMealSubmit(modalEl, state) {
        const mealId = state.mealId;
        const token = this.app.state.tokens.access;

        // NEW: Handle temp IDs - update locally only
        if (isTempMealId(mealId)) {
            console.log('[Nutrition] Updating local temp meal:', mealId);
            const meal = await DB.getMeal(mealId);
            if (!meal) {
                this.app.showToast('Блюдо не найдено', 'error');
                return;
            }

            const dishNameInput = modalEl.querySelector('#edit-meal-dish-name');
            const caloriesInput = modalEl.querySelector('#edit-meal-calories');
            const proteinInput = modalEl.querySelector('#edit-meal-protein');
            const fatInput = modalEl.querySelector('#edit-meal-fat');
            const carbsInput = modalEl.querySelector('#edit-meal-carbs');
            const tagsInput = modalEl.querySelector('#edit-meal-tags');
            const notesInput = modalEl.querySelector('#edit-meal-notes');

            const toNumOrNull = (input) => {
                const val = input?.value?.trim();
                return val !== '' ? Number(val) : null;
            };
            const toTextOrNull = (input) => {
                const val = input?.value?.trim();
                return val !== '' ? val : null;
            };

            const tagsRaw = tagsInput?.value?.trim() ?? '';
            const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

            const updatedMeal = {
                ...meal,
                dish_name: toTextOrNull(dishNameInput),
                calories: toNumOrNull(caloriesInput),
                protein_g: toNumOrNull(proteinInput),
                fat_g: toNumOrNull(fatInput),
                carbs_g: toNumOrNull(carbsInput),
                tags: tags.length > 0 ? tags : null,
                notes: toTextOrNull(notesInput),
                updated_at: Date.now(),
            };

            await DB.saveMeal(updatedMeal);
            this._state.cache.meals.set(String(mealId), updatedMeal);
            this.closeEditMealModal();
            this.app.showToast('Блюдо обновлено локально', 'success');
            await this.render(this.app.elements.pageContent, this.app, this._state.ui.selectedDate);
            return;
        }

        // Real ID - send to backend (existing code)
        const dishNameInput = modalEl.querySelector('#edit-meal-dish-name');
        const caloriesInput = modalEl.querySelector('#edit-meal-calories');
        const proteinInput = modalEl.querySelector('#edit-meal-protein');
        const fatInput = modalEl.querySelector('#edit-meal-fat');
        const carbsInput = modalEl.querySelector('#edit-meal-carbs');
        const tagsInput = modalEl.querySelector('#edit-meal-tags');
        const notesInput = modalEl.querySelector('#edit-meal-notes');

        const toNumOrNull = (input) => {
            const val = input?.value?.trim();
            return val !== '' ? Number(val) : null;
        };
        const toTextOrNull = (input) => {
            const val = input?.value?.trim();
            return val !== '' ? val : null;
        };

        const tagsRaw = tagsInput?.value?.trim() ?? '';
        const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

        const updateData = {
            dish_name: toTextOrNull(dishNameInput),
            calories: toNumOrNull(caloriesInput),
            protein_g: toNumOrNull(proteinInput),
            fat_g: toNumOrNull(fatInput),
            carbs_g: toNumOrNull(carbsInput),
            tags: tags.length > 0 ? tags : null,
            notes: toTextOrNull(notesInput),
        };

        const submitBtn = modalEl.querySelector('#edit-meal-submit');
        const originalHTML = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
            <svg class="animate-spin w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <span class="text-sm font-semibold">Сохранение...</span>
        `;

        try {
            const updated = await API.patch(`/nutrition/meals/${mealId}`, updateData, token);
            this._state.cache.meals.set(String(mealId), updated);
            this.closeEditMealModal();
            this.app.showToast('Блюдо обновлено', 'success');
            await this.render(this.app.elements.pageContent, this.app, this._state.ui.selectedDate);
        } catch (error) {
            console.error('[Nutrition] Edit meal error:', error);
            this.app.showToast(error?.data?.detail || 'Ошибка сохранения', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    }
};


