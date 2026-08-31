from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    DATABASE_URL: str
    AZURE_DATABASE_URL: Optional[str] = None  # separate RDS for Azure; falls back to DATABASE_URL
    SECRET_KEY: str
    FERNET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 600  # 10 hours
    ADMIN_EMAIL: str = "admin@company.com"
    PORTAL_ACCOUNT_ID: str = ""

    @property
    def effective_azure_db_url(self) -> str:
        return self.AZURE_DATABASE_URL or self.DATABASE_URL

    class Config:
        env_file = ".env"

settings = Settings()
