# Implementation Plan: Correct Offline Logic & Instant Short-Circuit in Camera.js

## Goal
Fix offline photo upload logic in `static/js/camera.js`:
1. Correct the offline boolean condition from `&&` to `||`: `const isOffline = !window.App?.state?.isOnline || !navigator.onLine;` to correctly handle L3 mobile provider blocks and captive portals where `navigator.onLine` is falsely `true`.
2. Move the offline short-circuit check right after file selection (or inside the upload handler before any loading overlay is created). When `isOffline` is true:
   - Compress the image locally (~100 KB).
   - Save directly to IndexedDB via `this.queueOfflineMeal(compressedBlob, notes)`.
   - Show the toast: `"Сохранено локально. Отправим при появлении связи."`.
   - Reset inputs and **DO NOT show the "Определяем продукты..." AI loading overlay/timer**.

## Affected Boundaries & Changes
- **`static/js/camera.js`**:
  - In `uploadBtn.addEventListener('click', ...)`, determine `isOffline` using `||` before calling `showLoadingOverlay`.
  - If `isOffline`:
    - Compress image.
    - Call `await this.queueOfflineMeal(compressedBlob, notes)`.
    - Show info toast.
    - Reset form inputs and exit early.
  - If online: proceed with loading overlay and `API.post` with 8-second timeout.

## Validation Plan
1. Test offline photo upload under simulated L3 block (`isOnline = false`, `navigator.onLine = true`): verify it compresses, queues in IndexedDB instantly, shows toast, and never displays the AI loading timer/overlay.
