# Implementation Plan: JWT Authentication via Secure HttpOnly Cookies

This plan outlines the migration of authentication in the MyLofi PWA from `localStorage` and `Authorization: Bearer` headers to secure `HttpOnly`, `SameSite=Lax` cookies.

---

## 1. Objectives & Scope
- **Security:** Protect JWT access and refresh tokens from XSS attacks by storing them in `HttpOnly` cookies.
- **PWA Persistence:** Ensure seamless session persistence across browser reloads and PWA backgrounding using cookies (`credentials: 'include'`).
- **Silent Refresh:** Implement an automatic 401 response interceptor in the frontend API client (`api.js`) to silently refresh expired access tokens using the HttpOnly refresh cookie.

---

## 2. Backend Refactoring (`app/api/v1/routes.py`)

### A. Authentication Dependencies (`get_current_user`, `get_optional_current_user`)
- Extract `access_token` from `request.cookies.get("access_token")`.
- Fall back to `Authorization: Bearer <token>` header if cookie is missing (for backward compatibility / WebSocket handshake if needed).
- Validate token payload and fetch user from database as before.

### B. Login Endpoint (`POST /auth/login`)
- Accept credentials, authenticate user.
- Generate access and refresh tokens.
- Set `access_token` and `refresh_token` cookies on the FastAPI `Response` object:
  - `httponly=True`
  - `samesite="lax"`
  - `secure=request.url.is_secure` (or environment-based check)
  - `max_age` matching token expiration limits.
- Return user profile metadata instead of returning tokens in the JSON response body.

### C. Refresh Endpoint (`POST /auth/refresh`)
- Extract `refresh_token` from `request.cookies.get("refresh_token")`.
- Validate/rotate refresh token in DB.
- Set new `access_token` (and rotated `refresh_token`) cookies on `Response`.
- Return success status.

### D. Logout Endpoints (`POST /auth/logout`, `POST /auth/logout-all`)
- Revoke refresh token in DB.
- Delete `access_token` and `refresh_token` cookies via `response.delete_cookie()`.

---

## 3. Frontend Network & State Refactoring (`static/js/api.js`, `static/js/app.js`)

### A. API Client (`static/js/api.js`)
- Ensure all `fetch` calls include `credentials: 'include'`.
- Remove manual `Authorization` header injection where access tokens were passed.
- **401 Interceptor & Silent Refresh:**
  - When `fetch` returns `401 Unauthorized` (and endpoint is not `/auth/login` or `/auth/refresh`):
    - Automatically call `POST /api/v1/auth/refresh`.
    - If refresh succeeds, retry the original failed request once.
    - If refresh fails, clear auth state and redirect/trigger login view.

### B. Application State (`static/js/app.js`)
- Remove saving/reading `access_token` and `refresh_token` from `localStorage`.
- Keep user profile data, offline sync queue, draft workouts, and read cache in `localStorage` / IndexedDB.
- Update login / logout actions to rely on cookies handled by the browser.

---

## 4. Validation & Testing Plan
- Run pytest suite (`pytest`) to verify backend cookie setting and token validation.
- Verify browser network requests include cookies (`credentials: 'include'`).
- Test login, page reload persistence, 401 silent refresh flow, and logout.
