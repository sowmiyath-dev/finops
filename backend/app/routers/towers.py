import uuid, asyncio, logging
from datetime import datetime, timezone, date, timedelta
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func

from app.models.database import get_db, AsyncSessionLocal
from app.models.db_models import User, ControlTower, SubAccount, CostRecord, SyncLog, AzureCostRecord
from app.models.schemas import OnboardKeys, OnboardRole, OnboardAzure, ControlTowerOut, SubAccountOut
from app.services.auth_service import get_current_user
from app.services.crypto_service import encrypt
from app.services.aws_session import test_connectivity, list_org_accounts
from app.services.cost_service import fetch_cur_from_s3, get_sync_date_range, get_full_year_date_range, get_report_keys_for_period, fetch_cur_single_file, stream_cur_file_batches
from app.services.azure_session import test_azure_connectivity, list_azure_subscriptions
from app.services.azure_cost_service import stream_azure_cost_batches, find_azure_export_blobs, get_azure_billing_periods
from app.config import settings

router = APIRouter(prefix="/towers", tags=["towers"])
logger = logging.getLogger(__name__)

_sync_progress: dict = {}
_executor = ThreadPoolExecutor(max_workers=8)
_sync_semaphore = asyncio.Semaphore(3)


# ── helpers ───────────────────────────────────────────────────────────────────

async def _upsert_sub_accounts(db: AsyncSession, ct_id: str, accounts: list[dict]):
    for acc in accounts:
        existing = await db.execute(
            select(SubAccount).where(
                SubAccount.control_tower_id == ct_id,
                SubAccount.aws_account_id == acc["aws_account_id"],
            )
        )
        row = existing.scalar_one_or_none()
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
    async with _sync_semaphore:
        _sync_progress[ct_id] = {"percent": 0, "status": "running", "message": "Initializing"}
        sync_log_id = None

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()
                if not ct:
                    return

            # Route to Azure sync if cloud_provider is azure
            if ct.cloud_provider == "azure":
                await _do_azure_sync(ct_id, triggered_by)
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

            # Step 1 — discover sub-accounts
            _sync_progress[ct_id]["message"] = "Discovering accounts"
            _sync_progress[ct_id]["percent"] = 10
            loop = asyncio.get_running_loop()

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()
            org_accounts = await loop.run_in_executor(_executor, list_org_accounts, ct)
            async with AsyncSessionLocal() as db:
                await _upsert_sub_accounts(db, ct_id, org_accounts)

            # Step 2 — determine date range
            _sync_progress[ct_id]["message"] = "Checking existing data"
            _sync_progress[ct_id]["percent"] = 20
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()
                count_result = await db.execute(
                    select(func.count()).where(CostRecord.control_tower_id == ct_id)
                )
                existing_count = count_result.scalar() or 0

            if force_start and force_end:
                start_date, end_date = force_start, force_end
                logger.info(f"Forced date range for CT {ct_id}: {start_date} → {end_date}")
            elif existing_count == 0:
                start_date, end_date = get_full_year_date_range()
                logger.info(f"First sync for CT {ct_id} — full year: {start_date} → {end_date}")
            else:
                start_date, end_date = get_sync_date_range(days_back=7)
                logger.info(f"Incremental sync for CT {ct_id} — last 7 days: {start_date} → {end_date}")

            # Step 3 — load sub_map
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

            # Step 4 — fetch and insert ONE FILE AT A TIME to avoid OOM
            from app.services.cost_service import _get_billing_periods_for_range
            billing_periods = _get_billing_periods_for_range(start_date, end_date)
            total_inserted = 0

            for period_idx, period in enumerate(billing_periods):
                p_start = date(int(period[:4]), int(period[4:6]), int(period[6:8]))
                p_end_raw = date(int(period[9:13]), int(period[13:15]), int(period[15:17]))
                month_start = max(p_start, date.fromisoformat(start_date))
                month_end = min(p_end_raw - timedelta(days=1), date.fromisoformat(end_date))

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

                # Delete existing records for this month
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        delete(CostRecord).where(
                            CostRecord.control_tower_id == ct_id,
                            CostRecord.date >= month_start,
                            CostRecord.date <= month_end,
                        )
                    )
                    await db.commit()

                # Process ONE FILE AT A TIME using streaming batches
                for file_idx, report_key in enumerate(report_keys):
                    logger.info(f"Period {period} file {file_idx+1}/{len(report_keys)}: {report_key}")
                    try:
                        # stream_cur_file_batches is a generator — runs in executor per batch
                        streamer = await loop.run_in_executor(
                            _executor,
                            lambda rk=report_key: list(stream_cur_file_batches(
                                ct, rk, month_start.isoformat(), month_end.isoformat(), 5000
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

            # Step 5 — finalize
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


# ── Azure sync ────────────────────────────────────────────────────────────────

async def _refresh_azure_monthly_summary(ct_id: str):
    """Pre-aggregate Azure cost by subscription per month into azure_monthly_summary."""
    from app.models.db_models import AzureMonthlySummary
    async with AsyncSessionLocal() as db:
        # Delete existing summary for this CT
        await db.execute(delete(AzureMonthlySummary).where(AzureMonthlySummary.control_tower_id == ct_id))

        # Aggregate actual cost by month+subscription
        from sqlalchemy import text
        await db.execute(text("""
            INSERT INTO azure_monthly_summary (id, control_tower_id, month, subscription_id, subscription_name, actual_cost, amortized_cost, refreshed_at)
            SELECT gen_random_uuid(), a.control_tower_id, a.month, a.subscription_id, a.subscription_name,
                   COALESCE(a.actual_cost, 0), COALESCE(m.amortized_cost, 0), NOW()
            FROM (
                SELECT control_tower_id, TO_CHAR(date, 'YYYY-MM') as month,
                       subscription_id, MAX(subscription_name) as subscription_name,
                       SUM(actual_cost) as actual_cost
                FROM azure_cost_records
                WHERE control_tower_id = :ct_id AND cost_type = 'actual'
                GROUP BY control_tower_id, TO_CHAR(date, 'YYYY-MM'), subscription_id
            ) a
            LEFT JOIN (
                SELECT TO_CHAR(date, 'YYYY-MM') as month, subscription_id,
                       SUM(amortized_cost) as amortized_cost
                FROM azure_cost_records
                WHERE control_tower_id = :ct_id AND cost_type = 'amortized'
                GROUP BY TO_CHAR(date, 'YYYY-MM'), subscription_id
            ) m ON a.month = m.month AND a.subscription_id = m.subscription_id
        """), {"ct_id": ct_id})
        await db.commit()
        logger.info(f"Azure monthly summary refreshed for CT {ct_id}")


async def _do_azure_sync(ct_id: str, triggered_by: str = "manual"):
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

        # Step 1 — discover subscriptions
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

        # Step 2 — determine date range
        _sync_progress[ct_id]["message"] = "Checking existing data"
        _sync_progress[ct_id]["percent"] = 20

        # Use EXISTS instead of COUNT(*) — much faster on large tables
        from sqlalchemy import text as sa_text
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                sa_text("SELECT EXISTS(SELECT 1 FROM azure_cost_records WHERE control_tower_id = :ct_id LIMIT 1)")
                .bindparams(ct_id=ct_id)
            )
            existing_count = 1 if result.scalar() else 0

        if existing_count == 0:
            start_date, end_date = "2026-01-01", get_sync_date_range()[1]
            logger.info(f"Azure full sync for CT {ct_id}: {start_date} → {end_date}")
        else:
            # Daily incremental — only re-read daily folders for current month
            from datetime import date as dt_date
            today = dt_date.today()
            start_date = today.replace(day=1).isoformat()
            end_date = today.isoformat()
            logger.info(f"Azure daily sync for CT {ct_id}: {start_date} → {end_date}")

        # Step 3 — load sub_map
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

        # Step 4 — find blobs and parse
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

        # Delete existing Azure records for the date range
        from datetime import date as dt_date
        start_dt = dt_date.fromisoformat(start_date)
        end_dt = dt_date.fromisoformat(end_date)

        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(AzureCostRecord).where(
                    AzureCostRecord.control_tower_id == ct_id,
                    AzureCostRecord.date >= start_dt,
                    AzureCostRecord.date <= end_dt,
                )
            )
            await db.commit()

        total_inserted = 0

        for blob_idx, blob_name in enumerate(csv_blobs):
            _sync_progress[ct_id]["message"] = f"Processing file {blob_idx+1}/{len(csv_blobs)}"
            _sync_progress[ct_id]["percent"] = 30 + int(60 * blob_idx / len(csv_blobs))
            logger.info(f"Azure processing blob {blob_idx+1}/{len(csv_blobs)}: {blob_name}")

            try:
                # Re-fetch CT to avoid stale connection
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                    ct_ref = result.scalar_one_or_none()

                # Use a queue to bridge sync generator → async consumer
                import queue as _queue
                q: _queue.Queue = _queue.Queue(maxsize=4)
                DONE = object()

                def _produce(bn=blob_name, c=ct_ref):
                    try:
                        for batch in stream_azure_cost_batches(c, bn, start_date, end_date, 500):
                            q.put(batch)
                    finally:
                        q.put(DONE)

                producer = loop.run_in_executor(_executor, _produce)

                while True:
                    batch = await loop.run_in_executor(None, q.get)
                    if batch is DONE:
                        break
                    if not batch:
                        continue
                    async with AsyncSessionLocal() as db:
                        db.add_all([
                            AzureCostRecord(
                                control_tower_id=ct_id,
                                subscription_id=r["subscription_id"],
                                subscription_name=r["subscription_name"],
                                resource_group=r.get("resource_group"),
                                resource_id=r.get("resource_id"),
                                resource_name=r.get("resource_name"),
                                date=r["date"],
                                billing_currency=r.get("billing_currency", "INR"),
                                actual_cost=r.get("actual_cost", 0),
                                amortized_cost=r.get("amortized_cost", 0),
                                quantity=r.get("quantity", 0),
                                unit=r.get("unit"),
                                service=r["service"],
                                meter_subcategory=r.get("meter_subcategory"),
                                meter_name=r.get("meter_name"),
                                product_name=r.get("product_name"),
                                region=r.get("region"),
                                charge_type=r.get("charge_type", "Usage"),
                                pricing_model=r.get("pricing_model", "OnDemand"),
                                is_marketplace=r.get("is_marketplace", False),
                                tags=r.get("tags"),
                                cost_type=r.get("cost_type", "actual"),
                            )
                            for r in batch
                        ])
                        await db.commit()
                        total_inserted += len(batch)
                        logger.info(f"Azure blob {blob_idx+1}/{len(csv_blobs)}: {total_inserted} total inserted")

                await producer
                logger.info(f"Azure blob {blob_idx+1} done: {total_inserted} total inserted")

            except Exception as file_err:
                logger.error(f"Failed to process Azure blob {blob_name}: {file_err}", exc_info=True)
                continue

        # Step 5 — finalize
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

        _sync_progress[ct_id] = {"percent": 100, "status": "done", "message": f"Completed — {total_inserted} records"}
        logger.info(f"Azure sync done for CT {ct_id}: {total_inserted} records")

        # Refresh Azure monthly summary cache
        try:
            await _refresh_azure_monthly_summary(ct_id)
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


# ── static routes MUST be before /{ct_id} dynamic routes ─────────────────────

@router.get("/generate-external-id")
async def generate_external_id(user: User = Depends(get_current_user)):
    """Generate an External ID to use in CFT before onboarding"""
    return {
        "external_id": str(uuid.uuid4()),
        "instructions": [
            "1. Copy this External ID",
            "2. Deploy the CFT in your management account using this External ID",
            "3. Copy the Role ARN from CFT Outputs",
            "4. Come back and click Add Control Tower → IAM Role",
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
    # Skip blocking connectivity test — sync will fail with clear error if creds are wrong
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

    # Single query for all sub_accounts — eliminates N+1
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


# ── dynamic /{ct_id} routes AFTER all static routes ──────────────────────────

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
