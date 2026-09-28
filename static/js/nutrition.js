import { API } from './api.js';
import { DB } from './db.js';
import { SyncEngine } from './sync.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

export const Nutrition = {
    app: null,

    async render(container, app) {
        this.app = app;
        try {
            const today = new Date().toISOString().split('T')[0];
            let data = null;
            let fromCache = false;

            try {
                data = await API.get(`/nutrition/logs?date=${today}`, this.app.state.tokens.access);
            } catch (error) {
                console.warn('[Nutrition] API unavailable, falling back to local data:', error?.message);
                fromCache = true;
            }

            if (!data && !fromCache) {
                container.innerHTML = Components.errorState('Данные не найдены');
                return;
            }

            const serverMeals = (data && data.meals) || [];
            const summary = data ? {
                calories: data.total_calories || 0,
                protein: data.total_protein_g || 0,
                fat: data.total_fat_g || 0,
                carbs: data.total_carbs_g || 0,
            } : { calories: 0, protein: 0, fat: 0, carbs: 0 };

            let pendingMeals = [];
            try {
                pendingMeals = await DB.getMealsByStatus(DB.SYNC_STATUS.PENDING);
            } catch (error) {
                console.warn('[Nutrition] Failed to read pending meals:', error);
            }

            let failedItems = [];
            try {
                failedItems = await SyncEngine.getFailedItems();
            } catch (error) {
                console.warn('[Nutrition] Failed to read failed items:', error);
            }

            const pendingMealCards = pendingMeals
                .slice()
                .sort((a, b) => (b.eaten_at || b.updated_at || 0) - (a.eaten_at || a.updated_at || 0))
                .map(meal => Components.mealCard(meal, app));

            const targets = {
                target_calories: this.app.state.user?.target_calories || 2000,
            };

            let html = `
                <div class="p-4">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="text-xl font-bold">Питание за сегодня</h2>
                        ${fromCache
                            ? '<span class="text-xs text-amber-500">Оффлайн</span>'
                            : ''}
                    </div>

                    <div class="grid grid-cols-4 gap-2 mb-6">
                        <div class="glass rounded-xl p-3 text-center">
                            <p class="text-2xl font-bold text-surface-900 dark:text-zinc-100">${Math.round(summary.calories)}</p>
                            <p class="text-xs text-surface-500">Ккал</p>
                        </div>
                        <div class="glass rounded-xl p-3 text-center">
                            <p class="text-lg font-bold text-surface-900 dark:text-zinc-100">${Math.round(summary.protein)}г</p>
                            <p class="text-xs text-surface-500">Белки</p>
                        </div>
                        <div class="glass rounded-xl p-3 text-center">
                            <p class="text-lg font-bold text-surface-900 dark:text-zinc-100">${Math.round(summary.fat)}г</p>
                            <p class="text-xs text-surface-500">Жиры</p>
                        </div>
                        <div class="glass rounded-xl p-3 text-center">
                            <p class="text-lg font-bold text-surface-900 dark:text-zinc-100">${Math.round(summary.carbs)}г</p>
                            <p class="text-xs text-surface-500">Углы</p>
                        </div>
                    </div>

                    <div class="h-2 bg-surface-200 dark:bg-white/10 rounded-full mb-4">
                        <div class="h-full bg-surface-800 dark:bg-zinc-100 rounded-full" style="width: ${Math.min(100, (summary.calories / targets.target_calories) * 100)}%"></div>
                    </div>
                    <p class="text-xs text-surface-500 mb-4">
                        ${Math.round(summary.calories)} / ${targets.target_calories} Ккал
                    </p>

                    ${pendingMealCards.length > 0 ? `
                        <div class="mb-4">
                            <h3 class="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-2">Сохранено офлайн</h3>
                            ${pendingMealCards}
                        </div>
                    ` : ''}

                    ${failedItems.length > 0 ? `
                        <div class="mb-4">
                            <div class="flex items-center justify-between mb-2">
                                <h3 class="text-xs font-semibold text-red-400 uppercase tracking-wider">Ошибка синхронизации</h3>
                                <button id="clear-failed" class="text-xs text-red-500 hover:text-red-400">Очистить все</button>
                            </div>
                            ${failedItems.map(item => `
                                <div class="glass rounded-xl p-3 mb-2">
                                    <p class="text-sm text-surface-600 dark:text-surface-300">${item.endpoint || 'Запрос'}</p>
                                    <p class="text-xs text-surface-500 truncate">${item.error || 'Неизвестная ошибка'}</p>
                                </div>
                            `).join('')}
                            <button id="retry-failed" class="w-full py-2 mt-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-xl">Повторить сейчас</button>
                        </div>
                    ` : ''}

                    ${serverMeals.length === 0 && pendingMealCards.length === 0
                        ? `<div class="text-center py-8 text-surface-400">Приёмов пищи нет. Нажмите «Камера» чтобы добавить.</div>`
                        : serverMeals.map(meal => Components.mealCard(meal, app)).join('')}
                </div>
            `;

            container.innerHTML = html;

            const retryBtn = container.querySelector('#retry-failed');
            if (retryBtn) {
                retryBtn.onclick = async () => {
                    retryBtn.disabled = true;
                    retryBtn.textContent = 'Синхронизация...';
                    try {
                        await SyncEngine.processQueue();
                    } catch (e) {
                        console.error('[Nutrition] Retry failed:', e);
                    }
                    this.app.state.app.renderPage('nutrition');
                };
            }

            const clearBtn = container.querySelector('#clear-failed');
            if (clearBtn) {
                clearBtn.onclick = async () => {
                    await SyncEngine.clearQueue();
                    this.app.state.app.renderPage('nutrition');
                };
            }
        } catch (error) {
            console.error('[Nutrition] Render error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки данных');
        }
    }
};
