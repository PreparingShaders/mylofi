# Architectural Audit: WebSocket vs. REST in MyLofi (FastAPI + Vanilla PWA)

## 1. Executive Summary & Context
MyLofi is an offline-first Progressive Web App (PWA) built with a FastAPI backend and a vanilla JavaScript frontend. Mobile PWA environments (especially iOS Safari and mobile browsers behind L3 network filters) present unique challenges: intermittent connectivity, background tab suspension, and battery drain constraints. 

This audit evaluates where persistent real-time transport (WebSockets) provides genuine user experience (UX) and architectural benefits versus where stateless HTTP/REST requests and local IndexedDB queuing (`SyncEngine`) must remain.

---

## 2. Current Architecture Overview
- **Backend (`FastAPI`, SQLAlchemy Async)**: Handles REST endpoints (`/api/v1/...`), background AI vision tasks (`ai_vision.py`), workout generation (`ai_workout_service.py`), and a nascent WebSocket manager (`app/ws/manager.py`).
- **Frontend PWA (`Vanilla JS`)**: Structured around single-page views (`nutrition.js`, `workouts.js`, `profile.js`), with robust offline mutation queuing (`SyncEngine` + IndexedDB) and read caching (`localStorage`).
- **Polling Pattern**: Currently, photo analysis uses an 800ms HTTP poll loop (`pollMealAnalysisStatus`) to check if background AI processing has completed.

---

## 3. Where WebSockets Make Sense (and Why)

### A. Asynchronous Background AI Analysis Completion (Push Notifications)
- **Current Problem**: When a user uploads a food photo, the client polls `GET /nutrition/meals/{id}` every 800ms for up to 45 seconds to detect when the AI vision pipeline (`completed` or `failed`) finishes.
- **WebSocket Solution**: 
  - Utilize the existing `ConnectionManager` (`app/ws/manager.py`) to push a `MEAL_UPDATE` message directly to the client when background processing completes.
- **Benefits**:
  - Eliminates redundant HTTP polling requests while the user is actively waiting.
  - Instantly transitions the UI from "Analyzing..." to the completed card without unnecessary network overhead.

### B. Proactive Connection Status & Heartbeat
- **WebSocket Solution**: A lightweight ping/pong heartbeat over the WebSocket connection.
- **Benefits**:
  - Provides sub-second detection of server reachability, helping distinguish between an active network link and an L3 mobile blockade / server outage much faster than standard TCP timeouts.

---

## 4. Where REST (HTTP + IndexedDB) Must Remain

### A. Mutations & Offline Queuing (`SyncEngine`)
- **Justification**:
  - Mutations (`POST`, `PUT`, `PATCH`, `DELETE`) like logging a meal, saving workout sets, or updating profile targets must work **completely offline**.
  - IndexedDB (`SyncEngine`) stores mutations locally and replays them via REST when connectivity returns. WebSockets are inherently stateful and ephemeral—queuing binary payloads or complex mutations over raw WebSockets offline is fragile and over-engineered compared to robust HTTP request replay.

### B. Binary File Uploads (Food Photos ~100 KB)
- **Justification**:
  - Multipart form-data file uploads are standard HTTP operations. Transporting binary image blobs over WebSockets requires custom framing, chunking, and acknowledgement protocols, duplicating built-in HTTP multipart capabilities.

### C. Initial Page Loads & Read Queries (Cached Reads)
- **Justification**:
  - SPA readouts (`GET` requests for nutrition logs, summaries, workout templates) leverage browser HTTP caching, service worker caching, and local Read Caches (`localStorage`/IndexedDB). REST allows instant rendering from cache while offline, whereas WebSockets require an active, live connection to query data.

---

## 5. Architectural Recommendation Matrix

| Feature / Flow | Recommended Transport | Architectural Justification |
| :--- | :--- | :--- |
| **Photo Uploads & Binary Data** | **REST (HTTP POST)** | Multipart form support, native offline queuing via IndexedDB (`SyncEngine`), retry logic. |
| **Offline Mutations (Workouts/Meals)** | **REST (HTTP / IndexedDB)** | Idempotent HTTP verbs + persistent IndexedDB queue guarantee no data loss during cellular drops. |
| **Initial Page Loads & Dashboard Reads** | **REST + Local Cache** | Instant offline rendering from cached read responses; no dependency on active socket. |
| **AI Analysis Completion Notification** | **WebSocket (Augmented by Polling Fallback)** | Pushes completion status instantly to eliminate polling loops; falls back gracefully to poll/check if socket is disconnected. |
| **Live Connection Heartbeat** | **WebSocket / Health Ping** | Fast detection of L3 blocks and network dropouts. |

---

## 6. Implementation Roadmap
1. **Phase 1 (Stabilize REST & Offline Resilience)**: (Completed in current offline hardening cycle) IndexedDB queuing, AbortController timeouts, and instant offline short-circuits.
2. **Phase 2 (Optional WebSocket Enhancement)**: Integrate WebSocket connection lifecycle in `API.createWebSocket()` for active dashboard sessions to receive real-time AI completion push events, keeping REST as the primary fallback for mutations and reads.
