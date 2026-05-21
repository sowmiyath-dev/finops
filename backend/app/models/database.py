from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.models.db_models import Base

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=20,          # increased from 5 — handles concurrent API requests
    max_overflow=20,       # increased from 10
    pool_pre_ping=True,
    pool_recycle=300,
    pool_timeout=30,
    connect_args={
        "server_settings": {"timezone": "UTC"},
        "command_timeout": 60,  # 60s query timeout
    },
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
