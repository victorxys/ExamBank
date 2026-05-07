import os
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

load_dotenv()

class Settings(BaseSettings):
    PROJECT_NAME: str = "Employee Profile Management System"
    API_V1_STR: str = "/api/v1/employees"
    PORT: int = int(os.getenv("PORT", "50013"))
    SECRET_KEY: str = os.getenv("SECRET_KEY", "xys131313")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    DATABASE_URL: str = os.getenv("DATABASE_URL")
    CONTRACT_SERVICE_URL: str = os.getenv("CONTRACT_SERVICE_URL", "http://localhost:50011")
    AUTH_SERVICE_URL: str = os.getenv("AUTH_SERVICE_URL", "http://localhost:50010")

    class Config:
        case_sensitive = True

settings = Settings()
