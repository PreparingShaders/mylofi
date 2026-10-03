import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from app.core.config import get_settings
from app.db.session import init_db, close_db, async_session_maker
from app.services.nutrition import fail_stale_meals
from app.services.workout import seed_exercise_catalog
from app.api.v1.routes import router as api_router

settings = get_settings()

# Uvicorn only configures its own loggers, so service modules (background
# tasks, services) would otherwise never reach the console. Keep uvicorn's own
# formatting but at one consistent level.
logging.basicConfig(
    level=settings.LOG_LEVEL.upper(),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    force=True,
)

# httpx (and httpcore underneath it) logs every request line at INFO, and the
# Gemini calls carry the API key in the query string: without this the console
# echoes the credentials of every model attempt in the cascade.
for _noisy_logger in ("httpx", "httpcore"):
    logging.getLogger(_noisy_logger).setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    async with async_session_maker() as session:
        # A restart is the usual reason a meal never left pending/processing:
        # the analysis task died with the previous process and cannot report
        # back, so those rows are failed before anyone can poll them.
        healed = await fail_stale_meals(session)
        if healed:
            logging.getLogger(__name__).info(f"[Startup] Failed {healed} stuck meal(s)")
        await seed_exercise_catalog(session)
    yield
    # Shutdown
    await close_db()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router, prefix="/api/v1")

# Static files (for PWA frontend)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Uploaded meal photos (stored under UPLOAD_DIR and referenced by
# photo_path / photo_thumbnail_path in meal responses)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(os.path.join(settings.UPLOAD_DIR, "thumbnails"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/")
async def serve_index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())