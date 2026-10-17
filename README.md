# MyLofi Fitness & Nutrition PWA

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.112-blue.svg)](https://fastapi.tiangolo.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.x-38BDF8.svg)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-4169E1.svg)](https://www.postgresql.org/)

A modern Progressive Web Application (PWA) and fitness/nutrition assistant featuring AI-powered meal analysis, custom workout planning, real-time logging, and an advanced administrative panel with tiered subscription management.

---

## 🚀 Tech Stack

### Backend
- **Framework:** Python 3.10+, FastAPI (async endpoints & dependency injection)
- **Database & ORM:** PostgreSQL, SQLAlchemy 2 (AsyncSession), Alembic migrations
- **Validation:** Pydantic v2
- **Authentication:** JWT (python-jose) + bcrypt password hashing, refresh-token rotation
- **AI & Vision:** Google Gemini API / OpenRouter cascading text-and-vision models (via Cloudflare Worker proxy) for meal photo recognition and workout coaching; Pillow for image processing
- **Real-time:** WebSocket meal-status updates (websockets)
- **Background tasks:** Redis + ARQ
- **Email:** Brevo API (verification, feedback replies)
- **Push notifications:** Web Push (VAPID)
- **Server:** Uvicorn ASGI server

### Frontend
- **Architecture:** Progressive Web App (PWA) with offline support & service worker (`static/sw.js`)
- **UI & Styling:** Tailwind CSS (CDN), Vanilla JavaScript SPA modules under `static/js/`
- **UX:** Mobile-first responsive design, dark mode optimized (`[color-scheme:dark]`)
- **Templates:** Static `index.html` entry point served by FastAPI

### Infrastructure & Deployment
- **Reverse proxy:** Nginx
- **Process management:** Systemd / Docker containerization
- **Linting / types:** ruff, mypy

---

## 📦 Core Modules & Functionality

### 1. User Area (PWA)
- **Workout Tracking:** Log sets, reps, weight, RPE, rest timers, and exercise catalog browsing. AI-generated workout plans and session verdicts.
- **AI Nutrition Logging:** Upload meal photos for instant AI macro breakdown, quality scoring, and daily/period nutrition summaries.
- **Activity Metrics:** Dashboard tracking workout consistency and nutrition targets.

### 2. Admin Panel
- **User Management:** Search, filter, paginate, activate/deactivate users, and toggle admin roles.
- **AI Quota Resets:** Instant reset for daily meal AI and weekly workout AI quotas.
- **Feedback Management:** List, view, update status, grant PRO, and send email replies to user feedback.
- **Custom PRO Subscription Management:** Grant or revoke PRO status using quick presets (7d, 30d) or a **custom date range** (`start_date` to `end_date` with end-of-day UTC expiration). Grants extend from `max(now, existing_expiry)` so paid time is never overwritten.
- **System Stats:** Total/active users, workouts, meals, AI error rate.

### 3. Activity Tracking & Security
- **Unified Activity Monitoring:** Throttled `last_seen_at` updates combined with latest meal and workout timestamps for accurate admin oversight.
- **Role-Based Access Control:** JWT-based authentication and admin route guards.

---

## 🗂️ Project Structure

```
mylofi/
├── alembic/                # Database migration scripts
├── app/
│   ├── api/v1/             # FastAPI routers (auth, workouts, nutrition, admin)
│   ├── core/               # Application settings (pydantic-settings)
│   ├── db/                 # Database session, base model, seed/clean scripts
│   ├── models/             # SQLAlchemy ORM models (User, Meal, Workout, Feedback, …)
│   ├── schemas/            # Pydantic v2 request/response schemas
│   ├── services/           # Business logic (AI vision, workout coach, limits, auth, email)
│   ├── ws/                 # WebSocket connection manager
│   └── main.py             # FastAPI app entrypoint (lifespan, static, health)
├── static/
│   ├── index.html          # PWA entry point (dark mode, Tailwind CDN config)
│   ├── sw.js               # Service worker for offline support
│   ├── js/                 # Modular Vanilla JS frontend (workouts.js, nutrition.js, admin.js, auth.js, …)
│   └── uploads/            # User-uploaded meal photos & thumbnails
├── tests/                  # Pytest async test suite (unit & Playwright e2e)
├── scripts/                # Maintenance scripts (make_admin, reassign_user_id, …)
├── alembic.ini             # Alembic configuration
├── pytest.ini              # Pytest configuration
├── requirements.txt        # Python dependencies
└── .env.example            # Environment variable template
```

---

## 🛠️ Getting Started & Installation

### Prerequisites
- Python 3.10+
- PostgreSQL 15+
- Redis (background tasks)
- (Optional) Node.js/npm only if you self-host Tailwind instead of the CDN build

### 1. Clone & Setup Environment

```bash
git clone <repository-url>
cd mylofi
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and configure your database URL, JWT secret, Redis, and AI API keys:

```bash
cp .env.example .env
# Edit .env with your credentials
```

Required variables: `DATABASE_URL`, `SECRET_KEY`. Optional but recommended: `GEMINI_API_KEY`, `OPEN_ROUTER_API_KEY`, `BREVO_API_KEY`, `REDIS_URL`.

### 3. Run Database Migrations

```bash
alembic upgrade head
```

### 4. Start the Development Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Access the application at `http://localhost:8000`. API docs are available at `/docs` when `DEBUG=true`.

### Make a User Admin (optional)

```bash
python scripts/make_admin.py <email>
```

---

## 🧪 Testing

Run the test suite using pytest:

```bash
pytest
```

Unit tests live in `tests/`; Playwright end-to-end tests live in `tests/e2e/`.

---

## 📄 License

MIT License.