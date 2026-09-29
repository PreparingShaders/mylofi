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
     * Ultra-compact 5-column metric bar replacing the circular ring.
     * Columns: Calories, Protein, Fat, Carbs, Quality Score.
     */
    nutritionMetricsBar(summary = {}, targets = {}, scoreOverride = null) {
        const safeNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

        const calories = safeNum(summary.calories);
        const protein = safeNum(summary.protein);
        const fat = safeNum(summary.fat);
        const carbs = safeNum(summary.carbs);

        const targetCalories = safeNum(targets.target_calories);
        const targetProtein = safeNum(targets.target_protein);
        const targetFat = safeNum(targets.target_fat);
        const targetCarbs = safeNum(targets.target_carbs);

        const hasMacros = calories > 0 || protein > 0 || fat > 0 || carbs > 0;
        const score = scoreOverride !== null ? scoreOverride : (hasMacros ? Utils.computeQualityScore({ calories, protein, fat, carbs }) : null);
        const gradeObj = score !== null ? Utils.qualityGrade(score) : { label: 'Нет данных', color: 'text-surface-400' };

        const pct = (current, target) => target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

        const metricColumns = [
            { label: 'Ккал', value: Math.round(calories), target: targetCalories, pct: pct(calories, targetCalories), color: 'amber-500' },
            { label: 'Белки', value: Math.round(protein), target: targetProtein, pct: pct(protein, targetProtein), color: 'amber-500', unit: 'г' },
            { label: 'Жиры', value: Math.round(fat), target: targetFat, pct: pct(fat, targetFat), color: 'lime-500', unit: 'г' },
            { label: 'Углеводы', value: Math.round(carbs), target: targetCarbs, pct: pct(carbs, targetCarbs), color: 'sky-500', unit: 'г' },
            { label: 'Качество', value: score !== null ? score : '—', target: 100, pct: score !== null ? score : 0, color: 'purple-500' },
        ];

        const columnHtml = metricColumns.map((col) => `
            <div class="flex flex-col items-center gap-0.5 min-w-0">
                <span class="text-[9px] font-medium text-surface-400 dark:text-surface-500 uppercase tracking-wider">${escapeHtml(col.label)}</span>
                <span class="text-xs font-bold text-surface-900 dark:text-zinc-100 leading-none whitespace-nowrap">
                    ${col.value}${col.unit ? ' ' + escapeHtml(col.unit) : ''}
                    ${col.target > 0 && col.value !== '—' ? `<span class="text-[8px] font-normal text-surface-400 dark:text-surface-500 ml-0.5">/ ${Math.round(col.target)}${col.unit ? ' ' + escapeHtml(col.unit) : ''}</span>` : ''}
                </span>
                <div class="w-full h-1 bg-surface-200 dark:bg-white/10 rounded-full overflow-hidden" role="progressbar" aria-valuenow="${col.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(col.label)} ${col.pct}%">
                    <div class="h-full bg-${col.color} rounded-full transition-all duration-500 ease-out" style="width: ${col.pct}%"></div>
                </div>
            </div>
        `).join('');

        return `
            <div class="glass-strong rounded-xl p-2.5 mb-3" role="region" aria-label="Показатели питания">
                <div class="grid grid-cols-5 gap-1.5 text-center">
                    ${columnHtml}
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
        const dateLabel = day ? Utils.formatDayMonth(day) : '';

        const calories = Math.round(meal.calories || 0);
        const protein = Math.round(meal.protein_g || meal.protein || 0);
        const fat = Math.round(meal.fat_g || meal.fat || 0);
        const carbs = Math.round(meal.carbs_g || meal.carbs || 0);
        const qualityScore = meal.quality_score !== undefined ? meal.quality_score : (meal.ingredients ? Utils.computeQualityScore({ calories, protein: meal.protein_g || meal.protein, fat: meal.fat_g || meal.fat, carbs: meal.carbs_g || meal.carbs }) : null);

        const photoSrc = this.mealPhotoUrl(meal);
        const safeSrc = photoSrc ? String(photoSrc).replace(/'/g, '%27').replace(/"/g, '%22') : null;

        const escName = escapeHtml(dishName);
        const escType = escapeHtml(mealType);
        const escTime = escapeHtml(timeLabel);
        const escDate = escapeHtml(dateLabel);
        const escCal = escapeHtml(String(calories));
        const escP = escapeHtml(String(protein));
        const escF = escapeHtml(String(fat));
        const escC = escapeHtml(String(carbs));
        const mealId = meal.id ?? '';

        // Front face background
        const frontBackground = safeSrc
            ? `style="background-image: url('${safeSrc}');"`
            : `class="bg-gradient-to-br from-surface-800 to-surface-900 dark:from-zinc-800 dark:to-zinc-900"`;

        // Quality score is no longer rendered on the front face; the unified
        // КБЖУ pill carries the macro breakdown instead.
        const qualityBadge = '';

        // Back face: ingredients & details
        let ingredientsHtml = '';
        if (meal.ingredients && Array.isArray(meal.ingredients) && meal.ingredients.length > 0) {
            ingredientsHtml = meal.ingredients.map(ing => `
                <div class="flex items-center justify-between py-1.5 border-b border-white/10 last:border-0">
                    <span class="text-sm text-white/80">${escapeHtml(ing.name || 'Ингредиент')}</span>
                    <span class="text-xs text-white/60 font-mono">${Math.round(ing.amount || 0)}г</span>
                </div>
            `).join('');
        } else if (meal.notes) {
            ingredientsHtml = `<p class="text-sm text-white/70 whitespace-pre-wrap">${escapeHtml(meal.notes)}</p>`;
        } else {
            ingredientsHtml = '<p class="text-sm text-white/50 text-center py-4">Детали недоступны</p>';
        }

// Micronutrients if available
        const fiber = meal.fiber_g !== undefined ? Math.round(meal.fiber_g) : null;
        const sugar = meal.sugar_g !== undefined ? Math.round(meal.sugar_g) : null;
        const sodium = meal.sodium_mg !== undefined ? Math.round(meal.sodium_mg) : null;

        const micronutrientsHtml = (fiber !== null || sugar !== null || sodium !== null)
            ? `
                <div class="mt-4 pt-4 border-t border-white/10">
                    <p class="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">Микронутриенты</p>
                    <div class="grid grid-cols-3 gap-2">
                        ${fiber !== null ? `<div class="text-center p-2 rounded-lg bg-white/5"><p class="text-xs font-bold text-white">${fiber}г</p><p class="text-[9px] text-white/50">Клетчатка</p></div>` : ''}
                        ${sugar !== null ? `<div class="text-center p-2 rounded-lg bg-white/5"><p class="text-xs font-bold text-white">${sugar}г</p><p class="text-[9px] text-white/50">Сахар</p></div>` : ''}
                        ${sodium !== null ? `<div class="text-center p-2 rounded-lg bg-white/5"><p class="text-xs font-bold text-white">${sodium}мг</p><p class="text-[9px] text-white/50">Натрий</p></div>` : ''}
                    </div>
                </div>
            `
            : '';

        // Notes section
        const notesHtml = meal.notes
            ? `
                <div class="mt-4 pt-4 border-t border-white/10">
                    <p class="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">Заметки</p>
                    <p class="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">${escapeHtml(meal.notes)}</p>
                </div>
            `
            : '';

        // Macro pills are now rendered inside the unified КБЖУ pill at the bottom,
        // so the old per-macro row is dropped to avoid duplication.
        const macroPills = '';

        // AI analysis is bound 1:1 to its meal and rendered inside the card front face.
        const insight = meal.ai_insight;
        const aiInsightHtml = (typeof insight === 'string' && insight.trim())
            ? escapeHtml(insight.trim())
            : '<span class="text-white/50">Нет данных анализа для отображения</span>';

        return `
            <article class="snap-center shrink-0 meal-card-slot" data-meal-id="${mealId}">
                <div class="meal-card-3d relative w-full h-full perspective-card ${isFailed ? 'ring-2 ring-red-500/40' : ''}" data-meal-id="${mealId}">
                    <div class="meal-card-inner relative w-full h-full transform-style-preserve-3d transition-transform duration-500 ease-out" data-action="flip-card">
                        <!-- FRONT FACE -->
                        <div class="meal-card-front absolute inset-0 backface-hidden rounded-2xl overflow-hidden bg-zinc-900">
                            <div ${frontBackground} class="absolute inset-0 bg-cover bg-center"></div>
                            <!-- Adaptive contrast scrims: top for badges, bottom for text -->
                            <div class="meal-card-scrim absolute inset-x-0 top-0 h-20 pointer-events-none"></div>
                            <div class="meal-card-gradient absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"></div>

                            <div class="relative z-10 h-full flex flex-col p-4">
                                <!-- Top row: meal type + time + date -->
                                <div class="flex items-start">
                                    <div class="glass-badge inline-flex items-center gap-1.5 rounded-full pl-2 pr-3.5 py-1.5 min-w-0">
                                        <span class="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-white/15 text-white">
                                            ${this.mealTypeIcon(meal.meal_type, 'w-3.5 h-3.5')}
                                        </span>
                                        <span class="text-xs font-semibold text-white truncate">${escType}</span>
                                        ${timeLabel ? `<span class="text-xs text-white/60 shrink-0">· ${escTime}</span>` : ''}
                                        ${dateLabel ? `<span class="text-xs text-white/40 shrink-0">${escDate}</span>` : ''}
                                    </div>
                                </div>

                                <!-- Dish name -->
                                <div class="mt-2 shrink-0">
                                    <h3 class="text-shadow-subtle text-xl font-bold text-white leading-tight truncate">${escName}</h3>
                                </div>

                                <!-- AI analysis for this meal -->
                                <div class="flex-1 min-h-0 mt-2">
                                    <div class="h-full rounded-2xl border border-white/10 bg-black/45 backdrop-blur-[2px] px-3 py-2.5 flex flex-col min-h-0">
                                        <div class="flex items-center gap-1.5 mb-1.5 shrink-0">
                                            <svg class="w-4 h-4 text-primary-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                            <h4 class="text-[11px] font-semibold text-white/70 uppercase tracking-wider">ИИ-анализ</h4>
                                        </div>
                                        <p class="text-shadow-subtle text-sm text-white/85 leading-relaxed flex-1 min-h-0 overflow-y-auto" data-no-flip>${aiInsightHtml}</p>
                                    </div>
                                </div>

                                <!-- Bottom: Full КБЖУ pill badge -->
                                <div class="flex items-center mt-3 shrink-0">
                                    <div class="glass-badge inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/10">
                                        <span class="text-sm font-semibold text-white">${escCal} ккал</span>
                                        <span class="text-sm text-white/70">Б ${escP}г</span>
                                        <span class="text-sm text-white/70">·</span>
                                        <span class="text-sm text-white/70">Ж ${escF}г</span>
                                        <span class="text-sm text-white/70">·</span>
                                        <span class="text-sm text-white/70">У ${escC}г</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- BACK FACE -->
                        <div class="meal-card-back absolute inset-0 backface-hidden rotate-y-180 rounded-2xl overflow-hidden bg-zinc-900 p-3.5 flex flex-col">
                            <div class="flex items-center justify-between mb-3 shrink-0">
                                <h4 class="text-base font-semibold text-white truncate">Детали блюда</h4>
                                <button type="button" data-action="flip-card" class="glass-badge w-7 h-7 rounded-full flex items-center justify-center text-white/85 hover:text-white transition-colors shrink-0" aria-label="Назад">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                                </button>
                            </div>

                            <div class="flex-1 overflow-y-auto min-h-0 space-y-3">
                                <!-- Ingredients Section -->
                                <div>
                                    <p class="text-[10px] font-medium text-white/50 uppercase tracking-wider mb-1">Состав / Ингредиенты</p>
                                    ${ingredientsHtml}
                                </div>

                                ${micronutrientsHtml}

                                ${notesHtml}
                            </div>

                            <div class="flex gap-2 mt-3 pt-3 border-t border-white/10 shrink-0">
                                <button type="button" data-action="edit-meal" data-meal-id="${mealId}" class="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors">Редактировать</button>
                                <button type="button" data-action="delete-meal" data-meal-id="${mealId}" class="flex-1 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm font-medium transition-colors">Удалить</button>
                            </div>
                        </div>
                    </div>
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
            backdrop.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto opacity-0 transition-opacity duration-200';
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
    },

    /**
     * New Meal Modal with photo preview, meal type selection, notes, and explicit submit.
     * Returns HTML string for the modal content.
     */
    newMealModal() {
        const mealTypes = [
            { value: 'breakfast', label: 'Завтрак' },
            { value: 'lunch', label: 'Обед' },
            { value: 'dinner', label: 'Ужин' },
            { value: 'snack', label: 'Перекус' },
        ];

        return `
            <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3" data-action="close-new-meal-modal">
                <div class="w-full max-w-xs sm:max-w-sm glass-strong rounded-2xl p-4 animate-slide-up flex flex-col gap-3" role="dialog" aria-modal="true" aria-labelledby="new-meal-title" data-action="stop-propagation">
                    <div class="flex items-center justify-between">
                        <h3 id="new-meal-title" class="text-base font-bold text-surface-900 dark:text-surface-50">Новый приём пищи</h3>
                        <button type="button" data-action="close-new-meal-modal" aria-label="Закрыть" class="w-8 h-8 -mr-1 -mt-1 rounded-xl flex items-center justify-center text-surface-500 hover:text-surface-900 dark:hover:text-surface-50 transition-colors shrink-0">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>

                    <!-- Photo preview, revealed only once a file is picked -->
                    <div id="new-meal-preview-container" class="hidden relative rounded-xl overflow-hidden bg-zinc-800 aspect-[4/3]">
                        <img id="new-meal-img" src="" alt="Предпросмотр блюда" class="absolute inset-0 w-full h-full object-cover">
                        <button type="button" id="new-meal-remove-img" data-action="remove-new-meal-img" class="absolute top-2 right-2 w-7 h-7 rounded-full glass-badge text-white flex items-center justify-center hover:bg-black/60 transition-colors" aria-label="Удалить фото">
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>

                    <!-- Photo source buttons, hidden while a preview is shown -->
                    <div id="new-meal-source-btns" class="grid grid-cols-2 gap-2">
                        <button type="button" data-action="new-meal-camera" class="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 text-sm font-medium text-surface-900 dark:text-zinc-100 transition-colors hover:bg-surface-100 dark:hover:bg-white/5">
                            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 010 6z"/></svg>
                            <span>Камера</span>
                        </button>
                        <button type="button" data-action="new-meal-gallery" class="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 text-sm font-medium text-surface-900 dark:text-zinc-100 transition-colors hover:bg-surface-100 dark:hover:bg-white/5">
                            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                            <span>Галерея</span>
                        </button>
                    </div>

                    <input type="file" id="new-meal-photo-input" accept="image/*" class="hidden" capture="environment">

                    <div>
                        <span class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1.5">Тип приёма пищи</span>
                        <div class="grid grid-cols-4 gap-1.5" role="group" aria-label="Выберите тип приёма пищи">
                            ${mealTypes.map((t) => `
                                <button type="button" data-action="set-new-meal-type" data-type="${t.value}" aria-pressed="false"
                                        class="new-meal-type-chip px-1 py-1.5 rounded-lg border border-surface-200 dark:border-white/10 text-[11px] font-medium text-surface-600 dark:text-surface-400 transition-colors whitespace-nowrap">
                                    ${t.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <label for="new-meal-notes" class="block text-[11px] font-medium text-surface-500 dark:text-surface-400 mb-1.5">Заметки <span class="opacity-60">(необязательно)</span></label>
                        <textarea id="new-meal-notes" placeholder="Например: Творог 1%, без сахара" class="w-full px-3 py-2 rounded-xl glass-input text-sm resize-none" rows="2"></textarea>
                    </div>

                    <button type="button" id="new-meal-submit" data-action="submit-new-meal" class="w-full flex items-center justify-center gap-2 py-3 glass rounded-xl text-center transition-all bg-primary-600 hover:bg-primary-700 text-white shadow-lg shadow-primary-600/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary-600 disabled:shadow-none" disabled>
                        <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                        <span class="text-sm font-semibold">Отправить / Анализировать</span>
                    </button>
                </div>
            </div>
        `;
    }
};