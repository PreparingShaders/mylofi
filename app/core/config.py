from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "MyLofi"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Database
    DATABASE_URL: str
    DATABASE_ECHO: bool = False

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:8000", "http://127.0.0.1:8000"]

    # Vision API
    VISION_API_URL: str = "http://localhost:8001/analyze"
    VISION_API_KEY: str = ""

    # Web Push (VAPID)
    VAPID_PRIVATE_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_CLAIMS_SUB: str = "mailto:admin@mylofi.app"

    # File upload
    MAX_FILE_SIZE_MB: int = 10
    UPLOAD_DIR: str = "./uploads"


@lru_cache
def get_settings() -> Settings:
    return Settings()