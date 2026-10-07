console.log("[DEBUG] Loaded components.js");
import { Utils } from './utils.js';
import { DB } from './db.js';

let sparklineSeq = 0;
let tonnageChartSeq = 0;
let ringGradientSeq = 0;

export function escapeHtml(value) {
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

/* Icons for the card action buttons. They are stroke-based like the meal-type
   icons so the top-right pair reads as one set on the photo. */
const MEAL_ACTION_ICON_PATHS = {
    edit: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 6.5l4 4"/>',
    trash: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 4h4"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 7l1 13h10l1-13"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11v6"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 11v6"/>',
};

const MACRO_ICON_PATHS = {
    protein: '<path d="M4 9.5v5"/><path d="M7.5 7v10"/><path d="M16.5 7v10"/><path d="M20 9.5v5"/><path d="M7.5 12h9"/>',
    fat: '<path d="M12 3.4c2.9 3.7 4.9 6.3 4.9 9a4.9 4.9 0 0 1-9.8 0c0-2.7 2-5.3 4.9-9Z"/>',
    carbs: '<path d="M12 3.6c.7 4.3 1.9 5.5 6.1 6.2-4.2.7-5.4 1.9-6.1 6.2-.7-4.3-1.9-5.5-6.1-6.2 4.2-.7 5.4-1.9 6.1-6.2Z"/>',
};

/* Verdict personas. The label is deliberately short: the badge shares a line
   with the "Вердикт нутрициолога" heading on a 375px screen, so anything longer
   wraps the header instead of sitting next to the score. An unknown key renders
   no badge at all rather than an empty pill - a meal analysed before personas
   existed simply has no voice to show. */
const AI_PERSONA_META = {
    kind: { emoji: '😊', label: 'Добрый нутрициолог' },
    strict: { emoji: '🧊', label: 'Строгий тренер' },
    sarcastic: { emoji: '😏', label: 'Саркастичный нутрициолог' },
    custom: { emoji: '🎭', label: 'Ваш стиль' },
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

/**
 * Paint tone for one macro, shared by the ring and the horizontal bars so the same
 * figure is never one colour in the dial and another in the legend.
 *
 * Protein is the macro whose colour carries meaning: neutral until the day's
 * target is reached, emerald from the target onwards. Its surplus is a good day,
 * so it never borrows the danger crimson - a user who overshoots protein must not
 * read the ring as a warning. Fat is the one macro whose overage is critical
 * enough to turn crimson, and an over-target calorie intake says the same thing
 * in the middle of the ring. Carbs stay carb-coloured either way: a day that is
 * over on carbs is not a day that failed.
 *
 * An unknown target (zero, missing, unset) leaves the macro in its own colour
 * rather than grading it against a norm the user never chose.
 */
function macroTone(key, current, target) {
    const value = Number.isFinite(Number(current)) ? Number(current) : 0;
    const goal = Number.isFinite(Number(target)) ? Number(target) : 0;
    if (goal <= 0) return key;
    if (key === 'protein') return value >= goal ? 'protein-goal' : 'protein';
    if (key === 'fat') return value > goal ? 'danger' : 'fat';
    return key;
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
     * Icon for a card action button. The buttons on the photo are icon-only, so
     * the name lives in the button's own `aria-label`/`title` rather than in
     * text next to the glyph.
     */
    mealActionIcon(icon, className = 'w-3.5 h-3.5') {
        const paths = MEAL_ACTION_ICON_PATHS[icon];
        if (!paths) return '';
        return `<svg class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
    },

    /**
     * AI quality badge for a single meal, as a whole number out of ten: "8/10".
     * Any raw score is normalised first, so a float 0-1 answer, the 0-100 macro
     * fallback and the 1-10 API value all land on the same integer; a meal with
     * nothing to score keeps the neutral placeholder instead of a hard "1/10".
     *
     * A themed chip from the card's own tokens rather than the black glass pill:
     * the score sits in the verdict header, on the card background, and a black
     * pill there read as a system badge floating over a white card.
     */
    qualityBadge(score) {
        const value = Utils.qualityScoreFromAI(score);
        const baseClasses = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-300 font-medium";
        if (value === null) {
            return `<span class="meal-card-quality ${baseClasses}" aria-label="ИИ-качество не рассчитано">✦ ИИ —<span class="opacity-60">/10</span></span>`;
        }
        return `<span class="meal-card-quality ${baseClasses}" aria-label="ИИ-качество ${value} из 10">✦ ИИ ${value}<span class="opacity-60">/10</span></span>`;
    },

    /**
     * Parse quality_reason JSON and render the metrics as a single dense row of
     * score pills, so a whole AI verdict fits in one line of the meal card.
     * Falls back to plain text if JSON parsing fails.
     */
    qualityMetrics(qualityReason, { limit = 3 } = {}) {
        if (!qualityReason) return '';
        let metrics = [];
        try {
            metrics = JSON.parse(qualityReason);
        } catch (e) {
            return `<p class="meal-card-ai__text text-white/70">${escapeHtml(qualityReason)}</p>`;
        }
        if (!Array.isArray(metrics) || metrics.length === 0) return '';
        const maxScore = 10;
        const shown = metrics.slice(0, limit);
        const overflow = metrics.length > shown.length ? metrics.length - shown.length : 0;

        return `
            <div class="meal-card-metrics">
                ${shown.map(m => {
                    const score = Math.max(0, Math.min(maxScore, Number(m.score) || 0));
                    const tone = score / maxScore >= 0.8 ? 'good' : (score / maxScore >= 0.6 ? 'mid' : 'low');
                    return `
                        <span class="meal-card-metric meal-card-metric--${tone}" title="${escapeHtml(m.label || '')}">
                            <span class="meal-card-metric__name">${escapeHtml(m.label || 'Метрика')}</span>
                            <span class="meal-card-metric__score">${score.toFixed(1)}</span>
                        </span>
                    `;
                }).join('')}
                ${overflow > 0 ? `<span class="meal-card-metric meal-card-metric--more">+${overflow}</span>` : ''}
            </div>
        `;
    },

    /**
     * Small chip naming the voice a verdict was written in. Empty string when the
     * meal carries no persona (analysed before the feature, or still pending), so
     * the caller can put it unconditionally where it belongs.
     */
    personaBadge(persona) {
        const key = String(persona ?? '').trim().toLowerCase();
        const meta = AI_PERSONA_META[key];
        if (!meta) return '';
        return `<span class="meal-card-persona" role="note" title="Стиль нутрициолога: ${escapeHtml(meta.label)}"><span class="meal-card-persona__emoji" aria-hidden="true">${meta.emoji}</span><span class="truncate">${escapeHtml(meta.label)}</span></span>`;
    },

    /**
     * Three horizontal macro bars (protein/fat/carbs) with current vs target
     * grams, used by the dashboard day slide.
     *
     * The fills take the macro tokens rather than a Tailwind colour, so a bar and
     * the ring pill above it are the same hue in both themes - and they grade the
     * same way, since both resolve their tone through `macroTone`. The figure
     * beside a bar is coloured only where the colour means something (protein at
     * its target, a fat overage); the rest stay in the neutral text colour.
     */
    macroBars(summary = {}, targets = {}) {
        const safeNum = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
        const formatNum = (value) => Math.round(value).toLocaleString('ru-RU');
        const pct = (current, target) => (target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0);

        const rows = [
            { key: 'protein', label: 'Белки', current: safeNum(summary.protein), target: safeNum(targets.target_protein) },
            { key: 'fat', label: 'Жиры', current: safeNum(summary.fat), target: safeNum(targets.target_fat) },
            { key: 'carbs', label: 'Углеводы', current: safeNum(summary.carbs), target: safeNum(targets.target_carbs) },
        ];

        return rows.map(({ key, label, current, target }) => {
            const valuePct = pct(current, target);
            const tone = macroTone(key, current, target);
            // Only the two tones that mean something reach the number.
            const valueTone = tone === 'danger' || tone === 'protein-goal' ? tone : '';
            return `
                <div class="flex items-center gap-2">
                    <span class="w-[70px] shrink-0 truncate text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">${escapeHtml(label)}</span>
                    <div class="flex-1 h-1.5 rounded-full bg-surface-200 dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow="${valuePct}" aria-valuemin="0" aria-valuemax="100" aria-label="${escapeHtml(label)} ${valuePct}%">
                        <div class="h-full macro-bar__fill--${tone} rounded-full transition-all duration-500 ease-out" style="width: ${valuePct}%"></div>
                    </div>
                    <span class="w-[72px] shrink-0 text-right text-[11px] font-semibold text-surface-800 dark:text-zinc-200 whitespace-nowrap${valueTone ? ` macro-bar__value--${valueTone}` : ''}">
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
     * The ring is one circle cut into three 120 degree sectors - proteins, fats
     * and carbs. Every sector draws its own faint rounded track and its own filled
     * arc on top, so the three macros float as separate thick pills instead of
     * sharing one continuous circle. Each pill takes its tone from `macroTone`,
     * so a saturated orange fat and a saturated cyan carb are always the vivid
     * accents, protein is neutral until it reaches its target and emerald from
     * there on, and crimson is spent only on a fat overage or on the over-target
     * calorie figure in the middle.
     *
     * Each pill is painted with its own gradient (a highlight stop down to the
     * accent) plus a drop-shadow glow in the same colour, which is what gives the
     * dial its lit depth instead of a flat stroke. Both live in CSS and are keyed
     * off the macro, so a theme switch recolours the ring without re-rendering it.
     * Protein is white on the dark theme; the light theme uses the darkened
     * relative of the same neutral, since the pill would otherwise be invisible on
     * a white card.
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
     * Each filled pill carries a small line-art glyph (dumbbell, oil drop, spark)
     * parked at its leading edge, so the icon travels as the value grows. Its ink
     * follows the pill it sits on, or it would vanish into the near-white protein
     * arc on the dark theme.
     */
    mercedesComboRing(summary = {}, targets = {}, qualityScore = null, size = 120, strokeWidth = 19, sectorGapDeg = 14) {
        const safeNum = (val) => (Number.isFinite(Number(val)) ? Number(val) : 0);
        const formatNum = (val) => Math.round(val).toLocaleString('ru-RU');
        const clamp01 = (val) => Math.max(0, Math.min(1, val));

        const calories = safeNum(summary.calories);
        const targetCalories = safeNum(targets.target_calories);

        // `tone` is a macro key, not a Tailwind colour: the arc, the glyph ink and
        // the label all resolve it through the same CSS token.
        const macros = [
            { key: 'protein', label: 'Белки', icon: 'protein', tone: 'protein', position: 'macro-label-protein', current: safeNum(summary.protein), target: safeNum(targets.target_protein) },
            { key: 'fat', label: 'Жиры', icon: 'fat', tone: 'fat', position: 'macro-label-fat', current: safeNum(summary.fat), target: safeNum(targets.target_fat) },
            { key: 'carbs', label: 'Углеводы', icon: 'carbs', tone: 'carbs', position: 'macro-label-carbs', current: safeNum(summary.carbs), target: safeNum(targets.target_carbs) },
        ].map((macro) => ({
            ...macro,
            ratio: macro.target > 0 ? macro.current / macro.target : 0,
            // Resolved once, so the arc, the glyph, the number and the legend dot
            // can never disagree about which side of the target the day is on.
            tone: macroTone(macro.key, macro.current, macro.target),
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

        // Gradient ids must be unique per instance: the dashboard ring and any
        // other ring on the page would otherwise share one definition and repaint
        // each other when a theme switch changed the stop colours. Allocated once
        // per tone, so the arc and the <defs> that paints it agree on the id.
        const paintedTones = [...new Set(macros.map((macro) => macro.tone))];
        const gradientIds = Object.fromEntries(
            paintedTones.map((tone) => [tone, `ring-${tone}-${++ringGradientSeq}`])
        );

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

        const glyph = (macro, tone, deg) => {
            const [x, y] = point(deg);
            const offset = glyphSize / 2;
            return `<svg x="${(x - offset).toFixed(2)}" y="${(y - offset).toFixed(2)}"
                             width="${glyphSize.toFixed(2)}" height="${glyphSize.toFixed(2)}" viewBox="0 0 24 24"
                             class="nutrition-ring__glyph nutrition-ring__glyph--${tone}"
                             fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                             aria-hidden="true">${MACRO_ICON_PATHS[macro.icon]}</svg>`;
        };

        const sector = (macro, index) => {
            // Half the gap opens the sector so the visible gap sits evenly between
            // neighbouring pills; the drawn arc then starts one cap further in.
            const sectorStart = rotation + index * sectorDeg + sectorGapDeg / 2;
            const drawStart = sectorStart + capDeg;
            const progressDeg = clamp01(macro.ratio) * pathDeg;
            const tone = macro.tone;
            const track = arc(drawStart, pathDeg);
            // The glyph needs a pill at least one stroke wide around it,
            // otherwise it would spill over the leading cap.
            const showGlyph = (progressDeg / 360) * circumference >= strokeWidth;
            const gradient = gradientIds[tone];
            return `
                <g>
                    ${track ? `<path d="${track}" class="nutrition-ring__track" fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"/>` : ''}
                    ${progressDeg > 0.05 ? `
                        <path d="${arc(drawStart, progressDeg)}" class="nutrition-ring__pill nutrition-ring__pill--${tone}"
                              fill="none" stroke="url(#${gradient})" stroke-width="${strokeWidth}" stroke-linecap="round"/>
                    ` : ''}
                    ${showGlyph ? glyph(macro, tone, drawStart + progressDeg) : ''}
                </g>
            `;
        };

        // One gradient per tone in play, defined before the arcs that reference it.
        // An arc with nothing to show draws no path, and an unused gradient costs
        // nothing to have defined.
        const gradientDefs = paintedTones.map((tone) => `
            <linearGradient id="${gradientIds[tone]}" class="nutrition-ring__gradient--${tone}"
                            x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-opacity="0.95"></stop>
                <stop offset="100%" stop-opacity="1"></stop>
            </linearGradient>
        `).join('');

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
            const tone = macro.tone;
            return `
                <div class="macro-label ${macro.position}" style="${labelAnchors[macro.key]}" role="group"
                     aria-label="${escapeHtml(macro.label)} ${share(macro)} от цели">
                    <span class="macro-label__value macro-label__value--${tone}">${formatNum(macro.current)}<span class="macro-label__target">${macro.target > 0 ? `/ ${formatNum(macro.target)} г` : ' г'}</span></span>
                    <span class="macro-label__name">
                        <span class="macro-label__dot macro-label__dot--${tone}"></span>${escapeHtml(macro.label)}
                    </span>
                </div>
            `;
        }).join('');

        return `
            <div class="nutrition-ring-container">
                <div class="relative flex items-center justify-center shrink-0" style="width: ${size}px; height: ${size}px;">
                    <div class="nutrition-ring__aura" aria-hidden="true"></div>
                    <svg class="absolute inset-0" width="${size}" height="${size}" role="img"
                         aria-label="Белки ${share(macros[0])}, жиры ${share(macros[1])}, углеводы ${share(macros[2])}">
                        <defs>${gradientDefs}</defs>
                        ${macros.map(sector).join('')}
                    </svg>
                    <div class="nutrition-ring__center">
                        <span class="nutrition-ring__score inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-300 font-medium"><svg class="nutrition-ring__spark w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z"/></svg>✦ ИИ ${scoreText}<span class="opacity-60">/10</span></span>
                        <span class="nutrition-ring__calories tabular-nums ${calOver ? 'text-red-500 dark:text-red-400' : 'text-surface-900 dark:text-zinc-100'}">${formatNum(calories)}<span class="nutrition-ring__calories-target">/ ${formatNum(targetCalories)} ккал</span></span>
                    </div>
                </div>
                ${macroLabels}
            </div>
        `;
    },

    /**
     * Daily AI recap of one day, as a card under the dashboard.
     *
     * The card has two states and no third: the recap, or the reason there is
     * none ("the day is not over", "no meals that day", "the model did not
     * answer"). A failed recap therefore still occupies the same slot with the
     * same height class, instead of the page silently losing a section or
     * growing one once the upstream recovers.
     *
     * A recap the user can ask for carries its own trigger: a finished day
     * without a recap offers the generation button, a stored recap a
     * refresh glyph that re-reads the day (`force=true`). A day still being
     * eaten never offers either.
     *
     * `payload` is the /nutrition/daily-summary response. The three options are
     * the controller's own words for the day the card is about, so the card can
     * never name a different date than the one it was asked for: `dateLabel`
     * (which is "Итог за вчера, 3 окт" while the header says "Сегодня"),
     * `allowGenerate` - the controller's verdict that the day is finished - and
     * `generateLabel` for the trigger, so the button reads "Сформировать итог за
     * вчера" when that is the day it writes.
     */
    dailySummaryCard(payload = {}, { dateLabel = '', allowGenerate = false, generateLabel = 'Сформировать итог дня' } = {}) {
        const available = payload?.available === true;
        const text = typeof payload.summary_text === 'string' ? payload.summary_text.trim() : '';
        const score = Number(payload.overall_score);
        const hasScore = Number.isFinite(score) && score > 0;
        // The server prints the score on its 1-10 scale; the ring shows the same
        // figure with one decimal, so the card matches it rather than inventing a
        // second precision.
        const scoreText = hasScore ? score.toFixed(1) : null;

        const head = `
            <div class="daily-summary__head">
                <span class="daily-summary__title">
                    <svg class="daily-summary__icon" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z"/></svg>
                    Итог дня
                </span>
                ${dateLabel ? `<span class="daily-summary__date">${escapeHtml(dateLabel)}</span>` : ''}
                ${available && scoreText
                    ? `<span class="daily-summary__score inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-300 font-medium"><span class="opacity-60">✦ ИИ</span> ${scoreText}<span class="opacity-60">/10</span></span>`
                    : ''}
                ${available
                    ? `<button type="button" data-action="regenerate-daily-summary" class="daily-summary__refresh btn-press"
                              aria-label="Пересчитать итог дня" title="Пересчитать итог дня">
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6"/></svg>
                      </button>`
                    : ''}
            </div>
        `;

        if (!available || !text) {
            const reason = typeof payload.reason === 'string' && payload.reason.trim()
                ? payload.reason.trim()
                : 'Нет данных за день';
            return `
                <section class="daily-summary daily-summary--empty glass rounded-3xl" aria-label="Итог дня">
                    ${head}
                    <p class="daily-summary__empty">${escapeHtml(reason)}</p>
                    ${allowGenerate
                        ? `<button type="button" data-action="generate-daily-summary" class="daily-summary__generate btn-press">
                              <svg class="daily-summary__generate-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>
                              <span>${escapeHtml(generateLabel)}</span>
                          </button>`
                        : ''}
                </section>
            `;
        }

        return `
            <section class="daily-summary glass rounded-3xl" aria-label="Итог дня">
                ${head}
                <p class="daily-summary__text">${escapeHtml(text)}</p>
            </section>
        `;
    },

    /**
     * AI coach verdict on one workout session.
     *
     * `payload` is the /ai/workout-summary response and the card has the same
     * two states as the daily recap: the verdict, or the reason there is none.
     * A session that was never analysed, a spent quota and a model that failed
     * all render the same empty slot, so the history screen keeps its layout
     * whatever the tier or the upstream did.
     *
     * The breakdown is collapsed by default: the verdict is the one glance, and
     * the tonnage per muscle group, the recovery advice and the recommendations
     * are the study material behind it. Every figure on the card is the
     * arithmetic the server rendered - the card prints `muscle_groups[].tonnage_kg`
     * rather than counting anything itself, so it can never disagree with the
     * tonnage chart.
     *
     * `allowAnalyze` is the controller's verdict that asking is worth it (a real
     * connection and a spent-or-free tier state it has already decided on), and
     * `analyzeLabel`/`busy` drive the trigger: the same button reads
     * "Разобрать с ИИ" on an unanalysed session and "Разбираем..." while the
     * request is in flight.
     */
    aiWorkoutCard(payload = {}, {
        allowAnalyze = false,
        analyzeLabel = 'Разобрать с ИИ',
        reanalyzeLabel = 'Пересчитать разбор',
        busy = false,
        title = 'Разбор от ИИ-тренера',
    } = {}) {
        const available = payload?.available === true;
        const text = typeof payload.ai_summary === 'string' ? payload.ai_summary.trim() : '';
        const score = Number(payload.overall_score);
        const hasScore = Number.isFinite(score) && score > 0;
        const scoreText = hasScore ? score.toFixed(1) : null;

        const limit = payload?.limit || null;
        const quotaLine = limit && limit.allowed === false && typeof limit.message === 'string' && limit.message.trim()
            ? `<p class="ai-workout__quota">${escapeHtml(limit.message.trim())}</p>`
            : '';

        const head = `
            <div class="ai-workout__head">
                <span class="ai-workout__title">
                    <svg class="ai-workout__icon" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z"/></svg>
                    ${escapeHtml(title)}
                </span>
                ${available && scoreText
                    ? `<span class="ai-workout__score inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-300 font-medium"><span class="opacity-60">✦ ИИ</span> ${scoreText}<span class="opacity-60">/10</span></span>`
                    : ''}
                ${payload?.analyzed_at
                    ? `<span class="ai-workout__date">${escapeHtml(Utils.formatDate(payload.analyzed_at))}</span>`
                    : ''}
            </div>
        `;

        const trigger = allowAnalyze
            ? `<button type="button" data-action="analyze-workout-ai" class="ai-workout__analyze btn-press"${busy ? ' disabled' : ''}>
                  <svg class="ai-workout__analyze-icon${busy ? ' animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 12h14"/></svg>
                  <span>${escapeHtml(busy ? 'Разбираем...' : (available ? reanalyzeLabel : analyzeLabel))}</span>
              </button>`
            : '';

        if (!available || !text) {
            const reason = typeof payload?.reason === 'string' && payload.reason.trim()
                ? payload.reason.trim()
                : 'Тренировка ещё не разобрана';
            return `
                <section class="ai-workout ai-workout--empty glass rounded-3xl" aria-label="${escapeHtml(title)}">
                    ${head}
                    <p class="ai-workout__empty">${escapeHtml(reason)}</p>
                    ${quotaLine}
                    ${trigger}
                </section>
            `;
        }

        const groups = Array.isArray(payload.muscle_groups) ? payload.muscle_groups.filter(g => g && g.muscle_group) : [];
        const groupPills = groups.map((g) => {
            const tonnage = Number(g.tonnage_kg) || 0;
            const sets = Number(g.sets_count) || 0;
            return `
                <span class="ai-workout__pill" title="${escapeHtml(g.muscle_group)}">
                    <span class="ai-workout__pill-name">${escapeHtml(g.muscle_group)}</span>
                    <span class="ai-workout__pill-value">${Math.round(tonnage)} кг · ${sets} подх.</span>
                </span>
            `;
        }).join('');

        const highlights = Array.isArray(payload.highlights) ? payload.highlights.filter(Boolean) : [];
        const highlightsBlock = highlights.length
            ? `<ul class="ai-workout__highlights">${highlights.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`
            : '';

        const recovery = typeof payload.recovery_advice === 'string' && payload.recovery_advice.trim()
            ? `<p class="ai-workout__recovery">${escapeHtml(payload.recovery_advice.trim())}</p>`
            : '';

        const intensity = typeof payload.intensity_conclusions === 'string' && payload.intensity_conclusions.trim()
            ? `<div class="ai-workout__callout ai-workout__callout--amber">${escapeHtml(payload.intensity_conclusions.trim())}</div>`
            : '';

        const balance = typeof payload.balance_analysis === 'string' && payload.balance_analysis.trim()
            ? `<div class="ai-workout__callout ai-workout__callout--indigo">${escapeHtml(payload.balance_analysis.trim())}</div>`
            : '';

        const recommendations = (Array.isArray(payload.recommendations) ? payload.recommendations : [])
            .filter(r => r && r.title && r.text)
            .map(r => `
                <li class="ai-workout__checklist-item">
                    <span class="ai-workout__checklist-marker" aria-hidden="true">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                    </span>
                    <span class="ai-workout__checklist-body">
                        <span class="ai-workout__checklist-title">${escapeHtml(r.title)}</span>
                        <span class="ai-workout__checklist-text">${escapeHtml(r.text)}</span>
                    </span>
                </li>
            `).join('');

        const focus = Array.isArray(payload.next_workout_focus) ? payload.next_workout_focus.filter(Boolean) : [];
        const focusBlock = focus.length
            ? `<ul class="ai-workout__checklist">${focus.map(f => `
                    <li class="ai-workout__checklist-item">
                        <span class="ai-workout__checklist-marker" aria-hidden="true">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                        </span>
                        <span class="ai-workout__checklist-text">${escapeHtml(f)}</span>
                    </li>
                `).join('')}</ul>`
            : '';

        const hasBody = groupPills || intensity || balance || highlightsBlock || recovery || focusBlock || recommendations;
        const body = hasBody ? `
            <div class="ai-workout__body">
                ${groupPills ? `<div class="ai-workout__pills"><span class="ai-workout__pills-label">Нагрузка по группам</span>${groupPills}</div>` : ''}
                ${intensity}
                ${balance}
                ${highlightsBlock}
                ${recovery}
                ${focusBlock ? `<div class="ai-workout__focus-wrap"><span class="ai-workout__focus-label">Фокус на следующей тренировке</span>${focusBlock}</div>` : ''}
                ${recommendations ? `<div class="ai-workout__checklist-wrap"><span class="ai-workout__focus-label">Рекомендации</span><ul class="ai-workout__checklist">${recommendations}</ul></div>` : ''}
            </div>
        ` : '';

        return `
            <section class="ai-workout glass rounded-3xl" aria-label="${escapeHtml(title)}">
                ${head}
                <p class="ai-workout__text">${escapeHtml(text)}</p>
                ${body}
                ${trigger}
            </section>
        `;
    },

    /**
     * The coach's plan for one exercise, as a badge on the active workout card.
     *
     * The targets are the first thing read and the focus line the second, so the
     * weight sits in the badge and the sentence under it stays quiet. A
     * recommendation the model left without a weight (an exercise the user has
     * never loaded) prints the sets and reps alone rather than a dash: there is
     * no target to show, and "—" would read as a broken value.
     */
    aiWorkoutPlanBadge(recommendation = {}) {
        if (!recommendation) return '';
        const targets = [
            recommendation.sets ? `${recommendation.sets}×${recommendation.reps ?? '—'}` : null,
            Number(recommendation.weight_kg) > 0 ? `${recommendation.weight_kg} кг` : null,
        ].filter(Boolean).join(' · ');
        const focus = typeof recommendation.focus === 'string' ? recommendation.focus.trim() : '';
        const motivation = typeof recommendation.motivation === 'string' ? recommendation.motivation.trim() : '';
        if (!targets && !focus && !motivation) return '';

        return `
            <div class="ai-plan">
                ${targets ? `<span class="ai-plan__targets">${escapeHtml(targets)}</span>` : ''}
                ${focus ? `<span class="ai-plan__focus">${escapeHtml(focus)}</span>` : ''}
                ${motivation ? `<span class="ai-plan__motivation">${escapeHtml(motivation)}</span>` : ''}
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
     *
     * It is a soft card rather than a dashed placeholder: the dashed outline read
     * as "nothing here yet" next to a fully styled meal card, and on a light
     * background it was the only tile without the summary card's rounded-3xl
     * silhouette. The lime disc keeps the affordance - a camera focus point with
     * the plus, the one action the tile performs - and the border warms up on
     * hover instead of appearing out of nowhere.
     */
    addMealActionCard() {
        return `
            <button type="button" data-action="open-add-meal-modal" aria-label="Добавить приём пищи"
                    class="meal-action-slot btn-press flex flex-col items-center justify-center p-6 text-center cursor-pointer
                           rounded-3xl bg-white/80 dark:bg-zinc-900/60
                           border border-surface-200 dark:border-white/10 hover:border-lime-500/60 dark:hover:border-lime-400/40
                           transition-colors">
                <span class="w-14 h-14 rounded-2xl bg-lime-500/15 dark:bg-lime-400/10 text-lime-600 dark:text-lime-400
                             flex items-center justify-center mb-3 shrink-0">
                    <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2"/><circle cx="12" cy="12" r="4.5" stroke-width="2"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10.25v3.5M10.25 12h3.5"/></svg>
                </span>
                <span class="text-base font-bold text-surface-900 dark:text-zinc-100">Добавить приём пищи</span>
                <span class="text-xs text-surface-500 dark:text-surface-400 mt-1">Сделать фото или загрузить из галереи</span>
            </button>
        `;
    },

    /**
     * Carousel tile shown when the day has no logged meals yet. It wears the same
     * soft rounded-3xl card as the add tile so an empty carousel still reads as
     * one row of cards rather than a bare placeholder next to a solid tile.
     */
    mealCarouselEmptyState() {
        return `
            <div class="meal-empty-slot flex flex-col items-center justify-center p-6 text-center
                        rounded-3xl bg-white/80 dark:bg-zinc-900/60
                        border border-surface-200 dark:border-white/10">
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
     * One tile of the meal macro bar: the amount over its caption, the amount
     * carrying the accent colour. The four accents are fixed brand colours
     * rather than theme tokens, so the bar reads the same in either theme.
     *
     * `pending` swaps the amount for a shimmer line: a meal still being analysed
     * has no numbers yet and must not print zeroes.
     */
    macroTile(label, value, tone, { unit = 'г', pending = false } = {}) {
        return `
            <div class="meal-card-macro meal-card-macro--${tone}">
                ${pending
                    ? `<span class="meal-skeleton__line w-[70%]"></span>`
                    : `<span class="meal-card-macro__value">${escapeHtml(String(value))}<span class="meal-card-macro__unit">${escapeHtml(unit)}</span></span>`}
                <span class="meal-card-macro__label">${escapeHtml(label)}</span>
            </div>
        `;
    },

    /**
     * Composition of a meal, read as the items the analysis recognised plus, when
     * those items carry weights, the total portion.
     *
     * The vision model returns plain tags, while a richer analysis may hand over
     * {name, amount} objects. Objects win, because only they carry the weights
     * the portion is summed from. Notes are the last resort, so a card never
     * shows a "Состав" heading over nothing.
     *
     * A list longer than the card can show is truncated behind a `+N` control
     * that is tappable: everything past the limit is rendered but stays hidden
     * until the control is pressed, so nothing is lost and the collapsed card
     * keeps its height. `data-expanded` on the list is the whole state - the
     * labels of the control are both in the markup and CSS picks one - so
     * expanding is a single attribute write instead of a DOM rebuild.
     */
    mealBreakdown(meal, { limit = 3 } = {}) {
        // Collapsed and expanded wording for the same control.
        const toggleLabels = (collapsed, expanded) => `
            <span class="composition-label composition-label--collapsed">${escapeHtml(collapsed)}</span>
            <span class="composition-label composition-label--expanded">${escapeHtml(expanded)}</span>
        `;

        const items = Array.isArray(meal.ingredients)
            ? meal.ingredients.filter((ing) => ing && (ing.name || ing.amount))
            : [];

        if (items.length > 0) {
            const total = items.reduce((sum, ing) => sum + (Number(ing.amount) || 0), 0);
            const hiddenFrom = Math.min(limit, items.length);
            const overflow = Math.max(0, items.length - hiddenFrom);
            return {
                portion: total > 0 ? Math.round(total) : null,
                body: `
                    <div class="meal-card-rows" data-composition data-expanded="false">
                        ${items.map((ing, index) => `
                            <div class="meal-card-row ${index >= hiddenFrom ? 'meal-card-row--overflow' : ''}">
                                <span class="meal-card-row__name">${escapeHtml(ing.name || 'Ингредиент')}</span>
                                <span class="meal-card-row__value">${escapeHtml(String(Math.round(Number(ing.amount) || 0)))} г</span>
                            </div>
                        `).join('')}
                        ${overflow > 0 ? `
                            <button type="button" class="meal-card-row meal-card-row--toggle" data-composition-toggle
                                    aria-expanded="false" aria-label="Показать весь состав">
                                <span class="meal-card-row__name meal-card-row__more">${toggleLabels(`Ещё ${overflow}`, 'Свернуть')}</span>
                                <span class="meal-card-row__value">${toggleLabels('показать', 'свернуть')}</span>
                            </button>
                        ` : ''}
                    </div>
                `,
            };
        }

        const tags = Array.isArray(meal.tags) ? meal.tags.filter(Boolean).map(String) : [];
        if (tags.length > 0) {
            const hiddenFrom = Math.min(limit + 1, tags.length);
            const overflow = Math.max(0, tags.length - hiddenFrom);
            return {
                portion: null,
                body: `
                    <div class="meal-card-tags" data-composition data-expanded="false">
                        ${tags.map((tag, index) => `
                            <span class="meal-card-tag ${index >= hiddenFrom ? 'meal-card-tag--overflow' : ''}">${escapeHtml(tag)}</span>
                        `).join('')}
                        ${overflow > 0 ? `
                            <button type="button" class="meal-card-tag meal-card-tag--more meal-card-tag--toggle" data-composition-toggle
                                    aria-expanded="false" aria-label="Показать весь состав">${toggleLabels(`+${overflow}`, 'Свернуть')}</button>
                        ` : ''}
                    </div>
                `,
            };
        }

        const notes = typeof meal.notes === 'string' ? meal.notes.trim() : '';
        if (notes) {
            return { portion: null, body: `<p class="meal-card-note">${escapeHtml(notes)}</p>` };
        }

        return { portion: null, body: '<p class="meal-card-note meal-card-note--empty">Детали недоступны</p>' };
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
     * Optimistic carousel tile shown between tapping "send" and the server
     * echoing the meal back. An analysis takes tens of seconds, so the slot is
     * claimed straight away: the user watches a card instead of a screen that
     * does not react. It keeps the meal card footprint, so the carousel does not
     * resize when the real card replaces it.
     */
    mealCardAnalyzingSkeleton() {
        const pill = (label) => `
            <div class="meal-card-pill meal-card-pill--pending">
                <span class="meal-skeleton__line w-[60%]"></span>
                <span class="meal-card-pill__label">${escapeHtml(label)}</span>
            </div>
        `;

        return `
            <article class="meal-card-slot snap-center shrink-0" data-meal-skeleton="true" role="status">
                <div class="meal-card meal-card--analyzing">
                    <div class="meal-card-hero meal-card-hero--tall meal-card-hero__fallback">
                        <div class="meal-card-hero__bottom flex flex-col items-center gap-2 text-center">
                            <div class="w-7 h-7 rounded-full border-2 border-white/25 border-t-transparent animate-spin"></div>
                            <h3 class="meal-card-hero__name">Анализируем блюдо</h3>
                            <p class="meal-card-hero__note">Нейросеть анализирует состав и КБЖУ...</p>
                        </div>
                    </div>
                    <div class="meal-card-pills">
                        ${pill('Ккал')}${pill('Белки')}${pill('Жиры')}${pill('Углеводы')}
                    </div>
                    ${this.mealSkeleton(2)}
                </div>
            </article>
        `;
    },

    /**
      * Photo meal card used by the nutrition carousel.
      *
      * One monolithic card carries the whole meal top to bottom: a tall photo
      * hero with the eaten-at time on the left of its top row and the edit and
      * delete icon buttons on the right, the dish name plus portion on its
      * bottom overlay, then the macro pill row, the recognised composition and
      * the AI verdict box. Nothing hides behind a flip or a second page, so a
      * single screenshot of the card is a complete record of the meal. The
      * quality score lives only in the verdict box: a second copy over the
      * photo was the same number twice.
      *
      * A meal that is still being analysed swaps its figures for shimmer lines
      * instead of printing zeroes, and `analysisTimedOut` stops the shimmer to
      * state the failure: nothing will come along to replace those placeholders.
      *
      * `showDate` adds the eaten date in front of the time, which is what makes
      * the same card readable across a week or month carousel. The chip carries
      * the time as plain text and nothing else: the meal-type glyph that used to
      * sit in front of it read as a stray `#` at 10px, and the spelled-out label
      * made the header read like a sentence and pushed the time out of view.
      */
    mealCardPhoto(meal, { showDate = false, analysisTimedOut = false } = {}) {
        const isPending = meal.status === 'pending' || meal.status === 'processing' || meal.sync_status === DB.SYNC_STATUS.PENDING;
        const isFailed = meal.sync_status === DB.SYNC_STATUS.FAILED;
        const isStuck = isPending && analysisTimedOut;
        const day = meal.eaten_at ? new Date(meal.eaten_at) : (meal.created_at ? new Date(meal.created_at) : null);

        const dishName = meal.dish_name || (isStuck ? 'Не распознано' : (isPending ? '' : 'Блюдо'));
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
        const qualityScore = isStuck
            ? null
            : Utils.qualityScoreFromAI(hasAIScore ? meal.quality_score : (macroScore === null ? null : macroScore / 10));

        const photoSrc = this.mealPhotoUrl(meal);
        const safeSrc = photoSrc ? String(photoSrc).replace(/'/g, '%27').replace(/"/g, '%22') : null;
        const mealId = meal.id ?? '';
        const escName = escapeHtml(dishName);

        const breakdown = isPending ? null : this.mealBreakdown(meal);

        const heroBackground = safeSrc
            ? `style="background-image: url('${safeSrc}');"`
            : 'class="meal-card-hero__fallback"';

        const heroOverlay = isStuck
            ? `
                <h3 class="meal-card-hero__name">Не распознано</h3>
                <p class="meal-card-hero__note meal-card-hero__note--error">Анализ не завершился</p>
            `
            : isPending
                ? `<div class="meal-card-hero__shimmer">${this.mealSkeleton(2)}</div>`
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
        const verdictContent = isStuck
            ? `<p class="meal-card-ai__text meal-card-ai__text--error">Таймаут анализа или сбой сервера. Попробуйте загрузить фото ещё раз.</p>`
            : isPending
                ? this.mealSkeleton(2)
                : insight
                    ? `<p class="meal-card-ai__text">${escapeHtml(insight)}</p>`
                    : this.qualityMetrics(meal.quality_reason);

        // The persona chip sits directly above the verdict box and inside the same
        // wrapper, so the pair keeps one 4px gap whatever the card's own 12px
        // section rhythm is: a chip separated from its verdict by the section gap
        // read as an unrelated label.
        const verdictBlock = verdictContent
            ? `
                <div class="meal-card-verdict-group">
                    ${this.personaBadge(meal.ai_persona)}
                    <div class="meal-card-verdict">
                        <div class="meal-card-verdict__header">
                            <span class="meal-card-verdict__title">Вердикт нутрициолога</span>
                            ${this.qualityBadge(qualityScore)}
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
                    <button type="button" data-action="edit-meal" data-meal-id="${mealId}" class="glass-badge meal-card-hero__action" aria-label="Редактировать блюдо" title="Редактировать">${this.mealActionIcon('edit')}</button>
                    <button type="button" data-action="delete-meal" data-meal-id="${mealId}" class="glass-badge meal-card-hero__action meal-card-hero__action--danger" aria-label="Удалить блюдо" title="Удалить">${this.mealActionIcon('trash')}</button>
                </div>
            `
            : '';

        return `
            <article class="meal-card-slot snap-center shrink-0" data-meal-id="${mealId}">
                <div class="meal-card ${isFailed || isStuck ? 'meal-card--alert' : ''}" data-meal-id="${mealId}">
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
                            <label for="new-meal-notes" class="block text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5">Комментарий к блюду <span class="opacity-60 normal-case tracking-normal">(необязательно)</span></label>
                            <textarea id="new-meal-notes" placeholder="Например: Творог 1%, без сахара" rows="2" class="w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-zinc-100 text-sm resize-none focus:border-lime-500 focus:outline-none"></textarea>
                            <p class="mt-1.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">Нейросеть учтёт комментарий при оценке порции и КБЖУ.</p>
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
     * Edit Meal Modal: a drum-sheet bottom sheet pre-filled with the current
     * meal values. Fields are nullable so clearing one sends null and the
     * server drops it instead of leaving a stale figure behind.
     */
    editMealModal(meal = {}) {
        const fieldClass = 'w-full px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-zinc-100 text-sm focus:border-lime-500 focus:outline-none';
        const labelClass = 'block text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mb-1.5';
        const safeText = (v) => escapeHtml(v ?? '');
        const safeNum = (v) => (v === null || v === undefined || v === '') ? '' : escapeHtml(String(v));
        const tags = Array.isArray(meal.tags) ? meal.tags.filter(Boolean).join(', ') : '';

        return `
            <div class="drum-sheet fixed inset-0 z-50 pointer-events-auto">
                <div class="drum-sheet-backdrop absolute inset-0 bg-black/40 dark:bg-black/60" data-action="close-edit-meal-modal"></div>
                <div class="drum-sheet-panel absolute bottom-0 left-0 right-0 bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 rounded-t-2xl border-t border-zinc-200 dark:border-white/10 flex flex-col drum-sheet-safe" role="dialog" aria-modal="true" aria-labelledby="edit-meal-title">
                    <div class="flex flex-col gap-3.5 px-4 pt-0 pb-1">
                        <div class="w-10 h-1 rounded-full bg-zinc-300 dark:bg-white/20 mx-auto drum-sheet-handle flex-shrink-0"></div>

                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-semibold truncate">ПИТАНИЕ</div>
                                <h3 id="edit-meal-title" class="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">Редактировать блюдо</h3>
                            </div>
                            <button type="button" data-action="close-edit-meal-modal" aria-label="Закрыть" class="sheet-close-btn w-8 h-8 rounded-xl bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400 text-sm flex-shrink-0 flex items-center justify-center hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M18 6L6 18"/></svg>
                            </button>
                        </div>

                        <div>
                            <label for="edit-meal-dish-name" class="${labelClass}">Название блюда</label>
                            <input type="text" id="edit-meal-dish-name" placeholder="Например: Салат с курицей" value="${safeText(meal.dish_name)}" class="${fieldClass}">
                        </div>

                        <div class="grid grid-cols-2 gap-2.5">
                            <div>
                                <label for="edit-meal-calories" class="${labelClass}">Ккал</label>
                                <input type="number" inputmode="numeric" id="edit-meal-calories" placeholder="0" value="${safeNum(meal.calories)}" class="${fieldClass}">
                            </div>
                            <div>
                                <label for="edit-meal-protein" class="${labelClass}">Белки, г</label>
                                <input type="number" inputmode="numeric" id="edit-meal-protein" placeholder="0" value="${safeNum(meal.protein_g)}" class="${fieldClass}">
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-2.5">
                            <div>
                                <label for="edit-meal-fat" class="${labelClass}">Жиры, г</label>
                                <input type="number" inputmode="numeric" id="edit-meal-fat" placeholder="0" value="${safeNum(meal.fat_g)}" class="${fieldClass}">
                            </div>
                            <div>
                                <label for="edit-meal-carbs" class="${labelClass}">Углеводы, г</label>
                                <input type="number" inputmode="numeric" id="edit-meal-carbs" placeholder="0" value="${safeNum(meal.carbs_g)}" class="${fieldClass}">
                            </div>
                        </div>

                        <div>
                            <label for="edit-meal-tags" class="${labelClass}">Теги <span class="opacity-60 normal-case tracking-normal">(через запятую)</span></label>
                            <input type="text" id="edit-meal-tags" placeholder="например: завтрак, белковый" value="${escapeHtml(tags)}" class="${fieldClass}">
                        </div>

                        <div>
                            <label for="edit-meal-notes" class="${labelClass}">Комментарий <span class="opacity-60 normal-case tracking-normal">(необязательно)</span></label>
                            <textarea id="edit-meal-notes" rows="2" placeholder="Например: без сахара" class="${fieldClass}">${safeText(meal.notes)}</textarea>
                        </div>

                        <button type="button" id="edit-meal-submit" data-action="submit-edit-meal" class="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-lime-500 hover:bg-lime-400 text-zinc-950 font-semibold text-base shadow-lg shadow-lime-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-lime-500 disabled:shadow-none">
                            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                            <span>Сохранить</span>
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
