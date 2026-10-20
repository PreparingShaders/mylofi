# Implementation Plan: IndexedDB Data Loading Pipeline Optimization

## Goal
Optimize the local IndexedDB data loading and hydration pipeline for mobile web environments (specifically iOS Safari/WebKit) to ensure lightning-fast cold starts, eliminate synchronous sequential bottlenecks, and maximize responsiveness.

## Affected Boundaries & Optimizations
- **Parallel IndexedDB Hydration (`static/js/db.js`, `nutrition.js`, `workouts.js`)**:
  - Replace sequential `await` chains for independent stores (e.g. fetching user profile, meals, workouts, templates) with concurrent `Promise.all()` fetching.
- **Cache-First Non-Blocking Initial Shell (`static/js/app.js`, `nutrition.js`)**:
  - Render the UI shell and critical above-the-fold content immediately from IndexedDB cache on initial load.
  - Defer non-critical secondary data fetching and background sync queue processing to non-blocking post-paint microtasks or deferred tasks.
- **Transaction & Deserialization Optimization (`db.js`)**:
  - Keep IDB transactions concise and avoid heavy synchronous JSON parsing loops on the main thread during initial hydration.

## Validation Plan
1. Test cold start hydration speed with populated IndexedDB stores on mobile simulation.
2. Verify parallel execution of store queries via `Promise.all()`.
3. Confirm instant above-the-fold rendering without blocking main thread.
