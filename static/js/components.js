console.log("[DEBUG] Loaded components.js");
import { Utils } from './utils.js';
import { DB } from './db.js';

let sparklineSeq = 0;
let tonnageChartSeq = 0;

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

const MACRO_ICON_PATHS = {
    protein: '<path d="M4 9.5v5"/><path d="M7.5 7v10"/><path d="M16.5 7v10"/><path d="M20 9.5v5"/><path d="M7.5 12h9"/>',
    fat: '<path d="M12 3.4c2.9 3.7 4.9 6.3 4.9 9a4.9 4.9 0 0 1-9.8 0c0-2.7 2-5.3 4.9-9Z"/>',
    carbs: '<path d="M12 3.6c.7 4.3 1.9 5.5 6.1 6.2-4.2.7-5.4 1.9-6.1 6.2-.7-4.3-1.9-5.5-6.1-6.2 4.2-.7 5.4-1.9 6.1-6.2Z"/>',
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
     * AI quality badge for a single meal, in tenths: "8.5 / 10". The score is
     * stored 0-100, so it is divided here; a meal with nothing to score keeps
     * the neutral placeholder instead of a hard "0.0" verdict.
     */
    qualityBadge(score) {
        if (score === null || score === undefined || !Number.isFinite(Number(score))) {
            return `<span class="glass-badge inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold text-white/85 whitespace-nowrap" aria-label="ИИ-качество не рассчитано">—<span class="opacity-60">/10</span></span>`;
        }
        const value = (Number(score) / 10).toFixed(1);
        return `<span class="glass-badge inline-flex items-center rounded-full px-2 py-1 text-[11px] font-bold text-white tabular-nums whitespace-nowrap" aria-label="ИИ-качество ${value} из 10">${escapeHtml(value)}<span class="opacity-60">/10</span></span>`;
    },

    /**
     * Parse quality_reason JSON and render compact metric bars.
     * Falls back to plain text if JSON parsing fails.
     */
    qualityMetrics(qualityReason) {
        if (!qualityReason) return '';
        let metrics = [];
        try {
            metrics = JSON.parse(qualityReason);
        } catch (e) {
            return `<p class="text-[11px] text-white/70 leading-snug">${escapeHtml(qualityReason)}</p>`;
        }
        if (!Array.isArray(metrics) || metrics.length === 0) return '';
        const maxScore = 10;
        return `
            <div class="space-y-1.5">
                ${metrics.map(m => {
                    const score = Math.max(0, Math.min(maxScore, Number(m.score) || 0));
                    const pct = Math.round((score / maxScore) * 100);
                    const color = pct >= 80 ? 'bg-lime-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
                    return `
                        <div>
                            <div class="flex items-center justify-between mb-0.5">
                                <span class="text-[11px] font-medium text-white/85">${escapeHtml(m.label || '')}</span>
                                <span class="text-[10px] font-mono text-white/60 tabular-nums">${score.toFixed(1)}/${maxScore}</span>
                            </div>
                            <div class="h-1 rounded-full bg-white/10 overflow-hidden">
                                <div class="h-full ${color} rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
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
     * Compact single-ring "Mercedes" summary for the dashboard slides.
     *
     * The ring is one circle cut into three 120 degree sectors - proteins
     * (emerald), fats (orange), carbs (cyan). Every sector draws its own faint
     * rounded track and its own filled arc on top, so the three macros float as
     * separate thick pills instead of sharing one continuous circle. Over-target
     * macros turn crimson (#EF4444), as does an over-target calorie intake.
     *
     * Round line caps bleed half a stroke past each end of an arc, so the drawn
     * path is shortened by that much on both sides; sectorGapDeg therefore stays
     * the real visible gap between neighbouring pills rather than the gap
     * between their raw path endpoints.
     *
     * The whole layout is rotated 165 degrees so the pill middles land at 10:30,
     * 2:45 and 6:45 - that is what lets each macro label sit outside the ring in
     * the direction its own pill points to (proteins top-left, fats right, carbs
     * bottom) instead of the old macro table underneath, which is what keeps the
     * header inside ~200-220px.
     *
     * Each filled pill carries a small white line-art glyph (dumbbell, oil drop,
     * spark) parked at its leading edge, so the icon travels as the value grows.
     */
    mercedesComboRing(summary = {}, targets = {}, qualityScore = null, size = 120, strokeWidth = 19, sectorGapDeg = 14) {
        const safeNum = (val) => (Number.isFinite(Number(val)) ? Number(val) : 0);
        const formatNum = (val) => Math.round(val).toLocaleString('ru-RU');
        const clamp01 = (val) => Math.max(0, Math.min(1, val));

        const calories = safeNum(summary.calories);
        const targetCalories = safeNum(targets.target_calories);

        const macros = [
            { key: 'protein', label: 'Белки', icon: 'protein', tone: 'emerald-500', position: 'macro-label-protein', current: safeNum(summary.protein), target: safeNum(targets.target_protein) },
            { key: 'fat', label: 'Жиры', icon: 'fat', tone: 'orange-500', position: 'macro-label-fat', current: safeNum(summary.fat), target: safeNum(targets.target_fat) },
            { key: 'carbs', label: 'Углеводы', icon: 'carbs', tone: 'cyan-500', position: 'macro-label-carbs', current: safeNum(summary.carbs), target: safeNum(targets.target_carbs) },
        ].map((macro) => ({
            ...macro,
            ratio: macro.target > 0 ? macro.current / macro.target : 0,
            over: macro.target > 0 && macro.current > macro.target,
        }));

        const calOver = targetCalories > 0 && calories > targetCalories;

        const center = size / 2;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const sectorDeg = 360 / macros.length;
        const arcSpanDeg = sectorDeg - sectorGapDeg;
        // Half a stroke of cap overhang, expressed in degrees, is what the drawn
        // arc has to give up on each end for the visible gap to stay honest.
        const capDeg = ((strokeWidth / 2) / radius) * (180 / Math.PI);
        const pathDeg = Math.max(0, arcSpanDeg - capDeg * 2);
        const glyphSize = strokeWidth * 0.6;
        const rotation = 165;

        const point = (deg) => {
            const rad = (deg * Math.PI) / 180;
            return [center + radius * Math.cos(rad), center + radius * Math.sin(rad)];
        };

        const arc = (startDeg, sweepDeg) => {
            if (sweepDeg <= 0.05) return '';
            const [x1, y1] = point(startDeg);
            const [x2, y2] = point(startDeg + sweepDeg);
            return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
        };

        const glyph = (macro, deg) => {
            const [x, y] = point(deg);
            const offset = glyphSize / 2;
            return `<svg x="${(x - offset).toFixed(2)}" y="${(y - offset).toFixed(2)}"
                             width="${glyphSize.toFixed(2)}" height="${glyphSize.toFixed(2)}" viewBox="0 0 24 24"
                             fill="none" stroke="#FFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                             aria-hidden="true">${MACRO_ICON_PATHS[macro.icon]}</svg>`;
        };

        const sector = (macro, index) => {
            // Half the gap opens the sector so the visible gap sits evenly between
            // neighbouring pills; the drawn arc then starts one cap further in.
            const sectorStart = rotation + index * sectorDeg + sectorGapDeg / 2;
            const drawStart = sectorStart + capDeg;
            const progressDeg = clamp01(macro.ratio) * pathDeg;
            const tone = macro.over ? 'red-500' : macro.tone;
            const track = arc(drawStart, pathDeg);
            // The glyph needs a pill at least one stroke wide around it,
            // otherwise it would spill over the leading cap.
            const showGlyph = (progressDeg / 360) * circumference >= strokeWidth;
            return `
                <g>
                    ${track ? `<path d="${track}" class="nutrition-ring__track" fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"/>` : ''}
                    ${progressDeg > 0.05 ? `
                        <path d="${arc(drawStart, progressDeg)}" class="nutrition-ring__pill text-${tone}"
                              fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round"/>
                    ` : ''}
                    ${showGlyph ? glyph(macro, drawStart + progressDeg) : ''}
                </g>
            `;
        };

        // Label anchors are derived from the same geometry so each label sits on
        // its own pill: the side labels are centred vertically on their pill
        // (translateY(-50%) does the centring, so a font-size change cannot break
        // it) and the carbs label is nudged onto the bottom pill, which the 165
        // degree rotation leaves left of the ring's centre.
        const pillMiddle = (index) => point(rotation + index * sectorDeg + sectorGapDeg / 2 + arcSpanDeg / 2);
        const labelAnchors = {
            protein: `top: ${pillMiddle(0)[1].toFixed(2)}px;`,
            fat: `top: ${pillMiddle(1)[1].toFixed(2)}px;`,
            carbs: `margin-left: ${(pillMiddle(2)[0] - center).toFixed(2)}px;`,
        };

        const scoreText = qualityScore === null || qualityScore === undefined
            ? '—'
            : (Number(qualityScore) / 10).toFixed(1);

        const share = (macro) => (macro.target > 0 ? `${Math.round(clamp01(macro.ratio) * 100)}%` : '—');

        const macroLabels = macros.map((macro) => {
            const tone = macro.over ? 'red-500' : macro.tone;
            return `
                <div class="macro-label ${macro.position}" style="${labelAnchors[macro.key]}" role="group"
                     aria-label="${escapeHtml(macro.label)} ${share(macro)} от цели">
                    <span class="macro-label__value text-${tone}">${formatNum(macro.current)}<span class="macro-label__target">${macro.target > 0 ? `/ ${formatNum(macro.target)} г` : ' г'}</span></span>
                    <span class="macro-label__name">
                        <span class="macro-label__dot bg-${tone}"></span>${escapeHtml(macro.label)}
                    </span>
                </div>
            `;
        }).join('');

        return `
            <div class="nutrition-ring-container">
                <div class="relative flex items-center justify-center shrink-0" style="width: ${size}px; height: ${size}px;">
                    <svg class="absolute inset-0" width="${size}" height="${size}" role="img"
                         aria-label="Белки ${share(macros[0])}, жиры ${share(macros[1])}, углеводы ${share(macros[2])}">
                        ${macros.map(sector).join('')}
                    </svg>
                    <div class="nutrition-ring__center">
                        <span class="nutrition-ring__score bg-purple-500/15 text-purple-500 dark:text-purple-400">ИИ ${scoreText}<span class="opacity-60">/10</span></span>
                        <span class="nutrition-ring__calories tabular-nums ${calOver ? 'text-red-500 dark:text-red-400' : 'text-surface-900 dark:text-zinc-100'}">${formatNum(calories)}<span class="nutrition-ring__calories-target">/ ${formatNum(targetCalories)} ккал</span></span>
                    </div>
                </div>
                ${macroLabels}
            </div>
        `;
    },

    /**
     * Nutrition dashboard: title row with the period switcher, then a single
     * ring slide for the selected period. The period tabs live in the title
     * row, so switching granularity costs no extra vertical space - the card
     * stays as compact as it was while the swipe carousel was there.
     */
    nutritionDashboardCard({
        title = 'Питание',
        tabs = '',
        body = '',
    } = {}) {
        return `
            <div class="nutrition-dashboard glass rounded-3xl p-3.5 shadow-xl" role="region" aria-label="Панель питания">
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <h3 class="text-[11px] font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider truncate">${escapeHtml(title)}</h3>
                    ${tabs}
                </div>
                ${body}
            </div>
        `;
    },

    /**
     * Period switcher for the nutrition dashboard. Text tabs carry the common
     * presets; the trailing icon tab opens the custom range sheet. The row stays
     * shrinkable (see .period-tabs), so a narrow screen pans it instead of
     * pushing it past the card border.
     */
    periodTabs(items = []) {
        const buttons = items.map((tab) => {
            const active = tab.active;
            const classes = `period-tab ${tab.icon ? 'period-tab--icon' : ''}`;
            const icon = tab.icon
                ? `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h13l-3-3M20 16H7l3 3"/></svg>`
                : '';
            return `
                <button type="button" data-action="set-period" data-period="${escapeHtml(tab.value)}"
                        aria-pressed="${active}" aria-label="${escapeHtml(tab.ariaLabel || tab.label || '')}"
                        class="${classes}">${icon}${tab.label ? `<span>${escapeHtml(tab.label)}</span>` : ''}</button>
            `;
        }).join('');

        return `<div class="period-tabs" role="group" aria-label="Период">${buttons}</div>`;
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

/**
     * Compact macro badge of a meal card ("Белки 12 г"). The three accents are
     * fixed brand colours rather than theme tokens: the badges always sit on a
     * photo, so they have to read the same in light and dark mode.
     */
    macroBadge(label, grams, tone) {
        return `
            <span class="macro-badge macro-badge--${tone}">
                <span class="macro-badge__label">${escapeHtml(label)}</span>
                <span class="macro-badge__value">${escapeHtml(String(grams))} г</span>
            </span>
        `;
    },

    /**
     * Shimmer lines shown while a meal is still being analysed. The pulse is
     * dropped under prefers-reduced-motion, which leaves a static placeholder.
     */
    mealSkeleton(lines = 2) {
        const widths = ['w-[85%]', 'w-[60%]'];
        return `
            <div class="meal-skeleton" aria-hidden="true">
                ${Array.from({ length: lines }, (_, i) => `
                    <span class="meal-skeleton__line ${widths[i] || 'w-[70%]'}"></span>
                `).join('')}
            </div>
        `;
    },

    /**
     * Photo meal card used by the nutrition carousel.
     *
     * Front face: a top bar (time · meal type on the left, per-meal AI quality
     * on the right), the photo itself kept as free of overlays as legibility
     * allows, and a bottom readout with the dish name, its calorie impact, the
     * three macro badges and a two-line AI snippet. A meal that is still being
     * analysed swaps the figures for shimmer lines instead of printing zeroes.
     *
     * `showDate` adds the eaten date to the top bar, which is what makes the
     * same card readable across a week or month carousel.
     *
     * `analysisTimedOut` marks a pending meal whose analysis never reported back:
     * it stops shimmering and states the failure instead, since nothing will
     * come along to replace those placeholders.
     */
    mealCardPhoto(meal, { showDate = false, analysisTimedOut = false } = {}) {
        const isPending = meal.status === 'pending' || meal.status === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING;
        const isFailed = meal.sync_status === DB.SYNC_STATUS.FAILED;
        const isStuck = isPending && analysisTimedOut;
        const day = meal.eaten_at ? new Date(meal.eaten_at) : (meal.created_at ? new Date(meal.created_at) : null);

        const dishName = meal.dish_name || (isStuck ? 'Не распознано' : (isPending ? '' : 'Блюдо'));
        const mealType = this.mealTypeLabel(meal.meal_type);
        const timeLabel = day ? Utils.formatTime(day) : '';
        const dateLabel = showDate && day ? Utils.formatDayMonth(day) : '';

        const calories = Math.round(meal.calories || 0);
        const protein = Math.round(meal.protein_g || meal.protein || 0);
        const fat = Math.round(meal.fat_g || meal.fat || 0);
        const carbs = Math.round(meal.carbs_g || meal.carbs || 0);
        const qualityScore = isStuck
            // Nothing was analysed, so there is nothing to score: the neutral
            // placeholder reads truer than a 0.0 verdict on empty macros.
            ? null
            : meal.quality_score !== undefined && meal.quality_score !== null
                ? Number(meal.quality_score)
                : Utils.computeQualityScore({
                      calories,
                      protein: meal.protein_g ?? meal.protein,
                      fat: meal.fat_g ?? meal.fat,
                      carbs: meal.carbs_g ?? meal.carbs,
                  });

        const photoSrc = this.mealPhotoUrl(meal);
        const safeSrc = photoSrc ? String(photoSrc).replace(/'/g, '%27').replace(/"/g, '%22') : null;

        const mealId = meal.id ?? '';
        const escName = escapeHtml(dishName);

        // Front face background
        const frontBackground = safeSrc
            ? `style="background-image: url('${safeSrc}');"`
            : `class="bg-gradient-to-br from-surface-800 to-surface-900 dark:from-zinc-800 dark:to-zinc-900"`;

        // Unified top chip label: date · time · meal type
        const chipLabel = [dateLabel, timeLabel, mealType].filter(Boolean).map(escapeHtml).join(' · ');

        // Pending meals have no numbers yet, so the readout swaps for shimmer
        // lines rather than printing a zero-calorie dish. A stuck meal keeps no
        // shimmer either: the placeholders would stay there forever.
        const headBlock = isStuck
            ? `
                <h3 class="text-shadow-subtle text-xl font-bold text-white leading-tight line-clamp-2">Не распознано</h3>
                <div class="mt-1">
                    <span class="text-[11px] font-semibold text-red-300">Анализ не завершился</span>
                </div>
            `
            : isPending
                ? this.mealSkeleton(1)
                : `
                    <h3 class="text-shadow-subtle text-xl font-bold text-white leading-tight line-clamp-2">${escName}</h3>
                    <div class="mt-1 flex items-baseline gap-1.5">
                        <span class="text-shadow-subtle text-2xl font-extrabold text-white tabular-nums leading-none">${escapeHtml(String(calories))}</span>
                        <span class="text-[11px] font-semibold text-white/70">ккал</span>
                    </div>
                `;

        const macroRow = isPending
            ? ''
            : `
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    ${this.macroBadge('Белки', protein, 'protein')}
                    ${this.macroBadge('Жиры', fat, 'fat')}
                    ${this.macroBadge('Углеводы', carbs, 'carbs')}
                </div>
            `;

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

        // AI snippet: the meal's own analysis when it exists, a skeleton while
        // the meal is still processing, and nothing at all once it is clear
        // there is no verdict to show.
        const insight = typeof meal.ai_insight === 'string' ? meal.ai_insight.trim() : '';
        const aiBlock = insight
            ? `
                <div class="meal-card-ai mt-2.5" data-no-flip>
                    <svg class="w-3.5 h-3.5 text-primary-400 shrink-0 mt-px" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    <p class="text-[11px] leading-snug text-white/85 line-clamp-2">${escapeHtml(insight)}</p>
                </div>
            `
            : isStuck
                ? `
                    <div class="meal-card-ai mt-2.5" data-no-flip>
                        <p class="text-[11px] leading-snug text-red-300 line-clamp-2">Таймаут анализа или сбой сервера. Попробуйте загрузить фото ещё раз.</p>
                    </div>
                `
                : isPending
                    ? `<div class="mt-2.5">${this.mealSkeleton(2)}</div>`
                    : '';

        return `
            <article class="snap-center shrink-0 meal-card-slot" data-meal-id="${mealId}">
                <div class="meal-card-3d relative w-full h-full perspective-card ${isFailed || isStuck ? 'ring-2 ring-red-500/40' : ''}" data-meal-id="${mealId}">
                    <div class="meal-card-inner relative w-full h-full transform-style-preserve-3d transition-transform duration-500 ease-out" data-action="flip-card">
                        <!-- FRONT FACE -->
                        <div class="meal-card-front absolute inset-0 backface-hidden rounded-2xl overflow-hidden bg-zinc-900">
                            <div ${frontBackground} class="absolute inset-0 bg-cover bg-center"></div>
                            <!-- Light scrims only: the photo stays readable, the top one just keeps the top bar legible -->
                            <div class="meal-card-scrim absolute inset-x-0 top-0 h-14 pointer-events-none"></div>
                            <div class="meal-card-gradient absolute inset-x-0 bottom-0 h-[58%] pointer-events-none"></div>

                            <div class="relative z-10 h-full flex flex-col p-4">
                                <!-- Top bar: time · meal type, AI quality of this meal on the right -->
                                <div class="flex items-center justify-between gap-2 shrink-0">
                                    <div class="glass-badge inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-3 py-1 min-w-0">
                                        <span class="inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-white/15 text-white">
                                            ${this.mealTypeIcon(meal.meal_type, 'w-3 h-3')}
                                        </span>
                                        <span class="text-[11px] font-semibold text-white truncate">${chipLabel}</span>
                                    </div>
                                    ${this.qualityBadge(qualityScore)}
                                </div>

                                <!-- Spacer keeps the plate visible and pins the readout to the bottom -->
                                <div class="flex-1 min-h-0"></div>

                                <div class="shrink-0">
                                    ${headBlock}
                                    ${macroRow}
                                    ${aiBlock}
                                </div>
                            </div>
                        </div>

                        <!-- BACK FACE -->
                        <div class="meal-card-back absolute inset-0 backface-hidden rotate-y-180 rounded-2xl overflow-hidden bg-zinc-900 p-3.5 flex flex-col">
                            <div class="flex items-start justify-between gap-2 mb-3 shrink-0">
                                <div class="min-w-0">
                                    <h4 class="text-base font-semibold text-white truncate">${escName}</h4>
                                    ${isPending ? '' : `<p class="text-[11px] text-white/55 tabular-nums">${escapeHtml(String(calories))} ккал · Б ${escapeHtml(String(protein))} · Ж ${escapeHtml(String(fat))} · У ${escapeHtml(String(carbs))} г</p>`}
                                </div>
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

                                ${meal.quality_reason ? `
                                    <div class="pt-4 border-t border-white/10">
                                        <p class="text-[10px] font-medium text-white/50 uppercase tracking-wider mb-2">Качество приёма</p>
                                        ${this.qualityMetrics(meal.quality_reason)}
                                    </div>
                                ` : ''}

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
     * Period picker sheet.
     *
     * Every period except the single day edits a range (two inputs plus quick
     * presets); the day keeps one input, since it only moves the anchor. The
     * caller owns the state and reads the values back from the
     * [data-period-field] inputs on apply.
     */
    periodSheet({ today, start, end, isRange }) {
        const presets = [
            { value: 'today', label: 'Сегодня' },
            { value: 'week', label: 'Текущая неделя' },
            { value: '30', label: 'Последние 30 дней' },
        ];

        const fieldClass = 'w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-zinc-100 text-sm focus:border-lime-500 focus:outline-none';
        const labelClass = 'block text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5';

        return `
            <div class="drum-sheet fixed inset-0 z-50 pointer-events-auto">
                <div class="drum-sheet-backdrop absolute inset-0 bg-black/40 dark:bg-black/60" data-action="close-period-sheet"></div>
                <div class="drum-sheet-panel absolute bottom-0 left-0 right-0 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 rounded-t-2xl border-t border-zinc-200 dark:border-white/10 flex flex-col drum-sheet-safe" role="dialog" aria-modal="true" aria-labelledby="period-sheet-title">
                    <div class="flex flex-col gap-3.5 px-4 pt-0 pb-1">
                        <div class="w-10 h-1 rounded-full bg-zinc-300 dark:bg-white/20 mx-auto drum-sheet-handle flex-shrink-0"></div>

                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-semibold truncate">ПИТАНИЕ</div>
                                <h3 id="period-sheet-title" class="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">${isRange ? 'Выбор периода' : 'Выбор даты'}</h3>
                            </div>
                            <button type="button" data-action="close-period-sheet" aria-label="Закрыть" class="sheet-close-btn w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0 flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"/></svg>
                            </button>
                        </div>

                        ${isRange
                            ? `
                            <div>
                                <div class="${labelClass} mb-0">Период (даты)</div>
                                <div class="period-sheet__date-grid grid grid-cols-2 gap-3 mt-1.5">
                                    <input type="date" id="period-start" data-period-field="start" aria-label="Дата начала" value="${escapeHtml(start)}" max="${escapeHtml(today)}" class="${fieldClass} period-sheet__date-input text-center">
                                    <input type="date" id="period-end" data-period-field="end" aria-label="Дата окончания" value="${escapeHtml(end)}" min="${escapeHtml(start)}" max="${escapeHtml(today)}" class="${fieldClass} period-sheet__date-input text-center">
                                </div>
                            </div>

                            <div>
                                <div class="${labelClass}">Быстрый выбор</div>
                                <div class="flex flex-wrap gap-1.5" role="group" aria-label="Готовые диапазоны">
                                    ${presets.map((preset) => `
                                        <button type="button" data-action="period-preset" data-range="${preset.value}"
                                                class="flex-auto px-2 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 transition-all hover:border-lime-500/50 whitespace-nowrap">
                                            ${escapeHtml(preset.label)}
                                        </button>
                                    `).join('')}
                                </div>
                            </div>
                            `
                            : `
                            <div>
                                <label for="period-single" class="${labelClass}">Дата</label>
                                <input type="date" id="period-single" data-period-field="start" value="${escapeHtml(start)}" max="${escapeHtml(today)}" class="${fieldClass} period-sheet__date-input">
                            </div>
                            <p class="text-[11px] text-zinc-500">Отчёт за один день. Для диапазона переключитесь на «7 дней», «Месяц» или ⇆.</p>
                            `}

                        <div class="flex gap-2 pt-1">
                            <button type="button" data-action="reset-period-sheet" class="flex-1 py-3 rounded-2xl glass text-sm font-semibold">Сбросить</button>
                            <button type="button" data-action="apply-period-sheet" class="flex-1 py-3 rounded-2xl bg-lime-500 text-zinc-950 font-bold text-sm shadow-md btn-press">Применить</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
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
                            <button type="button" data-action="close-new-meal-modal" aria-label="Закрыть" class="sheet-close-btn w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0 flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors">
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
