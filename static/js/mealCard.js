import { Utils } from './utils.js';
import { DB } from './db.js';
import { Components, escapeHtml } from './components.js';
import { MEAL_ANALYSIS } from './constants.js';

export class MealCard {
    constructor(nutritionModule) {
        this.nutrition = nutritionModule;
    }

    /**
     * Compute meal status flags (pending, failed, stuck) in one place.
     * Returns an object with the computed status flags.
     */
    _getStatus(meal) {
        if (!meal) return { isPending: false, isFailed: false, isStuck: false, isAlert: false };

        const serverStatus = meal.status;
        const isPending = serverStatus === 'pending' || serverStatus === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING;
        const isFailed = serverStatus === 'failed' || meal.sync_status === DB.SYNC_STATUS.FAILED;
        const createdAt = meal.created_at ? new Date(meal.created_at).getTime() : (meal.eaten_at ? new Date(meal.eaten_at).getTime() : Date.now());
        const updatedAt = meal.updated_at ? new Date(meal.updated_at).getTime() : createdAt;
        const isStuck = (serverStatus === 'pending' || serverStatus === 'processing') &&
            (Date.now() - Math.max(createdAt, updatedAt) > MEAL_ANALYSIS.STUCK_THRESHOLD_MS);
        const isAlert = isFailed || isStuck;

        return { isPending, isFailed, isStuck, isAlert };
    }

    /**
     * Render a meal card photo tile.
     */
    render(meal, { showDate = false } = {}) {
        if (!meal) return '';

        const { isPending, isFailed, isStuck, isAlert } = this._getStatus(meal);
        const createdAt = meal.created_at ? new Date(meal.created_at).getTime() : (meal.eaten_at ? new Date(meal.eaten_at).getTime() : Date.now());
        const updatedAt = meal.updated_at ? new Date(meal.updated_at).getTime() : createdAt;
        const day = meal.eaten_at ? new Date(meal.eaten_at) : (meal.created_at ? new Date(meal.created_at) : null);

        const dishName = meal.dish_name || (isPending ? '' : 'Блюдо');
        const timeLabel = day ? Utils.formatTime(day) : '';
        const dateLabel = showDate && day ? Utils.formatDayMonth(day) : '';
        const chipLabel = [dateLabel, timeLabel]
            .filter(Boolean)
            .map(escapeHtml)
            .join(' · ');

        const calories = Math.round(meal.calories || 0);
        const protein = Math.round(meal.protein_g || meal.protein || 0);
        const fat = Math.round(meal.fat_g || meal.fat || 0);
        const carbs = Math.round(meal.carbs_g || meal.carbs || 0);
        const formatNum = (value) => Math.round(value).toLocaleString('ru-RU');

        // The AI score and the macro-only fallback arrive on different scales,
        // so both go through the same normalisation before the badge prints it.
        const macroScore = Utils.computeQualityScore({
            calories,
            protein: meal.protein_g ?? meal.protein,
            fat: meal.fat_g ?? meal.fat,
            carbs: meal.carbs_g ?? meal.carbs,
        });
        const hasAIScore = meal.quality_score !== undefined && meal.quality_score !== null;
        const qualityScore = Utils.qualityScoreFromAI(hasAIScore ? meal.quality_score : (macroScore === null ? null : macroScore / 10));

        const photoSrc = Components.mealPhotoUrl(meal);
        const safeSrc = photoSrc ? String(photoSrc).replace(/'/g, '%27').replace(/"/g, '%22') : null;
        const mealId = meal.id ?? '';
        const escName = escapeHtml(dishName);

        const breakdown = isPending ? null : Components.mealBreakdown(meal);

        const heroBackground = safeSrc
            ? `style="background-image: url('${safeSrc}');"`
            : 'class="meal-card-hero__fallback"';

        const heroOverlay = isPending
            ? `
                <div class="flex flex-col items-center justify-center gap-2">
                    <div class="w-7 h-7 rounded-full border-2 border-white/20 border-t-lime-400 animate-spin"></div>
                    <span class="text-xs font-semibold text-white bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">Анализируем...</span>
                </div>
            `
            : isAlert
            ? `
                <div class="flex flex-col items-center justify-center gap-2">
                    <div class="w-6 h-6 rounded-full border-2 border-red-500/30 bg-red-500/10 flex items-center justify-center shrink-0">
                        <svg class="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
                    </div>
                    <span class="text-xs font-semibold text-white bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">${isStuck ? 'Анализ застрел' : 'Ошибка анализа'}</span>
                </div>
            `
            : `
                <h3 class="meal-card-hero__name">${escName}</h3>
                ${breakdown?.portion
                    ? `<p class="meal-card-hero__note">${escapeHtml(String(breakdown.portion))} г</p>`
                    : ''}
            `;

        const macroPill = (label, value, pending) => `
            <div class="meal-card-pill ${pending ? 'meal-card-pill--pending' : ''}">
                ${pending
                    ? `<span class="meal-skeleton__line w-[60%]"></span>`
                    : `<span class="meal-card-pill__value">${escapeHtml(String(value))}</span>`}
                <span class="meal-card-pill__label">${escapeHtml(label)}</span>
            </div>
        `;

        const macroBar = `
            <div class="meal-card-pills">
                ${macroPill('Ккал', formatNum(calories), isPending)}
                ${macroPill('Белки', formatNum(protein), isPending)}
                ${macroPill('Жиры', formatNum(fat), isPending)}
                ${macroPill('Углеводы', formatNum(carbs), isPending)}
            </div>
        `;

        const compositionBlock = breakdown
            ? `
                <div class="meal-card-section">
                    <p class="meal-card-section__label">Состав</p>
                    ${breakdown.body}
                </div>
            `
            : '';

        const insight = typeof meal.ai_insight === 'string' ? meal.ai_insight.trim() : '';
        const verdictContent = isPending
            ? `<div class="flex items-center gap-2"><div class="w-4 h-4 rounded-full border-2 border-white/20 border-t-lime-400 animate-spin"></div><span class="text-xs text-surface-500 dark:text-surface-400">Анализируем...</span></div>`
            : isAlert
            ? `<p class="meal-card-ai__text">${escapeHtml(meal.quality_reason || meal.error_message || 'Анализ не удался. Попробуйте повторить.')}</p>`
            : insight
            ? `<p class="meal-card-ai__text">${escapeHtml(insight)}</p>`
            : Components.qualityMetrics(meal.quality_reason);

        // The persona chip sits directly above the verdict box and inside the same
        // wrapper, so the pair keeps one 4px gap whatever the card's own 12px
        // section rhythm is: a chip separated from its verdict by the section gap
        // read as an unrelated label.
        const verdictBlock = verdictContent
            ? `
                <div class="meal-card-verdict-group">
                    ${Components.personaBadge(meal.ai_persona)}
                    <div class="meal-card-verdict">
                        <div class="meal-card-verdict__header">
                            <span class="meal-card-verdict__title">Вердикт нутрициолога</span>
                            ${Components.qualityBadge(qualityScore)}
                        </div>
                        <div class="meal-card-verdict__body">
                            ${verdictContent}
                        </div>
                    </div>
                </div>
            `
            : '';

        const actionsBlock = mealId
            ? `
                <div class="meal-card-hero__actions">
                    ${isAlert
                        ? `<button type="button" data-action="retry-analysis" data-meal-id="${mealId}" class="glass-badge meal-card-hero__action meal-card-hero__action--retry" aria-label="Повторить анализ" title="Повторить анализ">${Components.mealActionIcon('retry')}</button>`
                        : ''}
                    <button type="button" data-action="edit-meal" data-meal-id="${mealId}" class="glass-badge meal-card-hero__action" aria-label="Редактировать блюдо" title="Редактировать">${Components.mealActionIcon('edit')}</button>
                    <button type="button" data-action="delete-meal" data-meal-id="${mealId}" class="glass-badge meal-card-hero__action meal-card-hero__action--danger" aria-label="Удалить блюдо" title="Удалить">${Components.mealActionIcon('trash')}</button>
                </div>
            `
            : '';

        return `
            <article class="meal-card-slot snap-center shrink-0" data-meal-id="${mealId}">
                <div class="meal-card ${isAlert ? 'meal-card--alert' : ''}" data-meal-id="${mealId}">
                    <div class="meal-card-hero meal-card-hero--tall">
                        <div ${heroBackground} class="meal-card-hero__image"></div>
                        <div class="meal-card-scrim meal-card-scrim--heavy"></div>

                        <div class="meal-card-hero__top">
                            <div class="glass-badge inline-flex items-center rounded-full px-2.5 py-1 min-w-0">
                                <span class="text-[11px] font-semibold text-white truncate">${chipLabel}</span>
                            </div>
                            ${actionsBlock}
                        </div>

                        <div class="meal-card-hero__bottom">${heroOverlay}</div>
                    </div>

                    ${macroBar}
                    ${compositionBlock}
                    ${verdictBlock}
                </div>
            </article>
        `;
    }

    /**
     * Update a single meal card in place.
     */
    update(cardElement, meal, { showDate = false } = {}) {
        // For now, re-render the whole card. In the future this could do granular updates.
        const newHtml = this.render(meal, { showDate });
        const host = document.createElement('div');
        host.innerHTML = newHtml;
        const freshCard = host.firstElementChild;
        if (freshCard) {
            cardElement.replaceWith(freshCard);
            // Note: event binding is handled by the parent Nutrition module
        }
        return freshCard;
    }

    /**
     * Check if a meal is pending/analyzing.
     */
    isPending(meal) {
        return this._getStatus(meal).isPending;
    }

    /**
     * Check if a meal has failed.
     */
    isFailed(meal) {
        return this._getStatus(meal).isFailed;
    }

    /**
     * Check if a meal is stuck (pending for too long).
     */
    isStuck(meal) {
        return this._getStatus(meal).isStuck;
    }
}
