"""Standalone worker — runs daily sync scheduler only, separate from API."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone, date

from app.models.database import init_db, AsyncSessionLocal
from app.models.db_models import ControlTower, SyncLog
from sqlalchemy import select, and_

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_scheduler_tasks: set = set()


async def _recover_stuck_syncs():
    """Re-trigger any CTs whose last sync log from yesterday is stuck (started) or failed."""
    from app.routers.towers import _do_sync
    yesterday = date.today() - timedelta(days=1)
    yesterday_start = datetime(yesterday.year, yesterday.month, yesterday.day, 0, 0, 0, tzinfo=timezone.utc)
    yesterday_end = datetime(yesterday.year, yesterday.month, yesterday.day, 23, 59, 59, tzinfo=timezone.utc)

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(SyncLog).where(
                    and_(
                        SyncLog.status.in_(["started", "failed"]),
                        SyncLog.started_at >= yesterday_start,
                        SyncLog.started_at <= yesterday_end,
                    )
                )
            )
            stuck_logs = result.scalars().all()

        if not stuck_logs:
            logger.info("Worker: No stuck/failed syncs from yesterday")
            return

        # Deduplicate by CT — only recover each CT once
        seen_ct_ids: set = set()
        for log in stuck_logs:
            ct_id = str(log.control_tower_id)
            if ct_id in seen_ct_ids:
                continue
            seen_ct_ids.add(ct_id)
            logger.info(f"Worker: Recovering CT {ct_id} (log {log.id}, status={log.status}) for {yesterday}")
            task = asyncio.create_task(
                _do_sync(ct_id, triggered_by="recovery",
                         force_start=yesterday.isoformat(),
                         force_end=yesterday.isoformat())
            )
            _scheduler_tasks.add(task)
            task.add_done_callback(_scheduler_tasks.discard)
            await asyncio.sleep(10)  # stagger to avoid DB overload

        logger.info(f"Worker: Recovery triggered for {len(seen_ct_ids)} CT(s)")

    except Exception as e:
        logger.error(f"Worker: Recovery check error: {e}", exc_info=True)


async def _daily_sync_scheduler():
    """Fires once every day at 11:30 AM IST (06:00 UTC)."""
    from app.routers.towers import _do_sync
    logger.info("Worker: Daily sync scheduler started")
    while True:
        now = datetime.now(timezone.utc)
        target_hour, target_minute = 6, 0
        next_run = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
        if now >= next_run:
            next_run = next_run + timedelta(days=1)
        wait_seconds = (next_run - now).total_seconds()
        logger.info(f"Worker: Next daily sync in {wait_seconds:.0f}s at {next_run.isoformat()} UTC (11:30 AM IST)")
        await asyncio.sleep(wait_seconds)

        try:
            # Step 1 — recover any stuck/failed syncs from yesterday
            await _recover_stuck_syncs()
            # Small gap before starting today's syncs
            await asyncio.sleep(30)

            # Step 2 — normal daily sync for all auto-sync enabled CTs
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
