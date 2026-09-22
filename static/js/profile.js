console.log("[DEBUG] Loaded profile.js");
import { API } from './api.js';
import { Components } from './components.js';

export const Profile = {
    app: null,

    async render(container, app) {
        this.app = app;
        let user;
        try {
            user = await API.get('/users/me', this.app.state.tokens.access);
        } catch (error) {
            console.error('[Profile] Load error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки профиля');
            return;
        }

        container.innerHTML = `
            <div class="p-4">
                <div class="flex justify-between items-center mb-6">
                    <h2 class="text-xl font-bold">Профиль</h2>
                    <button data-action="logout"
                            class="text-red-500 text-sm font-medium">
                        Выйти
                    </button>
                </div>

                <div class="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm mb-4">
                    <h3 class="font-semibold mb-3">Данные пользователя</h3>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">
                        <span class="text-surface-500">Email:</span> ${user.email}
                    </p>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">
                        <span class="text-surface-500">Имя:</span> ${user.full_name || '—'}
                    </p>
                    <p class="text-sm text-surface-600 dark:text-surface-300">
                        <span class="text-surface-500">Роль:</span> ${user.role}
                    </p>
                </div>

                <div class="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm mb-4">
                    <h3 class="font-semibold mb-3">Целевые макросы</h3>
                    <p class="text-sm text-surface-600 dark:text-surface-300 mb-1">
                        <span class="text-surface-500">Калории:</span> ${user.target_calories || '—'} ккал
                    </p>
                    <p class="text-sm text-surface-600 dark:text-surface-300">
                        <span class="text-surface-500">Вес:</span> ${user.target_weight_kg || user.weight_kg || '—'} кг
                    </p>
                </div>

                <div class="text-xs text-surface-400 text-center">
                    Зарегистрирован: ${user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}
                </div>
            </div>
        `;
    }
};
