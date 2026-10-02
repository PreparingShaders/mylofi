console.log("[DEBUG] Loaded components.js");
import { Utils } from './utils.js';
import { DB } from './db.js';

let sparklineSeq = 0;
let tonnageChartSeq = 0;
let nutritionChartSeq = 0;

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
     * AI quality badge: score out of 10 plus its grade. A null score renders
     * the neutral placeholder instead of "0.0", which would read as a verdict.
     */
    qualityBadge(score) {
        if (score === null || score === undefined) {
            return `<span class="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-surface-200/70 dark:bg-white/10 text-surface-400 dark:text-surface-500">ИИ-качество —</span>`;
        }
        const grade = Utils.qualityGrade(score);
        return `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold bg-purple-500/15 text-purple-500 dark:text-purple-400">
                   ИИ-качество ${(score / 10).toFixed(1)} / 10
               </span>
               <span class="text-[10px] font-semibold uppercase tracking-wider ${grade.color}">${escapeHtml(grade.label)}</span>`;
    },

    /**
     * Three horizontal macro bars (protein/fat/carbs) with current vs target
     * grams, used by the dashboard day slide.
     */
    macroBars(summary = {}, targets = {}) {
        const safeNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
        const formatNum = (value) => Math.round(value).toLocaleString('ru-RU');
        const pct = (current, target) => (target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0);

        const rows = [
            { label: 'Белки', current: safeNum(summary.protein), target: safeNum(targets.target_protein), color: 'bg-sky-500' },
            { label: 'Жиры', current: safeNum(summary.fat), target: safeNum(targets.target_fat), color: 'bg-rose-400' },
            { label: 'Углеводы', current: safeNum(summary.carbs), target: safeNum(targets.target_carbs), color: 'bg-lime-500' },
        ];

        return rows.map(({ label, current, target, color }) => {
            const valuePct = pct(current, target);
            return `
                <div class="flex items-center gap-2">
                    <span class="w-[70px] shrink-0 truncate text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">${escapeHtml(label)}</span>
                    <div class="flex-1 h-1.5 rounded-full bg-surface-200 dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow="${valuePct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)} ${valuePct}%">
                        <div class="h-full ${color} rounded-full transition-all duration-500 ease-out" style="width: ${valuePct}%"></div>
                    </div>
                    <span class="w-[72px] shrink-0 text-right text-[11px] font-semibold text-surface-800 dark:text-zinc-200 whitespace-nowrap">
                        ${formatNum(current)}<span class="font-normal text-surface-400 dark:text-surface-500"> / ${formatNum(target)} г</span>
                    </span>
                </div>
            `;
        }).join('');
    },

    /**
     * Calorie ring for the dashboard slide. The fill is clamped to a full
     * circle, but the number in the middle stays true to the real intake so an
     * over-target day still reads 2 400 / 2 000 instead of a capped value.
     */
    calorieDonut(summary = {}, targets = {}, size = 116, strokeWidth = 11) {
        const safeNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
        const formatNum = (value) => Math.round(value).toLocaleString('ru-RU');

        const calories = safeNum(summary.calories);
        const target = safeNum(targets.target_calories);

        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const ratio = target > 0 ? calories / target : 0;
        const progress = Math.max(0, Math.min(1, ratio));
        const offset = circumference - progress * circumference;

        // Ring colour tracks the fill: amber while under, rose once over.
        const ringColor = target <= 0
            ? 'text-surface-300 dark:text-zinc-700'
            : (ratio >= 1 ? 'text-rose-500 dark:text-rose-400' : 'text-amber-500 dark:text-amber-400');

        const remaining = Math.round(target - calories);
        const remainingChip = target <= 0
            ? `<span class="text-[10px] font-semibold text-surface-400 dark:text-surface-500">Цель не задана</span>`
            : `<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${remaining < 0
                ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400'
                : 'bg-lime-500/15 text-lime-600 dark:text-lime-400'}">
                   ${remaining < 0 ? `Перебор ${formatNum(-remaining)}` : `Осталось ${formatNum(remaining)}`}
               </span>`;

        return `
            <div class="flex flex-col items-center shrink-0">
                <div class="relative flex items-center justify-center" style="width: ${size}px; height: ${size}px;">
                    <svg class="absolute inset-0 -rotate-90" width="${size}" height="${size}" aria-hidden="true">
                        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="transparent"
                                stroke="currentColor" stroke-width="${strokeWidth}" class="text-surface-200 dark:text-white/10"/>
                        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="transparent"
                                stroke="currentColor" stroke-width="${strokeWidth}" class="${ringColor} transition-all duration-700 ease-out"
                                stroke-linecap="round"
                                stroke-dasharray="${circumference.toFixed(2)} ${circumference.toFixed(2)}"
                                stroke-dashoffset="${offset.toFixed(2)}"/>
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
                        <p class="text-lg font-bold leading-none text-surface-900 dark:text-zinc-100">${formatNum(calories)}</p>
                        <p class="text-[10px] text-surface-400 dark:text-surface-500 mt-0.5">из ${formatNum(target)} ккал</p>
                    </div>
                </div>
                <div class="mt-1.5">${remainingChip}</div>
            </div>
        `;
    },

    /**
     * Compact single-ring "Mercedes" summary for the dashboard day slide.
     *
     * The ring is one track cut into three 120 degree sectors - proteins
     * (amber), fats (rose), carbs (sky). Each sector draws its own track and a
     * progress arc on top of it, rotated into place, so the three macros stay
     * comparable on the same scale. Over-target macros turn rose (#EF4444),
     * as does an over-target calorie intake.
     *
     * The centre carries the AI quality score plus calories vs target, and a
     * thin row underneath repeats the three macros as text with colour dots,
     * which keeps the whole header inside ~180-220px of vertical space.
     */
    mercedesComboRing(summary = {}, targets = {}, qualityScore = null, size = 116, strokeWidth = 12, sectorGapDeg = 8) {
        const safeNum = (val) => (Number.isFinite(Number(val)) ? Number(val) : 0);
        const formatNum = (val) => Math.round(val).toLocaleString('ru-RU');
        const clamp01 = (val) => Math.max(0, Math.min(1, val));

        const calories = safeNum(summary.calories);
        const targetCalories = safeNum(targets.target_calories);

        const macros = [
            { key: 'protein', label: 'Белки', current: safeNum(summary.protein), target: safeNum(targets.target_protein), color: 'amber-500', dot: 'bg-amber-500' },
            { key: 'fat', label: 'Жиры', current: safeNum(summary.fat), target: safeNum(targets.target_fat), color: 'rose-400', dot: 'bg-rose-400' },
            { key: 'carbs', label: 'Углеводы', current: safeNum(summary.carbs), target: safeNum(targets.target_carbs), color: 'sky-500', dot: 'bg-sky-500' },
        ].map((macro) => ({
            ...macro,
            ratio: macro.target > 0 ? macro.current / macro.target : 0,
            over: macro.target > 0 && macro.current > macro.target,
        }));

        const calOver = targetCalories > 0 && calories > targetCalories;
        const remainingCalories = Math.round(targetCalories - calories);

        const center = size / 2;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const sectorDeg = 360 / macros.length;
        // Half the gap is added to the sector start angle so the gap sits
        // evenly between the neighbouring arcs.
        const arcDeg = sectorDeg - sectorGapDeg;
        const arcLength = (arcDeg / 360) * circumference;

        const sector = (macro, index) => {
            const angle = index * sectorDeg + sectorGapDeg / 2;
            const progressLength = clamp01(macro.ratio) * arcLength;
            const fillColor = macro.over ? 'text-rose-500 dark:text-rose-400' : `text-${macro.color} dark:text-${macro.color}`;
            return `
                <g transform="rotate(${angle.toFixed(2)} ${center} ${center})">
                    <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="currentColor"
                            stroke-width="${strokeWidth}" class="text-surface-200 dark:text-white/10"/>
                    ${progressLength > 0 ? `
                        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="currentColor"
                                stroke-width="${strokeWidth}" stroke-linecap="round"
                                class="${fillColor} transition-all duration-700 ease-out"
                                stroke-dasharray="${progressLength.toFixed(2)} ${circumference.toFixed(2)}"/>
                    ` : ''}
                </g>
            `;
        };

        const qualityText = qualityScore === null || qualityScore === undefined
            ? '—'
            : (Number(qualityScore) / 10).toFixed(1);

        const calorieChip = targetCalories <= 0
            ? `<span class="text-[9px] font-semibold text-surface-400 dark:text-surface-500">Цель не задана</span>`
            : `<span class="inline-flex items-center rounded-full px-1.5 py-[1px] text-[9px] font-semibold ${calOver
                ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400'
                : 'bg-lime-500/15 text-lime-600 dark:text-lime-400'}">
                   ${calOver ? `Перебор +${formatNum(-remainingCalories)}` : `Осталось ${formatNum(remainingCalories)}`}
               </span>`;

        const sectorLabel = (macro) => (macro.target > 0
            ? `${Math.round(macro.ratio * 100)}%`
            : '—');

        const macroRow = macros.map((macro) => {
            const pctValue = macro.target > 0 ? Math.min(999, Math.round(macro.ratio * 100)) : 0;
            const valueColor = macro.over ? 'text-rose-500 dark:text-rose-400' : 'text-surface-800 dark:text-zinc-200';
            const dotColor = macro.over ? 'bg-rose-500' : macro.dot;
            return `
                <div class="flex flex-col items-center gap-0.5 min-w-0 flex-1" role="group" aria-label="${escapeHtml(macro.label)} ${pctValue}% от цели">
                    <span class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
                        <span class="w-1.5 h-1.5 rounded-full ${dotColor} shrink-0"></span>${escapeHtml(macro.label)}
                    </span>
                    <span class="text-[11px] font-bold ${valueColor} leading-none tabular-nums">${formatNum(macro.current)}<span class="font-normal text-surface-400 dark:text-surface-500">/${formatNum(macro.target)} г</span></span>
                    <span class="text-[9px] leading-none ${macro.over ? 'text-rose-500 dark:text-rose-400 font-semibold' : 'text-surface-400 dark:text-surface-500'}">${sectorLabel(macro)}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="flex flex-col items-center">
                <div class="relative flex items-center justify-center shrink-0" style="width: ${size}px; height: ${size}px;">
                    <svg class="absolute inset-0 -rotate-90" width="${size}" height="${size}" role="img"
                         aria-label="Белки ${sectorLabel(macros[0])}, жиры ${sectorLabel(macros[1])}, углеводы ${sectorLabel(macros[2])}">
                        ${macros.map(sector).join('')}
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center text-center px-4 leading-none">
                        <span class="text-xl font-extrabold ${calOver ? 'text-rose-500 dark:text-rose-400' : 'text-surface-900 dark:text-zinc-100'}">
                            ${qualityText}<span class="text-[10px] font-normal text-surface-400 dark:text-surface-500">/10</span>
                        </span>
                        <span class="text-[10px] font-bold ${calOver ? 'text-rose-500 dark:text-rose-400' : 'text-surface-600 dark:text-zinc-300'} mt-1 tabular-nums">${formatNum(calories)} / ${formatNum(targetCalories)} ккал</span>
                        <span class="mt-1">${calorieChip}</span>
                    </div>
                </div>

                <div class="w-full flex justify-around items-start gap-2 pt-2 mt-1 border-t border-surface-200 dark:border-white/10 text-xs">
                    ${macroRow}
                </div>
            </div>
        `;
    },

    /**
     * Daily calorie trend for the analytics slide. `series` is the dense day
     * list from /nutrition/week or /nutrition/month ({ key, label, calories }).
     * The target line is drawn as a dashed reference so the curve reads against
     * the goal instead of an arbitrary axis maximum.
     */
    nutritionTrendChart(series = [], { targetCalories = 0, height = 120, emptyText = 'Нет данных за период' } = {}) {
        const points = (series || []).filter(p => p && p.calories !== undefined && p.calories !== null);
        if (points.length === 0) {
            return `<div class="nutrition-trend text-xs text-surface-400 dark:text-surface-500 h-[120px] flex items-center justify-center">${escapeHtml(emptyText)}</div>`;
        }

        const values = points.map(p => Number(p.calories) || 0);
        const target = Number(targetCalories) || 0;
        const max = Math.max(target, ...values);
        // Anchor the baseline at zero so empty days stay visibly flat.
        const min = Math.min(0, ...values);
        const range = (max - min) || 1;

        const slot = 100 / points.length;
        const top = 12;
        const bottom = 88;
        const coords = values.map((value, i) => ({
            x: slot * (i + 0.5),
            y: bottom - ((value - min) / range) * (bottom - top),
        }));

        const gradientId = `nutrition-area-${++nutritionChartSeq}`;
        const linePath = buildSmoothPath(coords);
        const first = coords[0];
        const last = coords[coords.length - 1];
        const areaPath = `${linePath} L ${last.x.toFixed(2)} ${bottom} L ${first.x.toFixed(2)} ${bottom} Z`;
        const targetY = target > 0 ? (bottom - ((target - min) / range) * (bottom - top)).toFixed(2) : null;

        const lastIndex = points.length - 1;
        const step = Math.max(1, Math.ceil(points.length / 6));

        const chartPoints = points.map((point, i) => ({
            x: coords[i].x,
            y: coords[i].y,
            label: String(point.label ?? point.key ?? ''),
            value: values[i],
        }));

        const hits = chartPoints.map((_, i) => `
            <div class="absolute inset-y-0 cursor-pointer" data-nutrition-hit="${i}"
                 style="left: ${(i * slot).toFixed(2)}%; width: ${slot.toFixed(2)}%;"></div>
        `).join('');

        const labels = points.map((point, i) => {
            const text = (i % step === 0 || i === lastIndex) ? String(point.label ?? '') : '';
            return `<span class="flex-1 min-w-0 text-[9px] leading-none text-surface-400 dark:text-surface-500 text-center truncate">${escapeHtml(text)}</span>`;
        }).join('');

        const average = values.reduce((sum, v) => sum + v, 0) / values.length;
        const defaultReadout = `${chartPoints[lastIndex].label}: ${Math.round(values[lastIndex]).toLocaleString('ru-RU')} ккал`;

        return `
            <div class="nutrition-trend w-full select-none text-amber-500 dark:text-amber-400"
                 data-role="nutrition-trend"
                 data-points='${escapeHtml(JSON.stringify(chartPoints))}'>
                <div class="relative w-full touch-pan-y" style="height: ${height}px">
                    <svg class="block w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                            <linearGradient id="${gradientId}" x1="0%" y1="100%" x2="0%" y2="0%">
                                <stop offset="0%" stop-color="currentColor" stop-opacity="0.28"/>
                                <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
                            </linearGradient>
                        </defs>
                        <g stroke="currentColor" stroke-opacity="0.10" stroke-width="0.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke">
                            <line x1="0" y1="36" x2="100" y2="36"/>
                            <line x1="0" y1="63" x2="100" y2="63"/>
                        </g>
                        ${targetY !== null ? `
                            <line x1="0" y1="${targetY}" x2="100" y2="${targetY}" stroke="currentColor"
                                  stroke-opacity="0.65" stroke-width="1.25" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
                        ` : ''}
                        ${points.length > 1 ? `
                            <path d="${areaPath}" fill="url(#${gradientId})" stroke="none"/>
                            <path d="${linePath}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
                        ` : ''}
                    </svg>

                    <div data-nutrition-guide class="pointer-events-none absolute inset-y-0 w-px bg-current transition-opacity duration-150"
                         style="left: ${last.x.toFixed(2)}%;"></div>
                    <div data-nutrition-marker class="pointer-events-none absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 border-2 border-surface-50 dark:border-zinc-900 bg-current shadow-[0_0_6px_rgba(245,158,11,0.5)] transition-opacity duration-150"
                         style="left: ${last.x.toFixed(2)}%; top: ${last.y.toFixed(2)}%;"></div>

                    <div data-nutrition-surface class="absolute inset-0">${hits}</div>
                </div>

                <div class="mt-1.5 flex gap-0.5">${labels}</div>

                <div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-surface-400 dark:text-surface-500">
                    <span data-nutrition-readout class="font-mono truncate" aria-live="polite">${escapeHtml(defaultReadout)}</span>
                    <span class="font-mono flex-shrink-0">Ср. ${Math.round(average).toLocaleString('ru-RU')} ккал</span>
                </div>
            </div>
        `;
    },

    /**
     * Swipable nutrition dashboard: slide 1 is the day view (calorie ring, AI
     * quality, macro bars), slide 2 the period analytics (averages + trend).
     * `periodSelector` is injected by the caller so the active period pill and
     * the slider state stay owned by one component. Each slide renders its own
     * footer, because a caption shared by both would be wrong on the slide the
     * reader is not looking at.
     */
    nutritionDashboardCard({
        title = 'Питание',
        periodSelector = '',
        slides = [],
    } = {}) {
        const count = slides.length;
        const dots = Array.from({ length: count }, (_, i) => `
            <button type="button" data-action="nutrition-dot" data-slide="${i}"
                    aria-label="Слайд ${i + 1}" aria-pressed="${i === 0}"
                    class="nutrition-dot w-1.5 h-1.5 rounded-full transition-all duration-300 ${i === 0
                        ? 'bg-lime-500 dark:bg-lime-400 opacity-100'
                        : 'bg-surface-300 dark:bg-zinc-700 opacity-60'}"></button>
        `).join('');

        const track = slides.map((slide, i) => `
            <section class="nutrition-slide snap-center" data-slide="${i}" aria-label="Слайд ${i + 1}">
                ${slide}
            </section>
        `).join('');

        return `
            <div class="nutrition-dashboard glass rounded-3xl p-4 shadow-xl" role="region" aria-label="Панель питания">
                <div class="flex items-center justify-between gap-3 mb-2">
                    ${periodSelector}
                    <div class="flex items-center gap-1.5 shrink-0" role="group" aria-label="Слайды панели питания">
                        ${dots}
                    </div>
                </div>

                <h3 class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider truncate mb-2">${escapeHtml(title)}</h3>

                <div class="nutrition-track flex overflow-x-auto snap-x snap-mandatory" data-role="nutrition-slides">
                    ${track}
                </div>
            </div>
        `;
    },

    /**
     * First tile of the meal carousel: opens the new-meal sheet.
     */
    addMealActionCard() {
        return `
            <button type="button" data-action="open-add-meal-modal" aria-label="Добавить приём пищи"
                    class="meal-action-slot btn-press flex flex-col items-center justify-center p-6 text-center cursor-pointer
                           border-2 border-dashed border-surface-300 dark:border-zinc-700 hover:border-lime-500
                           bg-surface-50/60 dark:bg-zinc-900/50 transition-colors">
                <span class="w-14 h-14 rounded-2xl bg-lime-500/15 dark:bg-lime-400/10 text-lime-600 dark:text-lime-400 flex items-center justify-center mb-3 shrink-0">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 010 6z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 3v4M20 5h-4"/></svg>
                </span>
                <span class="text-base font-bold text-surface-900 dark:text-zinc-100">Добавить приём пищи</span>
                <span class="text-xs text-surface-500 dark:text-surface-400 mt-1">Сделать фото или загрузить из галереи</span>
            </button>
        `;
    },

    /**
     * Carousel tile shown when the day has no logged meals yet.
     */
    mealCarouselEmptyState() {
        return `
            <div class="meal-empty-slot flex flex-col items-center justify-center p-6 text-center">
                <span class="w-14 h-14 rounded-full glass flex items-center justify-center mb-3 shrink-0">
                    <svg class="w-7 h-7 text-surface-400 dark:text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6l4 2M4 12a8 8 0 1116 0 8 8 0 01-16 0z"/></svg>
                </span>
                <span class="text-base font-bold text-surface-900 dark:text-zinc-100">Нет приёмов пищи</span>
                <span class="text-xs text-surface-500 dark:text-surface-400 mt-1">Нажмите на карточку слева, чтобы добавить первое блюдо</span>
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

        // Unified top chip label: date · time · meal type
        const chipLabel = [escDate, escTime, escType].filter(Boolean).join(' · ');

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
                                <!-- Top row: meal type chip with date, time, and meal type -->
                                <div class="flex items-start">
                                    <div class="glass-badge inline-flex items-center gap-1.5 rounded-full pl-2 pr-3.5 py-1.5 min-w-0">
                                        <span class="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-full bg-white/15 text-white">
                                            ${this.mealTypeIcon(meal.meal_type, 'w-3.5 h-3.5')}
                                        </span>
                                        <span class="text-xs font-semibold text-white truncate">${chipLabel}</span>
                                    </div>
                                </div>

                                <!-- Dish name -->
                                <div class="mt-2 shrink-0">
                                    <h3 class="text-shadow-subtle text-xl font-bold text-white leading-tight truncate">${escName}</h3>
                                </div>

                                <!-- Spacer to push AI analysis to bottom -->
                                <div class="flex-1 min-h-0"></div>

                                <!-- Bottom-anchored AI analysis -->
                                <div class="shrink-0 mt-3 rounded-2xl border border-white/10 bg-black/45 backdrop-blur-[2px] px-3 py-2.5">
                                    <div class="flex items-center gap-1.5 mb-1.5 shrink-0">
                                        <svg class="w-4 h-4 text-primary-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                        <h4 class="text-[11px] font-semibold text-white/70 uppercase tracking-wider">ИИ-анализ</h4>
                                    </div>
                                    <p class="text-shadow-subtle text-sm text-white/85 leading-relaxed" data-no-flip>${aiInsightHtml}</p>
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

    /**
     * Smooth area line chart for the tonnage module. `series` is the dense
     * bucket list from /workouts/tonnage ({ key, label, tonnage_kg }).
     *
     * Points are laid out in equal-width slots so the invisible hover/tap hit
     * zones tile the plot without overlapping, while the bezier curve and the
     * marker share the exact same coordinates. Label thinning keeps long ranges
     * readable on narrow screens. Interaction is bound by the caller on
     * `[data-role="tonnage-chart"]` (see Workouts.bindTonnageChart).
     */
    tonnageLineChart(series = [], { valueKey = 'tonnage_kg', height = 128, emptyText = 'Нет данных за период' } = {}) {
        const points = (series || []).filter(p => p && p[valueKey] !== undefined && p[valueKey] !== null);
        if (points.length === 0) {
            return `<div class="text-xs text-surface-400 h-20 flex items-center justify-center">${escapeHtml(emptyText)}</div>`;
        }

        const values = points.map(p => Number(p[valueKey]) || 0);
        const max = Math.max(...values);
        // Anchor the baseline at zero so empty buckets stay visibly flat.
        const min = Math.min(0, ...values);
        const range = (max - min) || 1;
        const total = values.reduce((sum, v) => sum + v, 0);

        const slot = 100 / points.length;
        const top = 10;
        const bottom = 90;
        const coords = values.map((value, i) => ({
            x: slot * (i + 0.5),
            y: bottom - ((value - min) / range) * (bottom - top),
        }));

        const gradientId = `tonnage-area-${++tonnageChartSeq}`;
        const linePath = buildSmoothPath(coords);
        const first = coords[0];
        const last = coords[coords.length - 1];
        const areaPath = `${linePath} L ${last.x.toFixed(2)} ${bottom} L ${first.x.toFixed(2)} ${bottom} Z`;

        // Thin labels so long ranges never overlap on mobile.
        const step = Math.max(1, Math.ceil(points.length / 6));
        const lastIndex = points.length - 1;

        const chartPoints = points.map((point, i) => ({
            x: coords[i].x,
            y: coords[i].y,
            label: String(point.label ?? point.key ?? ''),
            value: values[i],
        }));

        const hits = chartPoints.map((_, i) => `
            <div class="absolute inset-y-0 cursor-pointer" data-tonnage-hit="${i}"
                 style="left: ${(i * slot).toFixed(2)}%; width: ${slot.toFixed(2)}%;"></div>
        `).join('');

        const labels = points.map((point, i) => {
            const text = (i % step === 0 || i === lastIndex) ? String(point.label ?? '') : '';
            return `<span class="flex-1 min-w-0 text-[9px] leading-none text-surface-400 dark:text-surface-500 text-center truncate">${escapeHtml(text)}</span>`;
        }).join('');

        const lastPoint = chartPoints[lastIndex];
        const defaultReadout = `${lastPoint.label ? `${lastPoint.label}: ` : ''}${Math.round(lastPoint.value).toLocaleString('ru-RU')} кг`;

        return `
            <div class="w-full select-none text-primary-600 dark:text-zinc-100" data-role="tonnage-chart" data-points='${escapeHtml(JSON.stringify(chartPoints))}'>
                <div class="relative w-full touch-pan-y" style="height: ${height}px">
                    <svg class="block w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                            <linearGradient id="${gradientId}" x1="0%" y1="100%" x2="0%" y2="0%">
                                <stop offset="0%" stop-color="currentColor" stop-opacity="0.26"/>
                                <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
                            </linearGradient>
                        </defs>
                        <g stroke="currentColor" stroke-opacity="0.10" stroke-width="0.5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke">
                            <line x1="0" y1="36" x2="100" y2="36"/>
                            <line x1="0" y1="63" x2="100" y2="63"/>
                        </g>
                        ${points.length > 1 ? `
                            <path d="${areaPath}" fill="url(#${gradientId})" stroke="none"/>
                            <path d="${linePath}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
                        ` : ''}
                    </svg>

                    <div data-tonnage-guide class="pointer-events-none absolute inset-y-0 w-px bg-current transition-opacity duration-150"
                         style="left: ${last.x.toFixed(2)}%;"></div>
                    <div data-tonnage-marker class="pointer-events-none absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 border-2 border-surface-50 dark:border-zinc-900 bg-primary-600 dark:bg-zinc-100 shadow-[0_0_6px_rgba(163,230,53,0.5)] transition-opacity duration-150"
                         style="left: ${last.x.toFixed(2)}%; top: ${last.y.toFixed(2)}%;"></div>

                    <div data-tonnage-surface class="absolute inset-0">${hits}</div>
                </div>

                <div class="mt-1.5 flex gap-0.5">${labels}</div>

                <div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-surface-400 dark:text-surface-500">
                    <span data-tonnage-readout class="font-mono truncate" aria-live="polite">${escapeHtml(defaultReadout)}</span>
                    <span class="font-mono flex-shrink-0">Всего: ${Math.round(total).toLocaleString('ru-RU')} кг</span>
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
            <div class="drum-sheet fixed inset-0 z-50 pointer-events-auto">
                <div class="drum-sheet-backdrop absolute inset-0 bg-black/40 dark:bg-black/60" data-action="close-new-meal-modal"></div>
                <div class="drum-sheet-panel absolute bottom-0 left-0 right-0 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 rounded-t-2xl border-t border-zinc-200 dark:border-white/10 flex flex-col drum-sheet-safe" role="dialog" aria-modal="true" aria-labelledby="new-meal-title">
                    <div class="flex flex-col gap-3.5 px-4 pt-0 pb-1">
                        <div class="w-10 h-1 rounded-full bg-zinc-300 dark:bg-white/20 mx-auto drum-sheet-handle flex-shrink-0"></div>

                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-semibold truncate">ДОБАВЛЕНИЕ ПИТАНИЯ</div>
                                <h3 id="new-meal-title" class="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">Новый приём пищи</h3>
                            </div>
                            <button type="button" data-action="close-new-meal-modal" aria-label="Закрыть" class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0 flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"/></svg>
                            </button>
                        </div>

                        <!-- Photo preview, revealed only once a file is picked -->
                        <div id="new-meal-preview-container" class="hidden relative rounded-xl overflow-hidden bg-zinc-800 aspect-[4/3] flex-shrink-0">
                            <img id="new-meal-img" src="" alt="Предпросмотр блюда" class="absolute inset-0 w-full h-full object-cover">
                            <button type="button" id="new-meal-remove-img" data-action="remove-new-meal-img" class="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/75 transition-colors" aria-label="Удалить фото">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                            </button>
                        </div>

                        <!-- Photo source buttons, hidden while a preview is shown -->
                        <div id="new-meal-source-btns" class="grid grid-cols-2 gap-2.5">
                            <button type="button" data-action="new-meal-camera" class="flex flex-col items-center justify-center gap-1.5 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl p-3 text-center cursor-pointer hover:border-lime-500/50 transition">
                                <svg class="w-4 h-4 shrink-0 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 13a3 3 0 100-6 3 3 0 010 6z"/></svg>
                                <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Камера</span>
                            </button>
                            <button type="button" data-action="new-meal-gallery" class="flex flex-col items-center justify-center gap-1.5 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl p-3 text-center cursor-pointer hover:border-lime-500/50 transition">
                                <svg class="w-4 h-4 shrink-0 text-zinc-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Галерея</span>
                            </button>
                        </div>

                        <input type="file" id="new-meal-photo-input" accept="image/*" class="hidden" capture="environment">

                        <div>
                            <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5">Тип приёма пищи</div>
                            <div class="grid grid-cols-4 gap-1.5" role="group" aria-label="Выберите тип приёма пищи">
                                ${mealTypes.map((t) => `
                                    <button type="button" data-action="set-new-meal-type" data-type="${t.value}" aria-pressed="false"
                                            class="new-meal-type-chip px-2 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs font-semibold text-zinc-600 dark:text-zinc-400 transition-all hover:border-lime-500/50 whitespace-nowrap">
                                        ${t.label}
                                    </button>
                                `).join('')}
                            </div>
                        </div>

                        <div>
                            <label for="new-meal-notes" class="block text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5">Заметки <span class="opacity-60 normal-case tracking-normal">(необязательно)</span></label>
                            <textarea id="new-meal-notes" placeholder="Например: Творог 1%, без сахара" rows="2" class="w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-zinc-100 text-sm resize-none focus:border-lime-500 focus:outline-none"></textarea>
                        </div>

                        <button type="button" id="new-meal-submit" data-action="submit-new-meal" class="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-zinc-950 font-semibold text-base shadow-lg shadow-lime-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-lime-500 disabled:shadow-none" disabled>
                            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                            <span>Отправить / Анализировать</span>
                        </button>
                        </div>
                </div>
            </div>
        `;
    },

    /**
     * Anthropometrics & target KBZhU bottom sheet. Pre-filled from the user
     * record; the caller recalculates the preview on every change.
     * Returns HTML string for the modal content.
     */
    anthropometricsModal(user = {}) {
        const genders = [
            { value: 'male', label: 'Мужской' },
            { value: 'female', label: 'Женский' },
        ];
        const activities = [
            { value: 'sedentary', label: 'Минимальная (сидячий образ)' },
            { value: 'light', label: 'Низкая (1-2 тренировки)' },
            { value: 'moderate', label: 'Средняя (3-4 тренировки)' },
            { value: 'active', label: 'Высокая (5-6 тренировок)' },
            { value: 'athlete', label: 'Очень высокая (7+)' },
        ];
        const goals = [
            { value: 'lose', label: 'Снизить' },
            { value: 'maintain', label: 'Поддерживать' },
            { value: 'gain', label: 'Набрать' },
        ];

        const currentGender = genders.some((g) => g.value === user.gender) ? user.gender : 'male';
        const currentActivity = activities.some((a) => a.value === user.activity_level) ? user.activity_level : 'moderate';
        const currentGoal = goals.some((g) => g.value === user.goal) ? user.goal : 'maintain';

        const genderChips = genders.map(({ value, label }) => `
            <button type="button" data-action="set-anthro-gender" data-value="${value}" aria-pressed="${value === currentGender}"
                    class="anthro-chip px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs font-semibold text-zinc-600 dark:text-zinc-400 transition-all hover:border-lime-500/50 whitespace-nowrap">
                ${label}
            </button>
        `).join('');

        const goalChips = goals.map(({ value, label }) => `
            <button type="button" data-action="set-anthro-goal" data-value="${value}" aria-pressed="${value === currentGoal}"
                    class="anthro-chip px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-xs font-semibold text-zinc-600 dark:text-zinc-400 transition-all hover:border-lime-500/50 whitespace-nowrap">
                ${label}
            </button>
        `).join('');

        const activityOptions = activities.map(({ value, label }) => `
            <option value="${value}" ${value === currentActivity ? 'selected' : ''}>${label}</option>
        `).join('');

        const fieldClass = 'w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-zinc-100 text-sm focus:border-lime-500 focus:outline-none';
        const labelClass = 'block text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5';

        return `
            <div class="drum-sheet fixed inset-0 z-50 pointer-events-auto">
                <div class="drum-sheet-backdrop absolute inset-0 bg-black/40 dark:bg-black/60" data-action="close-anthropometrics-modal"></div>
                <div class="drum-sheet-panel absolute bottom-0 left-0 right-0 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 rounded-t-2xl border-t border-zinc-200 dark:border-white/10 flex flex-col drum-sheet-safe" role="dialog" aria-modal="true" aria-labelledby="anthro-title">
                    <div class="flex flex-col gap-3.5 px-4 pt-0 pb-1">
                        <div class="w-10 h-1 rounded-full bg-zinc-300 dark:bg-white/20 mx-auto drum-sheet-handle flex-shrink-0"></div>

                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-semibold truncate">АНТРОПОМЕТРИКА</div>
                                <h3 id="anthro-title" class="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">Целевая норма КБЖУ</h3>
                            </div>
                            <button type="button" data-action="close-anthropometrics-modal" aria-label="Закрыть" class="w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0 flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"/></svg>
                            </button>
                        </div>

                        <div>
                            <div class="${labelClass}">Пол</div>
                            <div class="grid grid-cols-2 gap-1.5" role="group" aria-label="Пол">
                                ${genderChips}
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2.5">
                            <div>
                                <label for="anthro-age" class="${labelClass}">Возраст</label>
                                <input type="number" inputmode="numeric" id="anthro-age" data-field="age" min="10" max="100" placeholder="30"
                                       value="${escapeHtml(user.age ?? '')}" class="${fieldClass}">
                            </div>
                            <div>
                                <label for="anthro-height" class="${labelClass}">Рост, см</label>
                                <input type="number" inputmode="decimal" id="anthro-height" data-field="height" min="100" max="250" step="0.5" placeholder="175"
                                       value="${escapeHtml(user.height_cm ?? '')}" class="${fieldClass}">
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2.5">
                            <div>
                                <label for="anthro-weight" class="${labelClass}">Вес, кг</label>
                                <input type="number" inputmode="decimal" id="anthro-weight" data-field="weight" min="30" max="300" step="0.1" placeholder="70"
                                       value="${escapeHtml(user.weight_kg ?? '')}" class="${fieldClass}">
                            </div>
                            <div>
                                <label for="anthro-target-weight" class="${labelClass}">Целевой вес, кг <span class="opacity-60 normal-case tracking-normal">(необязательно)</span></label>
                                <input type="number" inputmode="decimal" id="anthro-target-weight" data-field="target_weight" min="30" max="300" step="0.1" placeholder="—"
                                       value="${escapeHtml(user.target_weight_kg ?? '')}" class="${fieldClass}">
                            </div>
                        </div>

                        <div>
                            <label for="anthro-activity" class="${labelClass}">Активность</label>
                            <select id="anthro-activity" data-field="activity" class="${fieldClass}">
                                ${activityOptions}
                            </select>
                        </div>

                        <div>
                            <div class="${labelClass}">Цель</div>
                            <div class="grid grid-cols-3 gap-1.5" role="group" aria-label="Цель">
                                ${goalChips}
                            </div>
                        </div>

                        <div id="anthro-preview" class="anthro-preview rounded-xl p-3"></div>

                        <button type="button" id="anthro-submit" data-action="save-anthropometrics"
                                class="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-zinc-950 font-semibold text-base shadow-lg shadow-lime-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-lime-500 disabled:shadow-none" disabled>
                            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                            <span>Сохранить и пересчитать</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
};
