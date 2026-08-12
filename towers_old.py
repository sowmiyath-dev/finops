import uuid, asyncio, logging
from datetime import datetime, timezone, date, timedelta
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func

from app.models.database import get_db, AsyncSessionLocal, SyncSessionLocal
from app.models.db_models import User, ControlTower, SubAccount, CostRecord, SyncLog, AzureCostRecord
from app.models.schemas import OnboardKeys, OnboardRole, OnboardAzure, ControlTowerOut, SubAccountOut
from app.services.auth_service import get_current_user
from app.services.crypto_service import encrypt
from app.services.aws_session import test_connectivity, list_org_accounts
from app.services.cost_service import fetch_cur_from_s3, get_sync_date_range, get_full_year_date_range, get_report_keys_for_period, fetch_cur_single_file, stream_cur_file_batches
from app.services.azure_session import test_azure_connectivity, list_azure_subscriptions
from app.services.azure_cost_service import stream_azure_cost_batches, find_azure_export_blobs, get_full_month_range_for_dates
from app.config import settings

router = APIRouter(prefix="/towers", tags=["towers"])
logger = logging.getLogger(__name__)

_sync_progress: dict = {}
_executor = ThreadPoolExecutor(max_workers=8)
_sync_semaphore = asyncio.Semaphore(3)


# â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _upsert_sub_accounts(db: AsyncSession, ct_id: str, accounts: list[dict]):
    for acc in accounts:
        existing = await db.execute(
            select(SubAccount).where(
                SubAccount.control_tower_id == ct_id,
                SubAccount.aws_account_id == acc["aws_account_id"],
            )
        )
        row = existing.scalars().first()
        if row:
            row.account_name = acc["account_name"]
            row.is_active = True
        else:
            db.add(SubAccount(
                control_tower_id=ct_id,
                aws_account_id=acc["aws_account_id"],
                account_name=acc["account_name"],
                is_active=True,
            ))
    await db.commit()


async def _do_sync(ct_id: str, triggered_by: str = "manual", force_start: Optional[str] = None, force_end: Optional[str] = None):
    # Guard: skip only if actively running right now (not failed/done)
    current = _sync_progress.get(ct_id, {})
    if current.get("status") == "running":
        logger.warning(f"Sync already running for CT {ct_id} — skipping duplicate trigger")
        return
    # Clear any stale failed/done state before starting
    _sync_progress[ct_id] = {"percent": 0, "status": "running", "message": "Initializing"}
    async with _sync_semaphore:
        sync_log_id = None

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()
                if not ct:
                    return

            # Route to Azure sync if cloud_provider is azure
            if ct.cloud_provider == "azure":
                await _do_azure_sync(ct_id, triggered_by, force_start=force_start, force_end=force_end)
                return

            # Create sync log
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()
                if not ct:
                    return
                sync_log = SyncLog(
                    control_tower_id=ct.id,
                    control_tower_name=ct.name,
                    triggered_by=triggered_by,
                    status="started",
                )
                db.add(sync_log)
                await db.commit()
                await db.refresh(sync_log)
                sync_log_id = sync_log.id

            # Step 1 â€” discover sub-accounts
            _sync_progress[ct_id]["message"] = "Discovering accounts"
            _sync_progress[ct_id]["percent"] = 10
            loop = asyncio.get_running_loop()

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()
            org_accounts = await loop.run_in_executor(_executor, list_org_accounts, ct)
            async with AsyncSessionLocal() as db:
                await _upsert_sub_accounts(db, ct_id, org_accounts)

            # Step 2 â€” determine date range
            _sync_progress[ct_id]["message"] = "Checking existing data"
            _sync_progress[ct_id]["percent"] = 20
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()
                from sqlalchemy import text as _sa_text
                import uuid as _uuid
                _exists = await db.execute(
                    _sa_text("SELECT EXISTS(SELECT 1 FROM cost_records WHERE control_tower_id = :ct_id LIMIT 1)")
                    .bindparams(ct_id=_uuid.UUID(ct_id))
                )
                existing_count = 1 if _exists.scalar() else 0

            if force_start and force_end:
                start_date, end_date = force_start, force_end
                logger.info(f"Forced date range for CT {ct_id}: {start_date} â†’ {end_date}")
            elif existing_count == 0:
                start_date, end_date = get_full_year_date_range()
                logger.info(f"First sync for CT {ct_id} â€” full year: {start_date} â†’ {end_date}")
            else:
                _today = date.today()
                start_date = (_today - timedelta(days=7)).isoformat()
                end_date = _today.isoformat()
                logger.info(f"Incremental sync for CT {ct_id} â€” last 7 days: {start_date} â†’ {end_date}")

            # Step 3 â€” load sub_map
            async with AsyncSessionLocal() as db:
                sub_result = await db.execute(
                    select(SubAccount).where(SubAccount.control_tower_id == ct_id)
                )
                sub_map = {s.aws_account_id: s for s in sub_result.scalars().all()}

            async def _get_or_create_sub(aws_account_id: str) -> SubAccount:
                """Get existing sub-account or create one on the fly."""
                if aws_account_id in sub_map:
                    return sub_map[aws_account_id]
                async with AsyncSessionLocal() as db:
                    sub = SubAccount(
                        control_tower_id=ct_id,
                        aws_account_id=aws_account_id,
                        account_name=aws_account_id,  # use ID as name until discovered
                        is_active=True,
                    )
                    db.add(sub)
                    await db.commit()
                    await db.refresh(sub)
                    sub_map[aws_account_id] = sub
                    logger.info(f"Auto-created sub-account for {aws_account_id}")
                    return sub

            # Step 4 â€” fetch and insert ONE FILE AT A TIME to avoid OOM
            from app.services.cost_service import _get_billing_periods_for_range
            billing_periods = _get_billing_periods_for_range(start_date, end_date)
            total_inserted = 0

            for period_idx, period in enumerate(billing_periods):
                p_start = date(int(period[:4]), int(period[4:6]), int(period[6:8]))
                p_end_raw = date(int(period[9:13]), int(period[13:15]), int(period[15:17]))
                _sync_progress[ct_id]["message"] = f"Syncing {period} ({period_idx+1}/{len(billing_periods)})"
                _sync_progress[ct_id]["percent"] = 30 + int(60 * period_idx / len(billing_periods))

                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                    ct = result.scalar_one_or_none()

                # Get list of files for this period
                report_keys = await loop.run_in_executor(
                    _executor, get_report_keys_for_period, ct, period
                )

                if not report_keys:
                    logger.info(f"No files for period {period}, skipping")
                    continue

                # Delete full month range using SyncSessionLocal (longer timeout for large tables)
                full_month_start = p_start
                full_month_end = p_end_raw - timedelta(days=1)
                async with SyncSessionLocal() as db:
                    await db.execute(
                        delete(CostRecord).where(
                            CostRecord.control_tower_id == ct_id,
                            CostRecord.date >= full_month_start,
                            CostRecord.date <= full_month_end,
                        )
                    )
                    await db.commit()
                logger.info(f"AWS deleted month {full_month_start} to {full_month_end} before re-insert")

                file_start = full_month_start.isoformat()
                file_end = full_month_end.isoformat()

                # Process ONE FILE AT A TIME using streaming batches
                for file_idx, report_key in enumerate(report_keys):
                    logger.info(f"Period {period} file {file_idx+1}/{len(report_keys)}: {report_key}")
                    try:
                        # stream_cur_file_batches is a generator - runs in executor per batch
                        streamer = await loop.run_in_executor(
                            _executor,
                            lambda rk=report_key: list(stream_cur_file_batches(
                                ct, rk, file_start, file_end, 5000
                            ))
                        )
                    except Exception as file_err:
                        logger.error(f"Failed to fetch file {report_key}: {file_err}", exc_info=True)
                        continue

                    for raw_batch in streamer:
                        if not raw_batch:
                            continue
                        async with AsyncSessionLocal() as db:
                            db_batch = []
                            for r in raw_batch:
                                sub = await _get_or_create_sub(r["aws_account_id"])
                                db_batch.append(CostRecord(
                                    control_tower_id=ct_id,
                                    sub_account_id=str(sub.id),
                                    aws_account_id=r["aws_account_id"],
                                    account_name=sub.account_name,
                                    date=r["date"],
                                    service=r["service"],
                                    region=r.get("region"),
                                    resource_id=r.get("resource_id"),
                                    usage_type=r.get("usage_type"),
                                    operation=r.get("operation"),
                                    blended_cost=r["blended_cost"],
                                    unblended_cost=r["unblended_cost"],
                                    net_unblended_cost=r["net_unblended_cost"],
                                    amortized_cost=r["amortized_cost"],
                                    usage_quantity=r["usage_quantity"],
                                    usage_unit=r.get("usage_unit"),
                                    purchase_type=r.get("purchase_type"),
                                    line_item_type=r.get("line_item_type"),
                                    is_marketplace=r.get("is_marketplace", False),
                                    tags=r.get("tags"),
                                    cloud_provider="aws",
                                ))
                            if db_batch:
                                db.add_all(db_batch)
                                await db.commit()
                                total_inserted += len(db_batch)
                                logger.info(f"Period {period} file {file_idx+1}: {total_inserted} total inserted")

                    del streamer

            # Step 5 â€” finalize
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(ControlTower)
                    .where(ControlTower.id == ct_id)
                    .values(last_synced_at=datetime.now(timezone.utc), is_active=True)
                )
                if sync_log_id:
                    await db.execute(
                        update(SyncLog).where(SyncLog.id == sync_log_id).values(
                            status="completed",
                            records_synced=total_inserted,
                            date_range_start=date.fromisoformat(start_date),
                            date_range_end=date.fromisoformat(end_date),
                            finished_at=datetime.now(timezone.utc),
                        )
                    )
                await db.commit()

            _sync_progress[ct_id] = {"percent": 100, "status": "done", "message": "Completed"}
            logger.info(f"Sync done for CT {ct_id}: {total_inserted} records")

            # Refresh vertical cost cache in background after sync
            try:
                from app.services.vertical_cache_service import refresh_vertical_cost_cache
                await refresh_vertical_cost_cache()
            except Exception as cache_err:
                logger.warning(f"vertical_cache refresh failed (non-fatal): {cache_err}")

        except Exception as e:
            logger.error(f"Sync failed for CT {ct_id}: {e}")
            async with AsyncSessionLocal() as db:
                if sync_log_id:
                    await db.execute(
                        update(SyncLog).where(SyncLog.id == sync_log_id).values(
                            status="failed",
                            error_message=str(e),
                            finished_at=datetime.now(timezone.utc),
                        )
                    )
                    await db.commit()
            _sync_progress[ct_id] = {"percent": 0, "status": "failed", "message": str(e)}


# â”€â”€ Azure sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _refresh_azure_monthly_summary(ct_id: str):
    """Re-aggregate Azure monthly summary for a specific CT only.
    Uses DELETE + INSERT (not upsert) to guarantee clean data after each sync.
    """
    from sqlalchemy import text
    import uuid as _uuid
    try:
        async with SyncSessionLocal() as db:
            await db.execute(
                text("DELETE FROM azure_monthly_summary WHERE control_tower_id = :ct_id")
                .bindparams(ct_id=_uuid.UUID(ct_id))
            )
            await db.execute(text("""
                INSERT INTO azure_monthly_summary
                    (id, control_tower_id, month, subscription_id, subscription_name,
                     actual_cost, amortized_cost, refreshed_at)
                SELECT
                    gen_random_uuid(),
                    a.control_tower_id,
                    a.month,
                    a.subscription_id,
                    a.subscription_name,
                    COALESCE(a.actual_cost, 0),
                    COALESCE(m.amortized_cost, a.actual_cost, 0),
                    NOW()
                FROM (
                    SELECT
                        control_tower_id,
                        TO_CHAR(date, 'YYYY-MM') AS month,
                        subscription_id,
                        MAX(subscription_name) AS subscription_name,
                        SUM(actual_cost) AS actual_cost
                    FROM azure_cost_records
                    WHERE cost_type = 'actual'
                      AND control_tower_id = :ct_id
                    GROUP BY control_tower_id, TO_CHAR(date, 'YYYY-MM'), subscription_id
                ) a
                LEFT JOIN (
                    SELECT
                        TO_CHAR(date, 'YYYY-MM') AS month,
                        subscription_id,
                        SUM(amortized_cost) AS amortized_cost
                    FROM azure_cost_records
                    WHERE cost_type = 'amortized'
                      AND control_tower_id = :ct_id
                    GROUP BY TO_CHAR(date, 'YYYY-MM'), subscription_id
                ) m ON a.month = m.month AND a.subscription_id = m.subscription_id
            """).bindparams(ct_id=_uuid.UUID(ct_id)))
            await db.commit()
            logger.info(f"Azure monthly summary refreshed for CT {ct_id}")
    except Exception as e:
        logger.error(f"Azure monthly summary refresh failed for CT {ct_id}: {e}", exc_info=True)
        raise


async def _rebuild_all_azure_summaries():
    """Rebuild azure_monthly_summary for ALL control towers from scratch.
    Called on startup and via admin endpoint to fix stale/corrupt summary data.
    """
    from sqlalchemy import text
    logger.info("Rebuilding ALL Azure monthly summaries from scratch")
    try:
        async with SyncSessionLocal() as db:
            # Truncate entire summary table and rebuild from raw records
            await db.execute(text("TRUNCATE TABLE azure_monthly_summary"))
            await db.execute(text("""
                INSERT INTO azure_monthly_summary
                    (id, control_tower_id, month, subscription_id, subscription_name,
                     actual_cost, amortized_cost, refreshed_at)
                SELECT
                    gen_random_uuid(),
                    a.control_tower_id,
                    a.month,
                    a.subscription_id,
                    a.subscription_name,
                    COALESCE(a.actual_cost, 0),
                    COALESCE(m.amortized_cost, a.actual_cost, 0),
                    NOW()
                FROM (
                    SELECT
                        control_tower_id,
                        TO_CHAR(date, 'YYYY-MM') AS month,
                        subscription_id,
                        MAX(subscription_name) AS subscription_name,
                        SUM(actual_cost) AS actual_cost
                    FROM azure_cost_records
                    WHERE cost_type = 'actual'
                    GROUP BY control_tower_id, TO_CHAR(date, 'YYYY-MM'), subscription_id
                ) a
                LEFT JOIN (
                    SELECT
                        control_tower_id,
                        TO_CHAR(date, 'YYYY-MM') AS month,
                        subscription_id,
                        SUM(amortized_cost) AS amortized_cost
                    FROM azure_cost_records
                    WHERE cost_type = 'amortized'
                    GROUP BY control_tower_id, TO_CHAR(date, 'YYYY-MM'), subscription_id
                ) m ON a.control_tower_id = m.control_tower_id
                      AND a.month = m.month
                      AND a.subscription_id = m.subscription_id
            """))
            await db.commit()
            logger.info("All Azure monthly summaries rebuilt successfully")
    except Exception as e:
        logger.error(f"Full Azure summary rebuild failed: {e}", exc_info=True)
        raise


async def _do_azure_sync(ct_id: str, triggered_by: str = "manual", force_start: Optional[str] = None, force_end: Optional[str] = None):
    """Sync cost data from Azure Cost Management Export."""
    _sync_progress[ct_id] = {"percent": 0, "status": "running", "message": "Starting Azure sync"}
    sync_log_id = None

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
            ct = result.scalar_one_or_none()
            if not ct:
                return
            sync_log = SyncLog(
                control_tower_id=ct.id,
                control_tower_name=ct.name,
                triggered_by=triggered_by,
                status="started",
            )
            db.add(sync_log)
            await db.commit()
            await db.refresh(sync_log)
            sync_log_id = sync_log.id

        # Step 1 -- discover subscriptions
        _sync_progress[ct_id]["message"] = "Discovering Azure subscriptions"
        _sync_progress[ct_id]["percent"] = 10
        loop = asyncio.get_running_loop()

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
            ct = result.scalar_one_or_none()

        try:
            subs = await loop.run_in_executor(_executor, list_azure_subscriptions, ct)
            if subs:
                async with AsyncSessionLocal() as db:
                    await _upsert_sub_accounts(db, ct_id, subs)
        except Exception as sub_err:
            logger.warning(f"Azure subscription discovery failed (non-fatal): {sub_err}")

        # Step 2 -- determine date range
        _sync_progress[ct_id]["message"] = "Checking existing data"
        _sync_progress[ct_id]["percent"] = 20

        from sqlalchemy import text as sa_text
        import uuid as _uuid
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                sa_text("SELECT EXISTS(SELECT 1 FROM azure_cost_records WHERE control_tower_id = :ct_id LIMIT 1)")
                .bindparams(ct_id=_uuid.UUID(ct_id))
            )
            existing_count = 1 if result.scalar() else 0

        from datetime import date as dt_date
        today = dt_date.today()
        if force_start and force_end:
            start_date = force_start
            end_date = force_end
            logger.info(f"Azure manual sync for CT {ct_id}: {start_date} to {end_date}")
        elif existing_count == 0:
            # Full sync -- start of current year
            start_date = today.replace(month=1, day=1).isoformat()
            end_date = today.isoformat()
            logger.info(f"Azure full sync for CT {ct_id}: {start_date} to {end_date}")
        else:
            # Daily incremental -- always sync n-7 days (today minus 7) to today
            # This ensures late-arriving Azure records and any partial days are captured
            start_date = (today - timedelta(days=7)).isoformat()
            end_date = today.isoformat()
            logger.info(f"Azure daily n-7 sync for CT {ct_id}: {start_date} to {end_date}")

        # Step 3 -- load sub_map
        async with AsyncSessionLocal() as db:
            sub_result = await db.execute(
                select(SubAccount).where(SubAccount.control_tower_id == ct_id)
            )
            sub_map = {s.aws_account_id: s for s in sub_result.scalars().all()}

        async def _get_or_create_sub(subscription_id: str, subscription_name: str = "") -> SubAccount:
            if subscription_id in sub_map:
                return sub_map[subscription_id]
            async with AsyncSessionLocal() as db:
                sub = SubAccount(
                    control_tower_id=ct_id,
                    aws_account_id=subscription_id,
                    account_name=subscription_name or subscription_id,
                    is_active=True,
                )
                db.add(sub)
                await db.commit()
                await db.refresh(sub)
                sub_map[subscription_id] = sub
                return sub

        # Step 4 -- find blobs
        _sync_progress[ct_id]["message"] = "Finding Azure export files"
        _sync_progress[ct_id]["percent"] = 30

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
            ct = result.scalar_one_or_none()

        csv_blobs = await loop.run_in_executor(
            _executor, find_azure_export_blobs, ct, start_date, end_date, existing_count == 0
        )

        if not csv_blobs:
            logger.warning(f"No Azure export blobs found for CT {ct_id}")
            async with AsyncSessionLocal() as db:
                if sync_log_id:
                    await db.execute(
                        update(SyncLog).where(SyncLog.id == sync_log_id).values(
                            status="failed",
                            error_message="No Azure export blobs found in storage container",
                            finished_at=datetime.now(timezone.utc),
                        )
                    )
                    await db.commit()
            _sync_progress[ct_id] = {"percent": 0, "status": "failed", "message": "No export files found"}
            return

        # Delete+reinsert full calendar months covered by the sync range.
        # Azure blobs are per-month — we must delete the full month before streaming
        # to avoid duplicate/stale rows. Never append to existing data.
        full_month_start, full_month_end = get_full_month_range_for_dates(start_date, end_date)
        logger.info(f"Azure sync -- deleting full month range {full_month_start} to {full_month_end} before re-insert")
        async with SyncSessionLocal() as db:
            await db.execute(
                delete(AzureCostRecord).where(
                    AzureCostRecord.control_tower_id == ct_id,
                    AzureCostRecord.date >= full_month_start,
                    AzureCostRecord.date <= full_month_end,
                )
            )
            await db.commit()

        # Stream using full month range so no rows are filtered out of the blob
        stream_start = full_month_start.isoformat()
        stream_end = full_month_end.isoformat()

        total_inserted = 0
        import uuid as _uuid3
        from sqlalchemy import text as _ins_text

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
            ct_ref = result.scalar_one_or_none()

        for blob_idx, blob_name in enumerate(csv_blobs):
            _sync_progress[ct_id]["message"] = f"Processing file {blob_idx+1}/{len(csv_blobs)}"
            _sync_progress[ct_id]["percent"] = 30 + int(60 * blob_idx / len(csv_blobs))
            logger.info(f"Azure processing blob {blob_idx+1}/{len(csv_blobs)}: {blob_name}")

            try:
                # Stream blob in executor — yields batches via generator, never loads full file into memory
                batch_gen = await loop.run_in_executor(
                    _executor,
                    lambda bn=blob_name: stream_azure_cost_batches(ct_ref, bn, stream_start, stream_end, 500)
                )

                # Consume generator batches and insert immediately — avoids OOM on large blobs
                def _collect_batches(gen):
                    return list(gen)

                batches = await loop.run_in_executor(_executor, _collect_batches, batch_gen)

                for batch in batches:
                    if not batch:
                        continue
                    async with SyncSessionLocal() as db:
                        await db.execute(_ins_text("""
                            INSERT INTO azure_cost_records
                                (id, control_tower_id, subscription_id, subscription_name,
                                 resource_group, resource_id, resource_name, date,
                                 billing_currency, actual_cost, amortized_cost, quantity, unit,
                                 service, meter_subcategory, meter_name, product_name, region,
                                 charge_type, pricing_model, is_marketplace, tags, cost_type, synced_at)
                            VALUES
                                (:id, :ct_id, :sub_id, :sub_name,
                                 :rg, :rid, :rname, :date,
                                 :currency, :actual, :amortized, :qty, :unit,
                                 :service, :meter_sub, :meter_name, :product, :region,
                                 :charge_type, :pricing, :marketplace, :tags, :cost_type, NOW())
                        """), [
                            {
                                "id": str(_uuid3.uuid4()), "ct_id": ct_id,
                                "sub_id": r["subscription_id"], "sub_name": r["subscription_name"],
                                "rg": r.get("resource_group"), "rid": r.get("resource_id"),
                                "rname": r.get("resource_name"), "date": r["date"],
                                "currency": r.get("billing_currency", "INR"),
                                "actual": r.get("actual_cost", 0), "amortized": r.get("amortized_cost", 0),
                                "qty": r.get("quantity", 0), "unit": r.get("unit"),
                                "service": r["service"], "meter_sub": r.get("meter_subcategory"),
                                "meter_name": r.get("meter_name"), "product": r.get("product_name"),
                                "region": r.get("region"), "charge_type": r.get("charge_type", "Usage"),
                                "pricing": r.get("pricing_model", "OnDemand"),
                                "marketplace": r.get("is_marketplace", False),
                                "tags": r.get("tags"), "cost_type": r.get("cost_type", "actual"),
                            }
                            for r in batch
                        ])
                        await db.commit()
                        total_inserted += len(batch)
                logger.info(f"Azure blob {blob_idx+1} done: {total_inserted} total inserted")

            except Exception as file_err:
                logger.error(f"Failed to process Azure blob {blob_name}: {file_err}", exc_info=True)
                continue

        # Step 5 -- finalize
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ControlTower)
                .where(ControlTower.id == ct_id)
                .values(last_synced_at=datetime.now(timezone.utc), is_active=True)
            )
            if sync_log_id:
                await db.execute(
                    update(SyncLog).where(SyncLog.id == sync_log_id).values(
                        status="completed",
                        records_synced=total_inserted,
                        date_range_start=dt_date.fromisoformat(start_date),
                        date_range_end=dt_date.fromisoformat(end_date),
                        finished_at=datetime.now(timezone.utc),
                    )
                )
            await db.commit()

        _sync_progress[ct_id] = {"percent": 100, "status": "done", "message": f"Completed -- {total_inserted} records"}
        logger.info(f"Azure sync done for CT {ct_id}: {total_inserted} records")

        try:
            await _refresh_azure_monthly_summary(ct_id)
            # Clear in-memory API cache so next request fetches fresh data from summary table
            from app.routers.azure_costs import _cache
            keys_to_clear = [k for k in _cache if k.startswith(("az_overview_", "az_summary_", "az_biz_costs_", "az_subs_", "az_browse_subs", "az_meta_subs"))]
            for k in keys_to_clear:
                _cache.pop(k, None)
            logger.info(f"Azure API cache cleared after sync for CT {ct_id}: {len(keys_to_clear)} keys")
        except Exception as cache_err:
            logger.warning(f"Azure monthly summary refresh failed (non-fatal): {cache_err}")

    except Exception as e:
        logger.error(f"Azure sync failed for CT {ct_id}: {e}", exc_info=True)
        async with AsyncSessionLocal() as db:
            if sync_log_id:
                await db.execute(
                    update(SyncLog).where(SyncLog.id == sync_log_id).values(
                        status="failed",
                        error_message=str(e),
                        finished_at=datetime.now(timezone.utc),
                    )
                )
                await db.commit()
        _sync_progress[ct_id] = {"percent": 0, "status": "failed", "message": str(e)}

@router.post("/rebuild-azure-summary")
async def rebuild_azure_summary(
    bg: BackgroundTasks,
    user: User = Depends(get_current_user),
):
    """Rebuild azure_monthly_summary from scratch for ALL control towers.
    Use this to fix incorrect month data after a bad sync.
    """
    if user.role == "viewer":
        raise HTTPException(status_code=403)
    bg.add_task(_rebuild_all_azure_summaries)
    # Also clear in-memory cache immediately
    from app.routers.azure_costs import _cache
    _cache.clear()
    return {"message": "Azure monthly summary rebuild started. All month data will be correct after completion."}


@router.get("/sync-active")
async def list_active_syncs(user: User = Depends(get_current_user)):
    """Returns all CTs that currently have a running sync."""
    return {
        ct_id: progress
        for ct_id, progress in _sync_progress.items()
        if progress.get("status") == "running"
    }


@router.get("/generate-external-id")
async def generate_external_id(user: User = Depends(get_current_user)):
    """Generate an External ID to use in CFT before onboarding"""
    return {
        "external_id": str(uuid.uuid4()),
        "instructions": [
            "1. Copy this External ID",
            "2. Deploy the CFT in your management account using this External ID",
            "3. Copy the Role ARN from CFT Outputs",
            "4. Come back and click Add Control Tower â†’ IAM Role",
            "5. Paste the Role ARN and this same External ID",
        ],
    }


@router.get("/trust-policy")
async def trust_policy(user: User = Depends(get_current_user)):
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": f"arn:aws:iam::{settings.PORTAL_ACCOUNT_ID}:root"},
            "Action": "sts:AssumeRole",
            "Condition": {"StringEquals": {"sts:ExternalId": "<use-generated-external-id>"}},
        }],
    }


@router.post("/onboard/keys", response_model=ControlTowerOut, status_code=201)
async def onboard_keys(payload: OnboardKeys, bg: BackgroundTasks, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot onboard")
    temp = ControlTower(
        user_id=user.id, name=payload.name,
        management_account_name=payload.management_account_name,
        management_account_id="pending",
        auth_method="keys",
        cloud_provider="aws",
        access_key_id=payload.access_key_id,
        encrypted_secret_key=encrypt(payload.secret_access_key),
        cur_s3_bucket=payload.cur_s3_bucket,
        cur_s3_prefix=payload.cur_s3_prefix,
    )
    ok, aws_id = test_connectivity(temp)
    if not ok:
        raise HTTPException(status_code=400, detail=f"AWS connectivity failed: {aws_id}")
    temp.management_account_id = aws_id
    temp.is_active = True
    db.add(temp)
    await db.commit()
    await db.refresh(temp)
    bg.add_task(_do_sync, str(temp.id), "manual")
    return ControlTowerOut(
        id=temp.id, name=temp.name, cloud_provider=temp.cloud_provider,
        management_account_id=temp.management_account_id,
        management_account_name=temp.management_account_name,
        auth_method=temp.auth_method, is_active=temp.is_active,
        auto_sync_enabled=temp.auto_sync_enabled,
        last_synced_at=temp.last_synced_at,
        external_id=temp.external_id,
        cur_s3_bucket=temp.cur_s3_bucket,
        cur_s3_prefix=temp.cur_s3_prefix,
        sub_accounts=[],
    )


@router.post("/onboard/role", response_model=ControlTowerOut, status_code=201)
async def onboard_role(payload: OnboardRole, bg: BackgroundTasks, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot onboard")
    ext_id = payload.external_id or str(uuid.uuid4())
    temp = ControlTower(
        user_id=user.id, name=payload.name,
        management_account_name=payload.management_account_name,
        management_account_id="pending",
        auth_method="role",
        cloud_provider="aws",
        role_arn=payload.role_arn,
        external_id=ext_id,
        cur_s3_bucket=payload.cur_s3_bucket,
        cur_s3_prefix=payload.cur_s3_prefix,
    )
    ok, aws_id = test_connectivity(temp)
    if not ok:
        raise HTTPException(status_code=400, detail=f"AWS role assumption failed: {aws_id}")
    temp.management_account_id = aws_id
    temp.is_active = True
    db.add(temp)
    await db.commit()
    await db.refresh(temp)
    bg.add_task(_do_sync, str(temp.id), "manual")
    return ControlTowerOut(
        id=temp.id, name=temp.name, cloud_provider=temp.cloud_provider,
        management_account_id=temp.management_account_id,
        management_account_name=temp.management_account_name,
        auth_method=temp.auth_method, is_active=temp.is_active,
        auto_sync_enabled=temp.auto_sync_enabled,
        last_synced_at=temp.last_synced_at,
        external_id=temp.external_id,
        cur_s3_bucket=temp.cur_s3_bucket,
        cur_s3_prefix=temp.cur_s3_prefix,
        sub_accounts=[],
    )


@router.post("/onboard/azure", response_model=ControlTowerOut, status_code=201)
async def onboard_azure(payload: OnboardAzure, bg: BackgroundTasks, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot onboard")
    temp = ControlTower(
        user_id=user.id, name=payload.name,
        management_account_name=payload.name,
        management_account_id=payload.tenant_id,
        auth_method="azure_service_principal",
        cloud_provider="azure",
        azure_tenant_id=payload.tenant_id,
        azure_client_id=payload.client_id,
        encrypted_azure_client_secret=encrypt(payload.client_secret),
        azure_storage_account=payload.storage_account,
        azure_container_name=payload.container_name,
        azure_export_name=payload.export_name,
    )
    # Skip blocking connectivity test â€” sync will fail with clear error if creds are wrong
    temp.is_active = True
    db.add(temp)
    await db.commit()
    await db.refresh(temp)
    bg.add_task(_do_sync, str(temp.id), "manual")
    return ControlTowerOut(
        id=temp.id, name=temp.name, cloud_provider=temp.cloud_provider,
        management_account_id=temp.management_account_id,
        management_account_name=temp.management_account_name,
        auth_method=temp.auth_method, is_active=temp.is_active,
        auto_sync_enabled=temp.auto_sync_enabled,
        last_synced_at=temp.last_synced_at,
        azure_tenant_id=temp.azure_tenant_id,
        azure_storage_account=temp.azure_storage_account,
        azure_container_name=temp.azure_container_name,
        azure_export_name=temp.azure_export_name,
        sub_accounts=[],
    )


@router.get("/", response_model=list[ControlTowerOut])
async def list_towers(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        result = await db.execute(select(ControlTower))
    else:
        result = await db.execute(select(ControlTower).where(ControlTower.user_id == user.id))
    towers = result.scalars().all()
    if not towers:
        return []

    # Single query for all sub_accounts â€” eliminates N+1
    tower_ids = [t.id for t in towers]
    sub_result = await db.execute(select(SubAccount).where(SubAccount.control_tower_id.in_(tower_ids)))
    all_subs = sub_result.scalars().all()
    subs_by_tower: dict = {}
    for s in all_subs:
        subs_by_tower.setdefault(str(s.control_tower_id), []).append(s)

    return [
        ControlTowerOut(
            id=t.id, name=t.name, cloud_provider=t.cloud_provider or "aws",
            management_account_id=t.management_account_id,
            management_account_name=t.management_account_name,
            auth_method=t.auth_method, is_active=t.is_active,
            auto_sync_enabled=t.auto_sync_enabled,
            last_synced_at=t.last_synced_at,
            external_id=t.external_id,
            cur_s3_bucket=t.cur_s3_bucket,
            cur_s3_prefix=t.cur_s3_prefix,
            azure_tenant_id=t.azure_tenant_id,
            azure_storage_account=t.azure_storage_account,
            azure_container_name=t.azure_container_name,
            azure_export_name=t.azure_export_name,
            sub_accounts=[
                SubAccountOut(id=s.id, aws_account_id=s.aws_account_id, account_name=s.account_name, is_active=s.is_active)
                for s in subs_by_tower.get(str(t.id), [])
            ],
        )
        for t in towers
    ]


# â”€â”€ dynamic /{ct_id} routes AFTER all static routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/{ct_id}/sync")
async def sync_tower(
    ct_id: str,
    bg: BackgroundTasks,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot sync")
    result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Control Tower not found")
    bg.add_task(_do_sync, ct_id, "manual", start_date, end_date)
    return {"message": "Sync started", "start_date": start_date, "end_date": end_date}


@router.post("/sync-all-azure")
async def sync_all_azure(
    bg: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Trigger daily sync for all Azure control towers immediately."""
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot sync")
    result = await db.execute(
        select(ControlTower).where(
            ControlTower.cloud_provider == "azure",
            ControlTower.auto_sync_enabled == True,
        )
    )
    cts = result.scalars().all()
    for ct in cts:
        bg.add_task(_do_sync, str(ct.id), "manual")
    return {"message": f"Sync triggered for {len(cts)} Azure control tower(s)", "ids": [str(ct.id) for ct in cts]}


@router.get("/{ct_id}/sync-status")
async def sync_status(ct_id: str, user: User = Depends(get_current_user)):
    return _sync_progress.get(ct_id, {"percent": 0, "status": "idle", "message": ""})


@router.patch("/{ct_id}/name")
async def update_tower_name(
    ct_id: str,
    name: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(status_code=403)
    result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
    ct = result.scalar_one_or_none()
    if not ct:
        raise HTTPException(status_code=404)
    ct.name = name
    await db.commit()
    return {"id": ct_id, "name": name}


@router.patch("/{ct_id}/auto-sync")
async def toggle_auto_sync(ct_id: str, enabled: bool, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot modify")
    result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
    ct = result.scalar_one_or_none()
    if not ct:
        raise HTTPException(status_code=404, detail="Not found")
    ct.auto_sync_enabled = enabled
    await db.commit()
    return {"auto_sync_enabled": ct.auto_sync_enabled}


@router.delete("/{ct_id}", status_code=204)
async def delete_tower(ct_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot delete")
    result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
    ct = result.scalar_one_or_none()
    if not ct:
        raise HTTPException(status_code=404, detail="Not found")
    await db.delete(ct)
    await db.commit()

