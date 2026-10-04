import { API } from './api.js';
import { DB } from './db.js';
import { SyncEngine } from './sync.js';
import { Components } from './components.js';
import { Utils, clientTimezone } from './utils.js';
import { Camera } from './camera.js';

const PERIODS = ['day', 'week', 'month', 'custom'];

// How long the dashboard watches a pending/processing meal before it gives up.
// The server bounds a single analysis, so a batch that outlives the budget is
// stuck rather than slow: without this the poll loop re-renders the page every
// 3s forever and the cards shimmer until the tab is closed.
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20; // 20 x 3s = 1 minute

// Day / 7 days / month are one-tap presets; the custom period is opened as a
// range sheet by the icon tab.
const PERIOD_TABS = [
    { value: 'day', label: 'День' },
    { value: 'week', label: '7 дней' },
    { value: 'month', label: 'Месяц' },
    { value: 'custom', label: null, icon: true, ariaLabel: 'Свой диапазон' },
];

export const Nutrition = {
    app: null,
    selectedDate: null,
    selectedPeriod: 'day',
    customRange: { start: null, end: null },
    _newMealModalState: null,
    _newMealModalClosing: null,
    _periodSheetState: null,
    _periodSheetClosing: null,
    _editMealModalState: null,
    _editMealModalClosing: null,
    _pollingTimer: null,
    // Recap generation in flight: the manual trigger on the daily-summary
    // card disables itself while the day is being re-read.
    _dailySummaryLoading: false,
    // Meals indexed by id, refreshed every render so the edit modal can pull
    // the current record without a dedicated single-meal endpoint.
    _mealsCache: new Map(),
    // Polling budget of the batch currently on screen: attempts spent so far,
    // whether it already timed out, and whether the render in flight was
    // triggered by the poll loop (a timed-out batch must not renew its own).
    _pollingAttempts: 0,
    _pollingTimedOut: false,
    _pollingRender: false,
    // Meal the carousel has to bring into view on the next render: the id is
    // only known after the upload answered, while the card arrives with it.
    _scrollTargetMealId: null,
    // Meal ids whose composition the user opened. The cards are rebuilt on every
    // render (the poll loop included), so the open state is remembered here
    // instead of being lost each time the carousel is rebuilt.
    _expandedCompositions: new Set(),

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
        const anchor = this.selectedDate && this.selectedDate <= today ? this.selectedDate : today;

        if (this.selectedPeriod === 'week') {
            const start = this.startOfWeek(anchor);
            const weekEnd = this.shiftDate(start, 6);
            return { start, end: weekEnd > today ? today : weekEnd };
        }

        if (this.selectedPeriod === 'month') {
            const { start, end } = this.monthBounds(anchor);
            return { start, end: end > today ? today : end };
        }

        if (this.selectedPeriod === 'custom') {
            let start = this.customRange?.start;
            let end = this.customRange?.end;
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
        if (this.selectedPeriod === 'day') {
            next = this.shiftDate(this.selectedDate, delta);
        } else if (this.selectedPeriod === 'week') {
            next = this.shiftDate(this.selectedDate, delta * 7);
        } else if (this.selectedPeriod === 'month') {
            next = this.shiftMonth(this.selectedDate, delta);
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
        const endpoint = this.selectedPeriod === 'day'
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
        try {
            pendingMeals = await DB.getMealsByStatus(DB.SYNC_STATUS.PENDING);
        } catch (error) {
            console.warn('[Nutrition] Failed to read pending meals:', error);
        }

        let failedItems = [];
        try {
            failedItems = await SyncEngine.getFailedItems();
        } catch (error) {
            console.warn('[Nutrition] Failed to read failed items:', error);
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
        if (this.selectedPeriod === 'day') return null;

        const token = this.app.state.tokens.access;
        const { start, end } = this.periodRange();

        let endpoint = null;
        if (this.selectedPeriod === 'week') {
            endpoint = `/nutrition/week?date=${this.selectedDate}`;
        } else if (this.selectedPeriod === 'month') {
            endpoint = `/nutrition/month?date=${this.selectedDate}`;
        } else {
            endpoint = `/nutrition/range?start_date=${start}&end_date=${end}`;
        }

        try {
            const data = await API.get(this.withTimezone(endpoint), token);
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
        if (this.selectedDate && this.selectedDate >= today) return this.shiftDate(today, -1);
        return this.selectedDate;
    },

    /** True while the card is standing in for yesterday behind a "Сегодня" header. */
    recapIsYesterday() {
        return Boolean(this.selectedDate) && this.selectedDate >= this.todayISO();
    },

    /**
     * Everything the recap card is rendered with, shared by the page render and
     * the in-place swap after a regeneration: the date it names, whether its day
     * is finished enough to generate, and the wording of that trigger. One place,
     * so the card can never claim a different day than the request it rode on.
     */
    recapCardOptions() {
        const date = this.recapDate();
        const isYesterday = this.recapIsYesterday();
        return {
            dateLabel: isYesterday
                ? `Итог за вчера, ${this.formatDayMonthISO(date)}`
                : this.formatDayMonthISO(date),
            allowGenerate: Boolean(date) && date < this.todayISO(),
            generateLabel: isYesterday ? 'Сформировать итог за вчера' : 'Сформировать итог дня',
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
        if (this.selectedPeriod !== 'day') return null;

        const token = this.app.state.tokens.access;
        const endpoint = `/nutrition/daily-summary?date=${encodeURIComponent(this.recapDate())}`;
        try {
            const data = await API.get(this.withTimezone(endpoint), token);
            return (data && typeof data === 'object') ? data : null;
        } catch (error) {
            console.warn('[Nutrition] Daily summary unavailable:', error?.message);
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
    async generateDailySummary() {
        if (this._dailySummaryLoading) return;
        const container = this.app.elements.pageContent;
        const section = container.querySelector('.daily-summary');
        if (!section) return;

        this._dailySummaryLoading = true;
        this.setDailySummaryBusy(section, true);

        const token = this.app.state.tokens.access;
        const endpoint = `/nutrition/daily-summary?date=${encodeURIComponent(this.recapDate())}&force=true`;
        try {
            const data = await API.get(this.withTimezone(endpoint), token);
            const payload = (data && typeof data === 'object') ? data : null;
            // A forced run rewrites the stored row, so the cached answer
            // for this day - which may still say "no recap" - is stale.
            API.invalidateReadCache('/nutrition/daily-summary');
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
            this._dailySummaryLoading = false;
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
        container.querySelectorAll(
            '[data-action="generate-daily-summary"], [data-action="regenerate-daily-summary"]'
        ).forEach((btn) => {
            btn.onclick = () => this.generateDailySummary();
        });
    },

    /**
     * Newest-first ordering key for a meal. Timestamps arrive as ISO strings,
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
        if (this.selectedPeriod === 'day') {
            return this.formatDateLabel(this.selectedDate);
        }
        if (this.selectedPeriod === 'month') {
            return this.formatMonthYear(this.selectedDate);
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
        if (this.selectedPeriod === 'day') return { range: 'День', coverage: '' };

        const days = Number(periodData?.days) || 0;
        const activeDays = Number(periodData?.active_days) || 0;
        const coverage = days ? `${activeDays}/${days} дн.` : (activeDays ? `${activeDays} дн.` : '');

        if (!periodData) {
            return this.selectedPeriod === 'custom'
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
        const showArrows = this.selectedPeriod !== 'custom';
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
            active: this.selectedPeriod === tab.value,
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
        if (period === this.selectedPeriod) return;
        this.selectedPeriod = period;
        await this.render(this.app.elements.pageContent, this.app);
    },

    /** Arrow navigation: one day, one week or one month depending on period. */
    async stepPeriod(delta) {
        const next = this.stepAnchor(delta);
        if (!next) return;
        this.selectedDate = next;
        await this.render(this.app.elements.pageContent, this.app);
    },

    /**
     * Period picker sheet. Only the single day needs one date input; every wider
     * period edits a range, so the sheet always exposes the start and the end.
     */
    openPeriodSheet() {
        // Guard on the closing element too, so a tap during the slide-out
        // animation cannot stack a second sheet on top of the first.
        if (this._periodSheetState || this._periodSheetClosing) return;

        const today = this.todayISO();
        const { start, end } = this.periodRange();
        const isRange = this.selectedPeriod !== 'day';

        const host = document.createElement('div');
        host.innerHTML = Components.periodSheet({ today, start, end, isRange });
        const modalEl = host.firstElementChild;
        document.body.appendChild(modalEl);

        this._periodSheetState = {
            modalEl,
            isRange,
            today,
            initialStart: start,
            initialEnd: end,
            bodyWasLocked: document.body.classList.contains('overflow-hidden'),
            onKeydown: null,
        };
        document.body.classList.add('overflow-hidden');

        this.bindPeriodSheetEvents(this._periodSheetState);
    },

    closePeriodSheet() {
        if (!this._periodSheetState) return;

        const { modalEl, onKeydown, bodyWasLocked } = this._periodSheetState;
        this._periodSheetState = null;
        if (onKeydown) {
            document.removeEventListener('keydown', onKeydown);
        }
        if (!bodyWasLocked) {
            document.body.classList.remove('overflow-hidden');
        }

        modalEl.querySelector('.drum-sheet-panel')?.classList.add('is-closing');
        modalEl.querySelector('.drum-sheet-backdrop')?.classList.add('is-closing');

        this._periodSheetClosing = modalEl;
        setTimeout(() => {
            modalEl.remove();
            if (this._periodSheetClosing === modalEl) {
                this._periodSheetClosing = null;
            }
        }, 220);
    },

    bindPeriodSheetEvents(state) {
        const { modalEl, today, isRange } = state;

        // Event delegation on the sheet container: the close button sits above
        // overlapping inputs/flex elements, so a single delegated listener
        // catches taps that a direct handler would miss.
        modalEl.addEventListener('click', (e) => {
            const target = e.target;
            if (target.closest('[data-action="close-period-sheet"]') || target.closest('.drum-sheet-backdrop')) {
                e.preventDefault();
                e.stopPropagation();
                this.closePeriodSheet();
            }
        });

        const onKeydown = (e) => {
            if (e.key === 'Escape') this.closePeriodSheet();
        };
        state.onKeydown = onKeydown;
        document.addEventListener('keydown', onKeydown);

        const startInput = modalEl.querySelector('[data-period-field="start"]');
        const endInput = modalEl.querySelector('[data-period-field="end"]');

        // Keep the bounds ordered while typing: a start past the end pulls the
        // end along, and an end before the start pulls the start back, so the
        // range can never read backwards before it is applied.
        if (isRange && startInput && endInput) {
            startInput.addEventListener('change', () => {
                if (!startInput.value) return;
                if (endInput.value && endInput.value < startInput.value) {
                    endInput.value = startInput.value;
                }
                endInput.min = startInput.value;
            });
            endInput.addEventListener('change', () => {
                if (!endInput.value) return;
                if (startInput.value && startInput.value > endInput.value) {
                    startInput.value = endInput.value;
                }
                endInput.min = startInput.value;
            });
        }

        modalEl.querySelectorAll('[data-action="period-preset"]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const range = this.presetRange(btn.dataset.range, today);
                if (!range) return;
                if (startInput) startInput.value = range.start;
                if (endInput) endInput.value = range.end;
                if (endInput) endInput.min = range.start;
            });
        });

        modalEl.querySelector('[data-action="reset-period-sheet"]')?.addEventListener('click', () => {
            if (startInput) startInput.value = state.initialStart;
            if (endInput) {
                endInput.value = state.initialEnd;
                endInput.min = state.initialStart;
            }
        });

        modalEl.querySelector('[data-action="apply-period-sheet"]')?.addEventListener('click', async () => {
            let start = startInput?.value || '';
            let end = isRange ? (endInput?.value || '') : start;
            if (!start) return;
            if (!end) end = start;
            // Swapped or future bounds are accepted but normalised, so the
            // range always reads the way the API will resolve it.
            if (start > end) [start, end] = [end, start];
            if (end > today) end = today;
            if (start > today) start = today;

            this.closePeriodSheet();

            if (isRange) {
                this.selectedPeriod = 'custom';
                this.customRange = { start, end };
                this.selectedDate = end;
            } else {
                this.selectedDate = start;
            }

            await this.render(this.app.elements.pageContent, this.app);
        });
    },

    /** Quick ranges offered by the custom period sheet. */
    presetRange(preset, today) {
        if (preset === 'today') return { start: today, end: today };
        if (preset === 'week') return { start: this.startOfWeek(today), end: today };
        if (preset === '30') return { start: this.shiftDate(today, -29), end: today };
        return null;
    },

    async render(container, app, dateOverride = null) {
        this.app = app;
        if (dateOverride) {
            this.selectedDate = dateOverride;
        }
        if (!this.selectedDate) {
            this.selectedDate = this.todayISO();
        }
        if (!PERIODS.includes(this.selectedPeriod)) {
            this.selectedPeriod = 'day';
        }

        // Every render the user asked for (page switch, date step, retry) opens a
        // fresh polling window; a render from the poll loop only spends the
        // budget of the window it belongs to.
        if (!this._pollingRender) {
            this.resetPolling();
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
            // recap only inside it; both are started here so all three requests
            // fly in parallel.
            const periodDataPromise = this.loadPeriodData();
            const dailySummaryPromise = this.loadDailySummary();
            const loaded = await this.loadData();
            const periodData = await periodDataPromise;
            const dailySummary = await dailySummaryPromise;
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
                target_calories: resolveTarget(apiTargets?.target_calories, user.target_calories, 2000),
                target_protein: resolveTarget(apiTargets?.target_protein, user.target_protein_g, 150),
                target_fat: resolveTarget(apiTargets?.target_fat, user.target_fat_g, 65),
                target_carbs: resolveTarget(apiTargets?.target_carbs, user.target_carbs_g, 250),
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
            this._mealsCache = new Map();
            for (const meal of sortedMeals) {
                if (meal.id != null) this._mealsCache.set(String(meal.id), meal);
            }
            for (const meal of pendingSorted) {
                if (meal.id != null) this._mealsCache.set(String(meal.id), meal);
            }

            const totalMeals = sortedMeals.length + pendingSorted.length;
            // Wider periods need the eaten date on every card, otherwise tiles
            // from different days are indistinguishable in the carousel.
            const showDate = this.selectedPeriod !== 'day';

            // A meal still being analysed can sit in either list: server-side
            // ones come back in sortedMeals, locally queued ones in
            // pendingSorted. Both must learn that the polling window ran out.
            const cardOptions = { showDate, analysisTimedOut: this._pollingTimedOut };

            const period = this.periodAverage(periodData);
            // The day ring reads the day totals; wider periods read the per-day
            // average, which keeps them comparable with the same daily targets.
            // A missing period payload therefore falls back to zeros rather than
            // re-labelling the day's totals as a week or a month.
            const isDayPeriod = this.selectedPeriod === 'day';
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

            // The recap sits directly under the dashboard, inside the header, so
            // the meal carousel starts below both without a second wrapper. Its chip
            // names the concrete day rather than reusing the header label: the recap
            // is a stored record of that date, and the header says only "Сегодня".
            // A finished day also earns the manual generation trigger; a day still
            // being eaten never does.
            const dailySummaryBlock = dailySummary
                ? Components.dailySummaryCard(dailySummary, this.recapCardOptions())
                : '';

            let html = `
                <div class="single-viewport px-4 pt-4 pb-20">
                    <!-- HEADER -->
                    <div class="viewport-header p-1 pt-0 pb-2">
                        ${this.renderDateNav(fromCache)}

                        <!-- Period dashboard: day, 7 days, month or custom range -->
                        <div class="mt-2">${dashboard}</div>
                        ${dailySummaryBlock}
                    </div>

                    <!-- PENDING SYNC BANNER -->
                    ${pendingSorted.length > 0
                        ? `
                        <div class="shrink-0 mb-1">
                            <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                                <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                Ожидают синхронизации: ${pendingSorted.length}
                            </span>
                        </div>
                        `
                        : ''}

                    <!-- STUCK ANALYSIS BANNER (polling budget spent) -->
                    ${this._pollingTimedOut ? this.renderAnalysisTimeoutBanner() : ''}

                    <!-- SNAP CAROUSEL: action tile first, then pending meals, then logged meals (LIFO) -->
                    <div class="meal-carousel" id="meal-carousel">
                        ${Components.addMealActionCard()}
                        ${pendingSorted.map((meal) => Components.mealCardPhoto(meal, cardOptions)).join('')}
                        ${sortedMeals.map((meal) => Components.mealCardPhoto(meal, cardOptions)).join('')}
                        ${totalMeals === 0 ? Components.mealCarouselEmptyState() : ''}
                    </div>

                    <!-- FAILED SYNC ITEMS (inline if any) -->
                    ${failedItems.length > 0
                        ? `
                        <div class="viewport-content px-4 pb-2 -mx-4" id="failed-items-section">
                            <div class="glass rounded-xl p-3 mb-2 border border-red-500/20">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wider">Ошибка синхронизации</h3>
                                    <button id="clear-failed" class="text-xs text-red-500 hover:text-red-400">Очистить все</button>
                                </div>
                                ${failedItems.map((item) => `
                                    <div class="glass rounded-lg p-2 mb-1">
                                        <p class="text-sm text-surface-600 dark:text-surface-300">${item.endpoint || 'Запрос'}</p>
                                        <p class="text-xs text-surface-500 truncate">${item.error || 'Неизвестная ошибка'}</p>
                                    </div>
                                `).join('')}
                                <button id="retry-failed" class="w-full py-2 mt-1 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl">Повторить сейчас</button>
                            </div>
                        </div>
                        `
                        : ''}
                </div>
            `;

            container.innerHTML = html;

            this.bindDateNav();
            this.bindPeriodTabs();
            this.bindAddMealModal();
            this.bindMealActions();
            this.bindFailedItems();
            this.bindDailySummary();

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

        // Start/stop polling for pending/processing meals
        this.managePolling(serverMeals, pendingMeals);
    },

    /**
     * Notice shown once the polling budget is spent while meals are still
     * pending. The dashboard stops refreshing itself at this point, so the user
     * has to be told why the numbers stopped moving.
     */
    renderAnalysisTimeoutBanner() {
        return `
            <div class="shrink-0 mb-1 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2" id="analysis-timeout-banner">
                <div class="flex items-start gap-2">
                    <svg class="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                    <div class="min-w-0">
                        <p class="text-xs font-semibold text-red-500">Анализ фото не завершился</p>
                        <p class="text-[11px] text-surface-600 dark:text-surface-300 leading-snug">
                            Автообновление остановлено. Вернитесь позже или загрузите это фото ещё раз.
                        </p>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Stop the poll loop. Split out from managePolling because a timeout has to
     * end the loop too, not just the absence of pending meals.
     */
    stopPolling() {
        if (!this._pollingTimer) return;
        clearInterval(this._pollingTimer);
        this._pollingTimer = null;
    },

    /**
     * Forget the current polling window: no timer, full budget, no timeout
     * notice. A window belongs to one batch of pending meals, so it must not
     * leak into the next upload.
     */
    resetPolling() {
        this.stopPolling();
        this._pollingAttempts = 0;
        this._pollingTimedOut = false;
    },

    /**
     * Manage polling for meals that are being analyzed.
     * Polls every 3s while any meal has status 'pending' or 'processing', for at
     * most MAX_POLL_ATTEMPTS ticks.
     */
    managePolling(serverMeals, pendingMeals) {
        this.stopPolling();

        // Check if any meal needs polling (pending or processing)
        const hasPendingOrProcessing =
            serverMeals.some(m => m.status === 'pending' || m.status === 'processing') ||
            pendingMeals.some(m => m.status === 'pending' || m.status === 'processing' || m.sync_status === 'pending');

        if (!hasPendingOrProcessing) {
            // Nothing left to watch: the batch reached a terminal status, so its
            // window and its timeout notice are both spent.
            this.resetPolling();
            return;
        }

        // A batch that already timed out stays unpolled until the user opens a
        // new window, otherwise the timeout render would restart the loop it
        // has just ended.
        if (this._pollingTimedOut) return;

        this._pollingTimer = setInterval(() => this.pollPendingMeals(), POLL_INTERVAL_MS);
    },

    /**
     * Poll for updated meal data when pending/processing meals exist.
     * Only refreshes if we're still on the nutrition page, and gives up once the
     * polling budget is spent.
     */
    async pollPendingMeals() {
        // Only poll if nutrition page is currently active
        if (this.app?.state?.currentPage !== 'nutrition') {
            this.managePolling([], []);
            return;
        }

        this._pollingAttempts += 1;
        if (this._pollingAttempts >= MAX_POLL_ATTEMPTS) {
            // Out of budget: end the loop and let the still-pending cards show
            // the timeout instead of shimmering forever.
            this._pollingTimedOut = true;
            this.stopPolling();
            console.warn(
                `[Nutrition] Polling stopped after ${MAX_POLL_ATTEMPTS} attempts, ` +
                'some meals are still pending'
            );
        }

        this._pollingRender = true;
        try {
            await this.render(this.app.elements.pageContent, this.app);
        } catch (error) {
            console.warn('[Nutrition] Polling error:', error);
        } finally {
            this._pollingRender = false;
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
        // Guard on the closing element too, so a tap during the slide-out
        // animation cannot stack a second sheet on top of the first.
        if (this._newMealModalState || this._newMealModalClosing) return;

        const modalHtml = Components.newMealModal();
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        const modalEl = modalContainer.firstElementChild;
        document.body.appendChild(modalEl);

        this._newMealModalState = {
            modalEl,
            panelEl: modalEl.querySelector('.drum-sheet-panel'),
            selectedFile: null,
            selectedMealType: null,
            previewUrl: null,
        };

        // Lock background scroll while the sheet is open (restore prior state on close)
        this._newMealModalState.bodyWasLocked = document.body.classList.contains('overflow-hidden');
        document.body.classList.add('overflow-hidden');

        // Bind events
        this.bindNewMealModalEvents(modalEl);
    },

    closeNewMealModal() {
        if (!this._newMealModalState) return;

        const { modalEl, panelEl, previewUrl, onKeydown, bodyWasLocked } = this._newMealModalState;
        // Revoke the object URL before the modal leaves the DOM so a preview
        // that is never submitted does not leak its blob.
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }
        this._newMealModalState = null;
        if (onKeydown) {
            document.removeEventListener('keydown', onKeydown);
        }
        if (!bodyWasLocked) {
            document.body.classList.remove('overflow-hidden');
        }

        // Slide the panel back out before removing it, mirroring the drum sheet.
        panelEl?.classList.add('is-closing');
        modalEl.querySelector('.drum-sheet-backdrop')?.classList.add('is-closing');

        this._newMealModalClosing = modalEl;
        setTimeout(() => {
            modalEl.remove();
            if (this._newMealModalClosing === modalEl) {
                this._newMealModalClosing = null;
            }
        }, 220);
    },

    bindNewMealModalEvents(modalEl) {
        const state = this._newMealModalState;

        // Backdrop closes the sheet; the close button sits inside the panel and
        // is bound directly so panel clicks never bubble into the backdrop handler.
        modalEl.querySelector('.drum-sheet-backdrop')?.addEventListener('click', () => {
            this.closeNewMealModal();
        });
        modalEl.querySelector('.drum-sheet-panel [data-action="close-new-meal-modal"]')?.addEventListener('click', () => {
            this.closeNewMealModal();
        });

        // Escape key
        const onKeydown = (e) => {
            if (e.key === 'Escape') {
                this.closeNewMealModal();
            }
        };
        state.onKeydown = onKeydown;
        document.addEventListener('keydown', onKeydown);

        // Meal type selection
        modalEl.querySelectorAll('[data-action="set-new-meal-type"]').forEach((btn) => {
            btn.onclick = () => {
                state.selectedMealType = btn.dataset.type;
                modalEl.querySelectorAll('[data-action="set-new-meal-type"]').forEach((b) => {
                    const isActive = b.dataset.type === state.selectedMealType;
                    b.classList.toggle('active', isActive);
                    b.setAttribute('aria-pressed', String(isActive));
                });
                this.updateNewMealSubmitState(modalEl, state);
            };
        });

        // Camera button
        modalEl.querySelector('[data-action="new-meal-camera"]')?.addEventListener('click', () => {
            const input = modalEl.querySelector('#new-meal-photo-input');
            if (input) {
                input.setAttribute('capture', 'environment');
                input.click();
            }
        });

        // Gallery button
        modalEl.querySelector('[data-action="new-meal-gallery"]')?.addEventListener('click', () => {
            const input = modalEl.querySelector('#new-meal-photo-input');
            if (input) {
                input.removeAttribute('capture');
                input.click();
            }
        });

        // Remove image button
        modalEl.querySelector('[data-action="remove-new-meal-img"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearNewMealImage(modalEl, state);
        });

        // File input change
        const photoInput = modalEl.querySelector('#new-meal-photo-input');
        if (photoInput) {
            photoInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.handleNewMealFileSelect(file, modalEl, state);
                }
            };
        }

        // Submit button
        modalEl.querySelector('[data-action="submit-new-meal"]')?.addEventListener('click', () => {
            this.handleNewMealSubmit(modalEl, state);
        });
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
        if (!state.selectedFile || !state.selectedMealType) {
            return;
        }

        const notesInput = modalEl.querySelector('#new-meal-notes');
        const notes = notesInput ? notesInput.value.trim() || null : null;
        const token = this.app.state.tokens.access;

        const submitBtn = modalEl.querySelector('#new-meal-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
            <svg class="animate-spin w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <span class="text-sm font-semibold">Загрузка...</span>
        `;

        let compressedBlob = state.selectedFile;

        try {
            const compressed = await Utils.compressImage(state.selectedFile);
            if (compressed) {
                compressedBlob = compressed;
            }
        } catch (compressError) {
            console.warn('[Nutrition] Compression failed, using original:', compressError);
        }

        const formData = new FormData();
        formData.append('file', compressedBlob, 'photo.webp');
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
        this.showAnalyzingSkeleton();

        try {
            const response = await API.post('/nutrition/photos', formData, token, true);
            newMealId = response?.meal_id ?? null;
            this.app.showToast('Фото загружено, идёт анализ', 'success');
            this.closeNewMealModal();
        } catch (error) {
            if (error?.isNetworkError || error?.offlineQueued) {
                newMealId = await Camera.queueOfflineMeal(compressedBlob, notes, state.selectedMealType);
                this.app.showToast('Нет связи. Фото сохранено локально и будет загружено при появлении связи', 'info');
                this.closeNewMealModal();
            } else {
                console.error('[Nutrition] Upload error:', error);
                this.app.showToast(error.data?.detail || 'Ошибка загрузки', 'error');
            }
        } finally {
            this.removeAnalyzingSkeleton();
            submitBtn.disabled = false;
            submitBtn.innerHTML = `
                <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                <span class="text-sm font-semibold">Отправить / Анализировать</span>
            `;
        }

        // The reload brings the real card (pending, then analysed); the carousel only
        // knows its id once the render that produced it is done, so the target
        // is handed over instead of scrolled to here.
        this._scrollTargetMealId = newMealId;
        await this.render(this.app.elements.pageContent, this.app, this.selectedDate);
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

        // The add tile stays first; the new meal lands right after it.
        carousel.insertBefore(slot, carousel.children[1] || null);
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
    scrollCarouselToSlot(slot) {
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
            carousel.scrollTo({ left: target, behavior: 'smooth' });
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

        const targetId = this._scrollTargetMealId;
        this._scrollTargetMealId = null;
        if (targetId !== null && targetId !== undefined) {
            const slot = carousel.querySelector(`.meal-card-slot[data-meal-id="${targetId}"]`);
            if (slot) {
                this.scrollCarouselToSlot(slot);
                return;
            }
        }

        const max = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
        carousel.scrollLeft = Math.max(0, Math.min(previousLeft || 0, max));
    },

    bindFailedItems() {
        const container = this.app.elements.pageContent;

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
                this.app.renderPage('nutrition');
            };
        }

        const clearBtn = container.querySelector('#clear-failed');
        if (clearBtn) {
            clearBtn.onclick = async () => {
                await SyncEngine.clearQueue();
                this.app.renderPage('nutrition');
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
            if (mealId && this._expandedCompositions.has(String(mealId))) {
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
                    if (expanded) this._expandedCompositions.add(id);
                    else this._expandedCompositions.delete(id);
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
    },

    /**
     * Edit meal modal: bottom sheet pre-filled with the current meal data,
     * following the same drum-sheet open/close lifecycle as the new-meal sheet.
     */
    openEditMealModal(mealId) {
        if (this._editMealModalState || this._editMealModalClosing) return;

        const meal = this._mealsCache.get(String(mealId));
        if (!meal) {
            this.app.showToast('Не удалось загрузить данные блюда', 'error');
            return;
        }

        const modalHtml = Components.editMealModal(meal);
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = modalHtml;
        const modalEl = modalContainer.firstElementChild;
        document.body.appendChild(modalEl);

        this._editMealModalState = {
            modalEl,
            mealId,
            panelEl: modalEl.querySelector('.drum-sheet-panel'),
        };

        this._editMealModalState.bodyWasLocked = document.body.classList.contains('overflow-hidden');
        document.body.classList.add('overflow-hidden');

        this.bindEditMealModalEvents(modalEl, this._editMealModalState);
    },

    closeEditMealModal() {
        if (!this._editMealModalState) return;

        const { modalEl, panelEl, onKeydown, bodyWasLocked } = this._editMealModalState;
        this._editMealModalState = null;
        if (onKeydown) {
            document.removeEventListener('keydown', onKeydown);
        }
        if (!bodyWasLocked) {
            document.body.classList.remove('overflow-hidden');
        }

        panelEl?.classList.add('is-closing');
        modalEl.querySelector('.drum-sheet-backdrop')?.classList.add('is-closing');

        this._editMealModalClosing = modalEl;
        setTimeout(() => {
            modalEl.remove();
            if (this._editMealModalClosing === modalEl) {
                this._editMealModalClosing = null;
            }
        }, 220);
    },

    bindEditMealModalEvents(modalEl, state) {
        // Backdrop closes the sheet
        modalEl.querySelector('.drum-sheet-backdrop')?.addEventListener('click', () => {
            this.closeEditMealModal();
        });
        modalEl.querySelector('.drum-sheet-panel [data-action="close-edit-meal-modal"]')?.addEventListener('click', () => {
            this.closeEditMealModal();
        });

        // Escape key
        const onKeydown = (e) => {
            if (e.key === 'Escape') this.closeEditMealModal();
        };
        state.onKeydown = onKeydown;
        document.addEventListener('keydown', onKeydown);

        // Submit button
        modalEl.querySelector('[data-action="submit-edit-meal"]')?.addEventListener('click', () => {
            this.handleEditMealSubmit(modalEl, state);
        });
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
            this._mealsCache.set(String(mealId), updated);
            this.closeEditMealModal();
            this.app.showToast('Блюдо обновлено', 'success');
            await this.render(this.app.elements.pageContent, this.app, this.selectedDate);
        } catch (error) {
            console.error('[Nutrition] Edit meal error:', error);
            this.app.showToast(error?.data?.detail || 'Ошибка сохранения', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalHTML;
        }
    }
};