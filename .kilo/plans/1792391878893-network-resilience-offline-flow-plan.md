# Implementation Plan: Graceful Auth Expiry, Sync Loop Prevention, & UI Error Refinement

## Goal
1. Fix handling of expired/invalid authentication tokens (401/403) to prevent background sync spam and safely redirect to the login screen.
2. Refine the Sync Errors UI: exclude technical/auth endpoints from the error UI, provide user-friendly labels for actionable errors, and auto-purge system-level errors.

## Affected Boundaries & Changes
- **Token Refresh & API Error Interception (`static/js/api.js`)**:
  - Catch auth failure (401/403), abort background sync (`SyncEngine`), clear stale tokens, and redirect to the login landing screen.
- **App Resume & Cold Start Validation (`static/js/app.js`)**:
  - Validate tokens *before* flushing sync queue. If invalid, reset auth state and render landing.
- **Sync Engine Halt & UI Refinement (`static/js/sync.js`, UI components)**:
  - Halt `SyncEngine` on persistent auth errors.
  - **Endpoint Filtering**: In `SyncEngine.enqueue` or the UI error mapper, filter out infrastructure endpoints (`/auth/refresh`, `/auth/login`, `/health`, token validation) so they never appear in the "Sync Errors" UI.
  - **Friendly Error Mapping**: Map technical endpoints to user-friendly labels (e.g., `/nutrition/photos` -> "Фото еды").
  - **Auto-Purge**: Automatically discard/hide system-level errors in the sync error modal.

## Validation Plan
1. Test expired refresh token behavior.
2. Verify sync error UI excludes infrastructure routes.
3. Test user-friendly labels for actionable sync items.
4. Confirm auto-purge functionality for system-level sync errors.
