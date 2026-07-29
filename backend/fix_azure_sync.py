"""
Azure dedup + resync script.
Run inside backend container:
  docker-compose exec backend python fix_azure_sync.py

Steps:
  1. Show current counts
  2. Truncate azure_cost_records and azure_monthly_summary for this CT
  3. Trigger a full resync (existing_count=0 path) so all blobs are re-read cleanly
"""
import asyncio, sys, os, time
sys.path.insert(0, "/app")
os.chdir("/app")

CT_ID = "051dd3a4-9b33-42b4-ad09-e4606264fd11"

async def main():
    from app.models.database import AsyncSessionLocal, SyncSessionLocal
    from sqlalchemy import text
    import uuid as _uuid

    ct_uuid = _uuid.UUID(CT_ID)

    print("=" * 60)
    print("AZURE FIX: TRUNCATE + FULL RESYNC")
    print("=" * 60)

    # Step 1 -- show current counts
    print("\n[1] Current record counts...")
    async with AsyncSessionLocal() as db:
        r = await db.execute(text("SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=ct_uuid))
        total = r.scalar()
        print(f"  azure_cost_records: {total:,}")

        r = await db.execute(text("SELECT COUNT(*) FROM azure_monthly_summary WHERE control_tower_id = :id").bindparams(id=ct_uuid))
        print(f"  azure_monthly_summary: {r.scalar():,}")

    if total == 0:
        print("  Table already empty -- skipping truncate")
    else:
        # Step 2 -- truncate (much faster than DELETE on 24M rows)
        print(f"\n[2] Truncating {total:,} rows from azure_cost_records (this is fast)...")
        t0 = time.time()
        async with SyncSessionLocal() as db:
            # DELETE with CT filter -- safer than TRUNCATE (preserves other CTs if any)
            await db.execute(
                text("DELETE FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=ct_uuid)
            )
            await db.commit()
        print(f"  Done in {time.time()-t0:.1f}s")

        print("\n[2b] Clearing azure_monthly_summary...")
        async with AsyncSessionLocal() as db:
            await db.execute(
                text("DELETE FROM azure_monthly_summary WHERE control_tower_id = :id").bindparams(id=ct_uuid)
            )
            await db.commit()
        print("  Done")

    # Step 3 -- verify empty
    async with AsyncSessionLocal() as db:
        r = await db.execute(text("SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=ct_uuid))
        remaining = r.scalar()
    print(f"\n[3] Rows remaining after truncate: {remaining:,}")
    if remaining > 0:
        print("  WARNING: rows still present -- DELETE may have timed out, try again")
        return

    # Step 4 -- trigger full resync
    print("\n[4] Triggering full resync (will read ALL blobs: historical + daily)...")
    print("    This runs in the background -- check sync logs for progress")
    from app.models.database import init_db
    await init_db()
    from app.routers.towers import _do_azure_sync
    # Run directly (not background) so we can see output
    await _do_azure_sync(CT_ID, triggered_by="fix_script")

    # Step 5 -- final counts
    print("\n[5] Final record counts after resync:")
    async with AsyncSessionLocal() as db:
        r = await db.execute(text("SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=ct_uuid))
        print(f"  azure_cost_records: {r.scalar():,}")

        r = await db.execute(text("SELECT cost_type, COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id GROUP BY cost_type").bindparams(id=ct_uuid))
        for row in r.fetchall():
            print(f"    cost_type={row[0]}: {row[1]:,}")

        r = await db.execute(text("SELECT MIN(date), MAX(date) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=ct_uuid))
        row = r.fetchone()
        print(f"  Date range: {row[0]} to {row[1]}")

        r = await db.execute(text("SELECT COUNT(*) FROM azure_monthly_summary WHERE control_tower_id = :id").bindparams(id=ct_uuid))
        print(f"  azure_monthly_summary: {r.scalar():,}")

    print("\n" + "=" * 60)
    print("FIX COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
