"""Standalone worker — runs daily sync scheduler only, separate from API."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app.models.database import init_db, AsyncSessionLocal
from app.models.db_models import ControlTower
from sqlalchemy import select

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_scheduler_tasks: set = set()


async def _daily_sync_scheduler():
    """Fires once every day at 10:30 AM IST (05:00 UTC)."""
    from app.routers.towers import _do_sync
    logger.info("Worker: Daily sync scheduler started")
    while True:
        now = datetime.now(timezone.utc)
        target_hour, target_minute = 5, 0
        next_run = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
        if now >= next_run:
            next_run = next_run + timedelta(days=1)
        wait_seconds = (next_run - now).total_seconds()
        logger.info(f"Worker: Next daily sync in {wait_seconds:.0f}s at {next_run.isoformat()} UTC (10:30 AM IST)")
        await asyncio.sleep(wait_seconds)

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(ControlTower).where(ControlTower.auto_sync_enabled == True)
                )
                cts = result.scalars().all()

            logger.info(f"Worker: Triggering {len(cts)} control towers")
            for ct in cts:
                task = asyncio.create_task(_do_sync(str(ct.id), triggered_by="scheduler"))
                _scheduler_tasks.add(task)
                task.add_done_callback(_scheduler_tasks.discard)
                await asyncio.sleep(10)

        except Exception as e:
            logger.error(f"Worker: Scheduler error: {e}", exc_info=True)


async def main():
    await init_db()
    logger.info("Finoptix Worker started")
    await _daily_sync_scheduler()


if __name__ == "__main__":
    asyncio.run(main())
