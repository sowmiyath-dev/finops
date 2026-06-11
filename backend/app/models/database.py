from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.models.db_models import Base

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=20,
    pool_pre_ping=True,    # tests connection before use — auto-recovers stale connections
    pool_recycle=1800,     # recycle connections every 30 min
    pool_timeout=60,       # wait up to 60s for a connection
    connect_args={
        "server_settings": {"timezone": "UTC"},
        "command_timeout": 120,
    },
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
