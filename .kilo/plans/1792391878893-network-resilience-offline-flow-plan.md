# Implementation Plan: Prevent Offline Logout & Enforce Instant Camera Short-Circuit

## Goal
Resolve two critical offline PWA bugs:
1. **Prevent Unwanted Logout / Landing Page Redirect**: Ensure that when network requests or health checks fail (`isOnline === false`), users with existing access/refresh tokens in storage are never kicked out to the public landing page. Instead, they remain on their cached SPA view (Nutrition, Workouts, Profile).
2. **Instant Offline Photo Upload Short-Circuit (`camera.js`)**: Place the offline check (`!window.App?.state?.isOnline || !navigator.onLine`) at the absolute first line of both file selection (`change`) and submission (`click`) handlers. When offline, prevent default event handling, bypass any loading overlay or AI timer entirely, compress the image to ~100 KB, save directly to IndexedDB via `SyncEngine.queueOfflineMeal`, show the local save toast, reset the form, and return immediately.

## Affected Boundaries & Changes
- **Auth Guard & App Initialization (`static/js/app.js`)**:
  - In `init()` and online/resume revalidation handlers, check if a token exists. If validation fails due to a network error (`isNetworkError` / `isOffline`), do NOT clear tokens or redirect to landing. Preserve user session and show cached views.
- **Camera Upload Short-Circuit (`static/js/camera.js`)**:
  - At the start of the file input `change` listener and `uploadBtn` `click` listener:
    ```js
    const isOffline = !window.App?.state?.isOnline || !navigator.onLine;
    if (isOffline) {
        e.preventDefault();
        e.stopPropagation();
        // Compress and queue offline immediately without loading overlay
        ...
        return;
    }
    ```

## Validation Plan
1. Test offline navigation with backend stopped: verify user remains on cached SPA view without being redirected to landing.
2. Test offline photo upload: verify it never shows the "Определяем продукты..." loading overlay, compresses instantly, queues in IndexedDB, and displays the offline toast.
