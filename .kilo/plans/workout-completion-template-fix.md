# Fix Workout Completion - Set Doubling & History Sync + Offline History Display

## Problem 1: Set Count Doubling (3 → 6)
When saving a free-form workout as a template, `target_sets` becomes 6 instead of 3.

**Root Cause**: `syncSessionFromDOM()` queries `document.querySelectorAll('[data-set-id]')` across the ENTIRE document. This picks up:
- Duplicate set rows from carousel + list views
- Cached/hidden exercise cards in modals or other views
- Same sets rendered in multiple tab panels

The function also doesn't deduplicate by `setId`.

## Problem 2: History Sync Broken for Local Sessions
Completed free-form (local) workouts don't appear in history until they sync with server.

**Root Cause**: `completeLocalSession()` saves to `offline_local_session` key. But `recoverCompletedSessions()` only scans `completed_session_*` keys. Completed local sessions never upload to server, so never appear in `/workouts/history`.

## Problem 3: History Doesn't Show Offline Workouts Immediately
When user completes workout offline, it saves locally but history screen only shows server data. User sees empty history until sync completes.

---

## Affected Files
- `static/js/workouts.js` - `syncSessionFromDOM`, `completeLocalSession`, `recoverCompletedSessions`, `renderHistory`, `renderHistoryList`
- `static/js/app.js` - `handleCompleteWorkout` (operation order fix)

---

## Fix Plan

### Fix 1: Scope `syncSessionFromDOM` to Workout Container & Deduplicate
**File**: `static/js/workouts.js`, function `syncSessionFromDOM` (line 1075)

```javascript
syncSessionFromDOM(container) {
    if (!this.currentSession) return;
    
    // Default to the workout screen container if not provided
    const root = container || document.getElementById('carousel') || document.querySelector('.workout-carousel') || document;
    
    // Get exercise cards ONLY from the workout container
    const exerciseCards = root.querySelectorAll('[data-exercise-id]');
    const newExercises = [];
    const seenSetIds = new Set();
    
    exerciseCards.forEach(card => {
        const exId = card.dataset.exerciseId;
        const nameEl = card.querySelector('[data-exercise-name]') || card.querySelector('h3, h4');
        const name = nameEl?.textContent?.trim() || '';
        
        const setRows = card.querySelectorAll('[data-set-id]');
        const sets = [];
        
        setRows.forEach(row => {
            const setId = parseInt(row.dataset.setId, 10);
            if (isNaN(setId)) return;
            
            // Deduplicate: skip if we've already processed this setId
            if (seenSetIds.has(setId)) return;
            seenSetIds.add(setId);
            
            const weightInput = row.querySelector('[data-field="weight"]');
            const repsInput = row.querySelector('[data-field="reps"]');
            const durationInput = row.querySelector('[data-field="duration"]');
            const distanceInput = row.querySelector('[data-field="distance"]');
            const toggleBtn = row.querySelector('[data-action="toggle-set"]');
            
            const weight_kg = weightInput ? parseFloat(weightInput.value) : null;
            const reps = repsInput ? parseInt(repsInput.value, 10) : null;
            const duration = durationInput ? parseInt(durationInput.value, 10) : null;
            const distance = distanceInput ? parseFloat(distanceInput.value) : null;
            const is_completed = toggleBtn?.dataset.completed === 'true';
            
            sets.push({ id: setId, weight_kg, reps, duration, distance, is_completed });
        });
        
        if (sets.length > 0) {
            const existingEx = this.currentSession.exercises?.find(e => String(e.id) === String(exId));
            newExercises.push({
                id: existingEx?.id || exId,
                name: existingEx?.name || name,
                order: existingEx?.order || newExercises.length,
                notes: existingEx?.notes,
                sets,
                exercise_type: existingEx?.exercise_type || 'weight_reps',
            });
        }
    });
    
    if (newExercises.length > 0) {
        this.currentSession.exercises = newExercises;
    }
    
    // Persist to localStorage
    try {
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(this.currentSession));
        const sessionId = this.currentSession.isLocal ? this.currentSession.key : String(this.currentSession.id);
        if (sessionId) {
            localStorage.setItem(`session_${sessionId}`, JSON.stringify(this.currentSession));
        }
    } catch (error) {
        console.error('[Workouts] Failed to persist synced session:', error);
    }
}
```

### Fix 2: Update Callers to Pass Container
**File**: `static/js/app.js`, `handleCompleteWorkout` (line 2317)
```javascript
const workoutContainer = document.getElementById('carousel') || document.querySelector('.workout-carousel');
Workouts.syncSessionFromDOM(workoutContainer);
```

**File**: `static/js/workouts.js`, `promptTemplateUpdateIfNeeded` (line 2826)
```javascript
if (!session.isLocal) {
    const workoutContainer = document.getElementById('carousel') || document.querySelector('.workout-carousel');
    this.syncSessionFromDOM(workoutContainer);
}
```

**File**: `static/js/workouts.js`, `completeWorkoutWithAi` (line 2908)
```javascript
const workoutContainer = document.getElementById('carousel') || document.querySelector('.workout-carousel');
this.syncSessionFromDOM(workoutContainer);
```

### Fix 3: Fix `completeLocalSession` to Persist for Recovery
**File**: `static/js/workouts.js`, function `completeLocalSession` (line 1141)

```javascript
completeLocalSession(app) {
    const session = this.getActiveLocalSession();
    if (!session) return false;
    
    // Mirror the DOM into the local session before enqueueing the completion
    // request, so offline completions carry the real tonnage.
    if (this.currentSession && this.currentSession.key === session.key) {
        session.exercises = this.currentSession.exercises;
    }
    
    // Validate: free-form workout must have at least one exercise
    if (!session.exercises || session.exercises.length === 0) {
        app?.showToast('Добавьте хотя бы одно упражнение перед завершением', 'error');
        return false;
    }
    
    const token = app?.state?.tokens?.access || null;
    session.status = 'completed';
    session.completed_at = new Date().toISOString();
    session.duration_seconds = this.getElapsedSeconds(session);
    
    // Save as active session (for immediate UI)
    this.saveLocalSession(session);
    
    // ALSO persist as completed session for recovery/sync to server
    this.persistCompletedSessionLocally(session.key, session);
    
    API.enqueueRequest(
        'POST',
        `/workouts/sessions/${LOCAL_SESSION_PLACEHOLDER}/complete`,
        { duration_seconds: session.duration_seconds },
        token,
        { offlineSessionKey: session.key }
    );
    app?.showToast(OFFLINE_COMPLETE_MESSAGE, 'info');
    return true;
},
```

### Fix 4: Update `recoverCompletedSessions` to Also Check `offline_local_session`
**File**: `static/js/workouts.js`, function `recoverCompletedSessions` (line 742)

```javascript
recoverCompletedSessions(app) {
    try {
        // Check completed_session_* keys
        const keys = Object.keys(localStorage).filter(k => k.startsWith('completed_session_'));
        keys.forEach(async key => {
            const sessionId = key.replace('completed_session_', '');
            const session = JSON.parse(localStorage.getItem(key));
            if (session && session.status === 'completed') {
                await this.trySyncCompletedSession(app, sessionId, session, key);
            }
        });
        
        // ALSO check offline_local_session for completed local sessions
        const localSessionRaw = localStorage.getItem(LOCAL_SESSION_KEY);
        if (localSessionRaw) {
            const localSession = JSON.parse(localSessionRaw);
            if (localSession && localSession.status === 'completed' && localSession.key) {
                await this.trySyncCompletedSession(app, localSession.key, localSession, LOCAL_SESSION_KEY);
            }
        }
    } catch (err) {
        console.warn('[Workouts] Failed to recover completed sessions:', err);
    }
},

// Helper to avoid duplication
async trySyncCompletedSession(app, sessionId, session, storageKey) {
    const token = app?.state?.tokens?.access;
    if (token && navigator.onLine) {
        try {
            await API.post(`/workouts/sessions/${sessionId}/sync-completed`, session, token);
            localStorage.removeItem(storageKey);
            Workouts.forgetLocallyClosedSession(sessionId);
        } catch (err) {
            console.log('[Workouts] Will retry sync later:', err);
        }
    }
},
```

### Fix 5: Apply Operation Order Fix
**File**: `static/js/app.js`, `handleCompleteWorkout` (lines 2288-2295)

```javascript
// Save session reference BEFORE clearing state
const sessionToComplete = Workouts.currentSession;

// Мгновенный сброс активной сессии — плашка «Активная тренировка»
// должна исчезнуть сразу после клика, не дожидаясь ответа сервера.
Workouts.markSessionClosedLocally(sessionId);

// Prompt for template update BEFORE clearing session state
await Workouts.promptTemplateUpdateIfNeeded(this, sessionToComplete);

Workouts.clearActiveSessionState(this);
```

### Fix 6: Update History Rendering to Include Local Sessions
**File**: `static/js/workouts.js`, function `renderHistory` (line 4863)

Modify `renderHistory` to merge local completed sessions with server data:

```javascript
async renderHistory(container, app, { limit = 20, append = false } = {}) {
    this.app = app;
    this.stopWorkoutTimer();

    const historyState = this.historyState || { limit: limit, total: 0, sessions: [] };
    if (!append) historyState.limit = limit;
    this.historyState = historyState;

    let data;
    try {
        data = await API.get(`/workouts/history?limit=${historyState.limit}`, app.state.tokens.access);
    } catch (error) {
        console.error('[Workouts] History load error:', error);
        if (!append) container.innerHTML = Components.errorState('Ошибка загрузки истории');
        else this.renderHistoryList(container, app, historyState, true);
        return;
    }

    if (!data) {
        container.innerHTML = Components.errorState('Данные истории недоступны');
        return;
    }

    // Get local completed sessions that haven't synced yet
    const localSessions = this.getLocalCompletedSessions();
    
    // Merge server sessions with local sessions (local first, newest first)
    const serverSessions = (data?.sessions || []).slice();
    const allSessions = [...localSessions, ...serverSessions]
        .sort((a, b) => new Date(b.completed_at || b.started_at) - new Date(a.completed_at || a.started_at));
    
    historyState.sessions = allSessions;
    historyState.total = data?.total + localSessions.length;
    historyState.hasLocalSessions = localSessions.length > 0;

    this.renderHistoryList(container, app, historyState, false);
},

// New helper: Get locally completed sessions from localStorage
getLocalCompletedSessions() {
    const sessions = [];
    try {
        // Check completed_session_* keys
        const keys = Object.keys(localStorage).filter(k => k.startsWith('completed_session_'));
        keys.forEach(key => {
            const session = JSON.parse(localStorage.getItem(key));
            if (session && session.status === 'completed') {
                session._localOnly = true;  // Mark as local-only for UI
                sessions.push(session);
            }
        });
        
        // Check offline_local_session
        const localSessionRaw = localStorage.getItem(LOCAL_SESSION_KEY);
        if (localSessionRaw) {
            const localSession = JSON.parse(localSessionRaw);
            if (localSession && localSession.status === 'completed') {
                localSession._localOnly = true;
                sessions.push(localSession);
            }
        }
    } catch (err) {
        console.warn('[Workouts] Failed to read local completed sessions:', err);
    }
    return sessions;
},
```

### Fix 7: Update `renderHistoryList` to Show Sync Badge
**File**: `static/js/workouts.js`, function `renderHistoryList` (line 4894)

Add sync status badge for local-only sessions:

```javascript
renderHistoryList(container, app, historyState, failed) {
    const sessions = historyState.sessions || [];
    const hasMore = sessions.length < (historyState.total || 0);
    this.recentSessions = sessions.filter(s => s.status === 'completed');

    const groups = new Map();
    sessions.forEach(session => {
        const stamp = new Date(session.completed_at || session.started_at);
        const label = isNaN(stamp.getTime())
            ? 'Без даты'
            : stamp.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(session);
    });

    const statusLabel = (status, isLocalOnly) => {
        if (isLocalOnly) return 'Ожидает синхронизации';
        return status === 'completed' ? 'Завершена' : status === 'cancelled' ? 'Отменена' : 'Активна';
    };

    const groupBlocks = [...groups.entries()].map(([label, items]) => `
        <div class="mb-5">
            <h3 class="text-xs font-semibold text-surface-500 uppercase tracking-wider mb-2">${this.escapeHtml(label)}</h3>
            <div class="space-y-2">
                ${items.map(session => {
                    const metrics = this.getWorkoutMetrics(session);
                    const stamp = new Date(session.completed_at || session.started_at);
                    const isLocalOnly = session._localOnly === true;
                    const analyzable = (session.status === 'completed' || !session.status)
                        && metrics.completed > 0
                        && !isNaN(parseInt(session.id))
                        && !isLocalOnly;  // Don't offer AI analysis for local-only sessions
                    return `
                        <div class="glass rounded-2xl p-4 cursor-pointer btn-press" data-action="open-history-session" data-session-id="${session.id}">
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2">
                                        <h4 class="font-semibold text-sm truncate" title="${this.escapeHtml(session.name || 'Тренировка')}">${this.escapeHtml(session.name || 'Тренировка')}</h4>
                                        ${isLocalOnly ? `
                                            <span class="flex-shrink-0 px-2 py-0.5 text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full border border-amber-300 dark:border-amber-700">
                                                Ожидает синхронизации
                                            </span>
                                        ` : ''}
                                    </div>
                                    <p class="text-xs text-surface-500 dark:text-surface-400 mt-1">
                                        ${isNaN(stamp.getTime()) ? '—' : `${Utils.formatDate(stamp.toISOString())} · ${Utils.formatTime(stamp.toISOString())}`}
                                    </p>
                                </div>
                                <div class="text-right flex-shrink-0">
                                    <p class="text-sm font-bold text-primary-600 dark:text-primary-400">${Math.round(metrics.tonnage)} кг</p>
                                    <p class="text-[11px] text-surface-400">${metrics.completed}/${metrics.total} подх.</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-2 mt-2 text-[11px] text-surface-400">
                                <span>${Utils.formatDuration(session.duration_seconds || 0)}</span>
                                <span>·</span>
                                <span>${(session.exercises || []).length} упр.</span>
                                <span>·</span>
                                <span>${statusLabel(session.status, isLocalOnly)}</span>
                                ${analyzable ? `<button type="button" data-action="history-analyze-ai" data-session-id="${session.id}"
                                        class="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold ${session.has_ai_analysis ? 'bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-300' : 'bg-surface-100 dark:bg-white/5 text-surface-500 dark:text-surface-400'}">
                                        <span class="badge">✦ ИИ</span>
                                        <span>${session.has_ai_analysis ? 'Пересчитать' : 'Разобрать'}</span>
                                    </button>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');

    const html = `
        <div class="p-4">
            <div class="flex items-center mb-4">
                <button data-action="back-to-workouts" class="mr-3 text-surface-500 hover:text-surface-900">←</button>
                <h2 class="text-xl font-bold">История тренировок</h2>
            </div>

            ${failed
                ? '<div class="text-xs text-amber-600 dark:text-amber-400 mb-3">Не удалось обновить список, показаны ранее загруженные данные</div>'
                : ''}

            ${historyState.hasLocalSessions ? `
                <div class="text-xs text-amber-600 dark:text-amber-400 mb-3 flex items-center gap-1">
                    <span>⏳</span>
                    <span>Некоторые тренировки ожидают синхронизации с сервером</span>
                </div>
            ` : ''}

            ${sessions.length === 0
                ? `<div class="text-center py-8 text-surface-400">Ещё нет тренировок. Начните первую!</div>`
                : `${groupBlocks}
                    ${hasMore ? '<button type="button" data-action="history-load-more" class="w-full py-2.5 glass rounded-xl text-sm font-semibold">Показать ещё</button>' : ''}`}
        </div>
    `;

    container.innerHTML = html;

    // ... rest of event listeners unchanged
}
```

---

## Testing Requirements

After implementing all fixes, run the test suite:

```bash
cd /Users/vojtivit/Desktop/python_test/mylofy/mylofi
python -m pytest tests/ -v
```

Expected: All tests pass.

---

## Testing Checklist

| Scenario | Expected |
|----------|----------|
| Free-form workout: add exercise with 3 sets, complete, save as template | Template has `target_sets: 3` |
| Free-form workout: add 2 exercises with 3 sets each, complete | Both exercises have 3 sets in template |
| Free-form workout: complete offline, then come online | Session syncs to server, appears in history |
| Server workout: complete with network error | Persists locally, syncs when online, appears in history |
| Multiple rapid completions | No duplicate sets, no duplicate history entries |
| Workout with 0 exercises completed | Shows validation error, doesn't create template |
| **NEW**: Complete free-form workout offline, open History tab | Workout appears immediately with "Ожидает синхронизации" badge |
| **NEW**: Come online after offline completion | Badge disappears, session syncs to server |
| **NEW**: History shows mixed server + local sessions | All sessions visible, sorted by date |

---

## Rollback Plan
1. Revert `syncSessionFromDOM` to previous implementation
2. Revert `completeLocalSession` to not call `persistCompletedSessionLocally`
3. Revert `recoverCompletedSessions` to not check `LOCAL_SESSION_KEY`
4. Revert `handleCompleteWorkout` operation order
5. Revert `renderHistory` and `renderHistoryList` to original versions

---

## Out of Scope
- Background sync service worker for automatic retry
- Conflict resolution for simultaneous edits
- Exercise type-specific set handling (cardio/static)