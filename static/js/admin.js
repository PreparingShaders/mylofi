console.log("[DEBUG] Loaded admin.js");
import { API } from './api.js';
import { Components } from './components.js';

const Admin = {
    app: null,
    container: null,
    userModal: null,
    feedbackModal: null,

    state: {
        activeTab: 'users',
        search: '',
        feedback_search: '',
        is_active: null,
        is_admin: null,
        feedback_status: null,
        feedback_category: null,
        page: 1,
        page_size: 20,
        total: 0,
        total_pages: 1,
        feedback_total: 0,
        feedback_page: 1,
        feedback_total_pages: 1,
    },

    async render(container, app) {
        this.app = app;
        this.container = container;

        this.state.activeTab = 'users';
        this.state.search = '';
        this.state.is_active = null;
        this.state.is_admin = null;
        this.state.feedback_status = null;
        this.state.feedback_category = null;
        this.state.page = 1;
        this.state.feedback_page = 1;

        container.innerHTML = this.renderShell();
        await this.loadStats();
        await this.loadTabData();
    },

    renderShell() {
        return `
            <div class="admin-panel space-y-6">
                <div id="admin-stats" class="space-y-4"></div>

                <!-- Tab Navigation -->
                <div class="flex gap-2 border-b border-surface-200 dark:border-white/10 pb-2">
                    <button data-action="admin-tab" data-tab="users"
                            class="admin-tab-btn px-4 py-2.5 text-sm font-medium rounded-t-xl transition-all
                                   border-b-2 -mb-px">
                        Пользователи
                    </button>
                    <button data-action="admin-tab" data-tab="feedback"
                            class="admin-tab-btn px-4 py-2.5 text-sm font-medium rounded-t-xl transition-all
                                   border-b-2 -mb-px">
                        Обратная связь
                    </button>
                </div>

                <!-- Users Tab Content -->
                <div id="admin-users-tab" class="space-y-4">
                    <div class="flex flex-col sm:flex-row gap-2">
                        <div class="relative flex-1">
                            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 dark:text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                            </svg>
                            <input type="text" id="admin-search" data-action="admin-search"
                                   placeholder="Поиск по email или имени..."
                                   class="w-full pl-10 pr-4 py-2.5 rounded-xl glass-input text-sm text-surface-900 dark:text-zinc-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-lime-500/30">
                        </div>
                        <div class="flex gap-2">
                            <select id="admin-filter-active" data-action="admin-filter" data-filter="is_active"
                                    class="px-3 py-2 rounded-xl glass-input text-sm text-surface-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-lime-500/30">
                                <option value="">Все статусы</option>
                                <option value="true">Активные</option>
                                <option value="false">Заблокированные</option>
                            </select>
                            <select id="admin-filter-admin" data-action="admin-filter" data-filter="is_admin"
                                    class="px-3 py-2 rounded-xl glass-input text-sm text-surface-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-lime-500/30">
                                <option value="">Все роли</option>
                                <option value="true">Админы</option>
                                <option value="false">Пользователи</option>
                            </select>
                            <button data-action="admin-reset-filters"
                                    class="px-3 py-2 rounded-xl glass text-xs font-semibold text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors">
                                Сбросить
                            </button>
                        </div>
                    </div>

                    <div id="admin-users" class="min-h-[120px]"></div>

                    <div id="admin-pagination" class="flex justify-center"></div>
                </div>

                <!-- Feedback Tab Content -->
                <div id="admin-feedback-tab" class="space-y-4 hidden">
                    <div class="flex flex-col sm:flex-row gap-2">
                        <div class="relative flex-1">
                            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 dark:text-surface-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                            </svg>
                            <input type="text" id="admin-feedback-search" data-action="admin-feedback-search"
                                   placeholder="Поиск по email или сообщению..."
                                   class="w-full pl-10 pr-4 py-2.5 rounded-xl glass-input text-sm text-surface-900 dark:text-zinc-100 placeholder-surface-400 dark:placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-lime-500/30">
                        </div>
                        <div class="flex gap-2">
                            <select id="admin-feedback-filter-status" data-action="admin-feedback-filter" data-filter="status"
                                    class="px-3 py-2 rounded-xl glass-input text-sm text-surface-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-lime-500/30">
                                <option value="">Все статусы</option>
                                <option value="new">Новые</option>
                                <option value="resolved">Решённые</option>
                            </select>
                            <select id="admin-feedback-filter-category" data-action="admin-feedback-filter" data-filter="category"
                                    class="px-3 py-2 rounded-xl glass-input text-sm text-surface-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-lime-500/30">
                                <option value="">Все категории</option>
                                <option value="pro_request">PRO запрос</option>
                                <option value="bug">Баг</option>
                                <option value="question">Вопрос</option>
                            </select>
                            <button data-action="admin-feedback-reset-filters"
                                    class="px-3 py-2 rounded-xl glass text-xs font-semibold text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors">
                                Сбросить
                            </button>
                        </div>
                    </div>

                    <div id="admin-feedback-list" class="min-h-[120px]"></div>

                    <div id="admin-feedback-pagination" class="flex justify-center"></div>
                </div>
            </div>
        `;
    },

    buildUsersQuery() {
        const params = new URLSearchParams();
        if (this.state.search) params.set('search', this.state.search);
        if (this.state.is_active !== null) params.set('is_active', this.state.is_active);
        if (this.state.is_admin !== null) params.set('is_admin', this.state.is_admin);
        params.set('page', String(this.state.page));
        params.set('page_size', String(this.state.page_size));
        return params.toString();
    },

    buildFeedbackQuery() {
        const params = new URLSearchParams();
        if (this.state.feedback_search) params.set('search', this.state.feedback_search);
        if (this.state.feedback_status) params.set('status', this.state.feedback_status);
        if (this.state.feedback_category) params.set('category', this.state.feedback_category);
        params.set('page', String(this.state.feedback_page));
        params.set('page_size', String(this.state.page_size));
        return params.toString();
    },

    syncFilterUI() {
        const activeFilter = this.container.querySelector('#admin-filter-active');
        const adminFilter = this.container.querySelector('#admin-filter-admin');
        const searchInput = this.container.querySelector('#admin-search');
        if (activeFilter) activeFilter.value = this.state.is_active !== null ? String(this.state.is_active) : '';
        if (adminFilter) adminFilter.value = this.state.is_admin !== null ? String(this.state.is_admin) : '';
        if (searchInput) searchInput.value = this.state.search;

        // Feedback tab filters
        const feedbackStatusFilter = this.container.querySelector('#admin-feedback-filter-status');
        const feedbackCategoryFilter = this.container.querySelector('#admin-feedback-filter-category');
        const feedbackSearchInput = this.container.querySelector('#admin-feedback-search');
        if (feedbackStatusFilter) feedbackStatusFilter.value = this.state.feedback_status || '';
        if (feedbackCategoryFilter) feedbackCategoryFilter.value = this.state.feedback_category || '';
        if (feedbackSearchInput) feedbackSearchInput.value = this.state.feedback_search || '';
    },

    async applySearch() {
        const searchInput = this.container.querySelector('#admin-search');
        this.state.search = searchInput ? searchInput.value.trim() : '';
        this.state.page = 1;
        await this.loadUsers();
    },

    async applyFeedbackSearch() {
        const searchInput = this.container.querySelector('#admin-feedback-search');
        this.state.feedback_search = searchInput ? searchInput.value.trim() : '';
        this.state.feedback_page = 1;
        await this.loadFeedback();
    },

    async applyFilter(filter, value) {
        if (filter === 'is_active') {
            this.state.is_active = value === '' ? null : value === 'true';
        } else if (filter === 'is_admin') {
            this.state.is_admin = value === '' ? null : value === 'true';
        }
        this.state.page = 1;
        await this.loadUsers();
    },

    async applyFeedbackFilter(filter, value) {
        if (filter === 'status') {
            this.state.feedback_status = value === '' ? null : value;
        } else if (filter === 'category') {
            this.state.feedback_category = value === '' ? null : value;
        }
        this.state.feedback_page = 1;
        await this.loadFeedback();
    },

    resetFilters() {
        this.state.search = '';
        this.state.is_active = null;
        this.state.is_admin = null;
        this.state.page = 1;
        this.syncFilterUI();
        this.loadUsers();
    },

    resetFeedbackFilters() {
        this.state.feedback_search = '';
        this.state.feedback_status = null;
        this.state.feedback_category = null;
        this.state.feedback_page = 1;
        this.syncFilterUI();
        this.loadFeedback();
    },

    async loadTabData() {
        if (this.state.activeTab === 'users') {
            await this.loadUsers();
        } else if (this.state.activeTab === 'feedback') {
            await this.loadFeedback();
        }
    },

    async switchTab(tab) {
        this.state.activeTab = tab;
        const usersTab = this.container.querySelector('#admin-users-tab');
        const feedbackTab = this.container.querySelector('#admin-feedback-tab');
        const usersBtn = this.container.querySelector('[data-tab="users"]');
        const feedbackBtn = this.container.querySelector('[data-tab="feedback"]');

        // Clear the destination panel's rendered rows before switching, so a
        // stale list never lingers behind the new tab's loading spinner.
        const usersList = this.container.querySelector('#admin-users');
        const feedbackList = this.container.querySelector('#admin-feedback-list');
        const usersPagination = this.container.querySelector('#admin-pagination');
        const feedbackPagination = this.container.querySelector('#admin-feedback-pagination');

        if (tab === 'users') {
            usersTab.classList.remove('hidden');
            feedbackTab.classList.add('hidden');
            usersBtn.classList.add('border-lime-500', 'text-lime-600', 'dark:text-lime-400');
            usersBtn.classList.remove('text-surface-500', 'dark:text-zinc-400', 'border-transparent');
            feedbackBtn.classList.remove('border-lime-500', 'text-lime-600', 'dark:text-lime-400');
            feedbackBtn.classList.add('text-surface-500', 'dark:text-zinc-400', 'border-transparent');
            if (usersList) usersList.innerHTML = '';
            if (usersPagination) usersPagination.innerHTML = '';
            await this.loadUsers();
        } else {
            usersTab.classList.add('hidden');
            feedbackTab.classList.remove('hidden');
            feedbackBtn.classList.add('border-lime-500', 'text-lime-600', 'dark:text-lime-400');
            feedbackBtn.classList.remove('text-surface-500', 'dark:text-zinc-400', 'border-transparent');
            usersBtn.classList.remove('border-lime-500', 'text-lime-600', 'dark:text-lime-400');
            usersBtn.classList.add('text-surface-500', 'dark:text-zinc-400', 'border-transparent');
            if (feedbackList) feedbackList.innerHTML = '';
            if (feedbackPagination) feedbackPagination.innerHTML = '';
            await this.loadFeedback();
        }
    },

    prevPage() {
        if (this.state.page > 1) {
            this.state.page -= 1;
            this.loadUsers();
        }
    },

    nextPage() {
        if (this.state.page < this.state.total_pages) {
            this.state.page += 1;
            this.loadUsers();
        }
    },

    async loadStats() {
        try {
            const stats = await API.get('/admin/stats', this.app.state.tokens.access);
            const statsEl = this.container.querySelector('#admin-stats');
            if (!statsEl) return;
            statsEl.innerHTML = `
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            this.container.querySelector('#admin-stats').innerHTML = Components.errorState('Ошибка загрузки статистики');
        }
    },

    async loadUsers() {
        const listEl = this.container.querySelector('#admin-users');
        if (!listEl) return;
        listEl.innerHTML = Components.loadingSpinner();

        try {
            const query = this.buildUsersQuery();
            const data = await API.get(`/admin/users${query ? `?${query}` : ''}`, this.app.state.tokens.access);

            this.syncFilterUI();

            this.state.total = data.total;
            this.state.total_pages = Math.ceil(data.total / data.page_size) || 1;

            if (!data.items || data.items.length === 0) {
                listEl.innerHTML = `<p class="text-sm text-surface-500 dark:text-surface-400 text-center py-8">Пользователи не найдены</p>`;
                this.renderPagination();
                return;
            }

            const isCurrentUser = (id) => this.app.state.user && id === this.app.state.user.id;

            const getInitials = (name) => {
                if (!name) return '?';
                const parts = name.trim().split(/\s+/);
                if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            };

            const avatarColorClass = (user) => user.is_admin
                ? 'bg-lime-500/10 text-lime-600 dark:text-lime-400'
                : 'bg-primary-600/10 text-primary-600 dark:text-zinc-200';

            listEl.innerHTML = `
                <div class="glass rounded-2xl overflow-hidden">
                    <div class="w-full overflow-x-auto scrollbar-thin hidden md:block">
                        <table class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-surface-200 dark:border-white/10">
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">ID</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Email</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Имя</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Активен</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Админ</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Квота</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Создано</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.items.map(u => {
                                    const self = isCurrentUser(u.id);
                                    return `
                                    <tr class="border-b border-surface-100 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/5">
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${u.id}</td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300 font-medium">${escapeHtml(u.email)}</td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${escapeHtml(u.full_name || '—')}</td>
                                        <td class="px-4 py-3">
                                            ${self
                                                ? `<span class="px-2 py-1 rounded-lg text-xs font-semibold ${u.is_active ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}">${u.is_active ? 'Активен' : 'Заблокирован'}</span>`
                                                : `<button data-action="toggle-active" data-user-id="${u.id}" data-active="${u.is_active}" class="px-2 py-1 rounded-lg text-xs font-semibold transition-all ${u.is_active ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}">${u.is_active ? 'Активен' : 'Заблокирован'}</button>`
                                            }
                                        </td>
                                        <td class="px-4 py-3">
                                            ${self
                                                ? `<span class="px-2 py-1 rounded-lg text-xs font-semibold ${u.is_admin ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400' : 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400'}">${u.is_admin ? 'Админ' : 'Пользователь'}</span>`
                                                : `<button data-action="toggle-admin" data-user-id="${u.id}" data-admin="${u.is_admin}" class="px-2 py-1 rounded-lg text-xs font-semibold transition-all ${u.is_admin ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400' : 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400'}">${u.is_admin ? 'Админ' : 'Пользователь'}</button>`
                                            }
                                        </td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${u.meal_ai_daily_count}</td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${u.created_workouts_count}</td>
                                        <td class="px-4 py-3">
                                            <div class="flex items-center gap-1">
                                                <button data-action="view-user" data-user-id="${u.id}"
                                                        class="p-1 rounded-lg text-surface-600 dark:text-zinc-300 hover:text-primary-600 dark:hover:text-zinc-100 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors"
                                                        title="Подробнее" aria-label="Подробнее">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.25 11.25l.04.04M21 12c0 9-9 21-9 21S3 21 3 12a9 9 0 1118 0z"></path>
                                                    </svg>
                                                </button>
                                                ${self ? '' : `<button data-action="reset-quota" data-user-id="${u.id}" class="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors">Сбросить квоту</button>`}
                                            </div>
                                        </td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>

                    <div class="block md:hidden space-y-2 p-4">
                        ${data.items.map(u => {
                            const self = isCurrentUser(u.id);
                            const initials = getInitials(u.full_name);
                            const colorClass = avatarColorClass(u);
                            return `
                            <button data-action="view-user" data-user-id="${u.id}"
                                    class="w-full text-left p-3 rounded-xl hover:bg-surface-100 dark:hover:bg-white/5 transition-colors group"
                                    aria-label="Подробнее о ${escapeHtml(u.full_name || u.email)}">
                                <div class="flex items-center gap-3">
                                    <div class="w-10 h-10 rounded-xl flex items-center justify-center ${colorClass} shrink-0">
                                        <span class="text-sm font-semibold">${initials}</span>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <p class="text-sm font-semibold truncate text-surface-900 dark:text-zinc-100">${escapeHtml(u.full_name || u.email)}</p>
                                        <p class="text-xs text-surface-500 dark:text-surface-400 truncate">${escapeHtml(u.email)}</p>
                                    </div>
                                    <div class="flex items-center gap-2 shrink-0">
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${u.is_active ? 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}">
                                            ${u.is_active ? 'Активен' : 'Блок'}
                                        </span>
                                        <svg class="w-4 h-4 text-surface-400 dark:text-surface-500 group-hover:text-primary-600 dark:group-hover:text-zinc-200 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                                        </svg>
                                    </div>
                                </div>
                            </button>
                            `;
                        }).join('')}
                    </div>

                    <div class="px-4 py-3 border-t border-surface-200 dark:border-white/10 flex items-center justify-between">
                        <span class="text-xs text-surface-500 dark:text-surface-400">Всего: ${data.total}</span>
                        <span class="text-xs text-surface-500 dark:text-surface-400">Страница ${data.page} из ${this.state.total_pages}</span>
                    </div>
                </div>
            `;

            this.renderPagination();
        } catch (error) {
            console.error('[Admin] Users load error:', error);
            listEl.innerHTML = Components.errorState('Ошибка загрузки пользователей');
            this.renderPagination();
        }
    },

    renderPagination() {
        const el = this.container.querySelector('#admin-pagination');
        if (!el) return;

        const total = this.state.total;
        const pageSize = this.state.page_size;
        const currentPage = this.state.page;
        const totalPages = Math.ceil(total / pageSize) || 1;
        const hasPrev = currentPage > 1;
        const hasNext = currentPage < totalPages;

        el.innerHTML = `
            <div class="flex items-center gap-2">
                <button data-action="admin-prev-page"
                        class="px-3 py-1.5 rounded-xl text-sm font-semibold flex items-center gap-1 transition-all
                               ${hasPrev
                                   ? 'glass text-surface-900 dark:text-zinc-100 hover:bg-surface-100 dark:hover:bg-white/10'
                                   : 'text-surface-400 dark:text-zinc-500 cursor-not-allowed opacity-50'}
                               " ${!hasPrev ? 'disabled' : ''}>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                    </svg>
                </button>
                <span class="text-xs text-surface-500 dark:text-surface-400">Стр. ${currentPage} / ${totalPages}</span>
                <button data-action="admin-next-page"
                        class="px-3 py-1.5 rounded-xl text-sm font-semibold flex items-center gap-1 transition-all
                               ${hasNext
                                   ? 'glass text-surface-900 dark:text-zinc-100 hover:bg-surface-100 dark:hover:bg-white/10'
                                   : 'text-surface-400 dark:text-zinc-500 cursor-not-allowed opacity-50'}
                               " ${!hasNext ? 'disabled' : ''}>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                    </svg>
                </button>
            </div>
        `;
    },

    renderFeedbackPagination() {
        const el = this.container.querySelector('#admin-feedback-pagination');
        if (!el) return;

        const total = this.state.feedback_total;
        const pageSize = this.state.page_size;
        const currentPage = this.state.feedback_page;
        const totalPages = Math.ceil(total / pageSize) || 1;
        const hasPrev = currentPage > 1;
        const hasNext = currentPage < totalPages;

        el.innerHTML = `
            <div class="flex items-center gap-2">
                <button data-action="admin-feedback-prev-page"
                        class="px-3 py-1.5 rounded-xl text-sm font-semibold flex items-center gap-1 transition-all
                               ${hasPrev
                                   ? 'glass text-surface-900 dark:text-zinc-100 hover:bg-surface-100 dark:hover:bg-white/10'
                                   : 'text-surface-400 dark:text-zinc-500 cursor-not-allowed opacity-50'}
                               " ${!hasPrev ? 'disabled' : ''}>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                    </svg>
                </button>
                <span class="text-xs text-surface-500 dark:text-surface-400">Стр. ${currentPage} / ${totalPages}</span>
                <button data-action="admin-feedback-next-page"
                        class="px-3 py-1.5 rounded-xl text-sm font-semibold flex items-center gap-1 transition-all
                               ${hasNext
                                   ? 'glass text-surface-900 dark:text-zinc-100 hover:bg-surface-100 dark:hover:bg-white/10'
                                   : 'text-surface-400 dark:text-zinc-500 cursor-not-allowed opacity-50'}
                               " ${!hasNext ? 'disabled' : ''}>
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                    </svg>
                </button>
            </div>
        `;
    },

    prevFeedbackPage() {
        if (this.state.feedback_page > 1) {
            this.state.feedback_page -= 1;
            this.loadFeedback();
        }
    },

    nextFeedbackPage() {
        if (this.state.feedback_page < this.state.feedback_total_pages) {
            this.state.feedback_page += 1;
            this.loadFeedback();
        }
    },

    async loadFeedback() {
        const listEl = this.container.querySelector('#admin-feedback-list');
        if (!listEl) return;
        listEl.innerHTML = Components.loadingSpinner();

        try {
            const query = this.buildFeedbackQuery();
            const data = await API.get(`/admin/feedback${query ? `?${query}` : ''}`, this.app.state.tokens.access);

            this.syncFilterUI();

            this.state.feedback_total = data.total;
            this.state.feedback_total_pages = Math.ceil(data.total / data.page_size) || 1;

            if (!data.items || data.items.length === 0) {
                listEl.innerHTML = `<p class="text-sm text-surface-500 dark:text-surface-400 text-center py-8">Обращений не найдено</p>`;
                this.renderFeedbackPagination();
                return;
            }

            const categoryLabels = {
                pro_request: 'PRO запрос',
                bug: 'Баг',
                question: 'Вопрос',
            };
            const statusLabels = {
                new: 'Новый',
                resolved: 'Решён',
            };
            const statusColors = {
                new: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400',
                resolved: 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400',
            };

            listEl.innerHTML = `
                <div class="glass rounded-2xl overflow-hidden">
                    <div class="w-full overflow-x-auto scrollbar-thin hidden md:block">
                        <table class="w-full text-sm">
                            <thead>
                                <tr class="border-b border-surface-200 dark:border-white/10">
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">ID</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Email</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Категория</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Статус</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Пользователь</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Скриншоты</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Создано</th>
                                    <th class="text-left px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${data.items.map(f => {
                                    const images = f.images || [];
                                    return `
                                    <tr class="border-b border-surface-100 dark:border-white/5 hover:bg-surface-50 dark:hover:bg-white/5">
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${f.id}</td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300 font-medium">${escapeHtml(f.email)}</td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${categoryLabels[f.category] || f.category}</td>
                                        <td class="px-4 py-3">
                                            <span class="px-2 py-1 rounded-lg text-xs font-semibold ${statusColors[f.status] || 'bg-surface-100 text-surface-600'}">
                                                ${statusLabels[f.status] || f.status}
                                            </span>
                                        </td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">
                                            ${f.user_email ? `${escapeHtml(f.user_email)} (ID: ${f.user_id})` : 'Гость'}
                                        </td>
                                        <td class="px-4 py-3">
                                            ${images.length > 0 ? `
                                                <button data-action="view-feedback-images" data-images='${escapeHtml(JSON.stringify(images))}'
                                                        class="text-xs font-medium text-lime-600 dark:text-lime-400 hover:text-lime-700 dark:hover:text-lime-300 transition-colors">
                                                    Просмотр (${images.length})
                                                </button>
                                            ` : '<span class="text-surface-400 dark:text-zinc-500">—</span>'}
                                        </td>
                                        <td class="px-4 py-3 text-surface-700 dark:text-zinc-300">${new Date(f.created_at).toLocaleString('ru-RU')}</td>
<td class="px-4 py-3">
                                            <div class="flex items-center gap-1">
                                                <button data-action="view-feedback" data-feedback-id="${f.id}"
                                                        class="p-1 rounded-lg text-surface-600 dark:text-zinc-300 hover:text-primary-600 dark:hover:text-zinc-100 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors"
                                                        title="查看详情" aria-label="查看详情">
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.25 11.25l.04.04M21 12c0 9-9 21-9 21S3 21 3 12a9 9 0 1118 0z"></path>
                                                    </svg>
                                                </button>
                                                ${f.status === 'new' ? `
                                                    <button data-action="update-feedback-status" data-feedback-id="${f.id}" data-status="resolved"
                                                            class="p-1 rounded-lg text-surface-600 dark:text-zinc-300 hover:text-lime-600 dark:hover:text-lime-400 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors"
                                                            title="Отметить решённым" aria-label="Отметить решённым">
                                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                                                    </button>
                                                ` : `
                                                    <button data-action="update-feedback-status" data-feedback-id="${f.id}" data-status="new"
                                                            class="p-1 rounded-lg text-surface-600 dark:text-zinc-300 hover:text-lime-600 dark:hover:text-lime-400 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors"
                                                            title="Вернуть в новые" aria-label="Вернуть в новые">
                                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                                    </button>
                                                `}
                                                ${f.user_id && f.category === 'pro_request' && f.status !== 'resolved' ? `
                                                    <button data-action="grant-pro-from-feedback" data-feedback-id="${f.id}" data-user-id="${f.user_id}"
                                                            class="p-1 rounded-lg text-surface-600 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors"
                                                            title="Выдать PRO" aria-label="Выдать PRO">
                                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z"/></svg>
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </td>
                                    </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>

                    <div class="block md:hidden space-y-2 p-4">
                        ${data.items.map(f => {
                            const images = f.images || [];
                            const categoryLabels = {
                                pro_request: 'PRO запрос',
                                bug: 'Баг',
                                question: 'Вопрос',
                            };
                            const statusLabels = {
                                new: 'Новый',
                                resolved: 'Решён',
                            };
                            const statusColors = {
                                new: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400',
                                resolved: 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400',
                            };
                            return `
                            <div class="glass rounded-xl p-3 space-y-2">
                                <button data-action="view-feedback" data-feedback-id="${f.id}"
                                        class="w-full text-left p-3 rounded-xl hover:bg-surface-100 dark:hover:bg-white/5 transition-colors group"
                                        aria-label="Подробнее об обращении #${f.id}">
                                    <div class="flex items-start gap-3">
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center gap-2">
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColors[f.status] || 'bg-surface-100 text-surface-600'}">
                                                    ${statusLabels[f.status] || f.status}
                                                </span>
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400">
                                                    ${categoryLabels[f.category] || f.category}
                                                </span>
                                            </div>
                                            <p class="text-sm font-semibold truncate text-surface-900 dark:text-zinc-100 mt-1">${escapeHtml(f.email)}</p>
                                            <p class="text-xs text-surface-500 dark:text-surface-400 truncate mt-0.5">${escapeHtml(f.message).slice(0, 80)}${f.message.length > 80 ? '...' : ''}</p>
                                            <p class="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
                                                ${f.user_email ? `${escapeHtml(f.user_email)} (ID: ${f.user_id})` : 'Гость'} · ${new Date(f.created_at).toLocaleString('ru-RU')}
                                            </p>
                                            ${images.length > 0 ? `
                                            <p class="text-xs text-lime-600 dark:text-lime-400 mt-1">📎 ${images.length} фото</p>
                                            ` : ''}
                                        </div>
                                        <svg class="w-4 h-4 text-surface-400 dark:text-surface-500 group-hover:text-primary-600 dark:group-hover:text-zinc-200 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                                        </svg>
                                    </div>
                                </button>
                                <div class="flex items-center gap-1.5 pt-1 border-t border-surface-100 dark:border-white/5">
                                    ${f.status === 'new' ? `
                                        <button data-action="update-feedback-status" data-feedback-id="${f.id}" data-status="resolved"
                                                class="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400 hover:bg-lime-200 dark:hover:bg-lime-900/50 transition-colors">
                                            Решено
                                        </button>
                                    ` : `
                                        <button data-action="update-feedback-status" data-feedback-id="${f.id}" data-status="new"
                                                class="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-surface-100 text-surface-700 dark:bg-white/5 dark:text-zinc-300 hover:bg-surface-200 transition-colors">
                                            В новые
                                        </button>
                                    `}
                                    ${f.user_id && f.category === 'pro_request' && f.status !== 'resolved' ? `
                                        <button data-action="grant-pro-from-feedback" data-feedback-id="${f.id}" data-user-id="${f.user_id}"
                                                class="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">
                                            PRO
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                            `;
                        }).join('')}
                    </div>

                    <div class="px-4 py-3 border-t border-surface-200 dark:border-white/10 flex items-center justify-between">
                        <span class="text-xs text-surface-500 dark:text-surface-400">Всего: ${data.total}</span>
                        <span class="text-xs text-surface-500 dark:text-surface-400">Страница ${data.page} из ${this.state.feedback_total_pages}</span>
                    </div>
                </div>
            `;

            this.renderFeedbackPagination();
        } catch (error) {
            console.error('[Admin] Feedback load error:', error);
            listEl.innerHTML = Components.errorState('Ошибка загрузки обращений');
            this.renderFeedbackPagination();
        }
    },

    async viewUser(userId) {
        try {
            const user = await API.get(`/admin/users/${userId}`, this.app.state.tokens.access);
            this.showUserModal(user);
        } catch (error) {
            console.error('[Admin] User load error:', error);
            this.app.showToast(error?.data?.detail || error?.message || 'Ошибка загрузки пользователя', 'error');
        }
    },

    showUserModal(user) {
        if (this.userModal) {
            this.userModal.remove();
        }

        const isCurrentUser = this.app.state.user && user.id === this.app.state.user.id;
        const host = document.getElementById('modals') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm opacity-0 transition-opacity duration-200 pointer-events-auto';

        const panel = document.createElement('div');
        panel.className = 'fixed inset-x-0 bottom-0 z-[60] glass-strong rounded-t-2xl max-h-[85vh] overflow-y-auto transform transition-transform duration-200 translate-y-full pointer-events-auto';

        const avatarColor = user.is_admin
            ? 'bg-lime-500/10 text-lime-400'
            : 'bg-primary-600/10 text-primary-600 dark:text-zinc-200';

        const fmtDate = (v) => v ? new Date(v).toLocaleDateString('ru-RU') : null;
        const defaultStart = new Date().toISOString().split('T')[0];
        const defaultEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        panel.innerHTML = `
            <div class="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto my-3"></div>

            <div class="flex items-center justify-between mb-4 px-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center ${avatarColor}">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-surface-900 dark:text-zinc-100">${escapeHtml(user.full_name || user.email)}</h3>
                        <p class="text-sm text-surface-500 dark:text-surface-400">${escapeHtml(user.email)}</p>
                    </div>
                </div>
                <button data-action="close-user-modal" class="min-w-[44px] min-h-[44px] p-2.5 rounded-lg flex items-center justify-center text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <div class="space-y-3 text-sm px-4">
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">ID</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.id}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Роль</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${escapeHtml(user.role)}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Статус</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.is_active ? 'Активен' : 'Заблокирован'}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Премиум</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.is_premium
                        ? (user.premium_expires_at
                            ? `Активен (до ${fmtDate(user.premium_expires_at)})`
                            : 'Бессрочно')
                        : 'Нет'}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Квота ИИ (сегодня)</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.meal_ai_daily_count}</span>
                </div>
                ${user.last_meal_ai_date ? `
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Последний AI приём</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${fmtDate(user.last_meal_ai_date)}</span>
                </div>` : ''}
                ${user.last_workout_ai_analysis_at ? `
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Последний AI тренировка</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${fmtDate(user.last_workout_ai_analysis_at)}</span>
                </div>` : ''}
                ${user.last_nutrition_ai_analysis_at ? `
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Последний AI питание</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${fmtDate(user.last_nutrition_ai_analysis_at)}</span>
                </div>` : ''}
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Создано тренировок</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.created_workouts_count}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Последняя активность</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.last_seen_at ? new Date(user.last_seen_at).toLocaleString('ru-RU') : '—'}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Приёмов пищи всего</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.total_meals_count || 0}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Завершено тренировок</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.completed_workouts_count || 0}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">AI запросов всего</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${user.total_ai_requests || 0}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Создан</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${new Date(user.created_at).toLocaleString('ru-RU')}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-surface-500 dark:text-surface-400">Обновлён</span>
                    <span class="text-surface-900 dark:text-zinc-100 font-medium">${new Date(user.updated_at).toLocaleString('ru-RU')}</span>
                </div>
            </div>

            ${!isCurrentUser ? `
            <div class="flex flex-col gap-2 mt-6 pt-4 border-t border-surface-200 dark:border-white/10 px-4 pb-16">
                <button data-action="modal-toggle-active" data-user-id="${user.id}" data-active="${user.is_active}"
                        class="w-full px-3 py-2 rounded-xl text-sm font-semibold transition-all
                               ${user.is_active
                                   ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100'
                                   : 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400 hover:bg-lime-200'}">
                    ${user.is_active ? 'Деактивировать' : 'Активировать'}
                </button>
                <button data-action="modal-toggle-admin" data-user-id="${user.id}" data-admin="${user.is_admin}"
                        class="w-full px-3 py-2 rounded-xl text-sm font-semibold transition-all
                               ${user.is_admin
                                   ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100'
                                   : 'bg-primary-600 text-white hover:bg-primary-700'}">
                    ${user.is_admin ? 'Убрать админа' : 'Назначить админом'}
                </button>
                <button data-action="modal-reset-quota" data-user-id="${user.id}"
                        class="w-full px-3 py-2 rounded-xl text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors">
                    Сбросить квоту
                </button>
                <div class="pt-2">
                    <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">Подписка PRO</p>
                    <div class="grid grid-cols-3 gap-2">
                        <button data-action="modal-premium-grant" data-user-id="${user.id}" data-days="7"
                                class="px-2 py-2 rounded-xl text-xs font-semibold bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400 hover:bg-lime-200 dark:hover:bg-lime-900/50 transition-colors">
                            Выдать на 7 дней
                        </button>
                        <button data-action="modal-premium-grant" data-user-id="${user.id}" data-days="30"
                                class="px-2 py-2 rounded-xl text-xs font-semibold bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400 hover:bg-lime-200 dark:hover:bg-lime-900/50 transition-colors">
                            Выдать на 30 дней
                        </button>
                        <button data-action="modal-premium-revoke" data-user-id="${user.id}"
                                class="px-2 py-2 rounded-xl text-xs font-semibold bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors">
                            Отозвать премиум
                        </button>
                    </div>
                    <div class="mt-4 pt-3 border-t border-surface-200/20 dark:border-white/10 space-y-2.5">
                        <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">Кастомный период PRO</p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-end">
                            <div class="md:col-span-2">
                                <label class="block text-xs text-surface-400 dark:text-surface-500 mb-1">Дата начала</label>
                                <input type="date" id="custom-premium-start" value="${defaultStart}"
                                       class="bg-surface-800 text-surface-100 border border-surface-700/80 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500/80 [color-scheme:dark]">
                            </div>
                            <div class="md:col-span-2">
                                <label class="block text-xs text-surface-400 dark:text-surface-500 mb-1">Дата окончания</label>
                                <input type="date" id="custom-premium-end" value="${defaultEnd}"
                                       class="bg-surface-800 text-surface-100 border border-surface-700/80 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500/80 [color-scheme:dark]">
                            </div>
                            <div class="sm:col-span-2 md:col-span-1">
                                <button data-action="modal-premium-grant-custom" data-user-id="${user.id}"
                                        class="w-full h-[34px] px-3 py-2 rounded-xl text-xs font-semibold bg-amber-600/90 hover:bg-amber-600 text-white transition-colors">
                                    Применить
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>` : ''}
        `;

        backdrop.appendChild(panel);
        host.appendChild(backdrop);
        this.userModal = backdrop;

        // Lock background scroll
        document.body.classList.add('overflow-hidden');

        // Backdrop click to close (click outside panel)
        this._userModalBackdropClick = (e) => {
            if (e.target === backdrop) {
                Admin.closeUserModal();
            }
        };
        backdrop.addEventListener('click', this._userModalBackdropClick);

        this._userModalKeydown = (e) => {
            if (e.key === 'Escape') Admin.closeUserModal();
        };
        document.addEventListener('keydown', this._userModalKeydown);

        setTimeout(() => {
            backdrop.classList.remove('opacity-0');
            panel.classList.remove('translate-y-full');
        }, 10);
    },

    closeUserModal() {
        const backdrop = this.userModal;
        if (!backdrop) return;
        const panel = backdrop.firstElementChild;
        backdrop.classList.add('opacity-0');
        if (panel) panel.classList.add('translate-y-full');
        setTimeout(() => {
            if (this.userModal === backdrop) {
                backdrop.remove();
                this.userModal = null;
            }
            // Restore background scroll
            document.body.classList.remove('overflow-hidden');
            if (this._userModalKeydown) {
                document.removeEventListener('keydown', this._userModalKeydown);
                this._userModalKeydown = null;
            }
            if (this._userModalBackdropClick) {
                backdrop.removeEventListener('click', this._userModalBackdropClick);
                this._userModalBackdropClick = null;
            }
        }, 200);
    },

    async toggleActive(userId, isActive) {
        try {
            await API.patch(`/admin/users/${userId}/status`, { is_active: !isActive }, this.app.state.tokens.access);
            this.app.showToast('Статус пользователя обновлён', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('[Admin] Toggle active error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка обновления статуса', 'error');
            }
        }
    },

    async toggleAdmin(userId, isAdmin) {
        try {
            await API.patch(`/admin/users/${userId}/status`, { is_admin: !isAdmin }, this.app.state.tokens.access);
            this.app.showToast('Статус администратора обновлён', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('[Admin] Toggle admin error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка обновления роли', 'error');
            }
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
            await this.loadUsers();
        } catch (error) {
            console.error('[Admin] Reset quota error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка сброса квоты', 'error');
            }
        }
    },

    async updatePremium(userId, action, days) {
        const labels = { grant_7: 'Премиум выдан на 7 дней', grant_30: 'Премиум выдан на 30 дней', revoke: 'Премиум отозван' };
        try {
            await API.patch(`/admin/users/${userId}/premium`, { action, days: days ?? null }, this.app.state.tokens.access);
            this.app.showToast(labels[action] || 'Подписка обновлена', 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('[Admin] Premium update error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка обновления подписки', 'error');
            }
        }
    },

    async updatePremiumCustom(userId, startDate, endDate) {
        try {
            await API.patch(`/admin/users/${userId}/premium`, { action: 'grant_custom', start_date: startDate, end_date: endDate }, this.app.state.tokens.access);
            this.app.showToast(`Премиум выдан до ${endDate}`, 'success');
            await this.loadUsers();
        } catch (error) {
            console.error('[Admin] Premium custom update error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка обновления подписки', 'error');
            }
        }
    },

    openFeedbackDetailModal(feedback) {
        if (this.feedbackModal) {
            this.feedbackModal.remove();
        }

        const host = document.getElementById('modals') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 z-50 bg-black/40 backdrop-blur-sm opacity-0 transition-opacity duration-200 pointer-events-auto';

        const panel = document.createElement('div');
        panel.className = 'fixed inset-x-0 bottom-0 z-[60] glass-strong rounded-t-2xl max-h-[85vh] overflow-y-auto transform transition-transform duration-200 translate-y-full pointer-events-auto';

        const categoryLabels = {
            pro_request: 'PRO запрос',
            bug: 'Баг',
            question: 'Вопрос',
        };
        const statusLabels = {
            new: 'Новый',
            resolved: 'Решён',
        };
        const statusColors = {
            new: 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400',
            resolved: 'bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400',
        };

        const images = feedback.images || [];

        panel.innerHTML = `
            <div class="w-12 h-1.5 bg-zinc-700 rounded-full mx-auto my-3"></div>

            <div class="flex items-center justify-between mb-4 px-4">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl flex items-center justify-center bg-lime-500/10 text-lime-600 dark:text-lime-400">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
                        </svg>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-surface-900 dark:text-zinc-100">Обращение #${feedback.id}</h3>
                        <p class="text-sm text-surface-500 dark:text-surface-400">${escapeHtml(feedback.email)}</p>
                    </div>
                </div>
                <button data-action="close-feedback-modal" class="min-w-[44px] min-h-[44px] p-2.5 rounded-lg flex items-center justify-center text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-white/5 transition-colors">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>

            <div class="space-y-4 px-4">
                <div class="flex items-center gap-2 flex-wrap">
                    <span data-status-badge class="px-2 py-1 rounded-lg text-xs font-semibold ${statusColors[feedback.status] || 'bg-surface-100 text-surface-600'}">
                        ${statusLabels[feedback.status] || feedback.status}
                    </span>
                    <span class="px-2 py-1 rounded-lg text-xs font-semibold bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400">
                        ${categoryLabels[feedback.category] || feedback.category}
                    </span>
                </div>

                <div class="space-y-2 text-sm">
                    <div class="flex justify-between">
                        <span class="text-surface-500 dark:text-surface-400">Пользователь</span>
                        <span class="text-surface-900 dark:text-zinc-100 font-medium">${feedback.user_email ? `${escapeHtml(feedback.user_email)} (ID: ${feedback.user_id})` : 'Гость'}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-surface-500 dark:text-surface-400">Создано</span>
                        <span class="text-surface-900 dark:text-zinc-100 font-medium">${new Date(feedback.created_at).toLocaleString('ru-RU')}</span>
                    </div>
                </div>

                <div class="pt-2 border-t border-surface-200 dark:border-white/10">
                    <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">Сообщение</p>
                    <p class="text-sm text-surface-700 dark:text-zinc-300 whitespace-pre-wrap">${escapeHtml(feedback.message)}</p>
                </div>

                ${images.length > 0 ? `
                <div class="pt-2 border-t border-surface-200 dark:border-white/10">
                    <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">Скриншоты (${images.length})</p>
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                        ${images.map(img => `
                            <button data-action="view-full-image" data-url="${img.url}"
                                    class="aspect-square rounded-xl overflow-hidden bg-surface-100 dark:bg-white/5 hover:scale-[1.02] transition-transform cursor-zoom-in"
                                    aria-label="Открыть изображение">
                                <img src="${img.thumbnail_url || img.url}" alt="Screenshot" class="w-full h-full object-cover">
                            </button>
                        `).join('')}
                    </div>
                </div>
                ` : ''}

                <div class="pt-4 border-t border-surface-200 dark:border-white/10">
                    <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-3">Действия</p>
                    <div class="space-y-2">
                        <button data-action="update-feedback-status" data-feedback-id="${feedback.id}" data-status="resolved"
                                class="w-full px-3 py-2 rounded-xl text-sm font-semibold transition-all
                                       ${feedback.status === 'resolved' ? 'bg-surface-100 text-surface-500 dark:bg-white/5 dark:text-zinc-500 cursor-not-allowed opacity-50' : 'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400 hover:bg-lime-200 dark:hover:bg-lime-900/50'}"
                                ${feedback.status === 'resolved' ? 'disabled' : ''}>
                            Отметить как решённое
                        </button>
                        <button data-action="update-feedback-status" data-feedback-id="${feedback.id}" data-status="new"
                                class="w-full px-3 py-2 rounded-xl text-sm font-semibold transition-all
                                       ${feedback.status === 'new' ? 'bg-surface-100 text-surface-500 dark:bg-white/5 dark:text-zinc-500 cursor-not-allowed opacity-50' : 'bg-surface-100 text-surface-700 dark:bg-white/5 dark:text-zinc-300 hover:bg-surface-200'}"
                                ${feedback.status === 'new' ? 'disabled' : ''}>
                            Вернуть в новые
                        </button>
                        ${feedback.user_id && feedback.category === 'pro_request' && feedback.status !== 'resolved' ? `
                        <button data-action="grant-pro-from-feedback" data-feedback-id="${feedback.id}" data-user-id="${feedback.user_id}"
                                class="w-full px-3 py-2 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors flex items-center justify-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                            </svg>
                            Выдать PRO и отметить решённым
                        </button>
                        ` : ''}
                    </div>
                </div>

                <div class="pt-4 border-t border-surface-200 dark:border-white/10">
                    <p class="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-3">Ответ по Email</p>
                    <div class="space-y-2">
                        <textarea id="admin-feedback-reply-text" rows="4"
                                  class="w-full px-3 py-2 rounded-xl glass-input text-sm text-surface-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-lime-500/30"
                                  placeholder="Напишите ответ пользователю..."></textarea>
                        <button data-action="send-feedback-reply" data-feedback-id="${feedback.id}"
                                class="w-full px-3 py-2 rounded-xl text-sm font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors flex items-center justify-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M22 12c0 4.713-3.788 8.533-8.533 8.533S5 16.713 5 12 8.788 3.467 13.5 3.467 22 7.287 22 12zM5.51 7.51 12 14l6.49-6.49L18 12.51 12 18.51 6 12.51z"></path>
                            </svg>
                            Отправить ответ по Email
                        </button>
                    </div>
                </div>
            </div>
        `;

        backdrop.appendChild(panel);
        host.appendChild(backdrop);
        this.feedbackModal = backdrop;

        document.body.classList.add('overflow-hidden');

        this._feedbackModalBackdropClick = (e) => {
            if (e.target === backdrop) {
                Admin.closeFeedbackModal();
            }
        };
        backdrop.addEventListener('click', this._feedbackModalBackdropClick);

        this._feedbackModalKeydown = (e) => {
            if (e.key === 'Escape') Admin.closeFeedbackModal();
        };
        document.addEventListener('keydown', this._feedbackModalKeydown);

        setTimeout(() => {
            backdrop.classList.remove('opacity-0');
            panel.classList.remove('translate-y-full');
        }, 10);
    },

    closeFeedbackModal() {
        const backdrop = this.feedbackModal;
        if (!backdrop) return;
        const panel = backdrop.firstElementChild;
        backdrop.classList.add('opacity-0');
        if (panel) panel.classList.add('translate-y-full');
        setTimeout(() => {
            if (this.feedbackModal === backdrop) {
                backdrop.remove();
                this.feedbackModal = null;
            }
            document.body.classList.remove('overflow-hidden');
            if (this._feedbackModalKeydown) {
                document.removeEventListener('keydown', this._feedbackModalKeydown);
                this._feedbackModalKeydown = null;
            }
            if (this._feedbackModalBackdropClick) {
                backdrop.removeEventListener('click', this._feedbackModalBackdropClick);
                this._feedbackModalBackdropClick = null;
            }
        }, 200);
    },

    async updateFeedback(feedbackId, data) {
        try {
            await API.patch(`/admin/feedback/${feedbackId}`, data, this.app.state.tokens.access);
            this.app.showToast('Обращение обновлено', 'success');
            this.closeFeedbackModal();
            await this.loadFeedback();
        } catch (error) {
            console.error('[Admin] Feedback update error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка обновления обращения', 'error');
            }
        }
    },

    async sendFeedbackReply(feedbackId, replyText) {
        try {
            await API.post(`/admin/feedback/${feedbackId}/reply`, { reply_text: replyText }, this.app.state.tokens.access);
            this.app.showToast('Ответ отправлен по email', 'success');

            const textarea = this.feedbackModal?.querySelector('#admin-feedback-reply-text');
            if (textarea) textarea.value = '';

            const badge = this.feedbackModal?.querySelector('[data-status-badge]');
            if (badge) {
                badge.textContent = 'Решён';
                badge.className = 'px-2 py-1 rounded-lg text-xs font-semibold bg-surface-100 text-surface-600 dark:bg-white/5 dark:text-zinc-400';
            }

            await this.loadFeedback();
        } catch (error) {
            console.error('[Admin] Feedback reply error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка отправки ответа', 'error');
            }
        }
    },

    async grantProFromFeedback(feedbackId, userId) {
        if (!await Components.confirmModal({
            title: 'Выдать PRO?',
            message: 'Пользователю будет выдан PRO статус, а обращение отмечено как решённое. Продолжить?',
            confirmText: 'Выдать PRO',
            confirmClass: 'bg-primary-600 hover:bg-primary-700 text-white shadow-md',
            cancelText: 'Отмена'
        })) return;

        try {
            await API.patch(`/admin/feedback/${feedbackId}`, { status: 'resolved', grant_pro: true }, this.app.state.tokens.access);
            this.app.showToast('PRO выдан, обращение отмечено как решённое', 'success');
            this.closeFeedbackModal();
            await this.loadFeedback();
        } catch (error) {
            console.error('[Admin] Grant PRO from feedback error:', error);
            if (error?.status !== 401 && error?.status !== 403) {
                this.app.showToast(error?.data?.detail || error?.message || 'Ошибка выдачи PRO', 'error');
            }
        }
    },

    openFullScreenImage(url, images) {
        const host = document.getElementById('modals') || document.body;

        const backdrop = document.createElement('div');
        backdrop.className = 'fixed inset-0 z-50 bg-black/90 opacity-0 transition-opacity duration-200 pointer-events-auto';

        const panel = document.createElement('div');
        panel.className = 'fixed inset-0 z-[60] flex items-center justify-center pointer-events-auto';
        panel.style.maxWidth = '100%';
        panel.style.maxHeight = '100%';

        let currentIndex = images.findIndex(img => img.url === url);
        if (currentIndex === -1) currentIndex = 0;

        panel.innerHTML = `
            <button data-action="close-fullscreen-image" class="absolute top-4 right-4 z-10 min-w-[44px] min-h-[44px] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors flex items-center justify-center" aria-label="Закрыть">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
            ${images.length > 1 ? `
            <button data-action="prev-fullscreen-image" class="absolute left-4 z-10 min-w-[44px] min-h-[44px] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors flex items-center justify-center" aria-label="Предыдущее">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
            </button>
            <button data-action="next-fullscreen-image" class="absolute right-4 z-10 min-w-[44px] min-h-[44px] p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors flex items-center justify-center" aria-label="Следующее">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            </button>
            ` : ''}
            <img src="${url}" alt="Fullscreen image" class="max-w-[90vw] max-h-[90vh] object-contain">
        `;

        backdrop.appendChild(panel);
        host.appendChild(backdrop);

        document.body.classList.add('overflow-hidden');

        const closeFn = () => {
            backdrop.classList.add('opacity-0');
            setTimeout(() => backdrop.remove(), 200);
            document.body.classList.remove('overflow-hidden');
            backdrop.removeEventListener('click', backdropClickFn);
            document.removeEventListener('keydown', keydownFn);
        };

        const backdropClickFn = (e) => {
            if (e.target === backdrop) closeFn();
        };
        backdrop.addEventListener('click', backdropClickFn);

        const keydownFn = (e) => {
            if (e.key === 'Escape') closeFn();
            if (e.key === 'ArrowLeft' && images.length > 1) showImage((currentIndex - 1 + images.length) % images.length);
            if (e.key === 'ArrowRight' && images.length > 1) showImage((currentIndex + 1) % images.length);
        };
        document.addEventListener('keydown', keydownFn);

        const showImage = (index) => {
            const img = panel.querySelector('img');
            if (img) {
                img.src = images[index].url;
            }
            currentIndex = index;
        };

        // Add click handlers for nav buttons
        const prevBtn = panel.querySelector('[data-action="prev-fullscreen-image"]');
        const nextBtn = panel.querySelector('[data-action="next-fullscreen-image"]');
        if (prevBtn) prevBtn.addEventListener('click', () => showImage((currentIndex - 1 + images.length) % images.length));
        if (nextBtn) nextBtn.addEventListener('click', () => showImage((currentIndex + 1) % images.length));

        setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
    },
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'admin-tab') {
        const btn = e.target.closest('[data-action="admin-tab"]');
        const tab = btn.dataset.tab;
        if (tab && tab !== Admin.state.activeTab) {
            Admin.switchTab(tab);
        }
        return;
    }
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
    if (action === 'view-user') {
        e.preventDefault();
        const btn = e.target.closest('[data-action="view-user"]');
        Admin.viewUser(parseInt(btn.dataset.userId));
    }
    if (action === 'close-user-modal') {
        Admin.closeUserModal();
    }
    if (action === 'modal-toggle-active') {
        const btn = e.target.closest('[data-action="modal-toggle-active"]');
        Admin.closeUserModal();
        Admin.toggleActive(parseInt(btn.dataset.userId), btn.dataset.active === 'true');
    }
    if (action === 'modal-toggle-admin') {
        const btn = e.target.closest('[data-action="modal-toggle-admin"]');
        Admin.closeUserModal();
        Admin.toggleAdmin(parseInt(btn.dataset.userId), btn.dataset.admin === 'true');
    }
    if (action === 'modal-reset-quota') {
        const btn = e.target.closest('[data-action="modal-reset-quota"]');
        Admin.closeUserModal();
        Admin.resetQuota(parseInt(btn.dataset.userId));
    }
    if (action === 'modal-premium-grant') {
        const btn = e.target.closest('[data-action="modal-premium-grant"]');
        const days = parseInt(btn.dataset.days);
        Admin.closeUserModal();
        Admin.updatePremium(parseInt(btn.dataset.userId), `grant_${days}`, days);
    }
    if (action === 'modal-premium-grant-custom') {
        const btn = e.target.closest('[data-action="modal-premium-grant-custom"]');
        const userId = parseInt(btn.dataset.userId);
        const startInput = document.getElementById('custom-premium-start');
        const endInput = document.getElementById('custom-premium-end');
        const startDate = startInput ? startInput.value : '';
        const endDate = endInput ? endInput.value : '';
        if (!startDate || !endDate) {
            Admin.app.showToast('Укажите начальную и конечную даты', 'error');
            return;
        }
        if (startDate > endDate) {
            Admin.app.showToast('Начальная дата не может быть позже конечной', 'error');
            return;
        }
        Admin.closeUserModal();
        Admin.updatePremiumCustom(userId, startDate, endDate);
    }
    if (action === 'modal-premium-revoke') {
        const btn = e.target.closest('[data-action="modal-premium-revoke"]');
        Admin.closeUserModal();
        Admin.updatePremium(parseInt(btn.dataset.userId), 'revoke');
    }
    if (action === 'admin-reset-filters') {
        Admin.resetFilters();
    }
    if (action === 'admin-prev-page') {
        const el = e.target.closest('[data-action="admin-prev-page"]');
        if (!el.disabled) Admin.prevPage();
    }
    if (action === 'admin-next-page') {
        const el = e.target.closest('[data-action="admin-next-page"]');
        if (!el.disabled) Admin.nextPage();
    }
    if (action === 'admin-feedback-prev-page') {
        const el = e.target.closest('[data-action="admin-feedback-prev-page"]');
        if (!el.disabled) Admin.prevFeedbackPage();
    }
    if (action === 'admin-feedback-next-page') {
        const el = e.target.closest('[data-action="admin-feedback-next-page"]');
        if (!el.disabled) Admin.nextFeedbackPage();
    }
    if (action === 'view-feedback') {
        e.preventDefault();
        const btn = e.target.closest('[data-action="view-feedback"]');
        const feedbackId = parseInt(btn.dataset.feedbackId);
        try {
            const feedback = await API.get(`/admin/feedback/${feedbackId}`, Admin.app.state.tokens.access);
            Admin.openFeedbackDetailModal(feedback);
        } catch (error) {
            console.error('[Admin] Feedback load error:', error);
            Admin.app.showToast(error?.data?.detail || error?.message || 'Ошибка загрузки обращения', 'error');
        }
    }
    if (action === 'view-feedback-images') {
        const btn = e.target.closest('[data-action="view-feedback-images"]');
        const images = JSON.parse(btn.dataset.images);
        // Open first image in full view
        if (images.length > 0) {
            Admin.openFullScreenImage(images[0].url, images);
        }
    }
    if (action === 'view-full-image') {
        const btn = e.target.closest('[data-action="view-full-image"]');
        const url = btn.dataset.url;
        const imagesAttr = btn.closest('[data-images]')?.dataset.images;
        const images = imagesAttr ? JSON.parse(imagesAttr) : [{url}];
        Admin.openFullScreenImage(url, images);
    }
    if (action === 'close-feedback-modal') {
        Admin.closeFeedbackModal();
    }
    if (action === 'update-feedback-status') {
        const btn = e.target.closest('[data-action="update-feedback-status"]');
        const feedbackId = parseInt(btn.dataset.feedbackId);
        const status = btn.dataset.status;
        Admin.updateFeedback(feedbackId, { status });
    }
    if (action === 'grant-pro-from-feedback') {
        const btn = e.target.closest('[data-action="grant-pro-from-feedback"]');
        const feedbackId = parseInt(btn.dataset.feedbackId);
        const userId = parseInt(btn.dataset.userId);
        Admin.grantProFromFeedback(feedbackId, userId);
    }
    if (action === 'send-feedback-reply') {
        const btn = e.target.closest('[data-action="send-feedback-reply"]');
        const feedbackId = parseInt(btn.dataset.feedbackId);
        const textarea = Admin.feedbackModal?.querySelector('#admin-feedback-reply-text');
        const replyText = textarea ? textarea.value.trim() : '';
        if (!replyText) {
            textarea?.focus();
            return;
        }
        Admin.sendFeedbackReply(feedbackId, replyText);
    }
    if (action === 'admin-feedback-reset-filters') {
        Admin.resetFeedbackFilters();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest('#admin-search')) {
        e.preventDefault();
        Admin.applySearch();
    }
    if (e.key === 'Enter' && e.target.closest('#admin-feedback-search')) {
        e.preventDefault();
        Admin.applyFeedbackSearch();
    }
});

document.addEventListener('change', (e) => {
    const select = e.target.closest('[data-action="admin-filter"]');
    if (select) {
        Admin.applyFilter(select.dataset.filter, select.value);
    }
    const feedbackSelect = e.target.closest('[data-action="admin-feedback-filter"]');
    if (feedbackSelect) {
        Admin.applyFeedbackFilter(feedbackSelect.dataset.filter, feedbackSelect.value);
    }
});

export { Admin };
