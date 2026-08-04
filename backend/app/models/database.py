from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.models.db_models import Base

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
    },
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Long-timeout engine for sync operations — inserts/deletes on large tables need more than 30s
_sync_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=60,
    connect_args={
        "server_settings": {"timezone": "UTC", "statement_timeout": "300000"},  # 5 min
        "command_timeout": 300,
    },
)
SyncSessionLocal = sessionmaker(_sync_engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
