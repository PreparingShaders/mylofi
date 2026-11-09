# Fix Workout Completion - Set Doubling & History Sync + Offline History Display + Sync 422 Fix

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

## Problem 4: 422 Error on Offline Sync Endpoint
When `trySyncCompletedSession` calls `POST /workouts/sessions/sync-offline`, the backend returns 422 (Unprocessable Entity).

**Root Cause**: The frontend sends the raw local session object which includes extra fields not in the `OfflineSessionSyncRequest` schema:
- `key`, `isLocal`, `status`, `pendingPatches`, `remoteSessionId`, `setIdMap` - not in schema
- Sets have `id`, `exercise_id` - not in `WorkoutSetCreate` schema
- Exercises have `id`, `exercise_type` - not in `WorkoutSessionExerciseCreate` schema
- Some sets may have `reps: null` if user left input empty (but `reps` is required in backend)

## Problem 5: Sets Not Auto-Completing When Weight/Reps Filled
When user fills weight and reps but forgets to press the checkbox, the set is not marked as completed. On workout completion, these sets may be skipped or not counted.

**Root Cause**: `syncSessionFromDOM` only reads `is_completed` from the checkbox state (`toggleBtn?.dataset.completed === 'true'`). It doesn't infer completion from filled inputs.

## Problem 7: Temp Set IDs Cause 404 Errors in Multiple Network Request Points
When a server workout has optimistically added exercises (with temp IDs like `temp-set-...` or negative IDs like `-100001`), multiple code paths send PATCH/POST requests to `/workouts/sets/{tempId}` which returns 404. The error handler treats this as a network failure, showing "Сеть недоступна".

**Root Cause**: Several places in workouts.js and app.js send set updates to the server without checking if the set ID is a real server ID vs a temporary/local ID.

## Problem 8: Default 3 Sets Per Exercise - Poor UX for Free-form Workouts
When adding a new exercise (especially in free-form workouts), it creates 3 empty sets by default. User has to fill all 3 or delete extras.

**Desired UX**: 
- Default to **1 set** per new exercise
- When user clicks "+ Add Set", the new set should **copy weight and reps from the previous set** (already partially implemented but needs refinement)

---

---

## Affected Files
- `static/js/workouts.js` - `syncSessionFromDOM`, `completeLocalSession`, `recoverCompletedSessions`, `renderHistory`, `renderHistoryList`, `trySyncCompletedSession`
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

### Fix 8: Transform Session Data for Sync-Offline Endpoint (NEW)
**File**: `static/js/workouts.js`, function `trySyncCompletedSession` (line 768)

The backend `OfflineSessionSyncRequest` schema expects only specific fields. The raw local session has extra fields that cause 422 validation errors. Transform the session before sending:

```javascript
// Helper to transform local session to match OfflineSessionSyncRequest schema
buildOfflineSyncPayload(session) {
    // Only include fields defined in the backend schema
    const payload = {
        name: session.name || 'Свободная тренировка',
        template_id: session.template_id || null,
        notes: session.notes || null,
        started_at: session.started_at,
        completed_at: session.completed_at,
        duration_seconds: session.duration_seconds || 0,
        exercises: (session.exercises || []).map(ex => ({
            name: ex.name,
            order: ex.order || 0,
            notes: ex.notes || null,
            sets: (ex.sets || []).map(set => ({
                set_number: set.set_number,
                weight_kg: set.weight_kg ?? null,
                reps: set.reps ?? 10,  // reps is REQUIRED in backend (ge=1), default to 10 if missing
                rpe: set.rpe ?? null,
                is_completed: set.is_completed ?? false,
                rest_seconds: set.rest_seconds ?? null,
                rest_time_seconds: set.rest_time_seconds ?? null,
            })).filter(set => set.set_number > 0) // Ensure valid set numbers
        })).filter(ex => ex.sets.length > 0) // Only include exercises with valid sets
    };
    
    return payload;
},

// Updated trySyncCompletedSession
async trySyncCompletedSession(app, sessionId, session, storageKey) {
    const token = app?.state?.tokens?.access;
    if (token && navigator.onLine) {
        try {
            // Transform session to match backend schema
            const syncPayload = this.buildOfflineSyncPayload(session);
            
            // Use the sync-offline endpoint that accepts full session data
            const response = await API.post(`/workouts/sessions/sync-offline`, syncPayload, token);
            localStorage.removeItem(storageKey);
            Workouts.forgetLocallyClosedSession(sessionId);
            // Dispatch event so any pending patches in queue get remapped via resolveQueuedItem
            window.dispatchEvent(new CustomEvent('mylofi:local-session-synced', {
                detail: { sessionId: response.id },
            }));
        } catch (err) {
            console.log('[Workouts] Will retry sync later:', err);
        }
    }
},
```

Also update the `recoverCompletedSessions` helper to use the transformed payload:

```javascript
// Helper to avoid duplication
async trySyncCompletedSession(app, sessionId, session, storageKey) {
    const token = app?.state?.tokens?.access;
    if (token && navigator.onLine) {
        try {
            // Transform session to match backend schema
            const syncPayload = this.buildOfflineSyncPayload(session);
            
            await API.post(`/workouts/sessions/sync-offline`, syncPayload, token);
            localStorage.removeItem(storageKey);
            Workouts.forgetLocallyClosedSession(sessionId);
        } catch (err) {
            console.log('[Workouts] Will retry sync later:', err);
        }
    }
},
```

---

### Fix 10: Skip Temp Set IDs in flushPendingSetEdits
**File**: `static/js/app.js`, function `flushPendingSetEdits` (line 2407)

Add a helper to Workouts to check if a set ID is a real server ID, and use it in flushPendingSetEdits:

**Step 1: Add helper to Workouts (static/js/workouts.js, around line 1015)**

```javascript
// Check if a set ID is a real server-assigned ID (positive integer)
isRealSetId(setId) {
    return typeof setId === 'number' && setId > 0 && Number.isInteger(setId);
},
```

**Step 2: Update flushPendingSetEdits (static/js/app.js, line 2407)**

```javascript
async flushPendingSetEdits() {
    const session = Workouts.currentSession;
    if (!session) return;
    const failed = [];
    await this.ensureFreshToken();
    const promises = [];
    for (const ex of (session.exercises || [])) {
        for (const set of (ex.sets || [])) {
            const setId = set.id;
            if (setId == null) continue;
            
            // Skip temporary/local set IDs (negative numbers, temp-* strings)
            // to avoid 404 errors that trigger false offline detection
            if (!Workouts.isRealSetId(setId)) {
                console.log('[flushPendingSetEdits] Skipping temp set ID:', setId);
                continue;
            }
            
            const payload = {};
            if (set.weight_kg != null && !isNaN(set.weight_kg)) payload.weight_kg = set.weight_kg;
            if (set.reps != null && !isNaN(set.reps)) payload.reps = set.reps;
            if (set.is_completed) payload.is_completed = true;
            
            if (Object.keys(payload).length <= 1 && !payload.is_completed) continue;
            
            console.log('[flushPendingSetEdits] Flushing set', setId, payload);
            promises.push(
                API.patch(`/workouts/sets/${setId}`, payload, this.state.tokens.access).catch(err => {
                    console.error(`[flushPendingSetEdits] Failed to flush set ${setId}:`, err?.message || err);
                    failed.push(setId);
                })
            );
        }
    }
    await Promise.all(promises);
    if (failed.length) {
        console.warn('[flushPendingSetEdits] Sets that failed to persist:', failed);
    }
},
```

### Fix 11: Extend Temp ID Network Blocking to All Set Request Points
**File**: `static/js/workouts.js` - Multiple locations

Apply `isRealSetId` check to ALL network requests that use set IDs. The following locations need updates:

**1. Line 1850 - Rest timer PATCH:**
```javascript
// Before sending rest_time_seconds PATCH
if (Workouts.isRealSetId(setId)) {
    API.patch(`/workouts/sets/${setId}`, { rest_time_seconds: elapsed }, token).catch(() => {});
}
```

**2. Line 2306 - Auto-complete next set PATCH:**
```javascript
// Before sending PATCH for next set
if (Workouts.isRealSetId(nextSetId)) {
    API.patch(`/workouts/sets/${nextSetId}`, patch, token).catch(() => {});
}
```

**3. Line 2358 - Drum picker value PATCH:**
```javascript
// Before sending PATCH for field update
if (Workouts.isRealSetId(setId)) {
    await API.patch(`/workouts/sets/${setId}`, { [field]: value }, token);
}
```

**4. Line 2519 - Set completion PATCH:**
```javascript
// Before sending PATCH for set completion
if (Workouts.isRealSetId(setId)) {
    await API.patch(`/workouts/sets/${setId}`, payload, token);
}
```

**5. Line 2554 - Clear rest time PATCH:**
```javascript
// Before sending PATCH to clear rest_time_seconds
if (Workouts.isRealSetId(savedSetId)) {
    API.patch(`/workouts/sets/${savedSetId}`, { rest_time_seconds: null }, token).catch(() => {});
}
```

**6. Line 4504 - Add set POST (already has isLocal check, but add explicit check):**
```javascript
// Already handles isLocal, but add safety check
if (!isLocal && !Workouts.isRealSetId(exercise.id)) {
    // Skip if exercise itself has temp ID
    return;
}
```

**7. Line 4599 - Delete set:**
```javascript
// Before sending DELETE
if (Workouts.isRealSetId(removedSet.id)) {
    API.delete(`/workouts/sets/${removedSet.id}`, token)
}
```

**8. Line 4896 - AI plan badge update PATCH:**
```javascript
// Before sending PATCH
if (Workouts.isRealSetId(setId)) {
    await API.patch(`/workouts/sets/${setId}`, patch, app.state.tokens.access).catch(() => {});
}
```

**9. Line 1088 - Pending patches replay (already uses setIdMap, should be OK but verify):**
```javascript
// This one uses realSetId from setIdMap, which should already be real IDs
// But add safety check:
if (realSetId && Workouts.isRealSetId(realSetId)) {
    await API.enqueueRequest('PATCH', `/workouts/sets/${realSetId}`, patch, token, { prepend: true });
}
```

### Fix 12: New UX - Default 1 Set Per Exercise, Copy Previous on Add
**File**: `static/js/workouts.js` - Multiple locations

**1. Line 943 - buildLocalSessionFromTemplate (template-based sessions):**
```javascript
// Change default from 3 to 1
const targetSets = Math.max(1, ex.target_sets || 1);  // was: || 3
```

**2. Line 2960 - Workout session exercise target_sets default:**
```javascript
target_sets: ex.sets?.length ?? 1,  // was: ?? 3
```

**3. Line 3235 - Template exercise display (keep as-is for template view):**
```javascript
// Keep this as-is for template editing
```

**4. Line 3487 - renderWorkoutScreen targetSets default:**
```javascript
const targetSets = Math.max(1, ex.target_sets || 1);  // was: || 3
```

**5. Line 3492 - Same as above**

**6. Line 5932 - Template modal default sets input (keep as 3 for template creation):**
```javascript
// Keep as 3 for template creation - templates are meant to have multiple sets
```

**7. Line 5983 - Template creation payload (keep as user input):**
```javascript
// Keep as user input
```

**8. Line 6424 - Template creation default sets (keep as 3 for templates):**
```javascript
// Keep as 3 for template creation
```

**9. Line 6538 - Optimistic exercise add for server sessions (CHANGE THIS):**
```javascript
sets: Array.from({ length: 1 }, (_, i) => ({  // was: ex.target_sets || 3
    id: `temp-set-${Date.now()}-${i}`,
    exercise_id: `temp-${Date.now()}`,
    set_number: i + 1,
    weight_kg: 0,
    reps: 10,
    rest_seconds: 90,
    is_completed: false,
})),
```

**10. Line 6570 - Same location, default to 1 set instead of 3**

**11. Lines 4484-4485 - Add set button (already copies from previous, but refine):**
```javascript
// Current logic already copies from lastSet, but ensure it works for both local and server
const lastSet = (exercise.sets || [])[(exercise.sets || []).length - 1] || { set_number: 0, weight_kg: null, reps: 10, rest_seconds: 90 };
const newSet = {
    id: isLocal ? TEMP_SET_ID_BASE - Math.floor(Math.random() * 999999) : null,
    exercise_id: exercise.id,
    set_number: (lastSet.set_number || 0) + 1,
    // Copy weight if previous set had weight > 0, otherwise null
    weight_kg: (lastSet.weight_kg !== null && lastSet.weight_kg > 0) ? lastSet.weight_kg : null,
    // Copy reps if previous set had reps > 0, otherwise default to 10
    reps: (lastSet.reps !== null && lastSet.reps > 0) ? lastSet.reps : 10,
    rest_seconds: lastSet.rest_seconds || 90,
    is_completed: false,
};
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
| **NEW**: Sync-offline endpoint returns 201 (not 422) | Session created on server, local storage cleared |
| **NEW**: User fills weight/reps but forgets checkbox | Set auto-completes, appears in history |
| **NEW**: Server workout with optimistically added exercises | No 404 errors on temp set IDs during flush |
| **NEW**: Add new exercise in free-form workout | Creates 1 set by default (not 3) |
| **NEW**: Click "+ Add Set" on filled set | New set copies weight/reps from previous |
| **NEW**: Multiple network request points with temp IDs | No 404 errors anywhere in console |

---

## Rollback Plan
1. Revert `syncSessionFromDOM` to previous implementation
2. Revert `completeLocalSession` to not call `persistCompletedSessionLocally`
3. Revert `recoverCompletedSessions` to not check `LOCAL_SESSION_KEY`
4. Revert `handleCompleteWorkout` operation order
5. Revert `renderHistory` and `renderHistoryList` to original versions
6. Revert `trySyncCompletedSession` to send raw session object
7. Revert auto-complete logic in `syncSessionFromDOM`
8. Revert `isRealSetId` helper and `flushPendingSetEdits` temp ID check
9. Revert temp ID checks in all 9 network request points
10. Revert default set count from 1 to 3 in local sessions
11. Revert add-set copy logic to previous version

---

## Out of Scope
- Background sync service worker for automatic retry
- Conflict resolution for simultaneous edits
- Exercise type-specific set handling (cardio/static)