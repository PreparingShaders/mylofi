console.log("[DEBUG] Loaded admin.js");
import { API } from './api.js';
import { Components } from './components.js';

const Admin = {
    app: null,
    container: null,

    async render(container, app) {
        this.app = app;
        this.container = container;

        container.innerHTML = Components.loadingSpinner();
        await this.loadStats();
        await this.loadUsers();
    },

    async loadStats() {
        try {
            const stats = await API.get('/admin/stats', this.app.state.tokens.access);
            const statsEl = this.container.querySelector('#admin-stats');
            if (!statsEl) return;
            statsEl.innerHTML = `
                <div class="grid grid-cols-2 gap-3 mb-6">
                    <div class="glass rounded-2xl p-4">
                        <p class="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wider">Всего пользователей</p>
                        <p class="text-2xl font-bold text-surface-900 dark:text-zinc-100 mt-1">${stats.total_users}</p>
                        <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">Активных: ${stats.active_users}</p>
                    </div>
                    <div class="glass rounded-2xl p-4">
                        <p class="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wider">Тренировок</p>
                        <p class="text-2xl font-bold text-surface-900 dark:text-zinc-100 mt-1">${stats.total_workouts}</p>
                        <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">Сегодня: ${stats.active_today}</p>
                    </div>
                    <div class="glass rounded-2xl p-4">
                        <p class="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wider">Приёмов пищи</p>
                        <p class="text-2xl font-bold text-surface-900 dark:text-zinc-100 mt-1">${stats.total_meals}</p>
                    </div>
                    <div class="glass rounded-2xl p-4">
                        <p class="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wider">Ошибок ИИ</p>
                        <p class="text-2xl font-bold text-surface-900 dark:text-zinc-100 mt-1">${stats.ai_error_rate}%</p>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('[Admin] Stats load error:', error);
        }
    },

    async loadUsers() {
        const listEl = this.container.querySelector('#admin-users');
        if (!listEl) return;
        listEl.innerHTML = Components.loadingSpinner();

        try {
            const data = await API.get('/admin/users?page=1&page_size=50', this.app.state.tokens.access);
            if (data.items.length === 0) {
                listEl.innerHTML = `<p class="text-sm text-surface-500 dark:text-surface-400 text-center py-8">Пользователи не найдены</p>`;
                return;
            }

            listEl.innerHTML = `
                <div class="glass rounded-2xl overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-surface-200 dark:border-white/10">
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">ID</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Email</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Имя</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Активен</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Админ</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.items.map(u => `
                                    <tr class="border-b border-surface-100 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/5">
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${u.id}</td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300 font-medium">${escapeHtml(u.email)}</td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${escapeHtml(u.full_name || '—')}</td>
                                        <td class="px-4 py-3">
                                            <button data-action="toggle-active" data-user-id="${u.id}" data-active="${u.is_active}" class="px-2 py-1 rounded-lg text-xs font-semibold transition-all ${u.is_active ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}">${u.is_active ? 'Активен' : 'Заблокирован'}</button>
                                        </td>
                                        <td class="px-4 py-3">
                                            <button data-action="toggle-admin" data-user-id="${u.id}" data-admin="${u.is_admin}" class="px-2 py-1 rounded-lg text-xs font-semibold transition-all ${u.is_admin ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400' : 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400'}">${u.is_admin ? 'Админ' : 'Пользователь'}</button>
                                        </td>
                                        <td class="px-4 py-3">
                                            <button data-action="reset-quota" data-user-id="${u.id}" class="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors">Сбросить квоту</button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="px-4 py-3 border-t border-surface-200 dark:border-white/10 flex items-center justify-between">
                        <span class="text-xs text-surface-500 dark:text-surface-400">Всего: ${data.total}</span>
                        <span class="text-xs text-surface-500 dark:text-surface-400">Страница ${data.page}</span>
                    </div>
                </div>
            `;
        } catch (error) {
            listEl.innerHTML = Components.errorState('Ошибка загрузки пользователей');
        }
    },

    async toggleActive(userId, isActive) {
        try {
            await API.patch(`/admin/users/${userId}/status`, { is_active: !isActive }, this.app.state.tokens.access);
            this.app.showToast('Статус пользователя обновлён', 'success');
            await this.loadUsers();
        } catch (error) {
            this.app.showToast(error?.data?.detail || error?.message || 'Ошибка обновления статуса', 'error');
        }
    },

    async toggleAdmin(userId, isAdmin) {
        try {
            await API.patch(`/admin/users/${userId}/status`, { is_admin: !isAdmin }, this.app.state.tokens.access);
            this.app.showToast('Статус администратора обновлён', 'success');
            await this.loadUsers();
        } catch (error) {
            this.app.showToast(error?.data?.detail || error?.message || 'Ошибка обновления роли', 'error');
        }
    },

    async resetQuota(userId) {
        if (!await Components.confirmModal({
            title: 'Сбросить ИИ-квоту?',
            message: 'Сбросить счётчики AI для этого пользователя?',
            confirmText: 'Сбросить',
            confirmClass: 'bg-red-600 hover:bg-red-700 text-white shadow-md',
            cancelText: 'Отмена'
        })) return;

        try {
            await API.post(`/admin/users/${userId}/reset-ai-quota`, null, this.app.state.tokens.access);
            this.app.showToast('Квота ИИ сброшена', 'success');
        } catch (error) {
            this.app.showToast(error?.data?.detail || error?.message || 'Ошибка сброса квоты', 'error');
        }
    }
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'toggle-active') {
        const btn = e.target.closest('[data-action="toggle-active"]');
        Admin.toggleActive(parseInt(btn.dataset.userId), btn.dataset.active === 'true');
    }
    if (action === 'toggle-admin') {
        const btn = e.target.closest('[data-action="toggle-admin"]');
        Admin.toggleAdmin(parseInt(btn.dataset.userId), btn.dataset.admin === 'true');
    }
    if (action === 'reset-quota') {
        const btn = e.target.closest('[data-action="reset-quota"]');
        Admin.resetQuota(parseInt(btn.dataset.userId));
    }
});

export { Admin };
