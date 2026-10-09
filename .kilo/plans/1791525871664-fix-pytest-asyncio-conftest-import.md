# Plan: Test Suite Fixes, Admin Bottom Sheet Fixes, and Admin Panel Functional Expansion

## Goal
1. Fix test suite configuration and imports (`pytest.ini`, `tests/conftest.py`, `test_AI_model.py`) to achieve 100% passing tests with zero warnings.
2. Fix Admin User Modal z-index, pointer-events, background scroll locking, and close button clickability.
3. Expand admin functionality:
   - Premium management in user Bottom Sheet ("Grant 30 days", "Grant 7 days", "Revoke premium" extending from current time/expiry).
   - Display formatted subscription expiration (`premium_expires_at` or "Lifetime" / "None").
   - Expanded user metrics in Bottom Sheet (`last_seen_at`, total meals logged, completed workouts count, total AI requests count).
   - DB model (`User`), Schemas (`AdminUserDetail`, `AdminPremiumUpdate`), and Admin API endpoints (`PATCH /api/v1/admin/users/{user_id}/premium`).

---

## Part 1: Test Suite Audit & Fixes
- **`tests/conftest.py`**: Add `import pytest_asyncio`.
- **`pytest.ini`**: Add `asyncio_default_fixture_loop_scope = session` and `pythonpath = .`.
- **`test_AI_model.py`**: Move to `scripts/test_AI_model.py` to prevent pytest miscollection.

---

## Part 2: Admin Bottom Sheet Bug Fixes (`static/js/admin.js`)
- **Pointer Events & Z-Index**: Add `pointer-events-auto` to backdrop; set backdrop `z-50` and panel `z-[60]`.
- **Background Scroll Lock**: Add/remove `overflow-hidden` on `document.body` when modal opens/closes.
- **Close Button Clickability**: Expand tap target (`p-2.5`, `min-w-[44px] min-h-[44px]`) and ensure event binding.

---

## Part 3: Admin Functional Expansion (DB, API, Frontend)

### 1. Database Model (`User` in `app/models/__init__.py`)
- Ensure `last_seen_at: Mapped[Optional[datetime]]` (or track user activity).
- Ensure `total_ai_requests: Mapped[int]` (or compute/store total AI interactions).

### 2. Pydantic Schemas (`app/schemas/__init__.py`)
- **`AdminPremiumUpdate`**:
  ```python
  class AdminPremiumUpdate(BaseModel):
      action: str # "grant_7", "grant_30", "revoke", or explicit duration/datetime
      days: Optional[int] = None
  ```
- **`AdminUserDetail` / `AdminUserItem`**:
  Add fields:
  - `premium_expires_at: Optional[datetime]`
  - `last_seen_at: Optional[datetime]`
  - `total_meals_count: int = 0`
  - `completed_workouts_count: int = 0`
  - `total_ai_requests: int = 0`

### 3. Admin API Endpoints (`app/api/v1/admin.py`)
- **`PATCH /api/v1/admin/users/{user_id}/premium`**:
  - Handles granting premium (+7 or +30 days extending from current `max(now, existing_expiry)` or setting `is_premium=True`) or revoking (`is_premium=False`, `premium_expires_at=None`).
- Update `_build_user_detail` / `_build_user_item` to query and populate total meals count (`func.count(Meal.id)`), completed workouts count (`func.count(WorkoutSession.id)` where completed/finished), total AI requests, and `last_seen_at`.

### 4. Frontend UI (`static/js/admin.js`)
- **User Bottom Sheet**:
  - Display subscription status and exact expiration (`premium_expires_at` formatted or "Бессрочно" / "Нет").
  - Premium quick action buttons:
    - [Выдать на 7 дней]
    - [Выдать на 30 дней]
    - [Отозвать премиум]
  - Additional metrics display:
    - Last seen (`last_seen_at`)
    - Total meals logged
    - Completed workouts count
    - Total AI requests count

---

## Implementation Steps
1. Apply test suite fixes (`tests/conftest.py`, `pytest.ini`, move `test_AI_model.py`).
2. Fix UI z-index and clickability in `static/js/admin.js`.
3. Update `User` model, schemas, and admin API endpoints (`app/api/v1/admin.py`).
4. Update `static/js/admin.js` to render new metrics and premium management buttons.

## Validation Plan
- Run `pytest` to verify 100% test pass rate with zero warnings.
- Test admin API endpoints and UI interactions for premium management and expanded user metrics.
