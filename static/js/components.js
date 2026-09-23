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

    sparkline(data, width = 100, height = 30) {
        if (!data || data.length === 0) return '<div class="text-xs text-surface-400">Нет данных</div>';
        
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        
        const points = data.map((v, i) => {
            const x = data.length > 1 ? (i / (data.length - 1)) * width : width / 2;
            const y = height - ((v - min) / range) * height;
            return `${x},${y}`;
        }).join(' ');

        return `
            <div class="flex items-center gap-2">
                <span class="text-[10px] text-surface-400 font-mono">${min}</span>
                <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="stroke-primary-500 fill-none" stroke-width="2">
                    ${data.length === 1 ? `<circle cx="${width/2}" cy="${height/2}" r="3" class="fill-primary-500"/>` : `<polyline points="${points}" stroke-linejoin="round" stroke-linecap="round"/>`}
                </svg>
                <span class="text-[10px] text-surface-400 font-mono">${max}</span>
            </div>
        `;
    }
};