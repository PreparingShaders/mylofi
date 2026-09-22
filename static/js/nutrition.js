console.log("[DEBUG] Loaded nutrition.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

export const Nutrition = {
    app: null,

    async render(container, app) {
        this.app = app;
        const today = new Date().toISOString().split('T')[0];
        let data;
        try {
            data = await API.get(`/nutrition/logs?date=${today}`, this.app.state.tokens.access);
        } catch (error) {
            console.error('[Nutrition] Load error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки данных');
            return;
        }

        const meals = data.meals || [];
        const summary = {
            calories: data.total_calories || 0,
            protein: data.total_protein_g || 0,
            fat: data.total_fat_g || 0,
            carbs: data.total_carbs_g || 0,
        };

        const targets = {
            target_calories: this.app.state.user?.target_calories || 2000,
        };

        let html = `
            <div class="p-4">
                <h2 class="text-xl font-bold mb-4">Питание за сегодня</h2>

                <div class="grid grid-cols-4 gap-2 mb-6">
                    <div class="bg-white dark:bg-surface-800 rounded-xl p-3 text-center">
                        <p class="text-2xl font-bold text-primary-600">${Math.round(summary.calories)}</p>
                        <p class="text-xs text-surface-500">Ккал</p>
                    </div>
                    <div class="bg-white dark:bg-surface-800 rounded-xl p-3 text-center">
                        <p class="text-lg font-bold text-primary-600">${Math.round(summary.protein)}г</p>
                        <p class="text-xs text-surface-500">Белки</p>
                    </div>
                    <div class="bg-white dark:bg-surface-800 rounded-xl p-3 text-center">
                        <p class="text-lg font-bold text-primary-600">${Math.round(summary.fat)}г</p>
                        <p class="text-xs text-surface-500">Жиры</p>
                    </div>
                    <div class="bg-white dark:bg-surface-800 rounded-xl p-3 text-center">
                        <p class="text-lg font-bold text-primary-600">${Math.round(summary.carbs)}г</p>
                        <p class="text-xs text-surface-500">Углы</p>
                    </div>
                </div>

                <div class="h-2 bg-surface-200 dark:bg-surface-700 rounded-full mb-4">
                    <div class="h-full bg-primary-600 rounded-full" style="width: ${Math.min(100, (summary.calories / targets.target_calories) * 100)}%"></div>
                </div>
                <p class="text-xs text-surface-500 mb-4">
                    ${Math.round(summary.calories)} / ${targets.target_calories} Ккал
                </p>

                ${meals.length === 0
                    ? `<div class="text-center py-8 text-surface-400">Приёмов пищи нет. Нажмите «Камера» чтобы добавить.</div>`
                    : meals.map(meal => Components.mealCard(meal, app)).join('')}
            </div>
        `;

        container.innerHTML = html;
    }
};
