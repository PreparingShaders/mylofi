console.log("[DEBUG] Loaded components.js");
import { Utils } from './utils.js';
import { DB } from './db.js';

let sparklineSeq = 0;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const MEAL_TYPE_META = {
    breakfast: { label: 'Завтрак', icon: 'sunrise' },
    lunch: { label: 'Обед', icon: 'utensils' },
    dinner: { label: 'Ужин', icon: 'moon' },
    snack: { label: 'Перекус', icon: 'cookie' },
};

const MEAL_TYPE_ICON_PATHS = {
    sunrise: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9Z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4v4"/>',
    utensils: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v20"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 2v20"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 2v20"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 10h20"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 14h20"/>',
    moon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 8a2 2 0 0 0 0-4 2 2 0 0 0-4 0 2 2 0 0 0 4 0Z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2 8h20"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 16V12a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4"/>',
    cookie: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v.01"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12v.01"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12v.01"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 16v.01"/>',
};

function buildSmoothPath(pts, tension = 0.2) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) * tension;
        const c1y = p1.y + (p2.y - p0.y) * tension;
        const c2x = p2.x - (p3.x - p1.x) * tension;
        const c2y = p2.y - (p3.y - p1.y) * tension;
        d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
}

export const Components = {
    loadingSpinner(size = 'h-8 w-8') {
        return `<div class="flex items-center justify-center"><div class="animate-spin rounded-full ${size} border-2 border-primary-600 dark:border-zinc-200 border-t-transparent"></div></div>`;
    },

    errorState(message = 'Что-то пошло не так', onRetry = null) {
        return `<div class="p-8 text-center text-red-500">${message}</div>`;
    },

    emptyState(message = 'Нет данных', actionText = null, onAction = null) {
        return `<div class="p-8 text-center text-surface-500 dark:text-surface-400">${message}</div>`;
    },

    progressRing(value, max, size = 120, strokeWidth = 10, color = 'primary-600 dark:text-zinc-200', bgColor = 'surface-300 dark:text-zinc-800', label = null) {
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const progress = Math.min(value / max, 1);
        const offset = circumference - progress * circumference;
        return `
            <div class="relative flex items-center justify-center" style="width: ${size}px; height: ${size}px;">
                <svg class="absolute" width="${size}" height="${size}"><circle stroke="currentColor" stroke-width="${strokeWidth}" fill="transparent" r="${radius}" cx="${size / 2}" cy="${size / 2}" class="text-${bgColor}"/><circle stroke="currentColor" stroke-width="${strokeWidth}" fill="transparent" r="${radius}" cx="${size / 2}" cy="${size / 2}" class="text-${color}" stroke-dasharray="${circumference} ${circumference}" stroke-dashoffset="${offset}"/></svg>
                <div class="absolute text-center"><p class="text-xl font-bold">${label || Math.round(progress * 100) + '%'}</p></div>
            </div>
        `;
    },

    mealTypeLabel(type) {
        return MEAL_TYPE_META[type]?.label || 'Приём пищи';
    },

    mealTypeIcon(type, className = 'w-4 h-4') {
        const icon = MEAL_TYPE_META[type]?.icon || 'utensils';
        return `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${MEAL_TYPE_ICON_PATHS[icon]}</svg>`;
    },

    /**
     * Unified kcal/macro widget: one SVG with three concentric rings
     * (calories outer, protein middle, fat/carbs inner) and the calorie
     * value in the centre.
     */
    nutritionRing(summary = {}, targets = {}, caption = 'ккал') {
        const safeNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
        const ratio = (current, target) => (target > 0 ? Math.min(1, Math.max(0, current / target)) : 0);

        const calories = safeNum(summary.calories);
        const protein = safeNum(summary.protein);
        const fat = safeNum(summary.fat);
        const carbs = safeNum(summary.carbs);

        const targetCalories = safeNum(targets.target_calories);
        const targetProtein = safeNum(targets.target_protein);
        const targetFat = safeNum(targets.target_fat);
        const targetCarbs = safeNum(targets.target_carbs);

        const rings = [
            { r: 54, width: 8, value: calories, target: targetCalories, className: 'text-blue-500' },
            { r: 42, width: 6, value: protein, target: targetProtein, className: 'text-amber-500' },
            { r: 30, width: 5, value: fat, target: targetFat, className: 'text-lime-500' },
        ];

        const arcs = rings.map((ring) => {
            const circumference = 2 * Math.PI * ring.r;
            const offset = circumference * (1 - ratio(ring.value, ring.target));
            const track = `<circle class="nutrition-ring__track" cx="60" cy="60" r="${ring.r}" stroke-width="${ring.width}" fill="none" stroke="currentColor" />`;
            const progress = `<circle class="nutrition-ring__arc ${ring.className}" cx="60" cy="60" r="${ring.r}" stroke-width="${ring.width}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" />`;
            return track + progress;
        }).join('');

        const legendItem = (label, value, target, colorClass) => `
            <span class="flex items-center gap-1 whitespace-nowrap">
                <span class="w-2 h-2 rounded-full ${colorClass}"></span>${label}
                <span class="font-semibold text-surface-900 dark:text-zinc-100">${Math.round(value)}</span>
                <span class="text-surface-500 dark:text-surface-400">/ ${Math.round(target)}г</span>
            </span>
        `;

        return `
            <div class="flex flex-col items-center">
                <div class="relative w-36 h-36 flex items-center justify-center" role="img"
                     aria-label="Калории ${Math.round(calories)} из ${Math.round(targetCalories)} ккал, белки ${Math.round(protein)} из ${Math.round(targetProtein)} грамм, жиры ${Math.round(fat)} из ${Math.round(targetFat)} грамм, углеводы ${Math.round(carbs)} из ${Math.round(targetCarbs)} грамм">
                    <svg class="nutrition-ring w-full h-full" viewBox="0 0 120 120" aria-hidden="true">
                        ${arcs}
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
                        <p class="text-2xl font-bold text-surface-900 dark:text-zinc-100 leading-none">${Math.round(calories)}</p>
                        <p class="text-[10px] text-surface-500 dark:text-surface-400 mt-1 leading-tight">/ ${Math.round(targetCalories)} ${escapeHtml(caption)}</p>
                    </div>
                </div>
                <div class="flex items-center justify-center gap-3 mt-3 text-[11px] text-surface-600 dark:text-surface-300">
                    ${legendItem('Б', protein, targetProtein, 'bg-amber-500')}
                    ${legendItem('Ж', fat, targetFat, 'bg-lime-500')}
                    ${legendItem('У', carbs, targetCarbs, 'bg-sky-500')}
                </div>
            </div>
        `;
    },

    /**
     * Resolves a displayable photo URL for a meal. Server-side paths are
     * stored on disk (e.g. "./uploads/thumbnails/ab12.jpg") and served by
     * the /uploads static mount, so only the tail after "uploads/" is needed.
     */
    mealPhotoUrl(meal) {
        if (meal.blob) {
            try {
                return URL.createObjectURL(meal.blob);
            } catch (error) {
                console.warn('[Components] Failed to create object URL for meal blob:', error);
            }
        }
        const direct = meal.image_url || meal.photo_url;
        if (direct) return direct;

        const stored = meal.photo_thumbnail_path || meal.photo_path;
        if (!stored) return null;
        const normalized = String(stored).replace(/\\/g, '/');
        const marker = normalized.lastIndexOf('/uploads/');
        const relative = marker >= 0 ? normalized.slice(marker + '/uploads/'.length) : normalized.replace(/^\/+/, '');
        if (!relative || relative.includes('..')) return null;
        return `/uploads/${relative}`;
    },

    mealCard(meal, app) {
        const isPending = meal.status === 'pending' || meal.status === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING;
        const isFailed = meal.sync_status === DB.SYNC_STATUS.FAILED;
        return `
            <div class="glass rounded-2xl p-4 mb-4 ${isFailed ? 'border border-red-500/30' : ''}">
                <h3 class="font-semibold">${meal.dish_name || (isPending ? 'Анализ...' : 'Блюдо')}</h3>
                <p class="text-surface-600 dark:text-surface-300">${Math.round(meal.calories || 0)} Ккал</p>
                ${isPending && meal.notes
                    ? `<p class="text-xs text-surface-500 mt-1">${meal.notes}</p>`
                    : ''}
                ${isPending
                    ? '<span class="inline-block mt-1 text-xs text-amber-500">Ожидает синхронизации</span>'
                    : ''}
            </div>
        `;
    },

    mealCardPhoto(meal, app) {
        const isPending = meal.status === 'pending' || meal.status === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING;
        const isFailed = meal.sync_status === DB.SYNC_STATUS.FAILED;
        const day = meal.eaten_at ? new Date(meal.eaten_at) : (meal.created_at ? new Date(meal.created_at) : null);

        const dishName = meal.dish_name || (isPending ? 'Анализ...' : 'Блюдо');
        const mealType = this.mealTypeLabel(meal.meal_type);
        const timeLabel = day ? Utils.formatTime(day) : '';

        const calories = Math.round(meal.calories || 0);
        const protein = Math.round(meal.protein_g || meal.protein || 0);
        const fat = Math.round(meal.fat_g || meal.fat || 0);
        const carbs = Math.round(meal.carbs_g || meal.carbs || 0);
        const fiber = Math.round(meal.fiber_g || 0);
        const sugar = Math.round(meal.sugar_g || 0);
        const sodium = Math.round(meal.sodium_mg || 0);

        const hasMacros = calories > 0 || protein > 0 || fat > 0 || carbs > 0;
        const photoSrc = this.mealPhotoUrl(meal);
        const safeSrc = photoSrc ? String(photoSrc).replace(/'/g, '%27').replace(/"/g, '%22') : null;

        let qualityScore = null;
        if (!isPending && !isFailed && hasMacros) {
            qualityScore = Utils.computeQualityScore({ calories, protein, fat, carbs });
        }

        const aiText = meal.ai_insight || meal.notes || (isPending ? 'Идёт анализ изображения...' : 'AI-анализ пока недоступен');
        const escName = escapeHtml(dishName);
        const escAi = escapeHtml(aiText);
        const escType = escapeHtml(mealType);
        const escTime = escapeHtml(timeLabel);
        const mealId = meal.id ?? '';

        const qualityBadge = qualityScore !== null
            ? `<div class="inline-flex items-center gap-1 bg-white/15 backdrop-blur rounded-full px-2 py-0.5 mt-2 w-fit">
                   <span class="text-xs font-bold text-white">${qualityScore}</span>
                   <span class="text-[9px] text-white/60">/100</span>
               </div>`
            : isPending
                ? `<div class="inline-flex items-center gap-1 bg-amber-500/25 backdrop-blur rounded-full px-2 py-0.5 mt-2 w-fit">
                       <span class="text-[10px] font-medium text-amber-200">${isFailed ? 'Ошибка синхронизации' : 'Очередь'}</span>
                   </div>`
                : '';

        const background = safeSrc
            ? `<div class="meal-card-photo absolute inset-0" style="background-image: url('${safeSrc}');"></div>`
            : `<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-300 to-surface-400 dark:from-white/5 dark:to-white/10">
                   <svg class="w-12 h-12 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                       <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                       <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 010 6z"/>
                   </svg>
               </div>`;

        const macroPill = (value, unit, label) => `
            <span class="flex-1 text-center px-2 py-1.5 bg-white/10 rounded-xl">
                <p class="text-sm font-bold text-white leading-tight">${value > 0 ? `${value}${unit}` : '—'}</p>
                <p class="text-[9px] text-white/60 leading-tight mt-0.5">${label}</p>
            </span>
        `;

        const actions = `
            <div class="meal-card-menu hidden absolute top-11 right-2 z-20 w-40 rounded-xl overflow-hidden bg-zinc-900/95 backdrop-blur border border-white/10 shadow-xl">
                <button type="button" data-action="edit-meal" data-meal-id="${mealId}"
                        class="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/10 transition-colors">Редактировать</button>
                <button type="button" data-action="delete-meal" data-meal-id="${mealId}"
                        class="w-full px-3 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/15 transition-colors border-t border-white/10">Удалить</button>
            </div>
        `;

        return `
            <article class="snap-start w-64 shrink-0" data-meal-id="${mealId}">
                <div class="meal-card relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-surface-900 dark:bg-zinc-900 ${isFailed ? 'ring-2 ring-red-500/40' : ''}">
                    ${background}
                    <div class="meal-card-overlay absolute inset-0"></div>

                    <div class="relative h-full p-4 flex flex-col justify-between">
                        <div class="flex items-start justify-between gap-2">
                            <div class="flex items-center gap-2 min-w-0">
                                <span class="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-lg bg-white/15 backdrop-blur text-white">
                                    ${this.mealTypeIcon(meal.meal_type)}
                                </span>
                                <span class="text-sm font-medium text-white/90 truncate">${escType}</span>
                            </div>
                            ${timeLabel ? `<time class="text-xs text-white/70 shrink-0">${escTime}</time>` : ''}
                        </div>

                        <div class="flex-1 flex flex-col justify-end pt-4">
                            <h3 class="text-lg font-semibold text-white leading-tight line-clamp-2">${escName}</h3>
                            <p class="text-xs text-white/75 mt-1 line-clamp-2">${escAi}</p>
                            ${qualityBadge}
                        </div>

                        <div class="flex items-center gap-1.5 pt-3 mt-3 border-t border-white/15">
                            ${macroPill(calories, '', 'Ккал')}
                            ${macroPill(protein, 'г', 'Белки')}
                            ${macroPill(fat, 'г', 'Жиры')}
                            ${macroPill(carbs, 'г', 'Углеводы')}
                        </div>
                        ${fiber > 0
                            ? `<p class="text-[10px] text-white/60 mt-2">Клетчатка: ${fiber}г · Сахар: ${sugar}г · Натрий: ${sodium}мг</p>`
                            : ''}
                    </div>

                    <button type="button" data-action="toggle-meal-menu" aria-label="Действия" aria-expanded="false"
                            class="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/35 backdrop-blur flex items-center justify-center text-white/80 hover:text-white hover:bg-black/50 transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"/></svg>
                    </button>
                    ${actions}
                </div>
            </article>
        `;
    },


    sparkline(data, height = 72, label = 'Динамика тоннажа (кг)') {
        if (!data || data.length === 0) return '<div class="text-xs text-surface-400 h-20 flex items-center justify-center">Нет истории тренировок</div>';

        const formatNum = (n) => Math.round(n).toLocaleString();
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const last = data[data.length - 1];
        const first = data[0];
        const trend = last > first ? '↑' : last < first ? '↓' : '→';
        const trendColor = last > first ? 'text-lime-600 dark:text-lime-400' : last < first ? 'text-rose-500 dark:text-rose-400' : 'text-surface-500 dark:text-surface-400';

        const toY = (v) => 85 - ((v - min) / range) * 60;

        const coords = data.map((v, i) => ({
            x: data.length > 1 ? 5 + (i / (data.length - 1)) * 90 : 50,
            y: toY(v)
        }));

        const gradientId = `sparkline-gradient-${++sparklineSeq}`;
        const lastPoint = coords[coords.length - 1];
        const linePath = buildSmoothPath(coords);
        const areaPath = `${linePath} L ${lastPoint.x} 100 L ${coords[0].x} 100 Z`;

        const lastX = data.length === 1 ? 50 : lastPoint.x;
        const lastY = data.length === 1 ? 55 : lastPoint.y;

        return `
            <div class="w-full text-surface-500 dark:text-zinc-200">
                <div class="pb-2 mb-2 border-b border-surface-200 dark:border-white/10">
                    <div class="text-xs text-surface-500 dark:text-surface-400 font-medium mb-1">${label}</div>
                    <div class="flex justify-between items-baseline">
                        <span class="text-[10px] text-surface-400 dark:text-surface-500 font-mono">${formatNum(min)} кг</span>
                        <div class="flex items-center gap-1">
                            <span class="text-xs text-surface-400 dark:text-surface-500">Последнее:</span>
                            <span class="text-sm font-bold font-mono ${trendColor}">${formatNum(last)} ${trend}</span>
                        </div>
                        <span class="text-[10px] text-surface-400 dark:text-surface-500 font-mono">${formatNum(max)} кг</span>
                    </div>
                </div>
                <div class="pt-2">
                    <div class="relative w-full">
                        <svg class="block w-full" width="100%" height="${height}" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <defs>
                                <linearGradient id="${gradientId}" x1="0%" y1="100%" x2="0%" y2="0%">
                                    <stop offset="0%" stop-color="currentColor" stop-opacity="0.22"/>
                                    <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
                                </linearGradient>
                            </defs>
                            <g stroke="currentColor" stroke-opacity="0.10" stroke-width="0.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke">
                                <line x1="0" y1="35" x2="100" y2="35"/>
                                <line x1="0" y1="65" x2="100" y2="65"/>
                            </g>
                            ${data.length === 1
                                ? ''
                                : `
                                    <path d="${areaPath}" fill="url(#${gradientId})" stroke="none"/>
                                    <path d="${linePath}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
                                `}
                        </svg>
                        <div class="absolute pointer-events-none -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-surface-50 dark:border-zinc-900 bg-surface-500 dark:bg-zinc-200 shadow-[0_0_4px_rgba(113,113,122,0.55)] dark:shadow-[0_0_8px_rgba(228,228,231,0.45)]" style="left: ${lastX}%; top: ${lastY}%;"></div>
                    </div>
                </div>
            </div>
        `;
    },

    confirmModal({
        title = 'Подтвердите действие',
        message = '',
        confirmText = 'Подтвердить',
        confirmClass = 'bg-primary-600 hover:bg-primary-700 text-white dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 shadow-md',
        cancelText = 'Отмена',
        cancelClass = 'bg-surface-100 dark:bg-white/5 text-surface-700 dark:text-surface-200 hover:bg-surface-200 dark:hover:bg-white/10 border border-surface-200 dark:border-white/10'
    } = {}) {
        return new Promise((resolve) => {
            const host = document.getElementById('modals') || document.body;
            const backdrop = document.createElement('div');
            backdrop.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4 pointer-events-auto opacity-0 transition-opacity duration-200';
            backdrop.innerHTML = `
                <div class="glass-strong rounded-2xl p-6 max-w-sm w-full mx-4 transform transition-all duration-200 scale-95 opacity-0 flex flex-col">
                    <h3 class="text-lg font-bold text-surface-900 dark:text-surface-50 mb-2">${escapeHtml(title)}</h3>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-6 leading-relaxed">${escapeHtml(message)}</p>
                    <div class="flex flex-col-reverse sm:flex-row gap-3">
                        <button type="button" data-modal-cancel class="flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-colors ${cancelClass}">${escapeHtml(cancelText)}</button>
                        <button type="button" data-modal-confirm class="flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-colors ${confirmClass}">${escapeHtml(confirmText)}</button>
                    </div>
                </div>
            `;

            const card = backdrop.firstElementChild;
            const confirmBtn = backdrop.querySelector('[data-modal-confirm]');
            const cancelBtn = backdrop.querySelector('[data-modal-cancel]');

            let settled = false;
            const close = (result) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeydown);
                backdrop.classList.remove('opacity-100');
                card.classList.remove('scale-100', 'opacity-100');
                card.classList.add('scale-95', 'opacity-0');
                setTimeout(() => backdrop.remove(), 200);
                resolve(result);
            };

            function onKeydown(e) {
                if (e.key === 'Escape') close(false);
            }

            confirmBtn.addEventListener('click', () => close(true));
            cancelBtn.addEventListener('click', () => close(false));
            backdrop.addEventListener('click', (e) => {
                if (e.target === backdrop) close(false);
            });
            document.addEventListener('keydown', onKeydown);

            host.appendChild(backdrop);
            requestAnimationFrame(() => {
                backdrop.classList.add('opacity-100');
                card.classList.remove('scale-95', 'opacity-0');
                card.classList.add('scale-100', 'opacity-100');
            });
            cancelBtn.focus();
        });
    }
};