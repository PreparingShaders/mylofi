console.log("[DEBUG] Loaded components.js");
import { Utils } from './utils.js';

export const Components = {
    loadingSpinner(size = 'h-8 w-8') {
        return `<div class="flex items-center justify-center"><div class="animate-spin rounded-full ${size} border-2 border-primary-600 border-t-transparent"></div></div>`;
    },

    errorState(message = 'Что-то пошло не так', onRetry = null) {
        return `<div class="p-8 text-center text-red-500">${message}</div>`;
    },

    emptyState(message = 'Нет данных', actionText = null, onAction = null) {
        return `<div class="p-8 text-center text-surface-500">${message}</div>`;
    },

    progressRing(value, max, size = 120, strokeWidth = 10, color = 'primary-600', bgColor = 'surface-300', label = null) {
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

    mealCard(meal, app) {
        const isPending = meal.status === 'pending' || meal.status === 'processing';
        return `
            <div class="bg-white p-4 rounded-2xl shadow-sm mb-4">
                <h3 class="font-semibold">${meal.dish_name || (isPending ? 'Анализ...' : 'Блюдо')}</h3>
                <p>${Math.round(meal.calories || 0)} Ккал</p>
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
        const trend = last > first ? '↗' : last < first ? '↘' : '→';
        const trendColor = last > first ? 'text-green-500' : last < first ? 'text-red-500' : 'text-surface-400';

        const toY = (v) => 85 - ((v - min) / range) * 60;

        const points = data.map((v, i) => {
            const x = data.length > 1 ? 5 + (i / (data.length - 1)) * 90 : 50;
            const y = toY(v);
            return `${x},${y}`;
        }).join(' ');

        const pointCircles = data.map((v, i) => {
            const x = data.length > 1 ? 5 + (i / (data.length - 1)) * 90 : 50;
            const y = toY(v);
            const isLast = i === data.length - 1;
            const r = isLast ? 5 : 3.5;
            return `<circle cx="${x}" cy="${y}" r="${r}" fill="#4f46e5" stroke="white" stroke-width="1.5" ${isLast ? 'style="filter: drop-shadow(0 0 4px #4f46e5)"' : ''}/>`;
        }).join('');

        return `
            <div class="w-full">
                <div class="pb-2 mb-2 border-b border-surface-200">
                    <div class="text-xs text-surface-500 font-medium mb-1">${label}</div>
                    <div class="flex justify-between items-baseline">
                        <span class="text-[10px] text-surface-400 font-mono">${formatNum(min)} кг</span>
                        <div class="flex items-center gap-1">
                            <span class="text-xs text-surface-400">Последнее:</span>
                            <span class="text-sm font-bold font-mono text-primary-600 ${trendColor}">${formatNum(last)} ${trend}</span>
                        </div>
                        <span class="text-[10px] text-surface-400 font-mono">${formatNum(max)} кг</span>
                    </div>
                </div>
                <div class="pt-2">
                    <svg width="100%" height="${height}" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="sparkline-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
                                <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.25"/>
                                <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
                            </linearGradient>
                        </defs>
                        <g stroke="currentColor" stroke-opacity="0.06" stroke-width="0.5" stroke-dasharray="3 3">
                            <line x1="0" y1="35" x2="100" y2="35"/>
                            <line x1="0" y1="65" x2="100" y2="65"/>
                        </g>
                        ${data.length === 1
                            ? `<circle cx="50" cy="55" r="7" fill="#4f46e5"/>`
                            : `
                                <polygon points="0,100 ${points} 100,100" fill="url(#sparkline-gradient)"/>
                                <polyline points="${points}" fill="none" stroke="#4f46e5" stroke-linejoin="round" stroke-linecap="round" stroke-width="2.5"/>
                                ${pointCircles}
                            `}
                    </svg>
                </div>
            </div>
        `;
    }
};