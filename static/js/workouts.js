console.log("[DEBUG] Loaded workouts.js");
import { API } from './api.js';
import { Components } from './components.js';
import { Utils } from './utils.js';

export const Workouts = {
    app: null,

    async render(container, app) {
        this.app = app;
        let activeSession;
        let stats = null;
        let templates = [];
        try {
            [activeSession, stats, templates] = await Promise.all([
                API.get('/workouts/sessions/active', app.state.tokens.access).catch(() => null),
                API.get('/workouts/statistics', app.state.tokens.access).catch(() => null),
                API.get('/workouts/templates', app.state.tokens.access).catch(() => []),
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

        let templatesWidget = '';
        if (templates && templates.length > 0) {
            const hasActiveSession = !!activeSession;
            templatesWidget = `
                <div class="mb-6">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="text-sm font-semibold text-surface-500 uppercase tracking-wider">Мои шаблоны</h3>
                        <span class="text-xs text-primary-600 dark:text-primary-400 font-medium">${templates.length} шт.</span>
                    </div>
                    <div class="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2 scrollbar-none -mx-4 px-4">
                        ${templates.map(t => `
                            <div class="min-w-[220px] max-w-[240px] snap-center bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
                                <div class="flex-1 cursor-pointer" data-action="view-template" data-template-id="${t.id}">
                                    <h4 class="font-bold text-base truncate mb-1" title="${t.name}">${t.name}</h4>
                                    <p class="text-xs text-surface-500 dark:text-surface-400 mb-2">${t.exercises.length} упр.</p>
                                    <div class="text-[11px] text-surface-400 truncate mb-3">
                                        ${t.exercises.map(ex => ex.name).join(', ')}
                                    </div>
                                </div>
                                <button data-action="start-template" data-template-id="${t.id}" ${hasActiveSession ? 'disabled' : ''}
                                        class="w-full py-2 ${hasActiveSession ? 'bg-surface-400' : 'bg-primary-600'} text-white rounded-xl text-xs font-semibold text-center shadow-sm">
                                    ${hasActiveSession ? 'Тренировка уже идет' : 'Начать тренировку →'}
                                </button>
                            </div>
                        `).join('')}
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

                <div class="mb-6">
                    <h3 class="text-sm font-semibold text-surface-500 uppercase tracking-wider mb-3">Действия</h3>
                    <div class="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-3 scrollbar-none -mx-4 px-4">
                        <!-- Card 1: Build Custom -->
                        <div class="min-w-[240px] max-w-[260px] snap-center bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl p-4 flex flex-col justify-between shadow-sm cursor-pointer btn-press" data-action="show-build-workout">
                            <div>
                                <div class="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center mb-3">
                                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                                </div>
                                <h4 class="font-bold text-lg mb-1">Собрать тренировку</h4>
                                <p class="text-xs text-surface-500 dark:text-surface-400">Создать и сохранить свой шаблон из каталога (220+)</p>
                            </div>
                            <span class="mt-4 text-xs font-semibold bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-3 py-2 rounded-xl text-center">Создать шаблон →</span>
                        </div>

                        <!-- Card 2: History -->
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

                        <!-- Card 3: Statistics -->
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

                ${templatesWidget}
            </div>
        `;

        container.innerHTML = html;

        container.querySelectorAll('[data-action="show-build-workout"]').forEach(el => {
            el.addEventListener('click', () => this.showBuildWorkout(app));
        });
        container.querySelectorAll('[data-action="view-history"]').forEach(el => {
            el.addEventListener('click', () => app.showPage('history'));
        });
        container.querySelectorAll('[data-action="view-statistics"]').forEach(el => {
            el.addEventListener('click', () => app.showPage('statistics'));
        });
        container.querySelectorAll('[data-action="view-history"]').forEach(el => {
            el.addEventListener('click', () => app.showPage('history'));
        });
        container.querySelectorAll('[data-action="view-templates"]').forEach(el => {
            el.addEventListener('click', () => app.showPage('templates'));
        });
        container.querySelectorAll('[data-action="view-statistics"]').forEach(el => {
            el.addEventListener('click', () => app.showPage('statistics'));
        });
        container.querySelector('[data-action="resume-workout"]')?.addEventListener('click', (e) => {
            const sessionId = e.currentTarget.dataset.sessionId;
            this.renderWorkoutScreen(container, app, parseInt(sessionId));
        });

        container.querySelectorAll('[data-action="view-template"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const templateId = parseInt(e.currentTarget.dataset.templateId);
                const template = templates.find(t => t.id === templateId);
                if (template) {
                    this.renderTemplateDetails(container, app, template);
                }
            });
        });

        container.querySelectorAll('[data-action="start-template"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const button = e.currentTarget;
                const templateId = parseInt(button.dataset.templateId);
                
                button.disabled = true;
                button.textContent = 'Запуск...';
                
                // Запускаем API запрос СРАЗУ, параллельно с отсчетом
                const sessionPromise = API.post(`/workouts/templates/${templateId}/start`, {}, app.state.tokens.access);
                
                // Запускаем отсчет
                this.renderCountdown(container, () => {});
                
                try {
                    const session = await sessionPromise;
                    
                    // Рендерим экран
                    await this.renderWorkoutScreen(container, app, session.id);
                } catch (err) {
                    console.error('Start template error:', err);
                    app.showToast(err.message || 'Ошибка запуска', 'error');
                    if (button) {
                        button.disabled = false;
                        button.textContent = 'Начать тренировку →';
                    }
                }
            });
        });
    },

    async renderCountdown(container, onComplete) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center modal-backdrop transition-opacity';
        overlay.innerHTML = `
            <div id="countdown" class="text-7xl font-bold text-white tabular-nums animate-pulse">3</div>
        `;
        document.body.appendChild(overlay);

        let count = 3;
        const display = overlay.querySelector('#countdown');
        
        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                display.textContent = count;
            } else {
                clearInterval(interval);
                document.body.removeChild(overlay);
                onComplete();
            }
        }, 1000);
    },

    async renderTemplateDetails(container, app, template) {
        this.app = app;
        const html = `
            <div class="p-4">
                <div class="flex items-center justify-between mb-4">
                    <button data-action="back-to-workouts" class="text-surface-500 hover:text-surface-900">←</button>
                    <h2 class="text-xl font-bold">${template.name}</h2>
                    <div class="flex gap-2">
                        <button data-action="edit-template" data-template-id="${template.id}" class="text-surface-500 hover:text-primary-600">✏️</button>
                        <button data-action="delete-template" data-template-id="${template.id}" class="text-surface-500 hover:text-red-500">🗑️</button>
                    </div>
                </div>

                <div class="bg-white dark:bg-surface-800 rounded-xl p-4 shadow-sm">
                    <h3 class="font-semibold mb-3">Упражнения (${template.exercises.length})</h3>
                    <ul class="space-y-2">
                        ${template.exercises.map(ex => `
                            <li class="text-sm py-2 border-b border-surface-200 dark:border-surface-700 last:border-0">
                                ${ex.name} - ${ex.target_sets} подх. × ${ex.target_reps} повт.
                            </li>
                        `).join('')}
                    </ul>
                </div>
            </div>
        `;
        container.innerHTML = html;

        container.querySelector('[data-action="back-to-workouts"]').addEventListener('click', () => {
            this.render(container, app);
        });

        container.querySelector('[data-action="edit-template"]').addEventListener('click', () => {
            this.showEditTemplateModal(app, template);
        });

        container.querySelector('[data-action="delete-template"]').addEventListener('click', async () => {
            if (!confirm('Удалить этот шаблон тренировки?')) return;
            try {
                await API.delete(`/workouts/templates/${template.id}`, app.state.tokens.access);
                app.showToast('Шаблон удален', 'info');
                this.render(container, app);
            } catch (err) {
                app.showToast(err.message || 'Ошибка удаления', 'error');
            }
        });
    },

    async renderWorkoutScreen(container, app, sessionId) {
        this.app = app;
        let session;
        let historyData = { sessions: [] };
        try {
            const url = sessionId ? `/workouts/sessions/${sessionId}` : '/workouts/sessions/active';
            [session, historyData] = await Promise.all([
                API.get(url, app.state.tokens.access),
                API.get('/workouts/history?limit=50', app.state.tokens.access).catch(() => ({ sessions: [] }))
            ]);
        } catch (error) {
            console.error('[Workouts] Session/History load error:', error);
            app.showToast('Ошибка загрузки данных', 'error');
            return;
        }
        if (!session) {
            app.showToast('Нет активной тренировки', 'info');
            return;
        }
        app.state.currentSessionId = session.id;

        const durationMin = Math.floor((new Date() - new Date(session.started_at)) / 60000);
        
        const completedHistorySessions = [...(historyData.sessions || [])]
            .filter(s => s.status === 'completed')
            .sort((a, b) => new Date(a.started_at) - new Date(b.started_at));

const exerciseCards = (session.exercises || []).map((ex, index, arr) => {
            const historyPoints = completedHistorySessions
                .flatMap(s => s.exercises.filter(e => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase()))
                .flatMap(e => e.sets.map(set => set.weight_kg))
                .filter(w => w != null && w > 0)
                .slice(-10);

            return `
            <div class="w-[98vw] max-w-[500px] snap-center bg-white dark:bg-surface-800 rounded-3xl p-5 shadow-lg flex flex-col min-h-[500px] border border-surface-100 dark:border-surface-700" data-exercise-id="${ex.id}">
                <div class="flex justify-between items-start mb-4">
                    <h3 class="font-bold text-lg text-surface-900 dark:text-surface-50 leading-tight flex-1 mr-2" title="${ex.name}">${ex.name}</h3>
                    <div class="flex items-center gap-1 flex-shrink-0">
                        <button type="button" data-action="move-ex-up" data-ex-id="${ex.id}" class="w-9 h-9 bg-surface-100 dark:bg-surface-700 rounded-xl text-xs font-bold hover:bg-surface-200 transition-colors ${index === 0 ? 'opacity-30 cursor-not-allowed' : ''}">▲</button>
                        <button type="button" data-action="move-ex-down" data-ex-id="${ex.id}" class="w-9 h-9 bg-surface-100 dark:bg-surface-700 rounded-xl text-xs font-bold hover:bg-surface-200 transition-colors ${index === arr.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}">▼</button>
                    </div>
                </div>
                
                <div class="mb-5 flex-1 min-h-[140px]">
                    ${Components.sparkline(historyPoints)}
                </div>

                <div class="space-y-3">
                    ${(ex.sets || []).map(set => {
                        let prevText = '—';
                        
                        // Сортируем завершенные сессии по дате (новейшие первые)
                        const sortedSessions = [...completedHistorySessions].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
                        
                        // Ищем последнюю завершенную сессию, где есть это упражнение (исключая текущую)
                        const prevSession = sortedSessions.find(s => 
                            s.id !== session.id && 
                            (s.exercises || []).some(e => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase())
                        );
                        
                        if (prevSession) {
                            const pastEx = (prevSession.exercises || []).find(e => e.name.trim().toLowerCase() === ex.name.trim().toLowerCase());
                            if (pastEx) {
                                const pastSets = [...(pastEx.sets || [])].sort((a, b) => a.set_number - b.set_number);
                                const pastSet = pastSets.find(s => s.set_number === set.set_number) || pastSets[set.set_number - 1];
                                if (pastSet && pastSet.weight_kg != null && pastSet.reps != null) {
                                    prevText = `${pastSet.weight_kg}×${pastSet.reps}`;
                                }
                            }
                        }

                        return `
                        <div class="flex items-center gap-2 bg-surface-50 dark:bg-surface-700/50 p-2 rounded-2xl" data-set-id="${set.id}">
                            <span class="font-bold w-6 text-center text-surface-400 text-xs">${set.set_number}</span>
                            
                            <div class="w-12 flex flex-col items-center justify-center flex-shrink-0" title="Прошлый подход">
                                <label class="text-[9px] text-surface-500 uppercase font-semibold text-center">Пред.</label>
                                <span class="text-[11px] font-semibold text-surface-600 dark:text-surface-300 h-10 flex items-center truncate">${prevText}</span>
                            </div>

                            <div class="flex-[2] flex flex-col min-w-0">
                                <label class="text-[9px] text-surface-500 uppercase font-semibold text-center">Вес</label>
                                <input type="number" min="0" step="0.5" placeholder="0"
                                       value="${set.weight_kg ?? ''}"
                                       class="w-24 h-12 bg-white dark:bg-surface-800 text-center text-xl font-bold rounded-xl border border-surface-200 dark:border-surface-600 focus:border-primary-500 focus:outline-none"
                                       data-field="weight" ${set.is_completed ? 'readonly' : ''}>
                            </div>
                            
                            <div class="flex-[2] flex flex-col min-w-0">
                                <label class="text-[9px] text-surface-500 uppercase font-semibold text-center">Повт</label>
                                <input type="number" min="0" placeholder="0"
                                       value="${set.reps ?? ''}"
                                       class="w-24 h-12 bg-white dark:bg-surface-800 text-center text-xl font-bold rounded-xl border border-surface-200 dark:border-surface-600 focus:border-primary-500 focus:outline-none"
                                       data-field="reps" ${set.is_completed ? 'readonly' : ''}>
                            </div>
                            
                            <button data-action="toggle-set"
                                    class="flex-shrink-0 w-11 h-11 rounded-2xl text-xl font-bold transition-all flex items-center justify-center ${set.is_completed ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300 shadow-md' : 'bg-white dark:bg-surface-800 text-surface-400 shadow-sm border border-surface-200'}"
                                    ${set.is_completed ? 'disabled' : ''}>
                                ✓
                            </button>
                        </div>
                    `;
                    }).join('')}
                </div>
            </div>
        `}).join('');

        // Cards
        const cancelCard = `
            <div class="w-[98vw] max-w-[500px] snap-center bg-surface-100 dark:bg-surface-800 rounded-2xl p-6 shadow-md flex flex-col items-center justify-center min-h-[520px]">
                <button data-action="cancel-workout" data-session-id="${session.id}"
                        class="w-full py-5 border-2 border-dashed border-red-300 dark:border-red-700 rounded-2xl text-red-600 font-bold text-base">
                    Отменить тренировку
                </button>
            </div>
        `;
        const completeCard = `
            <div class="w-[98vw] max-w-[500px] snap-center bg-surface-100 dark:bg-surface-800 rounded-2xl p-6 shadow-md flex flex-col items-center justify-center min-h-[520px]">
                <button data-action="complete-workout" data-session-id="${session.id}"
                        class="w-full py-5 bg-primary-600 text-white rounded-2xl font-bold text-base">
                    Завершить тренировку
                </button>
            </div>
        `;
        const allCards = [cancelCard, ...exerciseCards, completeCard];

        let html = `
            <div class="p-4 pt-16" id="workout-container">
                <div class="flex items-center justify-between mb-6">
                    <button data-action="back-to-workouts" class="text-surface-500 hover:text-surface-900 dark:text-surface-400 text-lg">←</button>
                    <h2 class="text-xl font-bold text-center flex-1 ${!session.name ? 'truncate' : ''}">${session.name || 'Тренировка'}</h2>
                    <span class="text-sm text-surface-500 font-mono">${durationMin} мин.</span>
                </div>

                <div class="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-10 px-4 -mx-4" id="carousel">
                    ${allCards.join('')}
                </div>
            </div>
        `;
        container.innerHTML = html;
        
        // Scroll to first exercise (index 1 in allCards)
        setTimeout(() => {
            const carousel = document.getElementById('carousel');
            if (carousel) {
                const cardWidth = carousel.querySelector('.snap-center').offsetWidth + 16; // 16px is gap
                carousel.scrollLeft = cardWidth; 
            }
        }, 100);

        // Event listeners for workout screen
        this.bindWorkoutScreenEvents(container, app, session.id);
    },

    bindWorkoutScreenEvents(container, app, sessionId) {
        const token = app.state.tokens.access;

        // Toggle set completion
        container.querySelectorAll('[data-action="toggle-set"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const button = e.currentTarget;
                const row = button.closest('[data-set-id]');
                if (!row) {
                    console.error('Row not found for set');
                    return;
                }
                const setId = parseInt(row.dataset.setId);
                if (isNaN(setId)) {
                    console.error('Invalid setId found:', row.dataset.setId);
                    return;
                }
                
                const weightInput = row.querySelector('[data-field="weight"]');
                const repsInput = row.querySelector('[data-field="reps"]');
                const weight_kg = weightInput ? parseFloat(weightInput.value) : null;
                const reps = repsInput ? parseInt(repsInput.value) : null;

                const isCompleted = !button.classList.contains('bg-primary-100');
                button.disabled = true;
                button.textContent = '...';
                try {
                    await API.patch(`/workouts/sets/${setId}`, { 
                        is_completed: isCompleted,
                        weight_kg: isNaN(weight_kg) ? null : weight_kg,
                        reps: isNaN(reps) ? null : reps
                    }, token);
                    if (isCompleted) {
                        button.classList.remove('bg-surface-100', 'text-surface-500', 'dark:bg-surface-700', 'dark:text-surface-400');
                        button.classList.add('bg-primary-100', 'text-primary-700', 'dark:bg-primary-900/40', 'dark:text-primary-300', 'shadow-md');
                        button.textContent = '✓';
                        
                        row.querySelector('span.font-bold').classList.add('text-surface-400', 'dark:text-surface-600');
                        row.querySelectorAll('input').forEach(inp => inp.classList.add('text-surface-400', 'dark:text-surface-600'));
                        row.querySelectorAll('label').forEach(lbl => lbl.classList.add('text-surface-400', 'dark:text-surface-600'));

                        row.querySelector('[data-field="weight"]').readOnly = true;
                        row.querySelector('[data-field="reps"]').readOnly = true;
                        button.disabled = false; 
                        
                        const exerciseContainer = button.closest('.snap-center');
                        const allToggleButtons = exerciseContainer.querySelectorAll('[data-action="toggle-set"]');
                        const allCompleted = Array.from(allToggleButtons).every(b => b.classList.contains('bg-primary-100'));
                        
                        if (allCompleted) {
                            const carousel = document.getElementById('carousel');
                            if (carousel) {
                                const cardWidth = exerciseContainer.offsetWidth + 16;
                                carousel.scrollBy({ left: cardWidth, behavior: 'smooth' });
                            }
                        }
                    }
                    else {
                        button.classList.remove('bg-primary-100', 'text-primary-700', 'dark:bg-primary-900/40', 'dark:text-primary-300', 'shadow-md');
                        button.classList.add('bg-surface-100', 'text-surface-500', 'dark:bg-surface-700', 'dark:text-surface-400');

                        row.querySelector('span.font-bold').classList.remove('text-surface-400', 'dark:text-surface-600');
                        row.querySelectorAll('input').forEach(inp => inp.classList.remove('text-surface-400', 'dark:text-surface-600'));
                        row.querySelectorAll('label').forEach(lbl => lbl.classList.remove('text-surface-400', 'dark:text-surface-600'));

                        row.querySelector('[data-field="weight"]').readOnly = false;
                        row.querySelector('[data-field="reps"]').readOnly = false;
                        button.textContent = '✓';
                        button.disabled = false;
                    }
                } catch (err) {
                    app.showToast(err.message || 'Ошибка', 'error');
                    button.disabled = false;
                    button.textContent = '✓';
                }
            });
        });

        // Save weight/reps on change or blur
        container.querySelectorAll('[data-field="weight"], [data-field="reps"]').forEach(input => {
            const saveHandler = async (e) => {
                const targetInput = e.target;
                const row = targetInput.closest('[data-set-id]');
                if (!row) return;
                const setId = parseInt(row.dataset.setId);
                const field = targetInput.dataset.field;
                const value = field === 'weight' ? parseFloat(targetInput.value) : parseInt(targetInput.value);
                if (isNaN(value)) return;

                if (field === 'weight') {
                    const exerciseContainer = row.closest('.bg-white, .dark\\:bg-surface-800');
                    if (exerciseContainer) {
                        const rows = exerciseContainer.querySelectorAll('[data-set-id]');
                        let foundCurrent = false;
                        for (const r of rows) {
                            if (foundCurrent) {
                                const nextWeightInput = r.querySelector('[data-field="weight"]');
                                if (nextWeightInput && !nextWeightInput.value) {
                                    nextWeightInput.value = value;
                                    const nextSetId = parseInt(r.dataset.setId);
                                    API.patch(`/workouts/sets/${nextSetId}`, { weight_kg: value }, token).catch(() => {});
                                }
                                break;
                            }
                            if (r === row) foundCurrent = true;
                        }
                    }
                }

                try {
                    await API.patch(`/workouts/sets/${setId}`, { [field]: value }, token);
                } catch (err) {
                    app.showToast(err.message || 'Ошибка сохранения', 'error');
                }
            };

            input.addEventListener('change', saveHandler);
            input.addEventListener('blur', saveHandler);
        });

        // Complete workout
        // Handled by App.js

        // Cancel workout
        // Handled by App.js

        // Move exercise up/down in active session
        container.querySelectorAll('[data-action="move-ex-up"], [data-action="move-ex-down"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.currentTarget.closest('[data-exercise-id]');
                const exId = parseInt(e.currentTarget.dataset.exId);
                const isUp = e.currentTarget.dataset.action === 'move-ex-up';
                const exercises = [...session.exercises];
                const idx = exercises.findIndex(ex => ex.id === exId);
                if (idx === -1) return;
                const targetIdx = isUp ? idx - 1 : idx + 1;
                if (targetIdx < 0 || targetIdx >= exercises.length) return;

                card.classList.add('scale-[1.02]', 'bg-primary-50/50', 'dark:bg-primary-900/20', 'transition-all', 'duration-300');

                const temp = exercises[idx];
                exercises[idx] = exercises[targetIdx];
                exercises[targetIdx] = temp;

                try {
                    await API.patch(`/workouts/sessions/${sessionId}`, {
                        exercises: exercises.map((ex, i) => ({ id: ex.id, order: i }))
                    }, token);
                    await this.renderWorkoutScreen(container, app, sessionId);
                } catch (err) {
                    app.showToast(err.message || 'Ошибка изменения порядка', 'error');
                }
            });
        });

        // Back button
        container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', () => {
            app.showPage('workouts');
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
            const [templates, activeSession] = await Promise.all([
                API.get('/workouts/templates', app.state.tokens.access),
                API.get('/workouts/sessions/active', app.state.tokens.access).catch(() => null)
            ]);
            const hasActiveSession = !!activeSession;
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
                                <button data-action="start-template" data-template-id="${t.id}" ${hasActiveSession ? 'disabled' : ''}
                                        class="px-3 py-1 ${hasActiveSession ? 'bg-surface-400' : 'bg-primary-600'} text-white rounded text-xs">
                                    ${hasActiveSession ? 'Активна' : 'Начать'}
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            container.innerHTML = html;
            container.querySelector('[data-action="back-to-workouts"]')?.addEventListener('click', () => {
                app.showPage('workouts');
            });
            container.querySelector('[data-action="create-template"]')?.addEventListener('click', () => {
                this.showCreateTemplateModal(app);
            });
        container.querySelectorAll('[data-action="view-template"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const templateId = parseInt(e.currentTarget.dataset.templateId);
                const template = templates.find(t => t.id === templateId);
                if (template) {
                    this.renderTemplateDetails(container, app, template);
                }
            });
        });

        container.querySelectorAll('[data-action="start-template"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const button = e.currentTarget;
                const templateId = parseInt(button.dataset.templateId);
                
                button.disabled = true;
                button.textContent = 'Запуск...';
                
                // Запускаем API запрос СРАЗУ, параллельно с отсчетом
                const sessionPromise = API.post(`/workouts/templates/${templateId}/start`, {}, app.state.tokens.access);
                
                // Запускаем отсчет
                this.renderCountdown(container, () => {});
                
                try {
                    const session = await sessionPromise;
                    
                    // Рендерим экран (не блокируя отсчет)
                    this.renderWorkoutScreen(app.elements.pageContent, app, session.id);
                } catch (err) {
                    app.showToast(err.message || 'Ошибка запуска', 'error');
                    button.disabled = false;
                    button.textContent = 'Начать';
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
                app.showPage('workouts');
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
                <div class="bg-surface-50 dark:bg-surface-900 rounded-2xl mx-4 max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
                    <div class="p-5 border-b border-surface-200 dark:border-surface-700 flex justify-between items-center">
                        <div>
                            <h3 class="text-lg font-bold">Собрать тренировку</h3>
                            <p class="text-xs text-surface-500">Выберите упражнения из каталога</p>
                        </div>
                        <button data-action="close-build-workout" class="text-surface-500 hover:text-surface-900 dark:text-surface-400 p-1">✕</button>
                    </div>

                    <div class="p-4 border-b border-surface-200 dark:border-surface-700">
                        <input id="bw-name" type="text" placeholder="Название тренировки" value="Моя тренировка"
                               class="w-full px-3 py-2.5 text-sm border border-surface-300 dark:border-surface-700 rounded-xl bg-surface-50 dark:bg-surface-800 mb-3 font-medium">
                        
                        <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-none" id="bw-groups-container">
                            <!-- Pills will be rendered here -->
                        </div>
                        
                        <div class="flex items-center gap-2 mt-2">
                            <input id="bw-search" type="text" placeholder="Поиск упражнения..."
                                   class="flex-1 px-3 py-2 text-sm border border-surface-300 dark:border-surface-700 rounded-xl bg-surface-50 dark:bg-surface-800">
                            <button id="bw-add-own" type="button" title="Добавить своё упражнение"
                                    class="w-10 h-10 flex items-center justify-center border border-surface-300 dark:border-surface-700 rounded-xl text-surface-500 hover:text-surface-900 bg-surface-100 dark:bg-surface-800 font-bold">+</button>
                        </div>
                    </div>

                    <div class="p-4 flex-1 overflow-y-auto">
                        <div class="text-xs font-semibold text-surface-400 mb-2 uppercase tracking-wider">Доступные упражнения</div>
                        <div id="bw-list" class="space-y-1.5"></div>
                    </div>

                    <div class="p-4 border-t border-surface-200 dark:border-surface-700 flex items-center justify-between gap-3">
                        <div id="bw-selected-count" class="text-xs text-surface-500 font-medium">Выбрано: 0</div>
                        <button id="bw-next"
                                class="px-6 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed" disabled>
                            Далее
                        </button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML = buildHtml();
        const groupsContainer = document.getElementById('bw-groups-container');
        const searchEl = document.getElementById('bw-search');
        const listEl = document.getElementById('bw-list');
        const nextBtn = document.getElementById('bw-next');
        const ownBtn = document.getElementById('bw-add-own');

        const renderGroupOptions = () => {
            groupsContainer.innerHTML = '';
            const allBtn = document.createElement('button');
            allBtn.textContent = 'Все';
            allBtn.className = `px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${filterGroup === '' ? 'bg-primary-600 text-white' : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300'}`;
            allBtn.addEventListener('click', () => { filterGroup = ''; renderGroupOptions(); renderList(); });
            groupsContainer.appendChild(allBtn);

            Object.entries(meta.muscle_groups || {}).forEach(([slug, label]) => {
                const btn = document.createElement('button');
                btn.textContent = label;
                btn.className = `px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${filterGroup === slug ? 'bg-primary-600 text-white' : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300'}`;
                btn.addEventListener('click', () => { filterGroup = slug; renderGroupOptions(); renderList(); });
                groupsContainer.appendChild(btn);
            });
        };

        const updateCreateLabel = () => {
            nextBtn.disabled = selected.length === 0;
            const countEl = document.getElementById('bw-selected-count');
            if (countEl) countEl.textContent = `Выбрано: ${selected.length}`;
        };

        const renderList = () => {
            const rows = exercises.filter(ex => {
                const g = !filterGroup || ex.muscle_group === filterGroup;
                const s = !search || ex.name.toLowerCase().includes(search.toLowerCase());
                return g && s;
            });
            listEl.innerHTML = rows.map(ex => {
                const isSelected = selected.includes(ex.id);
                return `
                <label class="flex items-center gap-4 p-4 cursor-pointer rounded-2xl border transition-all ${isSelected ? 'bg-primary-50 border-primary-200 dark:bg-primary-900/20 dark:border-primary-800' : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700 hover:border-surface-300'}">
                    <input type="checkbox" data-id="${ex.id}" class="w-5 h-5 text-primary-600 rounded"
                           ${isSelected ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold text-sm ${isSelected ? 'text-primary-900 dark:text-primary-100' : 'text-surface-900 dark:text-surface-100'}">${ex.name}</div>
                        <div class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                            ${meta.muscle_groups?.[ex.muscle_group] || ex.muscle_group} · ${meta.equipment?.[ex.equipment] || ex.equipment}
                        </div>
                    </div>
                </label>`;
            }).join('') || '<div class="text-sm text-surface-400 text-center py-6">Ничего не найдено</div>';

            listEl.querySelectorAll('input[data-id]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = parseInt(e.target.dataset.id);
                    if (e.target.checked) { selected.push(id); }
                    else { selected = selected.filter(i => i !== id); }
                    updateCreateLabel();
                    renderList();
                });
            });
        };

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
        nextBtn.addEventListener('click', () => {
            const selectedExercises = selected.map(id => exercises.find(ex => ex.id === id)).filter(Boolean);
            const templateName = document.getElementById('bw-name')?.value.trim() || 'Мой шаблон';
            this.renderConfigurationScreen(app, selectedExercises, async (configuredExercises) => {
                const saveBtn = document.getElementById('bw-save-final');
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Сохраняем...';
                }
                const payload = {
                    name: templateName,
                    exercises: configuredExercises
                };
                try {
                    await API.post('/workouts/templates', payload, token);
                    this.closeBuildModal();
                    await this.render(app.elements.pageContent, app);
                    app.showToast('Шаблон тренировки сохранен!', 'success');
                } catch (err) {
                    app.showToast(err.message || 'Ошибка сохранения шаблона', 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Сохранить';
                    }
                }
            }, null);
        });

        try {
            const [resMeta, resExercises] = await Promise.all([
                API.get('/workouts/exercises/meta', token),
                API.get('/workouts/exercises', token),
            ]);
            meta = resMeta;
            exercises = resExercises;
            renderGroupOptions();
            renderList();
        } catch (err) {
            app.showToast(err.message || 'Ошибка загрузки каталога', 'error');
        }
    },

    renderConfigurationScreen(app, selectedExercises, onSave, template = null) {
        const modal = document.getElementById('build-modal');
        const content = modal.querySelector('.flex.flex-col');
        
        const findTemplateEx = (exName) => template?.exercises.find(te => te.name === exName);

        content.innerHTML = `
            <div class="p-5 border-b border-surface-200 dark:border-surface-700 flex justify-between items-center">
                <h3 class="text-lg font-bold">Настройка упражнений и порядка</h3>
                <button data-action="close-build-workout" class="text-surface-500 hover:text-surface-900 dark:text-surface-400 p-1">✕</button>
            </div>
            <div class="p-4 flex-1 overflow-y-auto space-y-4" id="config-list">
                ${selectedExercises.map((ex, i) => {
                    const te = findTemplateEx(ex.name);
                    return `
                    <div class="bg-surface-100 dark:bg-surface-800 p-4 rounded-2xl flex items-center justify-between gap-3" data-ex-id="${ex.id}" data-index="${i}">
                        <div class="flex-1 min-w-0">
                            <h4 class="font-bold mb-2 truncate">${ex.name}</h4>
                            <div class="grid grid-cols-3 gap-2">
                                <div>
                                    <label class="text-xs text-surface-500">Подходы</label>
                                    <input type="number" value="${te?.target_sets || 3}" class="w-full px-2 py-1 bg-white dark:bg-surface-900 rounded border border-surface-300 dark:border-surface-700 cfg-sets">
                                </div>
                                <div>
                                    <label class="text-xs text-surface-500">Повт.</label>
                                    <input type="number" value="${te?.target_reps || 10}" class="w-full px-2 py-1 bg-white dark:bg-surface-900 rounded border border-surface-300 dark:border-surface-700 cfg-reps">
                                </div>
                                <div>
                                    <label class="text-xs text-surface-500">Вес (кг)</label>
                                    <input type="number" value="${te?.target_weight_kg || 0}" placeholder="0" class="w-full px-2 py-1 bg-white dark:bg-surface-900 rounded border border-surface-300 dark:border-surface-700 cfg-weight">
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-col gap-1.5">
                            <button type="button" data-action="cfg-move-up" class="px-3.5 py-2 bg-surface-200 dark:bg-surface-700 rounded-xl text-sm font-bold hover:bg-surface-300 transition-colors">▲</button>
                            <button type="button" data-action="cfg-move-down" class="px-3.5 py-2 bg-surface-200 dark:bg-surface-700 rounded-xl text-sm font-bold hover:bg-surface-300 transition-colors">▼</button>
                        </div>
                    </div>
                `}).join('')}
            </div>
            <div class="p-4 border-t border-surface-200 dark:border-surface-700">
                <button id="bw-save-final" class="w-full py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold shadow-md">Сохранить</button>
            </div>
        `;

        content.querySelectorAll('[data-action="cfg-move-up"], [data-action="cfg-move-down"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.currentTarget.closest('[data-ex-id]');
                const isUp = e.currentTarget.dataset.action === 'cfg-move-up';
                const cards = Array.from(content.querySelectorAll('[data-ex-id]'));
                const idx = cards.indexOf(card);
                const targetIdx = isUp ? idx - 1 : idx + 1;
                if (targetIdx < 0 || targetIdx >= cards.length) return;

                const targetCard = cards[targetIdx];

                card.classList.add('scale-[1.02]', 'bg-primary-50', 'dark:bg-primary-900/40', 'transition-all', 'duration-300');
                targetCard.classList.add('transition-all', 'duration-300');

                if (isUp) {
                    targetCard.before(card);
                } else {
                    targetCard.after(card);
                }

                setTimeout(() => {
                    card.classList.remove('scale-[1.02]', 'bg-primary-50', 'dark:bg-primary-900/40');
                }, 400);
            });
        });

        document.getElementById('bw-save-final').addEventListener('click', () => {
            const items = content.querySelectorAll('[data-ex-id]');
            const configured = Array.from(items).map((item, i) => ({
                name: item.querySelector('h4').textContent,
                order: i,
                target_sets: parseInt(item.querySelector('.cfg-sets').value),
                target_reps: parseInt(item.querySelector('.cfg-reps').value),
                target_weight_kg: parseFloat(item.querySelector('.cfg-weight').value) || null,
                rest_seconds: 90
            }));
            onSave(configured);
        });
    },

    async showEditTemplateModal(app, template) {
        this.app = app;
        const token = app.state.tokens.access;
        let meta = { muscle_groups: {}, equipment: {} };
        let exercises = [];
        let selected = [];
        let filterGroup = '';
        let search = '';

        const buildHtml = () => `
            <div id="build-modal" class="fixed inset-0 z-50 flex items-center justify-center modal-backdrop pointer-events-auto">
                <div class="bg-surface-50 dark:bg-surface-900 rounded-2xl mx-4 max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl">
                    <div class="p-5 border-b border-surface-200 dark:border-surface-700 flex justify-between items-center">
                        <div>
                            <h3 class="text-lg font-bold">Редактировать шаблон</h3>
                            <p class="text-xs text-surface-500">Измените название или упражнения</p>
                        </div>
                        <button data-action="close-build-workout" class="text-surface-500 hover:text-surface-900 dark:text-surface-400 p-1">✕</button>
                    </div>

                    <div class="p-4 border-b border-surface-200 dark:border-surface-700">
                        <input id="bw-name" type="text" placeholder="Название тренировки" value="${template.name || ''}"
                               class="w-full px-4 py-3 text-sm border border-surface-200 dark:border-surface-700 rounded-2xl bg-surface-100 dark:bg-surface-800 mb-4 font-medium">
                        
                        <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-none" id="bw-groups-container">
                            <!-- Pills will be rendered here -->
                        </div>
                        
                        <div class="flex items-center gap-2 mt-2">
                            <input id="bw-search" type="text" placeholder="Поиск упражнения..."
                                   class="flex-1 px-4 py-3 text-sm border border-surface-200 dark:border-surface-700 rounded-2xl bg-surface-100 dark:bg-surface-800">
                            <button id="bw-add-own" type="button" title="Добавить своё упражнение"
                                    class="w-12 h-12 flex items-center justify-center border border-surface-200 dark:border-surface-700 rounded-2xl text-surface-500 hover:text-surface-900 bg-surface-100 dark:bg-surface-800 font-bold text-xl">+</button>
                        </div>
                    </div>

                    <div class="p-4 flex-1 overflow-y-auto">
                        <div class="text-xs font-semibold text-surface-400 mb-2 uppercase tracking-wider">Доступные упражнения</div>
                        <div id="bw-list" class="space-y-1.5"></div>
                    </div>

                    <div class="p-4 border-t border-surface-200 dark:border-surface-700 flex items-center justify-between gap-3">
                        <div id="bw-selected-count" class="text-xs text-surface-500 font-medium">Выбрано: 0</div>
                        <button id="bw-next"
                                class="px-6 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                            Далее
                        </button>
                    </div>
                </div>
            </div>
        `;

        app.elements.modals.innerHTML = buildHtml();
        const groupsContainer = document.getElementById('bw-groups-container');
        const searchEl = document.getElementById('bw-search');
        const listEl = document.getElementById('bw-list');
        const nextBtn = document.getElementById('bw-next');
        const ownBtn = document.getElementById('bw-add-own');

        const renderGroupOptions = () => {
            groupsContainer.innerHTML = '';
            const allBtn = document.createElement('button');
            allBtn.textContent = 'Все';
            allBtn.className = `px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${filterGroup === '' ? 'bg-primary-600 text-white' : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300'}`;
            allBtn.addEventListener('click', () => { filterGroup = ''; renderGroupOptions(); renderList(); });
            groupsContainer.appendChild(allBtn);

            Object.entries(meta.muscle_groups || {}).forEach(([slug, label]) => {
                const btn = document.createElement('button');
                btn.textContent = label;
                btn.className = `px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${filterGroup === slug ? 'bg-primary-600 text-white' : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300'}`;
                btn.addEventListener('click', () => { filterGroup = slug; renderGroupOptions(); renderList(); });
                groupsContainer.appendChild(btn);
            });
        };

        const updateCreateLabel = () => {
            if (nextBtn) nextBtn.disabled = selected.length === 0;
            const countEl = document.getElementById('bw-selected-count');
            if (countEl) countEl.textContent = `Выбрано: ${selected.length}`;
        };

        const renderList = () => {
            const rows = exercises.filter(ex => {
                const g = !filterGroup || ex.muscle_group === filterGroup;
                const s = !search || ex.name.toLowerCase().includes(search.toLowerCase());
                return g && s;
            });
            listEl.innerHTML = rows.map(ex => {
                const isSelected = selected.includes(ex.id);
                return `
                <label class="flex items-center gap-4 p-4 cursor-pointer rounded-2xl border transition-all ${isSelected ? 'bg-primary-50 border-primary-200 dark:bg-primary-900/20 dark:border-primary-800' : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700 hover:border-surface-300'}">
                    <input type="checkbox" data-id="${ex.id}" class="w-5 h-5 text-primary-600 rounded"
                           ${isSelected ? 'checked' : ''}>
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold text-sm ${isSelected ? 'text-primary-900 dark:text-primary-100' : 'text-surface-900 dark:text-surface-100'}">${ex.name}</div>
                        <div class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                            ${meta.muscle_groups?.[ex.muscle_group] || ex.muscle_group} · ${meta.equipment?.[ex.equipment] || ex.equipment}
                        </div>
                    </div>
                </label>`;
            }).join('') || '<div class="text-sm text-surface-400 text-center py-6">Ничего не найдено</div>';

            listEl.querySelectorAll('input[data-id]').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = parseInt(e.target.dataset.id);
                    if (e.target.checked) { selected.push(id); }
                    else { selected = selected.filter(i => i !== id); }
                    updateCreateLabel();
                    renderList();
                });
            });
        };

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

        nextBtn.addEventListener('click', () => {
            const selectedExercises = exercises.filter(ex => selected.includes(ex.id));
            const templateName = document.getElementById('bw-name')?.value.trim() || template.name || 'Мой шаблон';
            
            // Fix sorting: match original template exercise order
            selectedExercises.sort((a, b) => {
                const idxA = template.exercises.findIndex(te => te.name === a.name);
                const idxB = template.exercises.findIndex(te => te.name === b.name);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });

            this.renderConfigurationScreen(app, selectedExercises, async (configuredExercises) => {
                const saveBtn = document.getElementById('bw-save-final');
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.textContent = 'Сохраняем...';
                }
                const payload = {
                    name: templateName,
                    exercises: configuredExercises
                };
                try {
                    await API.patch(`/workouts/templates/${template.id}`, payload, token);
                    this.closeBuildModal();
                    await this.render(app.elements.pageContent, app);
                    app.showToast('Шаблон обновлен!', 'success');
                } catch (err) {
                    app.showToast(err.message || 'Ошибка обновления', 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.textContent = 'Сохранить';
                    }
                }
            }, template);
        });

        try {
            const [resMeta, resExercises] = await Promise.all([
                API.get('/workouts/exercises/meta', token),
                API.get('/workouts/exercises', token),
            ]);
            meta = resMeta;
            exercises = resExercises;
            selected = (template.exercises || []).map(te => {
                const found = exercises.find(ex => ex.name === te.name);
                return found ? found.id : null;
            }).filter(Boolean);
            renderGroupOptions();
            renderList();
            updateCreateLabel();
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
