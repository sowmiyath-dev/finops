"""
Reset all Azure cost data and trigger a fresh full sync.
Run inside the backend container:
  docker-compose exec backend python reset_azure_and_sync.py
"""
import asyncio
import sys
import os

CT_ID = "051dd3a4-9b33-42b4-ad09-e4606264fd11"


async def main():
    from app.models.database import AsyncSessionLocal, SyncSessionLocal, init_db
    from sqlalchemy import text
    import uuid as _uuid

    await init_db()
    ct_uuid = _uuid.UUID(CT_ID)

    print("=" * 60)
    print("STEP 1 — Truncating Azure cost data for this CT")
    print("=" * 60)

    async with SyncSessionLocal() as db:
        r = await db.execute(
            text("DELETE FROM azure_cost_records WHERE control_tower_id = :id")
            .bindparams(id=ct_uuid)
        )
        print(f"  Deleted {r.rowcount} rows from azure_cost_records")

        r = await db.execute(
            text("DELETE FROM azure_monthly_summary WHERE control_tower_id = :id")
            .bindparams(id=ct_uuid)
        )
        print(f"  Deleted {r.rowcount} rows from azure_monthly_summary")

        r = await db.execute(
            text("DELETE FROM sync_logs WHERE control_tower_id = :id")
            .bindparams(id=ct_uuid)
        )
        print(f"  Deleted {r.rowcount} rows from sync_logs")

        await db.execute(
            text("UPDATE control_towers SET last_synced_at = NULL WHERE id = :id")
            .bindparams(id=ct_uuid)
        )
        print("  Reset last_synced_at to NULL")

        await db.commit()
    print("  DB cleanup done.\n")

    print("=" * 60)
    print("STEP 2 — Verifying CT config")
    print("=" * 60)

    from app.models.db_models import ControlTower
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        ct = (await db.execute(
            select(ControlTower).where(ControlTower.id == CT_ID)
        )).scalar_one_or_none()

    if not ct:
        print(f"  FAIL: ControlTower {CT_ID} not found. Exiting.")
        return

    print(f"  name             : {ct.name}")
    print(f"  storage_account  : {ct.azure_storage_account}")
    print(f"  container_name   : {ct.azure_container_name}")
    print(f"  export_name      : {ct.azure_export_name}")
    print(f"  cloud_provider   : {ct.cloud_provider}\n")

    print("=" * 60)
    print("STEP 3 — Starting full-year Azure sync (Jan 2026 → today)")
    print("         This runs in-process. Watch logs below.")
    print("=" * 60)

    from app.routers.towers import _do_azure_sync
    from datetime import date

    start_date = date(2026, 1, 1).isoformat()
    end_date = date.today().isoformat()

    print(f"  Sync range: {start_date} → {end_date}\n")

    await _do_azure_sync(
        CT_ID,
        triggered_by="reset_script",
        force_start=start_date,
        force_end=end_date,
    )

    print("\n" + "=" * 60)
    print("STEP 4 — Final DB counts")
    print("=" * 60)

    async with AsyncSessionLocal() as db:
        total = (await db.execute(
            text("SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id")
            .bindparams(id=ct_uuid)
        )).scalar()

        by_type = (await db.execute(
            text("SELECT cost_type, COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id GROUP BY cost_type")
            .bindparams(id=ct_uuid)
        )).fetchall()

        date_range = (await db.execute(
            text("SELECT MIN(date), MAX(date) FROM azure_cost_records WHERE control_tower_id = :id")
            .bindparams(id=ct_uuid)
        )).fetchone()

        summary_rows = (await db.execute(
            text("SELECT COUNT(*) FROM azure_monthly_summary WHERE control_tower_id = :id")
            .bindparams(id=ct_uuid)
        )).scalar()

    print(f"  azure_cost_records total : {total}")
    for row in by_type:
        print(f"    cost_type={row[0]}: {row[1]} rows")
    print(f"  Date range in DB         : {date_range[0]} → {date_range[1]}")
    print(f"  azure_monthly_summary    : {summary_rows} rows")
    print("\nDone.")


if __name__ == "__main__":
    sys.path.insert(0, "/app")
    os.chdir("/app")
    asyncio.run(main())
