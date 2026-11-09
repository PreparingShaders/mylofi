# History Tab Redesign - Implementation Plan

## Goal
Redesign the "History" tab in the Workouts section with:
1. **Summary Panel** - Key metrics (total workouts, total tonnage, avg duration) at the top
2. **Filters & Search** - Search by name/exercise, filter by period (Week/Month/All), workout type
3. **Enhanced Cards** - Show exercise preview with weights, better date grouping, keep sync badges & AI buttons

## Current State Analysis

### Files Involved
- `static/js/workouts.js` - `renderHistory()` (line 4939), `renderHistoryList()` (line 5006), `getWorkoutMetrics()` (line 3769)
- `static/css/styles.css` - Custom styles (Tailwind used for most styling)
- Backend: `app/services/workout.py` - `get_workout_history()` (line 452)

### Current History Data Structure
```javascript
// From renderHistory - session object includes:
{
  id: number,
  name: string,
  started_at: string,
  completed_at: string,
  duration_seconds: number,
  exercises: [
    { name: string, order: number, sets: [
      { weight_kg: number, reps: number, is_completed: boolean }
    ]}
  ],
  status: 'completed' | 'cancelled' | 'active',
  _localOnly: boolean,  // for offline sessions
  has_ai_analysis: boolean
}
```

### Current API Endpoint
`GET /workouts/history?limit=20` returns `{ sessions: [...], total: number }`

---

## Implementation Plan

### Phase 1: Backend - Add History Stats Endpoint
**File**: `app/services/workout.py` - Add new function
**File**: `app/api/v1/routes.py` - Add new endpoint

```python
# New function in workout.py
async def get_workout_history_stats(db: AsyncSession, user_id: int, period: str = 'all') -> dict:
    """Get aggregate statistics for history period."""
    # period: 'week', 'month', 'all'
    # Returns: { total_workouts, total_tonnage, total_duration_seconds, avg_duration_seconds, total_sets, completed_sets }
```

```python
# New endpoint in routes.py
@router.get("/workouts/history/stats")
async def get_history_stats(
    period: str = Query("all", regex="^(week|month|all)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    stats = await get_workout_history_stats(db, current_user.id, period)
    return stats
```

### Phase 2: Frontend - Summary Panel Component
**File**: `static/js/workouts.js` - Add new method `renderHistorySummary()`

```javascript
// Add to Workouts object
async renderHistorySummary(container, app, period = 'all') {
    // Fetch stats from new endpoint
    // Render compact cards: Total Workouts | Total Tonnage | Avg Duration | Total Sets
    // Include period selector tabs (Week/Month/All)
}
```

### Phase 3: Frontend - Filters & Search Bar
**File**: `static/js/workouts.js` - Modify `renderHistory()` and `renderHistoryList()`

Add above the history list:
- Search input with debounce (filter by session name, exercise names)
- Period filter (Week/Month/All) - triggers stats refresh and list refilter
- Workout type filter (All/Strength/Cardio/Mixed) - future extensibility

### Phase 4: Frontend - Enhanced History Cards
**File**: `static/js/workouts.js` - Modify `renderHistoryList()`

Changes to card template (lines 5030-5072):
1. **Exercise Preview**: Show top 3 exercises with their main metric (e.g., "Bench Press 80kg×8, 85kg×6, 90kg×4" or just "Bench Press: 3 sets, 240kg")
2. **Date Grouping**: Keep current month grouping but add week separators within months
3. **Sync Badges**: Keep existing `_localOnly` badge logic
4. **AI Button**: Keep existing logic

### Phase 5: Styling Updates
**File**: `static/css/styles.css` - Add custom styles if needed

Most styling can use Tailwind utilities. Add custom CSS only for:
- Summary panel card hover effects
- Search input focus states
- Exercise preview truncation with tooltip

---

## Data Flow

```
User opens History tab
    │
    ├─► renderHistory() called
    │       │
    │       ├─► Fetch /workouts/history?limit=20
    │       ├─► Fetch /workouts/history/stats?period=all
    │       ├─► Merge local sessions
    │       └─► Render:
    │               ├─► Summary Panel (from stats endpoint)
    │               ├─► Search/Filter Bar
    │               └─► History List (renderHistoryList)
    │
    ├─► User changes period filter
    │       └─► Refetch stats + re-filter list
    │
    ├─► User types in search
    │       └─► Client-side filter (debounced 300ms)
    │
    └─► User clicks "Load More"
            └─► Append more sessions from API
```

---

## API Contract

### GET /workouts/history/stats
**Query Params**: `period` (week|month|all, default: all)
**Response**:
```json
{
  "total_workouts": 42,
  "total_tonnage_kg": 125000,
  "total_duration_seconds": 360000,
  "avg_duration_seconds": 8571,
  "total_sets": 1260,
  "completed_sets": 1180
}
```

---

## Testing Checklist

| Scenario | Expected |
|----------|----------|
| Open History tab | Summary panel loads with stats, list renders |
| Change period to "Week" | Stats update, list filters to last 7 days |
| Change period to "Month" | Stats update, list filters to last 30 days |
| Search by workout name | List filters in real-time |
| Search by exercise name | List filters in real-time |
| Card shows exercise preview | Top 3 exercises with weights visible |
| Local session badge shows | "Ожидает синхронизации" badge visible |
| AI analyze button works | Opens AI analysis for eligible sessions |
| Load more button | Appends older sessions |
| Dark mode | All elements readable |

---

## Rollback Plan
1. Remove new stats endpoint from routes.py
2. Remove get_workout_history_stats from workout.py
3. Revert renderHistory and renderHistoryList to original
4. Remove summary panel and filter bar HTML

---

## Out of Scope
- Advanced charts/graphs (tonnage trends over time)
- Export history to CSV/PDF
- Workout comparison view
- Custom date range picker (beyond week/month/all)