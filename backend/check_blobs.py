"""
Blob discovery diagnostic — shows exactly which blobs will be synced and their cost_type.
Run inside backend container:
  docker-compose exec backend python check_blobs.py
"""
import asyncio, sys, os

CT_ID = "051dd3a4-9b33-42b4-ad09-e4606264fd11"

async def main():
    from app.models.database import AsyncSessionLocal, init_db
    from app.models.db_models import ControlTower
    from app.services.azure_cost_service import find_azure_export_blobs
    from sqlalchemy import select
    from datetime import date

    await init_db()

    async with AsyncSessionLocal() as db:
        ct = (await db.execute(
            select(ControlTower).where(ControlTower.id == CT_ID)
        )).scalar_one_or_none()

    if not ct:
        print(f"CT {CT_ID} not found"); return

    start_date = "2026-01-01"
    end_date   = date.today().isoformat()

    print(f"Scanning blobs: {start_date} → {end_date}")
    print(f"Storage account : {ct.azure_storage_account}")
    print(f"export_name     : {ct.azure_export_name}")
    print("=" * 70)

    blobs = find_azure_export_blobs(ct, start_date, end_date, is_first_sync=True)

    print(f"\nTotal blobs found: {len(blobs)}\n")

    # Group by container and show cost_type per blob
    for container, blob_name in sorted(blobs):
        full_path = f"{container}/{blob_name}".lower()
        cost_type = "amortized" if "amortized" in full_path and "actualcost" not in full_path else "actual"
        print(f"  [{cost_type:>9}]  [{container}]  {blob_name}")

    print("\n" + "=" * 70)
    print("Expected blobs per month (actual + amortized = 2 per month):")
    from collections import defaultdict
    month_type: dict = defaultdict(set)
    for container, blob_name in blobs:
        # extract YYYYMM from path
        import re
        m = re.search(r'(\d{4})(\d{2})\d{2}-\d{8}', blob_name)
        if m:
            month = f"{m.group(1)}-{m.group(2)}"
        else:
            month = "unknown"
        full_path = f"{container}/{blob_name}".lower()
        cost_type = "amortized" if "amortized" in full_path and "actualcost" not in full_path else "actual"
        month_type[month].add(cost_type)

    for month in sorted(month_type):
        types = month_type[month]
        status = "✓ OK" if {"actual", "amortized"} == types else f"✗ MISSING: {{'actual','amortized'} - types}"
        print(f"  {month}: {sorted(types)}  {status}")

if __name__ == "__main__":
    sys.path.insert(0, "/app")
    os.chdir("/app")
    asyncio.run(main())
