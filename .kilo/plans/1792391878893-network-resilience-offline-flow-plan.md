# Implementation Plan: Strict Offline Guard & Upload Short-Circuit in Camera.js

## Goal
Fix the bug where offline photo uploads still trigger the loading overlay and network attempt even when `isOnline` is false. Ensure an absolute, early offline guard at the very beginning of `uploadBtn.click` in `static/js/camera.js`.

## Affected Boundaries & Changes
- **`static/js/camera.js`**:
  - At the very beginning of the upload button click handler (line 260+), *before* creating the loading overlay or calling `Utils.compressImage` (or immediately after image selection/compression check), verify offline status via both `navigator.onLine` and `window.App?.state?.isOnline`.
  - Condition: `const isOffline = (window.App?.state?.isOnline === false) || !navigator.onLine;`
  - If `isOffline`, immediately:
    1. Skip the loading overlay (or remove if created).
    2. Call `await this.queueOfflineMeal(compressedBlob || selectedFile, notes);`
    3. Show toast: `this.app.showToast('Сохранено локально. Отправим при появлении связи.', 'info');`
    4. Reset input, selectedFile, button state, and `return;`.

## Validation Plan
1. Test offline photo upload: verify it bypasses the loading spinner entirely, queues instantly into IndexedDB, shows the local save toast, and resets.
