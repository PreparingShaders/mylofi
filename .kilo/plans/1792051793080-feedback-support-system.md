# Plan: Feedback & Support System Implementation

## Overview
Implement a comprehensive Feedback and Support module enabling authenticated users and anonymous guests to submit support tickets or PRO requests with screenshots, viewable and manageable in the Admin Panel with quick PRO grant capabilities. Ensure reliable modal opening/closing and robust `submitFeedback` execution across both the landing screen and authenticated screens.

---

## Architecture & Components

### 1. Data Model & Database Migration
- **Model `Feedback`** (`app/models/__init__.py`):
  - `id`: `Integer`, Primary Key
  - `user_id`: `Integer`, Foreign Key (`users.id`, ondelete="SET NULL"), nullable=True
  - `email`: `String(255)`, nullable=False
  - `category`: `String(50)`, nullable=False (e.g. `'pro_request'`, `'bug'`, `'question'`)
  - `message`: `Text`, nullable=False
  - `images`: `Text`, nullable=True (JSON-encoded list of image storage paths)
  - `status`: `String(50)`, default=`'new'` (choices: `'new'`, `'resolved'`)
  - `created_at`: `DateTime(timezone=True)`, default=UTC now
  - Relationship to `User`.
- **Alembic Migration**:
  - Generate and apply migration: `alembic revision --autogenerate -m "add feedback model"`.

### 2. Backend API Endpoints (FastAPI)
- **Optional Auth Dependency**:
  - `get_optional_current_user`: Returns `User` if valid Bearer token provided, otherwise `None`.
- **User / Guest API (`POST /api/v1/feedback`)**:
  - Accepts `multipart/form-data`:
    - `category`: `str` (Form)
    - `message`: `str` (Form)
    - `email`: `Optional[str]` (Form; required if guest, auto-filled from `current_user` if authenticated)
    - `images`: `List[UploadFile]` (File, max 3 files)
  - Validates image count (max 3), file types (`image/*`), file sizes.
  - If guest, ensures valid non-empty `email` is provided (returns 400 if missing/invalid).
  - Saves images to `uploads/feedback/` using `save_uploaded_photo`.
  - Commits feedback record to database.
- **Admin API (`app/api/v1/admin.py`)**:
  - `GET /api/v1/admin/feedback`:
    - Requires admin role (`get_current_admin_user`).
    - Query parameters: `page`, `page_size`, `status`, `category`.
  - `PATCH /api/v1/admin/feedback/{feedback_id}`:
    - Requires admin role.
    - Updates status and/or grants PRO subscription to the user.

### 3. Schemas (`app/schemas/`)
- `FeedbackCreate`, `FeedbackResponse`, `AdminFeedbackItem`, `AdminFeedbackListResponse`, `AdminFeedbackUpdate`.

### 4. Frontend UI, Modals & `submitFeedback` Fixes (`static/`)
- **Robust `submitFeedback` implementation (`profile.js`)**:
  - Safe state access: `state?.user` or fallback for guests without throwing `Cannot read properties of null (reading 'state')`.
  - Form data collection: category, message, email (from input if guest or session if logged in), and attached images (`state.selectedImages`).
  - On successful API response: show toast ("Сообщение успешно отправлено!"), reset form fields & image previews, and close modal.
- **DOM & Markup / Modal Opening (`open-feedback-modal`)**:
  - Ensure modal (`id="feedback-modal"`) works reliably from landing screen (`screen-landing`) and authenticated views.
  - Display email input field when `isGuest` is true; hide or make readonly with info message when logged in.
  - High `z-index` (`z-[120]` / `z-[130]`) and proper backdrop / click-outside handling.
- **Admin Panel (`static/js/admin.js`)**:
  - Feedback section/tab with cards, image preview, status toggle, and "Grant PRO" button.

### 5. Verification & Testing
- Unit and integration tests in `tests/` covering guest/auth feedback submission, admin listing, status updates, and PRO grant.
- Linting and type checking (`pytest`, `ruff check .`).

---

## Rollout & Execution Steps
1. Add `Feedback` model and update `app/models/__init__.py`.
2. Create and run Alembic migration.
3. Add Pydantic schemas in `app/schemas/`.
4. Implement feedback creation endpoint (`POST /api/v1/feedback`) with optional auth and email validation.
5. Implement admin feedback endpoints in `app/api/v1/admin.py`.
6. Implement frontend modals, safe `submitFeedback` with guest/auth handling, profile button updates, landing page link, and admin panel UI.
7. Run test suite (`pytest`) and verify functionality.
