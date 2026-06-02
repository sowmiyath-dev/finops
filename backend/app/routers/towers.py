import uuid, asyncio, logging
from datetime import datetime, timezone, date, timedelta
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func

from app.models.database import get_db, AsyncSessionLocal
from app.models.db_models import User, ControlTower, SubAccount, CostRecord, SyncLog
from app.models.schemas import OnboardKeys, OnboardRole, ControlTowerOut, SubAccountOut
from app.services.auth_service import get_current_user
from app.services.crypto_service import encrypt
from app.services.aws_session import test_connectivity, list_org_accounts
from app.services.cost_service import fetch_cur_from_s3, get_sync_date_range, get_full_year_date_range, get_report_keys_for_period, fetch_cur_single_file, stream_cur_file_batches
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


async def _do_sync(ct_id: str, triggered_by: str = "manual"):
    async with _sync_semaphore:
        _sync_progress[ct_id] = {"percent": 0, "status": "running", "message": "Initializing"}
        sync_log_id = None

        try:
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

            if existing_count == 0:
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
        id=temp.id, name=temp.name,
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
        id=temp.id, name=temp.name,
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


@router.get("/", response_model=list[ControlTowerOut])
async def list_towers(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        result = await db.execute(select(ControlTower))
    else:
        result = await db.execute(select(ControlTower).where(ControlTower.user_id == user.id))
    towers = result.scalars().all()

    response = []
    for t in towers:
        sub_result = await db.execute(select(SubAccount).where(SubAccount.control_tower_id == t.id))
        subs = sub_result.scalars().all()
        response.append(ControlTowerOut(
            id=t.id, name=t.name,
            management_account_id=t.management_account_id,
            management_account_name=t.management_account_name,
            auth_method=t.auth_method, is_active=t.is_active,
            auto_sync_enabled=t.auto_sync_enabled,
            last_synced_at=t.last_synced_at,
            external_id=t.external_id,
            cur_s3_bucket=t.cur_s3_bucket,
            cur_s3_prefix=t.cur_s3_prefix,
            sub_accounts=[SubAccountOut(id=s.id, aws_account_id=s.aws_account_id, account_name=s.account_name, is_active=s.is_active) for s in subs],
        ))
    return response


# ── dynamic /{ct_id} routes AFTER all static routes ──────────────────────────

@router.post("/{ct_id}/sync")
async def sync_tower(ct_id: str, bg: BackgroundTasks, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot sync")
    result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Control Tower not found")
    bg.add_task(_do_sync, ct_id, "manual")
    return {"message": "Sync started"}


@router.get("/{ct_id}/sync-status")
async def sync_status(ct_id: str, user: User = Depends(get_current_user)):
    return _sync_progress.get(ct_id, {"percent": 0, "status": "idle", "message": ""})


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
