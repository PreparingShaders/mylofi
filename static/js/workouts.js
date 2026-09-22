console.log("[DEBUG] Loaded workouts.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

export const Workouts = {
    app: null,

    async render(container, app) {
        this.app = app;
        let activeSession;
        try {
            activeSession = await API.get('/workouts/sessions/active', this.app.state.tokens.access);
        } catch (error) {
            console.error('[Workouts] Load error:', error);
            activeSession = null;
        }

        let html = `
            <div class="p-4">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">Мои тренировки</h2>
                </div>

                ${activeSession
                    ? `<div class="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl p-4 mb-4">
                        <h3 class="font-semibold text-primary-700 dark:text-primary-300">Активная тренировка</h3>
                        <p class="text-sm text-surface-600 dark:text-surface-300 mb-2">${activeSession.name || 'Без названия'}</p>
                        <button data-action="resume-workout" data-session-id="${activeSession.id}"
                                class="w-full py-2 bg-primary-600 text-white rounded-xl text-sm font-medium">
                            Продолжить
                        </button>
                    </div>`
                    : `<div class="bg-surface-100 dark:bg-surface-800 rounded-xl p-4 mb-4 text-center">
                        <p class="text-surface-500 mb-3">Нет активной тренировки</p>
                        <button data-action="start-workout"
                                class="w-full py-2 bg-primary-600 text-white rounded-xl text-sm font-medium">
                            Начать новую
                        </button>
                    </div>`}

                <button data-action="view-history"
                        class="w-full py-2 border border-surface-300 dark:border-surface-700 rounded-xl text-sm font-medium mb-4">
                    История тренировок
                </button>

                <p class="text-xs text-surface-400 text-center">Здесь будут шаблоны и кнопка начала тренировки</p>
            </div>
        `;

        container.innerHTML = html;
    },

    async renderHistory(container, app) {
        this.app = app;
        let data;
        try {
            data = await API.get('/workouts/history?limit=20', this.app.state.tokens.access);
        } catch (error) {
            console.error('[Workouts] History load error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки истории');
            return;
        }

        const sessions = data.sessions || [];

        let html = `
            <div class="p-4">
                <div class="flex items-center mb-4">
                    <button data-action="back-to-workouts" class="mr-3 text-surface-500 hover:text-surface-900">
                        ←
                    </button>
                    <h2 class="text-xl font-bold">История тренировок</h2>
                </div>

                ${sessions.length === 0
                    ? `<div class="text-center py-8 text-surface-400">Ещё нет тренировок. Начните первую!</div>`
                    : `<div class="space-y-3">
                        ${sessions.map(s => `
                            <div class="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm">
                                <h3 class="font-semibold">${s.name || 'Тренировка'}</h3>
                                <p class="text-sm text-surface-500">
                                    ${Utils.formatDate(s.started_at)} · ${Utils.formatDuration(s.duration_seconds || 0)}
                                </p>
                                <p class="text-xs text-surface-400 capitalize mt-1">
                                    Статус: ${s.status === 'completed' ? 'Завершена' : s.status === 'cancelled' ? 'Отменена' : 'Активна'}
                                </p>
                            </div>
                        `).join('')}
                    </div>`}
            </div>
        `;

        container.innerHTML = html;
    }
};
