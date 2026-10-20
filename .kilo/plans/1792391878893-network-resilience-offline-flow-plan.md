# Implementation Plan: "Golden Middle" Network State Architecture (WebSocket Heartbeat & Cache-First PWA)

## Goal
Implement a robust, battery-friendly, instant-loading network state management architecture in MyLofi:
1. Establish WebSocket (`RealtimeSocket` ping/pong heartbeat state machine) as the single source of truth for online/offline presence and the red network banner UI.
2. Streamline offline/online state transitions (Scenario A: Offline fallback & IndexedDB queue; Scenario B: Online reconnection & queue flushing via `SyncEngine`).
3. Guarantee instant cache-first page rendering (non-blocking render from IndexedDB cache on initial view load) while token validation and sync run in the background.

## Affected Boundaries & Architecture Changes
- **WebSocket Heartbeat & Source of Truth (`static/js/api.js` / `RealtimeSocket`)**:
  - Implement periodic ping/pong or connection status monitoring (`onopen`, `onclose`, `onerror`, pong timeout).
  - When connection is active and healthy: set `App.state.isOnline = true`, hide the red network banner.
  - When connection drops, errors (`net::ERR_CONNECTION_REFUSED`), or pong times out: set `App.state.isOnline = false`, show the red network banner immediately (`"Офлайн-режим: данные сохранятся локально"`).
- **Execution Scenarios**:
  - **Scenario A (Transition to OFFLINE)**: Show banner immediately, route mutations to IndexedDB (`SyncEngine`), render views strictly from local cache without blocking or timing out.
  - **Scenario B (Transition to ONLINE / WS Reconnect)**: Hide banner, automatically trigger `SyncEngine.processQueue()` to flush offline mutations, and listen for real-time push events (`meal_update`).
- **Instant Cache-First Initial Render (`static/js/app.js`, `nutrition.js`)**:
  - Render cached data immediately from IndexedDB/localStorage upon initialization.
  - Defer network token validation and sync queue flushing to non-blocking background promises, eliminating full-screen loading spinners on launch.

## Validation Plan
1. Test initial load with backend stopped: verify instant cache-first render without blocking spinners.
2. Test active WebSocket disconnect/reconnect: verify immediate offline banner toggle and automatic queue flush upon reconnection.
3. Test offline photo upload and mutation queuing under active WS offline state.
