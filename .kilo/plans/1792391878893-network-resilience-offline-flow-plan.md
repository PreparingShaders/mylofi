# Implementation Plan: Fix AI Workout Preview Generation & Delivery

## Problem Summary
The "Start with AI" flow fails because:
1. **Wrong model order**: Heavy models (`gemini-3.5-flash-lite`, `gemini-3.6-flash` - 20s timeout each) are tried before fast model (`gemini-3.1-flash-lite` - 4-7s)
2. **Frontend polling too short**: `AI_PREVIEW_STORE_WAIT_SECONDS=15s` vs background task `WORKOUT_AI_TASK_TIMEOUT=60s`
3. **No push delivery**: Background task stores plan in DB but client must poll; no WebSocket notification

## Affected Boundaries & Changes

### 1. Backend: Model Cascade Reorder (`app/services/ai_vision.py`)
- **File**: `app/services/ai_vision.py` lines 94-105
- **Change**: Reorder `UNIFIED_MODEL_CASCADE` to put fast/stable models first:
  ```python
  UNIFIED_MODEL_CASCADE = [
      "gemini-3.1-flash-lite",        # Fast, stable - FIRST
      "gemini-3.1-flash-lite-preview", # Backup fast
      "gemini-2.5-flash-lite",         # Fast fallback
      "gemini-2.5-flash",              # Reliable
      "gemini-3.5-flash-lite",         # Heavy - moved down
      "gemini-3.6-flash",              # Heavy - moved down
      "qwen/qwen3.8-27b:free",
      "dots-studio/dots-3-note-preview:free",
      "nvidia/nemotron-3.5-content-safety:free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  ]
  ```
- **Rationale**: Fast models succeed in 4-7s; heavy models timeout at 20s each. Current order wastes ~40s on timeouts before reaching fast model.

### 2. Backend: Timeout Alignment (`app/services/ai_workout_service.py`)
- **File**: `app/services/ai_workout_service.py` line 72
- **Change**: Increase `AI_PREVIEW_STORE_WAIT_SECONDS` from 15s to 45s (or match `WORKOUT_AI_TASK_TIMEOUT - 10s` buffer)
  ```python
  AI_PREVIEW_STORE_WAIT_SECONDS = 45.0  # Was 15.0
  ```
- **File**: `app/services/ai_workout_service.py` line 72
- **Optional**: Increase `WORKOUT_AI_TASK_TIMEOUT` to 90s for safety margin with cascade
  ```python
  WORKOUT_AI_TASK_TIMEOUT = 90.0  # Was 60.0
  ```

### 3. Backend: WebSocket Push Notification (`app/ws/manager.py`, `ai_workout_service.py`)
- **File**: `app/services/ai_workout_service.py` in `build_workout_preview_and_store` (after line 1186 commit)
- **Change**: After storing successful plan, push via WebSocket:
  ```python
  # After session.ai_plan_status = AI_PLAN_STATUS_AVAILABLE and commit
  try:
      from app.ws.manager import manager
      await manager.send_personal_message(
          WSMessage(type=WSMessageType.WORKOUT_PLAN_READY, payload={
              "session_id": session_id,
              "plan": payload
          }),
          session.user_id
      )
  except Exception as e:
      logger.warning(f"[AI Workout Preview] WebSocket push failed: {e}")
  ```
- **File**: `app/ws/manager.py` - Add `WORKOUT_PLAN_READY` to `WSMessageType` enum in schemas
- **File**: `app/schemas/__init__.py` - Add `WORKOUT_PLAN_READY` to `WSMessageType` enum

### 4. Frontend: WebSocket Listener (`static/js/workouts.js`, `static/js/app.js`)
- **File**: `static/js/workouts.js` - In `startTemplateWithAi` after rendering workout screen
- **Change**: Listen for `WORKOUT_PLAN_READY` WebSocket message and update UI reactively:
  ```javascript
  // In startTemplateWithAi, after renderWorkoutScreen
  const wsHandler = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'workout_plan_ready' && data.payload?.session_id === sessionId) {
          this.aiPlan = { ...data.payload.plan, sessionId };
          this.updateAiPlanBadges(container);
          ws.removeEventListener('message', wsHandler);
      }
  };
  ws.addEventListener('message', wsHandler);
  ```
- **Fallback**: Keep existing `loadAiPlan` polling as backup if WebSocket fails

### 5. Frontend: Extended Polling Timeout (`static/js/workouts.js`)
- **File**: `static/js/workouts.js` - `loadAiPlan` function
- **Change**: The `API.postImmediate` call to `/ai/workout-preview` already has the wait logic server-side via `wait_for_stored_ai_plan`. With increased `AI_PREVIEW_STORE_WAIT_SECONDS=45s`, the HTTP request will wait longer before returning.

## Data Flow (After Fix)

### Scenario: User clicks "Старт с ИИ"
1. Frontend calls `POST /workouts/templates/{id}/start?with_ai_plan=true`
2. Backend creates session, returns immediately, queues `build_workout_preview_and_store` background task
3. Frontend renders workout screen instantly (no loading wait)
4. Background task runs:
   - Tries `gemini-3.1-flash-lite` first → succeeds in ~5s
   - Stores plan in DB (`ai_plan_json`, `ai_plan_status=available`)
   - **Pushes via WebSocket** `WORKOUT_PLAN_READY` to user
5. Frontend receives WebSocket message → updates AI badges reactively
6. **Fallback**: If WebSocket missed, `loadAiPlan` polls `/ai/workout-preview` which waits up to 45s for stored plan

## Failure Modes & Mitigations
- **WebSocket not connected**: Polling fallback handles it (existing `loadAiPlan`)
- **All models fail**: Background task marks `ai_plan_status=failed`, UI shows "plan unavailable" toast
- **Model timeout**: Cascade continues to next model (existing behavior)
- **Background task crashes**: `try/catch` in `_use_session` marks failed, logs error

## Validation Plan
1. **Model order test**: Start workout with AI → verify plan arrives in ~5-10s (not 40s+)
2. **WebSocket delivery**: Open DevTools Network → WS → verify `WORKOUT_PLAN_READY` message received
3. **UI reactivity**: AI badges appear on workout screen without refresh
4. **Fallback polling**: Disconnect WebSocket, start workout → plan still loads via HTTP poll
5. **Timeout edge case**: Simulate slow model → verify cascade tries next model
6. **History persistence**: Complete workout → verify AI plan saved in session history

## Implementation Order
1. Reorder `UNIFIED_MODEL_CASCADE` in `ai_vision.py` (highest impact, lowest risk)
2. Increase `AI_PREVIEW_STORE_WAIT_SECONDS` in `ai_workout_service.py`
3. Add `WORKOUT_PLAN_READY` to `WSMessageType` enum in schemas
4. Add WebSocket push in `build_workout_preview_and_store`
5. Add WebSocket listener in `startTemplateWithAi` (frontend)
6. Test end-to-end

## Open Questions
- Should we also add a visual indicator (spinner/badge) on the workout screen while AI plan is generating?
- Do we want to persist the WebSocket connection across screen locks/backgrounding? (Current `realtime` connection in `app.js` may already handle this)