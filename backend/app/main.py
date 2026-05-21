import asyncio, logging
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.models.database import init_db, AsyncSessionLocal
from app.models.db_models import ControlTower
from app.routers import auth, towers, reports, admin, tags, verticals
from sqlalchemy import select

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Finoptix", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(towers.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(verticals.router, prefix="/api")

_scheduler_tasks: set = set()


async def _daily_sync_scheduler():
    """Fires once every day at 10:30 AM IST (05:00 UTC)."""
    from app.routers.towers import _do_sync
    from datetime import timedelta
    logger.info("Daily sync scheduler started")
    while True:
        now = datetime.now(timezone.utc)
        # 10:30 AM IST = 05:00 AM UTC
        target_hour, target_minute = 5, 0
        next_run = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
        if now >= next_run:
            next_run = next_run + timedelta(days=1)
        wait_seconds = (next_run - now).total_seconds()
        logger.info(f"Next daily sync in {wait_seconds:.0f}s at {next_run.isoformat()} UTC (10:30 AM IST)")
        await asyncio.sleep(wait_seconds)

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(ControlTower).where(ControlTower.auto_sync_enabled == True)
                )
                cts = result.scalars().all()

            logger.info(f"Daily sync: triggering {len(cts)} control towers")
            for ct in cts:
                task = asyncio.create_task(_do_sync(str(ct.id), triggered_by="scheduler"))
                _scheduler_tasks.add(task)
                task.add_done_callback(_scheduler_tasks.discard)
                await asyncio.sleep(10)

        except Exception as e:
            logger.error(f"Daily sync scheduler error: {e}")


@app.on_event("startup")
async def startup():
    await init_db()
    asyncio.create_task(_daily_sync_scheduler())


@app.get("/health")
async def health():
    return {"status": "ok", "app": "Finoptix"}


@app.get("/api/health")
async def health_api():
    return {"status": "ok", "app": "Finoptix"}
