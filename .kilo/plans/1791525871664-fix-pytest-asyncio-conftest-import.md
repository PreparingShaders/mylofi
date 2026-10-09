# Plan: Test Suite Fixes and Admin Bottom Sheet (User Modal) Z-Index & Clickability Fix

## Goal
1. Fix test suite configuration and imports (`pytest.ini`, `tests/conftest.py`, `test_AI_model.py`) to achieve 100% passing tests with zero warnings.
2. Fix the Admin User Modal (Bottom Sheet) z-index, pointer-events, background scroll locking, and close button clickability in `static/js/admin.js`.

---

## Part 1: Test Suite Audit & Fixes

1. **`tests/conftest.py`**:
   - Add `import pytest_asyncio` at the top of the file to fix `NameError: name 'pytest_asyncio' is not defined`.
2. **`pytest.ini`**:
   - Add `asyncio_default_fixture_loop_scope = session` and `pythonpath = .` to eliminate deprecation warnings and ensure proper module resolution.
3. **`test_AI_model.py`**:
   - Relocate from root directory (`test_AI_model.py`) to `scripts/test_AI_model.py` so pytest does not miscollect helper functions as test cases.

---

## Part 2: Admin User Modal (Bottom Sheet) Fixes (`static/js/admin.js`)

1. **Pointer Events & Z-Index Hierarchy**:
   - Since modals are mounted inside `#modals` (which has `pointer-events-none`), add `pointer-events-auto` to the modal `backdrop`.
   - Ensure clear z-index separation: backdrop at `z-50`, panel at `z-[60]` (or ensure panel sits cleanly above backdrop and catches touches/clicks).
2. **Background Scroll Lock**:
   - When `showUserModal()` opens, add `document.body.classList.add('overflow-hidden')`.
   - When `closeUserModal()` runs, remove `document.body.classList.remove('overflow-hidden')`.
3. **Close Button (`×`) Tap Area & Clickability**:
   - Expand the close button tap target (e.g., add `p-2.5` or `min-w-[44px] min-h-[44px]`, or ensure it has proper flex alignment and `pointer-events-auto`).
   - Ensure event listeners for closing (`data-action="close-user-modal"`) correctly intercept clicks/touches without propagating to the background.

---

## Implementation Steps

1. Update `pytest.ini` with asyncio loop scope and pythonpath.
2. Update `tests/conftest.py` with `import pytest_asyncio`.
3. Move `test_AI_model.py` to `scripts/test_AI_model.py`.
4. Update `static/js/admin.js` in `showUserModal` and `closeUserModal`:
   - Add `pointer-events-auto` to backdrop.
   - Adjust z-index of panel (`z-[60]`) relative to backdrop (`z-50`).
   - Add/remove `overflow-hidden` on `document.body`.
   - Improve close button size and touch target (`p-2.5`, `min-w-[44px] min-h-[44px]`).

## Validation Plan
- Run `pytest` via `.venv\Scripts\pytest.exe` to verify all tests pass with zero warnings.
- Manually test the Admin User Modal in browser:
  - Verify background scrolling is locked when modal is open.
  - Verify clicks outside the sheet (on backdrop) close the modal.
  - Verify buttons and close button (`×`) inside the bottom sheet respond immediately to taps/clicks.
