console.log("[DEBUG] Loaded workouts.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

const GOAL_LABELS = {
    strength: 'Силовая (3-5×5)',
    hypertrophy: 'Гипертрофия (3-4×10)',
    endurance: 'Выносливость (2-3×15)',
};

export const Workouts = {
    app: null,

    async render(container, app) {
        this.app = app;
        let activeSession;
        let stats = null;
        try {
            [activeSession, stats] = await Promise.all([
                API.get('/workouts/sessions/active', app.state.tokens.access).catch(() => null),
                API.get('/workouts/statistics', app.state.tokens.access).catch(() => null),
            ]);
        } catch (error) {
            console.error('[Workouts] Load error:', error);
        }

        let statsWidget = '';
        if (stats && stats.total_workouts > 0) {
            statsWidget = `
                <div class="bg-surface-100 dark:bg-surface-800 rounded-2xl p-4 mb-6 shadow-sm">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="font-semibold text-sm text-surface-500 uppercase tracking-wider">Прогресс и объём</h3>
                        <span class="text-xs text-primary-600 dark:text-primary-400 font-medium">Серия: ${stats.current_streak_weeks} нед.</span>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-center">
                        <div class="bg-surface-50 dark:bg-surface-700/50 p-2.5 rounded-xl">
                            <div class="text-xs text-surface-400">Тренировок</div>
                            <div class="text-lg font-bold">${stats.total_workouts}</div>
                        </div>
                        <div class="bg-surface-50 dark:bg-surface-700/50 p-2.5 rounded-xl">
                            <div class="text-xs text-surface-400">Тоннаж</div>
                            <div class="text-lg font-bold">${(stats.total_volume_kg / 1000).toFixed(1)} т</div>
                        </div>
                        <div class="bg-surface-50 dark:bg-surface-700/50 p-2.5 rounded-xl">
                            <div class="text-xs text-surface-400">Подходов</div>
                            <div class="text-lg font-bold">${stats.total_sets}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        let html = `
            <div class="p-4">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-bold">Мои тренировки</h2>
                </div>

                ${statsWidget}

                ${activeSession
                    ? `<div class="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl p-4 mb-6 shadow-sm">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="font-semibold text-primary-700 dark:text-primary-300">Активная тренировка</h3>
                            <span class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></span>
                        </div>
                        <p class="text-sm text-surface-600 dark:text-surface-300 mb-3">${activeSession.name || 'Без названия'}</p>
                        <button data-action="resume-workout" data-session-id="${activeSession.id}"
                                class="w-full py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium shadow-md">
                            Продолжить тренировку →
                        </button>
                    </div>`
                    : ''}

                <div class="mb-4">
                    <h3 class="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">Режимы и действия</h3>
                    <div class="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-3 scrollbar-none -mx-4 px-4">
                        <!-- Card 1: Quick Start -->
                        <div class="min-w-[240px] max-w-[260px] snap-center bg-gradient-to-br from-primary-600 to-primary-800 text-white rounded-2xl p-4 flex flex-col justify-between shadow-md cursor-pointer btn-press" data-action="start-workout">
                            <div>
                                <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center mb-3">
                                    <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                                </div>
                                <h4 class="font-bold text-lg mb-1">Быстрый старт</h4>
                                <p class="text-xs text-primary-100">Начать тренировку по цели (сила, гипертрофия, выносливость)</p>
                            </div>
                            <span class="mt-4 text-xs font-semibold bg-white/20 px-3 py-2 rounded-xl text-center">Начать →</span>
                        </div>

                        <!-- Card 2: Build Custom -->
                        <div class="min-w-[240px] max-w-[260px] snap-center bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="show-build-workout">
                            <div>
                                <div class="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-3">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                                </div>
                                <h4 class="font-bold text-lg mb-1">Своя тренировка</h4>
                                <p class="text-xs text-surface-500 dark:text-surface-400">Собрать тренировку из каталога упражнений (220+)</p>
                            </div>
                            <span class="mt-4 text-xs font-semibold bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-3 py-2 rounded-xl text-center">Создать →</span>
                        </div>

                        <!-- Card 3: Templates -->
                        <div class="min-w-[240px] max-w-[260px] snap-center bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="view-templates">
                            <div>
                                <div class="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-3">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                                </div>
                                <h4 class="font-bold text-lg mb-1">Шаблоны</h4>
                                <p class="text-xs text-surface-500 dark:text-surface-400">Готовые программы и шаблоны</p>
                            </div>
                            <span class="mt-4 text-xs font-semibold bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-3 py-2 rounded-xl text-center">Открыть →</span>
                        </div>

                        <!-- Card 4: History -->
                        <div class="min-w-[240px] max-w-[260px] snap-center bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="view-history">
                            <div>
                                <div class="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                </div>
                                <h4 class="font-bold text-lg mb-1">История</h4>
                                <p class="text-xs text-surface-500 dark:text-surface-400">Журнал прошлых тренировок</p>
                            </div>
                            <span class="mt-4 text-xs font-semibold bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-3 py-2 rounded-xl text-center">Смотреть →</span>
                        </div>

                        <!-- Card 5: Statistics -->
                        <div class="min-w-[240px] max-w-[260px] snap-center bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="view-statistics">
                            <div>
                                <div class="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 flex items-center justify-center flex-shrink-0 mb-3">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                                </div>
                                <h4 class="font-bold text-lg mb-1">Статистика</h4>
                                <p class="text-xs text-surface-500 dark:text-surface-400">Объемы, тоннаж и аналитика</p>
                            </div>
                            <span class="mt-4 text-xs font-semibold bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-3 py-2 rounded-xl text-center">Анализ →</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        container.querySelectorAll('[data-action="start-workout"]').forEach(el => {
            el.addEventListener('click', () => this.showQuickStart(app));
        });
        container.querySelectorAll('[data-action="show-build-workout"]').forEach(el => {
            el.addEventListener('click', () => this.showBuildWorkout(app));
        });
        container.querySelectorAll('[data-action="view-history"]').forEach(el => {
            el.addEventListener('click', () => app.router.navigate('/workouts/history'));
        });
        container.querySelectorAll('[data-action="view-templates"]').forEach(el => {
            el.addEventListener('click', () => app.router.navigate('/workouts/templates'));
        });
        container.querySelectorAll('[data-action="view-statistics"]').forEach(el => {
            el.addEventListener('click', () => app.router.navigate('/workouts/statistics'));
        });
        container.querySelector('[data-action="resume-workout"]')?.addEventListener('click', (e) => {
            const sessionId = e.currentTarget.dataset.sessionId;
            app.router.navigate(`/workouts/session/${sessionId}`);
        });
    },

    showQuickStart(app) {
        this.app = app;
        const html = `
            <div id="qs-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto">
                <div class="bg-surface-50 dark:bg-surface-900 rounded-2xl p-6 mx-4 max-w-sm w-full">
                    <h3 class="text-lg font-bold mb-4 text-center">Создать тренировку</h3>
                    <p class="text-sm text-surface-500 dark:text-surface-400 mb-4 text-center">Выберите цель:</p>
                    <div class="grid gap-2 mb-4">
                        <button data-goal="strength" class="goal-btn w-full py-3 border border-surface-300 dark:border-surface-700 rounded-xl text-center hover:bg-surface-200 dark:hover:bg-surface-700">
                            ${GOAL_LABELS.strength}
                        </button>
                        <button data-goal="hypertrophy" class="goal-btn w-full py-3 border border-surface-300 dark:border-surface-700 rounded-xl text-center hover:bg-surface-200 dark:hover:bg-surface-700">
                            ${GOAL_LABELS.hypertrophy}
                        </button>
                        <button data-goal="endurance" class="goal-btn w-full py-3 border border-surface-300 dark:border-surface-700 rounded-xl text-center hover:bg-surface-200 dark:hover:bg-surface-700">
                            ${GOAL_LABELS.endurance}
                        </button>
                    </div>
                    <button data-action="close-quick-start" class="w-full py-2 text-surface-500">Отмена</button>
                </div>
            </div>
        `;
        app.elements.modals.innerHTML = html;

        const modal = document.getElementById('qs-modal');
        const onGoal = async (e) => {
            const goal = e.currentTarget.dataset.goal;
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Создаём...';
            try {
                await API.post('/workouts/sessions/quick-start', { goal }, app.state.tokens.access);
                modal.remove();
                await this.render(app.elements.pageContent, app);
                app.showToast('Тренировка создана! Можете начинать.', 'success');
            } catch (err) {
                app.showToast(err.message || 'Ошибка создания тренировки', 'error');
                e.currentTarget.disabled = false;
                e.currentTarget.textContent = GOAL_LABELS[goal] || goal;
            }
        };
        const onClose = () => modal.remove();
        modal.querySelectorAll('[data-goal]').forEach(b => b.addEventListener('click', onGoal));
        modal.querySelector('[data-action="close-quick-start"]').addEventListener('click', onClose);
        modal.addEventListener('click', (e) => { if (e.target === modal) onClose(); });
    },

    async renderWorkoutScreen(container, app, sessionId) {
        this.app = app;
        let session;
        try {
            const url = sessionId ? `/workouts/sessions/${sessionId}` : '/workouts/sessions/active';
            session = await API.get(url, app.state.tokens.access);
        } catch (error) {
            console.error('[Workouts] Session load error:', error);
            app.showToast('Ошибка загрузки тренировки', 'error');
            return;
        }
        if (!session) {
            app.showToast('Нет активной тренировки', 'info');
            return;
        }
        app.state.currentSessionId = session.id;

        const exercisesHtml = (session.exercises || []).map(ex => `
            <div class="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm">
                <h3 class="font-semibold mb-3">${ex.name}</h3>
                <div class="space-y-2">
                    ${(ex.sets || []).map(set => `
                        <div class="flex items-center gap-2" data-set-id="${set.id}">
                            <span class="text-sm font-medium w-6 text-center">${set.set_number}</span>
                            <input type="number" min="0" step="0.5" placeholder="вес"
                                   value="${set.weight_kg ?? ''}"
                                   class="w-16 px-2 py-1 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-700"
                                   data-field="weight" ${set.is_completed ? 'readonly' : ''}>
                            <span class="text-surface-400">×</span>
                            <input type="number" min="0" placeholder="повт."
                                   value="${set.reps ?? ''}"
                                   class="w-16 px-2 py-1 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-700"
                                   data-field="reps" ${set.is_completed ? 'readonly' : ''}>
                            <button data-action="toggle-set"
                                    class="ml-auto py-1 px-2 text-lg ${set.is_completed ? 'text-primary-600 font-bold' : 'text-surface-400'}"
                                    ${set.is_completed ? 'disabled' : ''}>
                                ✓
                            </button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        let html = `
            <div class="p-4">
                <div class="flex items-center justify-between mb-4">
                    <button data-action="back-to-workouts" class="text-surface-500 hover:text-surface-900 dark:text-surface-400">←</button>
                    <h2 class="text-xl font-bold">${session.name || 'Тренировка'}</h2>
                    <div class="w-6"></div>
                </div>

                <div class="space-y-4">
                    ${exercisesHtml || `<p class="text-surface-400">Упражнения не добавлены</p>`}
                </div>

                <div class="flex gap-2 mt-6">
                    <button data-action="cancel-workout" data-session-id="${session.id}"
                            class="flex-1 py-2 border border-surface-300 dark:border-surface-700 rounded-xl text-sm font-medium">
                        Отменить
                    </button>
                    <button data-action="complete-workout" data-session-id="${session.id}"
                            class="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium">
                        Готово
                    </button>
                </div>
            </div>
        `;
        container.innerHTML = html;

        // Event listeners for workout screen
        this.bindWorkoutScreenEvents(container, app, session.id);
    },

    bindWorkoutScreenEvents(container, app, sessionId) {
        const token = app.state.tokens.access;

        // Toggle set completion
        container.querySelectorAll('[data-action="toggle-set"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const setId = parseInt(e.currentTarget.closest('[data-set-id]').dataset.setId);
                const isCompleted = !e.currentTarget.classList.contains('text-primary-600');
                e.currentTarget.disabled = true;
                e.currentTarget.textContent = '...';
                try {
                    await API.patch(`/workouts/sets/${setId}`, { is_completed: isCompleted }, token);
                    if (isCompleted) {
                        e.currentTarget.classList.add('text-primary-600', 'font-bold');
                        e.currentTarget.classList.remove('text-surface-400');
                        e.currentTarget.textContent = '✓';
                        // Disable inputs
                        const row = e.currentTarget.closest('[data-set-id]');
                        row.querySelector('[data-field="weight"]').readOnly = true;
                        row.querySelector('[data-field="reps"]').readOnly = true;
                        e.currentTarget.disabled = true;
                    } else {
                        e.currentTarget.classList.remove('text-primary-600', 'font-bold');
                        e.currentTarget.classList.add('text-surface-400');
                        e.currentTarget.textContent = '✓';
                        e.currentTarget.disabled = false;
                    }
                } catch (err) {
                    app.showToast(err.message || 'Ошибка', 'error');
                    e.currentTarget.disabled = false;
                    e.currentTarget.textContent = '✓';
                }
            });
        });

        // Save weight/reps on change
        container.querySelectorAll('[data-field="weight"], [data-field="reps"]').forEach(input => {
            input.addEventListener('change', async (e) => {
                const setId = parseInt(e.target.closest('[data-set-id]').dataset.setId);
                const field = e.target.dataset.field;
                const value = field === 'weight' ? parseFloat(e.target.value) : parseInt(e.target.value);
                if (isNaN(value)) return;
                try {
                    await API.patch(`/workouts/sets/${setId}`, { [field]: value }, token);
                } catch (err) {
                    app.showToast(err.message || 'Ошибка сохранения', 'error');
                }
            });
        });

        // Complete workout
        container.querySelector('[data-action="complete-workout"]')?.addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Завершаем...';
            try {
                await API.post(`/workouts/sessions/${sessionId}/complete`, {}, token);
                app.showToast('Тренировка завершена!', 'success');
                app.router.navigate('/workouts');
            } catch (err) {
                app.showToast(err.message || 'Ошибка завершения', 'error');
                e.currentTarget.disabled = false;
                e.currentTarget.textContent = 'Готово';
            }
        });

        // Cancel workout
        container.querySelector('[data-action="cancel-workout"]')?.addEventListener('click', async (e) => {
            if (!confirm('Отменить тренировку? Прогресс не сохранится.')) return;
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = 'Отмена...';
            try {
                await API.post(`/workouts/sessions/${sessionId}/cancel`, {}, token);
                app.showToast('Тренировка отменена', 'info');
                app.router.navigate('/workouts');
            } catch (err) {
                app.showToast(err.message || 'Ошибка отмены', 'error');
                e.currentTarget.disabled = false;
                e.currentTarget.textContent = 'Отменить';
            }
        });

        // Back button
        container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', () => {
            app.router.navigate('/workouts');
        });
    },

    async renderHistory(container, app) {
        this.app = app;
        let data;
        try {
            data = await API.get('/workouts/history?limit=20', app.state.tokens.access);
        } catch (error) {
            console.error('[Workouts] History load error:', error);
            container.innerHTML = Components.errorState('Ошибка загрузки истории');
            return;
        }

        const sessions = data.sessions || [];

        let html = `
            <div class="p-4">
                <div class="flex items-center mb-4">
                    <button data-action="back-to-workouts" class="mr-3 text-surface-500 hover:text-surface-900">←</button>
                    <h2 class="text-xl font-bold">История тренировок</h2>
                </div>

                ${sessions.length === 0
                    ? `<div class="text-center py-8 text-surface-400">Ещё нет тренировок. Начните первую!</div>`
                    : `<div class="space-y-3">
                        ${sessions.map(s => `
                            <div class="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm">
                                <h3 class="font-semibold">${s.name || 'Тренировка'}</h3>
                                <p class="text-sm text-surface-500 dark:text-surface-400">
                                    ${Utils.formatDate(s.started_at)} · ${Utils.formatDuration(s.duration_seconds || 0)}
                                </p>
                                <p class="text-xs text-surface-400 dark:text-surface-500 mt-1 capitalize">
                                    Статус: ${s.status === 'completed' ? 'Завершена' : s.status === 'cancelled' ? 'Отменена' : 'Активна'}
                                </p>
                            </div>
                        `).join('')}
                    </div>`}
            </div>
        `;

        container.innerHTML = html;
        container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', () => {
            app.router.navigate('/workouts');
        });
    },

    async renderTemplatesScreen(container, app) {
        this.app = app;
        try {
            const templates = await API.get('/workouts/templates', app.state.tokens.access);
            let html = `
                <div class="p-4">
                    <div class="flex items-center justify-between mb-4">
                        <button data-action="back-to-workouts" class="text-surface-500 hover:text-surface-900">←</button>
                        <h2 class="text-xl font-bold">Шаблоны</h2>
                        <button data-action="create-template" class="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium">+ Создать</button>
                    </div>
                    <div class="space-y-3">
                        ${templates.map(t => `
                            <div class="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm flex justify-between items-center">
                                <div>
                                    <h3 class="font-semibold">${t.name}</h3>
                                    <p class="text-xs text-surface-400">${t.exercises.length} упр.</p>
                                </div>
                                <button data-action="start-template" data-template-id="${t.id}"
                                        class="px-3 py-1 bg-primary-600 text-white rounded text-xs">Начать</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            container.innerHTML = html;
            container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', () => {
                app.router.navigate('/workouts');
            });
            container.querySelector('[data-action="create-template"]')?.addEventListener('click', () => {
                this.showCreateTemplateModal(app);
            });
            container.querySelectorAll('[data-action="start-template"]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const templateId = parseInt(e.currentTarget.dataset.templateId);
                    e.currentTarget.disabled = true;
                    e.currentTarget.textContent = 'Запуск...';
                    try {
                        const session = await API.post(`/workouts/templates/${templateId}/start`, {}, app.state.tokens.access);
                        await this.renderWorkoutScreen(app.elements.pageContent, app, session.id);
                        app.showToast('Тренировка запущена!', 'success');
                    } catch (err) {
                        app.showToast(err.message || 'Ошибка запуска', 'error');
                        e.currentTarget.disabled = false;
                        e.currentTarget.textContent = 'Начать';
                    }
                });
            });
        } catch (err) {
            app.showToast('Ошибка загрузки шаблонов', 'error');
        }
    },

    async renderStatisticsScreen(container, app) {
        this.app = app;
        try {
            const stats = await API.get('/workouts/statistics', app.state.tokens.access);
            let html = `
                <div class="p-4">
                    <div class="flex items-center mb-4">
                        <button data-action="back-to-workouts" class="mr-3 text-surface-500 hover:text-surface-900">←</button>
                        <h2 class="text-xl font-bold">Статистика</h2>
                    </div>
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="bg-primary-50 dark:bg-primary-900/20 rounded-xl p-4">
                            <p class="text-sm text-primary-700 dark:text-primary-300">Всего тренировок</p>
                            <p class="text-3xl font-bold text-primary-900 dark:text-primary-100">${stats.total_workouts}</p>
                        </div>
                        <div class="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
                            <p class="text-sm text-green-700 dark:text-green-300">На этой неделе</p>
                            <p class="text-3xl font-bold text-green-900 dark:text-green-100">${stats.workouts_this_week}</p>
                        </div>
                        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
                            <p class="text-sm text-blue-700 dark:text-blue-300">В этом месяце</p>
                            <p class="text-3xl font-bold text-blue-900 dark:text-blue-100">${stats.workouts_this_month}</p>
                        </div>
                        <div class="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4">
                            <p class="text-sm text-purple-700 dark:text-purple-300">Серия (недель)</p>
                            <p class="text-3xl font-bold text-purple-900 dark:text-purple-100">${stats.current_streak_weeks}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="bg-surface-100 dark:bg-surface-800 rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Общий объём</p>
                            <p class="text-2xl font-bold">${stats.total_volume_kg.toLocaleString()} кг</p>
                        </div>
                        <div class="bg-surface-100 dark:bg-surface-800 rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Всего подходов</p>
                            <p class="text-2xl font-bold">${stats.total_sets}</p>
                        </div>
                        <div class="bg-surface-100 dark:bg-surface-800 rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Общее время</p>
                            <p class="text-2xl font-bold">${stats.total_duration_hours} ч</p>
                        </div>
                        <div class="bg-surface-100 dark:bg-surface-800 rounded-xl p-4">
                            <p class="text-sm text-surface-500 dark:text-surface-400">Средняя тренировка</p>
                            <p class="text-2xl font-bold">${stats.avg_workout_duration_min} мин</p>
                        </div>
                    </div>
                    ${stats.top_exercises.length > 0 ? `
                        <div class="mb-6">
                            <h3 class="font-semibold mb-3">Топ упражнений по объёму</h3>
                            <div class="space-y-2">
                                ${stats.top_exercises.map((ex, i) => `
                                    <div class="bg-white dark:bg-surface-800 rounded-xl p-3 flex justify-between items-center">
                                        <div class="flex items-center gap-3">
                                            <span class="text-sm text-surface-400 w-6">${i + 1}.</span>
                                            <span class="font-medium">${ex.name}</span>
                                        </div>
                                        <div class="text-right">
                                            <p class="text-sm font-semibold">${ex.volume_kg.toLocaleString()} кг</p>
                                            <p class="text-xs text-surface-400">${ex.sets} подходов</p>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
            container.innerHTML = html;
            container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', () => {
                app.router.navigate('/workouts');
            });
        } catch (err) {
            app.showToast('Ошибка загрузки статистики', 'error');
        }
    },

    closeBuildModal() {
        const m = document.getElementById('build-modal');
        if (m) m.remove();
        const cm = document.getElementById('create-ex-modal');
        if (cm) cm.remove();
        const tm = document.getElementById('template-modal');
        if (tm) tm.remove();
    },

    async showBuildWorkout(app) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };
        let exercises = [];
        let selected = [];
        let filterGroup = '';
        let search = '';

        const buildHtml = () => `
            <div id="build-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto">
                <div class="bg-surface-50 dark:bg-surface-900 rounded-2xl mx-4 max-w-2xl w-full max-h-[85vh] flex flex-col">
                    <div class="p-5 border-b border-surface-200 dark:border-surface-700">
                        <div class="flex justify-between items-center">
                            <h3 class="text-lg font-bold">Собрать тренировку</h3>
                            <button data-action="close-build-workout" class="text-surface-500 hover:text-surface-900 dark:text-surface-400">✕</button>
                        </div>
                        <div class="grid grid-cols-2 gap-3 mt-3">
                            <input id="bw-name" type="text" placeholder="Название тренировки" value="Моя тренировка"
                                   class="px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                            <input id="bw-sets" type="number" min="1" value="3" placeholder="Подходы"
                                   class="px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                        </div>
                        <div class="grid grid-cols-2 gap-3 mt-3">
                            <input id="bw-reps" type="number" min="1" value="10" placeholder="Повторы"
                                   class="px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                            <input id="bw-rest" type="number" min="0" value="90" placeholder="Отдых, с"
                                   class="px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                        </div>
                        <textarea id="bw-notes" placeholder="Примечание (необязательно)"
                                  class="mt-3 w-full px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800"></textarea>
                    </div>
                    <div class="p-4 border-b border-surface-200 dark:border-surface-700">
                        <div class="flex items-center gap-2 mb-2 flex-wrap">
                            <select id="bw-group"
                                    class="px-2 py-1 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                                <option value="">Все группы мышц</option>
                            </select>
                            <input id="bw-search" type="text" placeholder="Поиск упражнения"
                                   class="flex-1 px-2 py-1 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                            <button id="bw-add-own" type="button" title="Добавить своё упражнение"
                                    class="px-2 py-1 border border-surface-300 dark:border-surface-700 rounded text-surface-500 hover:text-surface-900">+</button>
                        </div>
                        <div id="bw-list" class="space-y-1 overflow-y-auto max-h-72"></div>
                    </div>
                    <div class="p-4 border-t border-surface-200 dark:border-surface-700 flex gap-2">
                        <button id="bw-create"
                                class="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium" disabled>
                            Создать тренировку
                        </button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML = buildHtml();
        const groupEl = document.getElementById('bw-group');
        const searchEl = document.getElementById('bw-search');
        const listEl = document.getElementById('bw-list');
        const createBtn = document.getElementById('bw-create');
        const ownBtn = document.getElementById('bw-add-own');

        const renderGroupOptions = () => {
            groupEl.innerHTML = '<option value="">Все группы мышц</option>';
            Object.entries(meta.muscle_groups).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                if (slug === filterGroup) opt.selected = true;
                groupEl.appendChild(opt);
            });
        };

        const renderList = () => {
            const rows = exercises.filter(ex => {
                const g = !filterGroup || ex.muscle_group === filterGroup;
                const s = !search || ex.name.toLowerCase().includes(search.toLowerCase());
                return g && s;
            });
            listEl.innerHTML = rows.map(ex => `
                <label class="flex items-center gap-2 p-2 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700 rounded">
                    <input type="checkbox" data-id="${ex.id}"
                           ${selected.includes(ex.id) ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="font-medium">${ex.name}</div>
                        <div class="text-xs text-surface-500 dark:text-surface-400">
                            ${meta.muscle_groups[ex.muscle_group] || ex.muscle_group} · ${meta.equipment[ex.equipment] || ex.equipment} · ${ex.is_compound ? 'компаунд' : 'изоляция'}
                        </div>
                    </div>
                </label>
            `).join('') || '<div class="text-sm text-surface-400">Ничего не найдено</div>';
            listEl.querySelectorAll('input[data-id]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = parseInt(e.target.dataset.id);
                    if (e.target.checked) { selected.push(id); }
                    else { selected = selected.filter(i => i !== id); }
                    createBtn.disabled = selected.length === 0;
                });
            });
        };

        const updateCreateLabel = () => {
            createBtn.disabled = selected.length === 0;
        };

        groupEl.addEventListener('change', () => {
            filterGroup = groupEl.value;
            renderList();
        });
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            renderList();
        });
        ownBtn.addEventListener('click', () => {
            this.showCreateExerciseModal(app, (newEx) => {
                exercises.push(newEx);
                selected.push(newEx.id);
                renderList();
                updateCreateLabel();
            });
        });
        createBtn.addEventListener('click', async () => {
            if (selected.length === 0) return;
            createBtn.disabled = true;
            createBtn.textContent = 'Создаём...';
            const payload = {
                name: document.getElementById('bw-name').value.trim() || 'Моя тренировка',
                exercise_ids: selected,
                default_sets: parseInt(document.getElementById('bw-sets').value) || 3,
                default_reps: parseInt(document.getElementById('bw-reps').value) || 10,
                default_rest_seconds: parseInt(document.getElementById('bw-rest').value) || 90,
                notes: document.getElementById('bw-notes').value.trim() || undefined,
            };
            try {
                const session = await API.post('/workouts/sessions/build', payload, token);
                this.closeBuildModal();
                await this.renderWorkoutScreen(app.elements.pageContent, app, session.id);
                app.showToast('Тренировка создана! Можете тренироваться.', 'success');
            } catch (err) {
                app.showToast(err.message || 'Ошибка создания тренировки', 'error');
                createBtn.disabled = false;
                createBtn.textContent = 'Создать тренировку';
            }
        });

        try {
            const [meta, exercises] = await Promise.all([
                API.get('/workouts/exercises/meta', token),
                API.get('/workouts/exercises', token),
            ]);
            renderGroupOptions();
            renderList();
        } catch (err) {
            app.showToast(err.message || 'Ошибка загрузки каталога', 'error');
        }
    },

    showCreateExerciseModal(app, onCreated) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };

        const html = `
            <div id="create-ex-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto">
                <div class="bg-surface-50 dark:bg-surface-900 rounded-2xl p-6 mx-4 max-w-sm w-full">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-bold">Новое упражнение</h3>
                        <button data-action="close-build-workout" class="text-surface-500 hover:text-surface-900 dark:text-surface-400">✕</button>
                    </div>
                    <div class="space-y-3">
                        <input id="ce-name" type="text" placeholder="Название"
                                class="w-full px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                        <select id="ce-group"
                                class="w-full px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800"></select>
                        <select id="ce-equipment"
                                class="w-full px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800"></select>
                        <label class="flex items-center gap-2 text-sm">
                            <input id="ce-compound" type="checkbox" checked> Компаундное
                        </label>
                        <textarea id="ce-desc" placeholder="Описание (необязательно)"
                                  class="w-full px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800"></textarea>
                    </div>
                    <div class="flex gap-2 mt-5">
                        <button data-action="close-build-workout"
                                class="flex-1 py-2 border border-surface-300 dark:border-surface-700 rounded-xl text-sm font-medium">Отмена</button>
                        <button id="ce-save"
                                class="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium">Сохранить</button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML += html;
        const groupEl = document.getElementById('ce-group');
        const equipEl = document.getElementById('ce-equipment');
        const saveBtn = document.getElementById('ce-save');

        const renderOptions = () => {
            groupEl.innerHTML = '';
            Object.entries(meta.muscle_groups).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                groupEl.appendChild(opt);
            });
            equipEl.innerHTML = '';
            Object.entries(meta.equipment).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                equipEl.appendChild(opt);
            });
        };

        saveBtn.addEventListener('click', async () => {
            const payload = {
                name: document.getElementById('ce-name').value.trim(),
                muscle_group: groupEl.value,
                equipment: equipEl.value,
                is_compound: document.getElementById('ce-compound').checked,
                description: document.getElementById('ce-desc').value.trim() || undefined,
            };
            if (!payload.name || !payload.muscle_group || !payload.equipment) {
                app.showToast('Заполните название, группу мышц и снаряжение', 'error');
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = 'Сохраняю...';
            try {
                const created = await API.post('/workouts/exercises', payload, token);
                const m = document.getElementById('create-ex-modal');
                if (m) m.remove();
                onCreated(created);
            } catch (err) {
                app.showToast(err.message || 'Ошибка сохранения', 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = 'Сохранить';
            }
        });

        (async () => {
            try {
                meta = await API.get('/workouts/exercises/meta', token);
                renderOptions();
            } catch (err) {
                app.showToast(err.message || 'Ошибка загрузки справочника', 'error');
            }
        })();
    },

    async showCreateTemplateModal(app) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };
        let exercises = [];
        let selected = [];
        let filterGroup = '';
        let search = '';

        const renderGroupOptions = () => {
            groupEl.innerHTML = '<option value="">Все группы мышц</option>';
            Object.entries(meta.muscle_groups).forEach(([slug, label]) => {
                const opt = document.createElement('option');
                opt.value = slug;
                opt.textContent = label;
                if (slug === filterGroup) opt.selected = true;
                groupEl.appendChild(opt);
            });
        };

        const renderList = () => {
            const rows = exercises.filter(ex => {
                const g = !filterGroup || ex.muscle_group === filterGroup;
                const s = !search || ex.name.toLowerCase().includes(search.toLowerCase());
                return g && s;
            });
            listEl.innerHTML = rows.map(ex => `
                <label class="flex items-center gap-2 p-2 cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700 rounded">
                    <input type="checkbox" data-id="${ex.id}"
                           ${selected.includes(ex.id) ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="font-medium">${ex.name}</div>
                        <div class="text-xs text-surface-500 dark:text-surface-400">
                            ${meta.muscle_groups[ex.muscle_group] || ex.muscle_group} · ${meta.equipment[ex.equipment] || ex.equipment} · ${ex.is_compound ? 'компаунд' : 'изоляция'}
                        </div>
                    </div>
                </label>
            `).join('') || '<div class="text-sm text-surface-400">Ничего не найдено</div>';
            listEl.querySelectorAll('input[data-id]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = parseInt(e.target.dataset.id);
                    if (e.target.checked) { selected.push(id); }
                    else { selected = selected.filter(i => i !== id); }
                    createBtn.disabled = selected.length === 0;
                });
            });
        };

        const html = `
            <div id="template-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto">
                <div class="bg-surface-50 dark:bg-surface-900 rounded-2xl mx-4 max-w-2xl w-full max-h-[85vh] flex flex-col">
                    <div class="p-5 border-b border-surface-200 dark:border-surface-700">
                        <div class="flex justify-between items-center">
                            <h3 class="text-lg font-bold">Создать шаблон тренировки</h3>
                            <button data-action="close-template-modal" class="text-surface-500 hover:text-surface-900 dark:text-surface-400">✕</button>
                        </div>
                        <div class="grid grid-cols-2 gap-3 mt-3">
                            <input id="tmpl-name" type="text" placeholder="Название шаблона" value="Мой шаблон"
                                   class="px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                            <input id="tmpl-desc" type="text" placeholder="Описание (необязательно)"
                                   class="px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                        </div>
                    </div>
                    <div class="p-4 border-b border-surface-200 dark:border-surface-700">
                        <div class="flex items-center gap-2 mb-2 flex-wrap">
                            <select id="tmpl-group"
                                    class="px-2 py-1 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                                <option value="">Все группы мышц</option>
                            </select>
                            <input id="tmpl-search" type="text" placeholder="Поиск упражнения"
                                   class="flex-1 px-2 py-1 text-sm border border-surface-300 dark:border-surface-700 rounded bg-surface-50 dark:bg-surface-800">
                            <button id="tmpl-add-own" type="button" title="Добавить своё упражнение"
                                    class="px-2 py-1 border border-surface-300 dark:border-surface-700 rounded text-surface-500 hover:text-surface-900">+</button>
                        </div>
                        <div id="tmpl-list" class="space-y-1 overflow-y-auto max-h-72"></div>
                    </div>
                    <div class="p-4 border-t border-surface-200 dark:border-surface-700 flex gap-2">
                        <button id="tmpl-create"
                                class="flex-1 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium" disabled>
                            Создать шаблон
                        </button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML = html;
        const groupEl = document.getElementById('tmpl-group');
        const searchEl = document.getElementById('tmpl-search');
        const listEl = document.getElementById('tmpl-list');
        const createBtn = document.getElementById('tmpl-create');
        const ownBtn = document.getElementById('tmpl-add-own');

        groupEl.addEventListener('change', () => {
            filterGroup = groupEl.value;
            renderList();
        });
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            renderList();
        });
        ownBtn.addEventListener('click', () => {
            this.showCreateExerciseModal(app, (newEx) => {
                exercises.push(newEx);
                selected.push(newEx.id);
                renderList();
                createBtn.disabled = selected.length === 0;
            });
        });
        createBtn.addEventListener('click', async () => {
            if (selected.length === 0) return;
            createBtn.disabled = true;
            createBtn.textContent = 'Создаём...';
            // For template creation, we need to fetch full exercise details
            const selectedExercises = exercises.filter(ex => selected.includes(ex.id));
            const payload = {
                name: document.getElementById('tmpl-name').value.trim() || 'Мой шаблон',
                description: document.getElementById('tmpl-desc').value.trim() || undefined,
                exercises: selectedExercises.map((ex, i) => ({
                    name: ex.name,
                    order: i,
                    target_sets: 3,
                    target_reps: 10,
                    target_weight_kg: null,
                    rest_seconds: 90,
                    notes: `${ex.muscle_group} / ${ex.equipment}`,
                })),
            };
            try {
                await API.post('/workouts/templates', payload, token);
                const m = document.getElementById('template-modal');
                if (m) m.remove();
                app.showToast('Шаблон создан!', 'success');
                await this.renderTemplatesScreen(app.elements.pageContent, app);
            } catch (err) {
                app.showToast(err.message || 'Ошибка создания шаблона', 'error');
                createBtn.disabled = false;
                createBtn.textContent = 'Создать шаблон';
            }
        });
        document.querySelector('[data-action="close-template-modal"]')?.addEventListener('click', () => {
            const m = document.getElementById('template-modal');
            if (m) m.remove();
        });

        try {
            const [meta, exercises] = await Promise.all([
                API.get('/workouts/exercises/meta', token),
                API.get('/workouts/exercises', token),
            ]);
            renderGroupOptions();
            renderList();
        } catch (err) {
            app.showToast(err.message || 'Ошибка загрузки каталога', 'error');
        }
    }
};
