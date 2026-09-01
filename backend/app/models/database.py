from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.models.db_models import Base

# ── AWS DB (primary) ──────────────────────────────────────────────────────────
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=900,
    pool_timeout=10,
    connect_args={
        "server_settings": {
            "timezone": "UTC",
            "statement_timeout": "120000",
            "idle_in_transaction_session_timeout": "30000",
            "work_mem": "64MB",
        },
        "command_timeout": 120,
        "timeout": 15,  # fail fast if RDS is in backup/maintenance
    },
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Long-timeout engine for AWS sync operations
_sync_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=60,
    connect_args={
        "server_settings": {"timezone": "UTC", "statement_timeout": "300000"},
        "command_timeout": 300,
    },
)
SyncSessionLocal = sessionmaker(_sync_engine, class_=AsyncSession, expire_on_commit=False)

# ── Azure DB (separate RDS — falls back to AWS DB if AZURE_DATABASE_URL not set) ─
_azure_engine = create_async_engine(
    settings.effective_azure_db_url,
    echo=False,
    pool_size=15,
    max_overflow=15,
    pool_pre_ping=True,
    pool_recycle=900,
    pool_timeout=10,
    connect_args={
        "server_settings": {
            "timezone": "UTC",
            "statement_timeout": "120000",
            "idle_in_transaction_session_timeout": "30000",
            "work_mem": "64MB",
        },
        "command_timeout": 120,
        "timeout": 15,  # fail fast if RDS is in backup/maintenance
    },
)
AzureSessionLocal = sessionmaker(_azure_engine, class_=AsyncSession, expire_on_commit=False)

# Long-timeout engine for Azure bulk inserts/deletes
_azure_sync_engine = create_async_engine(
    settings.effective_azure_db_url,
    echo=False,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=60,
    connect_args={
        "server_settings": {"timezone": "UTC", "statement_timeout": "300000"},
        "command_timeout": 300,
    },
)
AzureSyncSessionLocal = sessionmaker(_azure_sync_engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    # Lightweight ping — avoids hanging during RDS backup windows
    async with engine.connect() as conn:
        await conn.execute(__import__('sqlalchemy', fromlist=['text']).text("SELECT 1"))
    if settings.AZURE_DATABASE_URL:
        async with _azure_engine.connect() as conn:
            await conn.execute(__import__('sqlalchemy', fromlist=['text']).text("SELECT 1"))


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def get_azure_db():
    async with AzureSessionLocal() as session:
        yield session
