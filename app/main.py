from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from app.core.config import get_settings
from app.db.session import init_db, close_db
from app.api.v1.routes import router as api_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
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


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/")
async def serve_index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())