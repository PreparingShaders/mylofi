# Plan: Test Suite Audit and Fixes for 100% Passing & Zero Warnings

## Goal
Conduct a complete audit of the test suite configuration and test files, resolve all test failures, deprecation warnings, and miscollected diagnostic scripts, ensuring `pytest` runs cleanly with 100% PASSED and no warnings.

## Audit Findings & Analysis

1. **`tests/conftest.py`**:
   - **Issue**: Missing `import pytest_asyncio` causing `NameError: name 'pytest_asyncio' is not defined` on `@pytest_asyncio.fixture`.
   - **Fix**: Add `import pytest_asyncio` to the top of `tests/conftest.py`.

2. **`pytest.ini`**:
   - **Issue**: Missing explicit asyncio default fixture loop scope and pythonpath settings, causing `PytestDeprecationWarning` regarding event loop scope and module path resolution.
   - **Fix**: Update `pytest.ini` to include:
     ```ini
     [pytest]
     asyncio_mode = auto
     asyncio_default_fixture_loop_scope = session
     pythonpath = .
     ```

3. **`test_AI_model.py` (Root Directory)**:
   - **Issue**: Named `test_AI_model.py` at the root, which causes Pytest to collect helper functions (such as `test_model`) as actual test functions, leading to `TypeError` (missing required arguments).
   - **Fix**: Move `test_AI_model.py` out of root test discovery (e.g., to `scripts/test_AI_model.py` or `tools/test_AI_model.py`) or exclude it in `pytest.ini` (`norecursedirs` or `python_files`).

4. **`test_ai_workout_rules.py`**:
   - **Analysis**: Pure unit tests with mocks for AI workout rules, weekly limits (`can_run_workout_ai`), and exercise catalog mapping. Relies on correct async fixture configuration and event loop scope. No code changes needed in test logic once `pytest_asyncio` and `pytest.ini` are correctly configured.

## Implementation Steps

1. **Update `pytest.ini`**:
   - Add `asyncio_default_fixture_loop_scope = session` and `pythonpath = .`.
   - Add test file discovery filters or ignore rules if needed.

2. **Update `tests/conftest.py`**:
   - Insert `import pytest_asyncio` right below `import pytest`.

3. **Relocate Diagnostic Script (`test_AI_model.py`)**:
   - Move `C:\PyProj\mylofi\test_AI_model.py` to `C:\PyProj\mylofi\scripts\test_AI_model.py` so pytest does not collect it as a test module.

## Validation Plan
- Run python `-m pytest -v` using the virtual environment interpreter (`.venv\Scripts\pytest.exe`).
- Verify zero failures, zero errors, and zero deprecation warnings.
- Confirm all unit and E2E tests pass (including `test_ai_workout_rules.py`, `test_auth.py`, `tests/e2e/test_auth_and_navigation.py`, etc.).
