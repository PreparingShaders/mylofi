# Plan: Offline Mode Audit, PWA Infrastructure, and Live Workout Resilience

## Goal
Conduct a comprehensive audit and implementation plan for the **Offline Mode (PWA / Service Worker / Offline Storage)** across the application, with primary focus on robust **Active Workout Logging (Live Workout Logging)**, offline nutrition logging, caching strategies, and automatic background/online synchronization via `SyncEngine` and `IndexedDB`.

---

## Part 1: Priority #1 — Active Workout Logging (Live Workout Resilience)

1. **Offline Pre-caching & Catalog Access**:
   - Verify Service Worker (`sw.js`) caches exercise catalog endpoints (`/api/v1/workouts/exercises`, `/meta`) using Stale-While-Revalidate (`CATALOG_CACHE`).
   - Ensure workout templates and recent weights history are stored locally in IndexedDB (`templates`, `workouts`, `PRs`) so users can start and conduct a workout in complete isolation (e.g., basement gym).
2. **Instant State Persistence (`localStorage` & `IndexedDB`)**:
   - On every set completion, weight/rep entry, or timer tick during an active workout session in `workouts.js`, instantly snapshot the active workout state to `localStorage` (e.g., `active_workout_session_state`) and/or IndexedDB.
3. **Crash & Reload Resilience**:
   - On page load / app initialization (`app.js` / `workouts.js`), check for an active unsaved workout state in local storage. If found, automatically restore the active workout screen with exact sets, completed status, and timers.
4. **Offline Completion & Mutation Outbox**:
   - When the user clicks "Finish Workout" offline, save the finalized workout record locally to IndexedDB (`workouts` store with `sync_status = 'pending'`) and enqueue a mutation in `sync_queue` (`POST /api/v1/workouts/sessions` or update).
   - Assign a temporary ID (`temp_...`) so subsequent actions or UI render gracefully without waiting for network ACK.

---

## Part 2: Nutrition & Profile Offline Support

1. **Caching Nutrition & Profile Data**:
   - Cache recent daily nutrition summaries, macro targets (`/api/v1/nutrition/daily`, `/api/v1/profile`), and user profiles via Runtime Cache (`RUNTIME_CACHE`) and IndexedDB (`meals` store).
2. **Offline Meal Logging & Photo Drafts**:
   - Support offline text/manual meal creation and photo draft queuing (`pendingPhotos` / `sync_queue`), ensuring photos and metadata are safely stored in IndexedDB and automatically replayed via `SyncEngine` upon reconnect.

---

## Part 3: Service Worker, PWA Shell & Sync Infrastructure

1. **App Shell & Static Cache (`sw.js`)**:
   - Ensure `SHELL_CACHE`precaches all essential UI assets (`/`, `/static/index.html`, CSS, JS modules, icons) with Cache-First strategy.
   - Fallback to offline HTML shell (`OFFLINE_FALLBACK_HTML`) when navigating offline without network.
2. **Automatic Synchronization (`SyncEngine`)**:
   - Listen to `online` events and Service Worker `sync` events (`mylofi-sync`).
   - Replay pending queue items (`sync_queue`), handling temporary ID resolution (`resolveTempId`) and retry limits (`MAX_RETRIES`).
3. **UI Offline Banner / Indicator**:
   - Display a non-intrusive banner or status dot in the header whenever `navigator.onLine` is false or when there are pending items in the sync outbox ("Офлайн-режим — данные сохраняются локально").

---

## Implementation Steps

1. **Verify & Enhance `sw.js`**:
   - Ensure robust caching of catalog endpoints and API GET requests.
2. **Active Workout State Persistence (`workouts.js`)**:
   - Implement real-time state autosave on every set checkbox/input change to `localStorage` / IndexedDB.
   - Implement auto-recovery on startup if an active workout session was interrupted.
3. **Offline Mutation Outbox Integration (`workouts.js`, `nutrition.js`, `sync.js`)**:
   - Ensure completed workouts and meals create valid `sync_queue` entries with temporary IDs and robust replay handling.
4. **UI Network Status Banner (`app.js`, `components.js`)**:
   - Add reactive offline banner observing `navigator.onLine` and pending sync count.

## Validation Plan
- Test offline mode via browser DevTools (Network -> Offline):
  - Verify app shell loads instantly.
  - Verify starting a workout, logging sets, and refreshing the page successfully restores the active workout.
  - Verify finishing a workout offline queues the mutation, and reconnecting automatically flushes the queue to FastAPI backend.
- Verify nutrition logging offline and subsequent sync.
