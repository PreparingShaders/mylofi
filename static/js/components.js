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

    caloricDonut(current, target, color = '#3b82f6', trackColor = '#d4d4d8') {
        const pct = Math.min(100, Math.max(0, (target > 0 ? (current / target) * 100 : 0)));
        const rounded = Math.round(current);
        const roundedTarget = Math.round(target);
        const pctClamped = Math.max(0.5, pct);

        return `
            <div class="relative flex items-center justify-center" style="--donut-color: ${color}; --donut-track: ${trackColor}; --donut-pct: ${pctClamped}%;">
                <div class="caloric-donut">
                    <div class="caloric-donut__track"></div>
                    <div class="caloric-donut__progress"></div>
                    <div class="caloric-donut__center flex items-center justify-center">
                        <div class="text-center">
                            <p class="text-xl font-bold text-surface-900 dark:text-zinc-100 leading-tight">${rounded}</p>
                            <p class="text-[10px] text-surface-500 dark:text-surface-400 leading-tight">/ ${roundedTarget} ккал</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
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

    mealCarouselCard(meal, app) {
        const isPending = meal.status === 'pending' || meal.status === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING;
        const isFailed = meal.sync_status === DB.SYNC_STATUS.FAILED;
        const day = meal.eaten_at ? new Date(meal.eaten_at) : (meal.created_at ? new Date(meal.created_at) : null);

        const mealTypeLabel = (type) => {
            const map = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
            if (!type) return 'Приём пищи';
            return map[type] || type;
        };

        const dishName = meal.dish_name || (isPending ? 'Анализ...' : 'Блюдо');
        const mealType = mealTypeLabel(meal.meal_type);
        const timeLabel = day ? Utils.formatTime(day) : '';

        const calories = Math.round(meal.calories || 0);
        const protein = Math.round(meal.protein_g || meal.protein || 0);
        const fat = Math.round(meal.fat_g || meal.fat || 0);
        const carbs = Math.round(meal.carbs_g || meal.carbs || 0);
        const fiber = Math.round(meal.fiber_g || 0);
        const sugar = Math.round(meal.sugar_g || 0);
        const sodium = Math.round(meal.sodium_mg || 0);

        const hasMacros = calories > 0 || protein > 0 || fat > 0 || carbs > 0;
        const blobSrc = meal.blob ? URL.createObjectURL(meal.blob) : null;
        const imgSrc = meal.image_url || meal.photo_url || blobSrc || null;
        const safeSrc = imgSrc ? String(imgSrc).replace(/'/g, '%27') : null;

        let qualityScore = null;
        if (!isPending && !isFailed && hasMacros) {
            qualityScore = Utils.computeQualityScore({ calories, protein, fat, carbs });
        }
        const grade = qualityScore !== null ? Utils.qualityGrade(qualityScore) : { label: isPending ? 'Очередь' : '—', color: 'text-amber-400' };

        const aiText = meal.ai_insight || meal.notes || (isPending ? 'Идёт анализ изображения...' : 'AI-анализ пока недоступен');
        const escName = escapeHtml(dishName);
        const escAi = escapeHtml(aiText);

        const qualityBadge = qualityScore !== null
            ? `<div class="flex items-center gap-1 bg-black/30 backdrop-blur rounded-lg px-2 py-1">
                   <span class="text-xs font-bold text-white">${qualityScore}</span>
                   <span class="text-[9px] text-white/50">/100</span>
               </div>`
            : `<div class="flex items-center gap-1 bg-amber-500/20 backdrop-blur rounded-lg px-2 py-1">
                   <span class="text-xs font-medium text-amber-300">${grade.label}</span>
               </div>`;

        const frontImage = safeSrc
            ? `<div class="absolute inset-0 bg-cover bg-center" style="background-image: url('${safeSrc}');"></div>`
            : `<div class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-300 to-surface-400 dark:from-white/5 dark:to-white/10">
                   <svg class="w-12 h-12 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                       <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 010 6z"/>
                   </svg>
               </div>`;

        const macroClass = (v) => v > 0 ? 'text-white' : 'text-white/40';

        return `
            <div class="snap-start w-72 shrink-0">
                <div class="flip-card" data-meal-id="${meal.id || ''}">
                    <div class="flip-card-inner relative w-full aspect-[4/3]">
                        <div class="flip-card-face flip-card-front flex flex-col justify-end ${isFailed ? 'ring-2 ring-red-500/30' : ''}">
                            ${frontImage}
                            <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent"></div>
                            <div class="relative p-4">
                                <div class="flex items-end justify-between">
                                    <div class="flex flex-col">
                                        <h3 class="font-bold text-white text-lg leading-tight">${escName}</h3>
                                        <p class="text-sm text-white/75 mt-0.5">${escapeHtml(mealType)} · ${timeLabel}</p>
                                    </div>
                                    ${qualityBadge}
                                </div>
                                <div class="grid grid-cols-4 gap-1.5 mt-3 text-center">
                                    <div><p class="text-sm font-bold text-white">${calories || '—'}</p><p class="text-[9px] text-white/50">Ккал</p></div>
                                    <div><p class="text-sm font-bold ${macroClass(protein)}">${protein || '—'}г</p><p class="text-[9px] text-white/60">Б</p></div>
                                    <div><p class="text-sm font-bold ${macroClass(fat)}">${fat || '—'}г</p><p class="text-[9px] text-white/60">Ж</p></div>
                                    <div><p class="text-sm font-bold ${macroClass(carbs)}">${carbs || '—'}г</p><p class="text-[9px] text-white/60">У</p></div>
                                </div>
                            </div>
                        </div>
                        <div class="flip-card-face flip-card-back p-4 flex flex-col">
                            <div class="mb-4">
                                <h4 class="text-xs font-semibold text-surface-400 dark:text-surface-300 uppercase tracking-wider mb-2.5">Состав блюда</h4>
                                <div class="grid grid-cols-2 gap-2">
                                    <div class="glass dark:bg-zinc-900/40 rounded-xl p-3 text-center">
                                        <p class="text-xl font-bold text-surface-900 dark:text-zinc-100">${calories || '—'}</p>
                                        <p class="text-[10px] text-surface-500">Ккал</p>
                                    </div>
                                    <div class="glass dark:bg-zinc-900/40 rounded-xl p-3 text-center">
                                        <p class="text-xl font-bold text-surface-900 dark:text-zinc-100">${protein || '—'}г</p>
                                        <p class="text-[10px] text-surface-500">Белки</p>
                                    </div>
                                    <div class="glass dark:bg-zinc-900/40 rounded-xl p-3 text-center">
                                        <p class="text-xl font-bold text-surface-900 dark:text-zinc-100">${fat || '—'}г</p>
                                        <p class="text-[10px] text-surface-500">Жиры</p>
                                    </div>
                                    <div class="glass dark:bg-zinc-900/40 rounded-xl p-3 text-center">
                                        <p class="text-xl font-bold text-surface-900 dark:text-zinc-100">${carbs || '—'}г</p>
                                        <p class="text-[10px] text-surface-500">Углеводы</p>
                                    </div>
                                </div>
                                ${fiber > 0
                                    ? `<p class="text-xs text-surface-500 dark:text-surface-400 mt-2.5">Клетчатка: ${fiber}г · Сахар: ${sugar}г · Натрий: ${sodium}мг</p>`
                                    : ''}
                            </div>
                            <div class="glass-strong dark:bg-zinc-900/60 rounded-xl p-3 mb-4 flex-1 overflow-y-auto">
                                <p class="text-xs text-surface-500 dark:text-zinc-300 italic leading-relaxed">${escAi}</p>
                            </div>
                            <div class="flex gap-2">
                                <button data-action="edit-meal" data-meal-id="${meal.id}" class="flex-1 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-white/10 rounded-lg transition-colors">Редактировать</button>
                                <button data-action="delete-meal" data-meal-id="${meal.id}" class="flex-1 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">Удалить</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
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