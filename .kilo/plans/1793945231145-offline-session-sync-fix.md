# Offline Session Synchronization Fix Plan

## Problem Analysis

The frontend creates local workout sessions with IDs like `local-1793943910796` (stored in localStorage). When the user completes a workout offline, the session data is persisted locally. When connectivity returns, `SyncEngine` / `Workouts.trySyncCompletedSession` attempts to POST to:
```
POST /api/v1/workouts/sessions/local-1793943910796/sync-completed
```

**No such endpoint exists on the backend.** The backend routes expect integer session IDs (`session_id: int`), so the request fails with 404.

## Solution Design

### Backend Changes (FastAPI)

1. **Add new schema** for offline session sync payload in `app/schemas/__init__.py`:
   - `OfflineSessionSyncRequest` - accepts full session data (name, started_at, completed_at, duration_seconds, exercises with sets)

2. **Add new service function** in `app/services/workout.py`:
   - `sync_offline_session(db, user_id, session_data)` - creates a new WorkoutSession with exercises/sets from the provided data

3. **Add new endpoint** in `app/api/v1/routes.py`:
   - `POST /workouts/sessions/sync-offline` - accepts offline session data, creates server-side session, returns created session ID

### Frontend Changes (static/js/workouts.js)

1. **Update `trySyncCompletedSession`** (line ~768) to call the new endpoint:
   - Send full session data to `/workouts/sessions/sync-offline`
   - On success, remove localStorage entry and mark as synced

2. **Update `completeLocalSession`** (line ~1166) to ensure session data includes all required fields for sync

3. **Handle response** - map the returned server session ID for any pending patches

## Implementation Details

### Backend Schema
```python
class OfflineSessionSyncRequest(BaseModel):
    """Full session data from an offline-completed workout."""
    name: str = Field(max_length=255)
    started_at: datetime
    completed_at: datetime
    duration_seconds: int = Field(ge=0)
    exercises: List[WorkoutSessionExerciseCreate] = []
    template_id: Optional[int] = None
    notes: Optional[str] = None
```

### Backend Service
```python
async def sync_offline_session(
    db: AsyncSession,
    user_id: int,
    session_data: OfflineSessionSyncRequest,
) -> WorkoutSession:
    """Create a server session from offline-completed workout data."""
    session = WorkoutSession(
        user_id=user_id,
        template_id=session_data.template_id,
        name=session_data.name,
        notes=session_data.notes,
        started_at=session_data.started_at,
        completed_at=session_data.completed_at,
        status=WorkoutSessionStatus.COMPLETED,
        duration_seconds=session_data.duration_seconds,
    )
    db.add(session)
    await db.flush()
    
    for ex_data in session_data.exercises:
        exercise = WorkoutSessionExercise(
            session_id=session.id,
            name=ex_data.name,
            order=ex_data.order,
            notes=ex_data.notes,
        )
        db.add(exercise)
        await db.flush()
        
        for set_data in ex_data.sets:
            workout_set = WorkoutSet(
                exercise_id=exercise.id,
                set_number=set_data.set_number,
                weight_kg=set_data.weight_kg,
                reps=set_data.reps,
                rpe=set_data.rpe,
                is_completed=set_data.is_completed,
                rest_seconds=set_data.rest_seconds,
                rest_time_seconds=set_data.rest_time_seconds,
            )
            db.add(workout_set)
    
    await db.commit()
    return await get_workout_session(db, session.id, user_id)
```

### Backend Endpoint
```python
@router.post(
    "/workouts/sessions/sync-offline",
    response_model=WorkoutSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def sync_offline_session_endpoint(
    session_data: OfflineSessionSyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sync a workout session completed offline."""
    session = await sync_offline_session(db, current_user.id, session_data)
    return session
```

### Frontend Sync Call
```javascript
// In trySyncCompletedSession (workouts.js:768)
await API.post(`/workouts/sessions/sync-offline`, session, token);
```

## Files to Modify

1. **app/schemas/__init__.py** - Add `OfflineSessionSyncRequest` schema
2. **app/services/workout.py** - Add `sync_offline_session` function
3. **app/api/v1/routes.py** - Add `/workouts/sessions/sync-offline` endpoint
4. **static/js/workouts.js** - Update `trySyncCompletedSession` to use new endpoint

## Testing Strategy

1. Run existing tests: `pytest tests/ -v`
2. Verify no regressions in workout session creation/completion
3. Test offline flow manually:
   - Start workout offline
   - Complete workout offline
   - Go online
   - Verify session appears in history with correct data

## Edge Cases

- Session with no exercises (should be rejected or create empty session)
- Duplicate sync attempts (idempotency - can check by started_at + user_id)
- Very old offline sessions (TTL handling)
- Sessions with AI plan data (preserve ai_plan_json if present)

## Rollout

- Deploy backend changes first (new endpoint is additive)
- Deploy frontend changes
- Monitor for 404 errors on sync-completed endpoint (should disappear)