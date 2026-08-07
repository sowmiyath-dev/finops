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
    """Re-trigger any CTs whose last sync log is stuck (started) or failed.
    Uses the original sync's date range so the full failed period is resynced.
    """
    from app.routers.towers import _do_sync
    try:
        async with AsyncSessionLocal() as db:
            # Mark any 'started' logs older than 2 hours as failed (crashed/stuck)
            from sqlalchemy import update as sa_update
            stale_cutoff = datetime.now(timezone.utc) - timedelta(hours=2)
            await db.execute(
                sa_update(SyncLog)
                .where(
                    SyncLog.status == "started",
                    SyncLog.started_at < stale_cutoff,
                )
                .values(status="failed", error_message="Sync timed out or worker crashed",
                        finished_at=datetime.now(timezone.utc))
            )
            await db.commit()
            logger.info("Worker: Marked stale 'started' logs as failed")

            # Find the latest sync log per CT — if it's failed, recover it
            # Use a subquery to get the most recent log per control_tower_id
            from sqlalchemy import text as sa_text
            failed_rows = (await db.execute(sa_text("""
                SELECT DISTINCT ON (control_tower_id)
                    control_tower_id, id, status, date_range_start, date_range_end, started_at
                FROM sync_logs
                ORDER BY control_tower_id, started_at DESC
            """))).all()

        failed_cts = [
            r for r in failed_rows
            if r.status in ("failed", "started")
        ]

        if not failed_cts:
            logger.info("Worker: No failed syncs to recover")
            return

        for row in failed_cts:
            ct_id = str(row.control_tower_id)
            # Use the original failed sync's date range if available,
            # otherwise fall back to n-7 days so we don't miss data
            if row.date_range_start and row.date_range_end:
                force_start = row.date_range_start.isoformat()
                force_end = row.date_range_end.isoformat()
            else:
                today = date.today()
                force_start = (today - timedelta(days=7)).isoformat()
                force_end = today.isoformat()

            logger.info(f"Worker: Recovering CT {ct_id} (status={row.status}) range {force_start} to {force_end}")
            task = asyncio.create_task(
                _do_sync(ct_id, triggered_by="recovery", force_start=force_start, force_end=force_end)
            )
            _scheduler_tasks.add(task)
            task.add_done_callback(_scheduler_tasks.discard)
            await asyncio.sleep(15)  # stagger to avoid DB overload

        logger.info(f"Worker: Recovery triggered for {len(failed_cts)} CT(s)")

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
