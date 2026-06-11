from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    FERNET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 600  # 10 hours
    ADMIN_EMAIL: str = "admin@company.com"
    PORTAL_ACCOUNT_ID: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
