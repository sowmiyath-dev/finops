import uuid, asyncio, logging
from datetime import datetime, timezone, date, timedelta
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from app.models.database import get_db, AsyncSessionLocal
from app.models.db_models import User, ControlTower, SubAccount, CostRecord, SyncLog
from app.models.schemas import OnboardKeys, OnboardRole, ControlTowerOut
from app.services.auth_service import get_current_user
from app.services.crypto_service import encrypt
from app.services.aws_session import test_connectivity, list_org_accounts
from app.services.cost_service import fetch_cur_from_s3, get_sync_date_range
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
        start_time = datetime.now(timezone.utc)

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

            # Step 1 — discover sub-accounts
            _sync_progress[ct_id]["message"] = "Discovering accounts"
            _sync_progress[ct_id]["percent"] = 10
            loop = asyncio.get_event_loop()

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()

            org_accounts = await loop.run_in_executor(_executor, list_org_accounts, ct)

            async with AsyncSessionLocal() as db:
                await _upsert_sub_accounts(db, ct_id, org_accounts)

            # Step 2 — fetch CUR from S3
            _sync_progress[ct_id]["message"] = "Fetching CUR from S3"
            _sync_progress[ct_id]["percent"] = 30

            start_date, end_date = get_sync_date_range(days_back=7)

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(ControlTower).where(ControlTower.id == ct_id))
                ct = result.scalar_one_or_none()

            raw_records = await loop.run_in_executor(
                _executor, fetch_cur_from_s3, ct, start_date, end_date
            )

            _sync_progress[ct_id]["message"] = "Storing records"
            _sync_progress[ct_id]["percent"] = 70

            # Step 3 — store records
            async with AsyncSessionLocal() as db:
                sub_result = await db.execute(
                    select(SubAccount).where(SubAccount.control_tower_id == ct_id)
                )
                sub_map = {s.aws_account_id: s for s in sub_result.scalars().all()}

                await db.execute(
                    delete(CostRecord).where(
                        CostRecord.control_tower_id == ct_id,
                        CostRecord.date >= start_date,
                        CostRecord.date <= end_date,
                    )
                )

                rows_to_insert = []
                for r in raw_records:
                    sub = sub_map.get(r["aws_account_id"])
                    if not sub:
                        continue
                    rows_to_insert.append(CostRecord(
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
                        tags=r.get("tags"),
                    ))

                if rows_to_insert:
                    db.add_all(rows_to_insert)

                await db.execute(
                    update(ControlTower)
                    .where(ControlTower.id == ct_id)
                    .values(last_synced_at=datetime.now(timezone.utc), is_active=True)
                )

                if sync_log_id:
                    await db.execute(
                        update(SyncLog).where(SyncLog.id == sync_log_id).values(
                            status="completed",
                            records_synced=len(rows_to_insert),
                            date_range_start=start_date,
                            date_range_end=end_date,
                            finished_at=datetime.now(timezone.utc),
                        )
                    )
                await db.commit()

            _sync_progress[ct_id] = {"percent": 100, "status": "done", "message": "Completed"}
            logger.info(f"Sync done for CT {ct_id}: {len(rows_to_insert)} records")

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
    result = await db.execute(select(ControlTower).where(ControlTower.id == temp.id))
    ct = result.scalar_one()
    return ct


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
    result = await db.execute(select(ControlTower).where(ControlTower.id == temp.id))
    ct = result.scalar_one()
    return ct


@router.get("/", response_model=list[ControlTowerOut])
async def list_towers(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        result = await db.execute(select(ControlTower))
    else:
        result = await db.execute(select(ControlTower).where(ControlTower.user_id == user.id))
    towers = result.scalars().all()
    for t in towers:
        sub_result = await db.execute(select(SubAccount).where(SubAccount.control_tower_id == t.id))
        t.sub_accounts = sub_result.scalars().all()
    return towers


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
