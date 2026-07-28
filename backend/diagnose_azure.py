"""
Azure Sync Diagnostics — run inside backend container:
  docker-compose exec backend python diagnose_azure.py
"""
import asyncio, sys, os, time
from datetime import date, datetime, timezone

CT_ID = "051dd3a4-9b33-42b4-ad09-e4606264fd11"

# ── 1. DB connection + fetch CT ───────────────────────────────────────────────
async def check_db_and_ct():
    print("\n=== [1] DB CONNECTION + CONTROL TOWER ===")
    from app.models.database import AsyncSessionLocal
    from app.models.db_models import ControlTower
    from sqlalchemy import select, text
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
            print("  ✓ DB connected")

            result = await db.execute(select(ControlTower).where(ControlTower.id == CT_ID))
            ct = result.scalar_one_or_none()
            if not ct:
                print(f"  ✗ ControlTower {CT_ID} NOT FOUND in DB")
                return None
            print(f"  ✓ CT found: name={ct.name}, provider={ct.cloud_provider}")
            print(f"    tenant_id={ct.azure_tenant_id}")
            print(f"    client_id={ct.azure_client_id}")
            print(f"    storage_account={ct.azure_storage_account}")
            print(f"    container_name={ct.azure_container_name}")
            print(f"    export_name={ct.azure_export_name}")
            print(f"    secret_set={'YES' if ct.encrypted_azure_client_secret else 'NO'}")
            return ct
    except Exception as e:
        print(f"  ✗ DB error: {e}")
        return None

# ── 2. Azure credential + token ───────────────────────────────────────────────
def check_credentials(ct):
    print("\n=== [2] AZURE CREDENTIALS ===")
    try:
        from app.services.azure_session import get_azure_credential
        cred = get_azure_credential(ct)
        token = cred.get_token("https://storage.azure.com/.default")
        if token and token.token:
            exp = datetime.fromtimestamp(token.expires_on, tz=timezone.utc)
            print(f"  ✓ Token obtained, expires: {exp.isoformat()}")
            return cred
        else:
            print("  ✗ Token empty")
            return None
    except Exception as e:
        print(f"  ✗ Credential error: {e}")
        return None

# ── 3. Clock drift ────────────────────────────────────────────────────────────
def check_clock():
    print("\n=== [3] SYSTEM CLOCK ===")
    import subprocess
    try:
        r = subprocess.run(["chronyc", "tracking"], capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            if "System time" in line or "RMS offset" in line or "Last offset" in line:
                print(f"  {line.strip()}")
    except Exception:
        pass
    now_utc = datetime.now(timezone.utc)
    print(f"  System UTC: {now_utc.isoformat()}")

# ── 4. Blob service client + container access ─────────────────────────────────
def check_blob_access(ct):
    print("\n=== [4] BLOB STORAGE ACCESS ===")
    try:
        from app.services.azure_session import get_blob_service_client
        client = get_blob_service_client(ct)
        container = client.get_container_client(ct.azure_container_name)
        props = container.get_container_properties()
        print(f"  ✓ Container '{ct.azure_container_name}' accessible")
        print(f"    Last modified: {props.get('last_modified', 'N/A')}")
        return container
    except Exception as e:
        print(f"  ✗ Blob access error: {e}")
        return None

# ── 5. List ALL top-level prefixes in container ───────────────────────────────
def check_container_structure(ct, container):
    print("\n=== [5] CONTAINER STRUCTURE (top-level folders) ===")
    try:
        # List blobs with delimiter to get virtual folders
        from azure.storage.blob import BlobServiceClient
        client = get_blob_service_client(ct) if container is None else None
        svc = ct  # reuse
        from app.services.azure_session import get_blob_service_client as gbsc
        blob_svc = gbsc(ct)
        cont = blob_svc.get_container_client(ct.azure_container_name)

        # Walk top-level prefixes
        seen = set()
        blobs = list(cont.list_blobs())
        print(f"  Total blobs in container: {len(blobs)}")
        for b in blobs:
            top = b.name.split("/")[0]
            seen.add(top)
        print(f"  Top-level folders ({len(seen)}):")
        for f in sorted(seen):
            count = sum(1 for b in blobs if b.name.startswith(f + "/") and b.name.endswith(".csv"))
            print(f"    {f}/  → {count} CSV files")
        return blobs
    except Exception as e:
        print(f"  ✗ Container listing error: {e}")
        return []

# ── 6. Check specific prefixes used by sync ───────────────────────────────────
def check_sync_prefixes(ct, blobs):
    print("\n=== [6] SYNC PREFIXES CHECK ===")
    prefixes = [
        "finoptix-actualcost/",
        "finoptix-amortizedcost/",
        "finoptix-daily-actualcost/",
        "finoptix-daily-amortizedcost/",
    ]
    for prefix in prefixes:
        found = [b for b in blobs if b.name.startswith(prefix) and b.name.endswith(".csv")]
        if found:
            latest = max(found, key=lambda b: b.last_modified)
            oldest = min(found, key=lambda b: b.last_modified)
            print(f"  ✓ {prefix}: {len(found)} CSVs")
            print(f"      oldest: {oldest.name} ({oldest.last_modified.date()})")
            print(f"      latest: {latest.name} ({latest.last_modified.date()})")
        else:
            print(f"  ✗ {prefix}: 0 CSVs — NOT FOUND")

# ── 7. Check date coverage in daily blobs ─────────────────────────────────────
def check_daily_date_coverage(ct, blobs):
    print("\n=== [7] DAILY BLOB DATE COVERAGE ===")
    today = date.today()
    print(f"  Today: {today}")
    for prefix in ["finoptix-daily-actualcost/", "finoptix-daily-amortizedcost/"]:
        found = [b for b in blobs if b.name.startswith(prefix) and b.name.endswith(".csv")]
        if not found:
            print(f"  {prefix}: no files")
            continue
        dates = sorted(set(b.last_modified.date() for b in found))
        print(f"  {prefix}: {len(found)} files, date range {dates[0]} → {dates[-1]}")
        if dates[-1] < today:
            print(f"    ⚠ Latest file is {(today - dates[-1]).days} day(s) old — Azure export may be delayed")
        else:
            print(f"    ✓ Has today's data")

# ── 8. Sample parse one daily blob ────────────────────────────────────────────
def check_sample_parse(ct, blobs):
    print("\n=== [8] SAMPLE BLOB PARSE ===")
    daily = [b for b in blobs if b.name.startswith("finoptix-daily-actualcost/") and b.name.endswith(".csv")]
    if not daily:
        print("  No daily actual blobs to sample")
        return
    sample = max(daily, key=lambda b: b.last_modified)
    print(f"  Sampling: {sample.name}")
    try:
        from app.services.azure_cost_service import stream_azure_cost_batches
        today = date.today()
        start = today.replace(day=1).isoformat()
        end = today.isoformat()
        rows = 0
        for batch in stream_azure_cost_batches(ct, sample.name, start, end, 500):
            rows += len(batch)
            if rows >= 500:
                break
        print(f"  ✓ Parsed {rows} rows from blob (date range {start} → {end})")
        if rows == 0:
            print(f"  ⚠ 0 rows parsed — blob may have data outside {start}→{end} range")
            # Try wider range
            rows2 = 0
            for batch in stream_azure_cost_batches(ct, sample.name, "2026-01-01", end, 500):
                rows2 += len(batch)
                if rows2 >= 500:
                    break
            print(f"  Wide range (2026-01-01→{end}): {rows2} rows")
    except Exception as e:
        print(f"  ✗ Parse error: {e}")

# ── 9. DB record counts ───────────────────────────────────────────────────────
async def check_db_counts():
    print("\n=== [9] DB RECORD COUNTS ===")
    from app.models.database import AsyncSessionLocal
    from sqlalchemy import text
    import uuid as _uuid
    try:
        async with AsyncSessionLocal() as db:
            # Total azure records
            r = await db.execute(text("SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=_uuid.UUID(CT_ID)))
            total = r.scalar()
            print(f"  azure_cost_records total: {total}")

            # By cost_type
            r = await db.execute(text("SELECT cost_type, COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id GROUP BY cost_type").bindparams(id=_uuid.UUID(CT_ID)))
            for row in r.fetchall():
                print(f"    cost_type={row[0]}: {row[1]} rows")

            # Date range
            r = await db.execute(text("SELECT MIN(date), MAX(date) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=_uuid.UUID(CT_ID)))
            row = r.fetchone()
            print(f"  Date range in DB: {row[0]} → {row[1]}")

            # Recent sync logs
            r = await db.execute(text("SELECT status, records_synced, error_message, started_at, finished_at FROM sync_logs WHERE control_tower_id = :id ORDER BY started_at DESC LIMIT 5").bindparams(id=_uuid.UUID(CT_ID)))
            print(f"\n  Last 5 sync logs:")
            for row in r.fetchall():
                duration = (row[4] - row[3]).seconds if row[3] and row[4] else "?"
                print(f"    [{row[0]}] records={row[1]} duration={duration}s error={row[2]}")
    except Exception as e:
        print(f"  ✗ DB count error: {e}")

# ── 10. RDS timeout test ──────────────────────────────────────────────────────
async def check_rds_timeout():
    print("\n=== [10] RDS DELETE TIMEOUT TEST ===")
    from app.models.database import AsyncSessionLocal
    from sqlalchemy import text
    import uuid as _uuid
    try:
        async with AsyncSessionLocal() as db:
            t0 = time.time()
            # EXPLAIN only — don't actually delete
            r = await db.execute(
                text("EXPLAIN SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id AND date >= '2026-07-01' AND date <= '2026-07-28'")
                .bindparams(id=_uuid.UUID(CT_ID))
            )
            elapsed = time.time() - t0
            rows = r.fetchall()
            print(f"  EXPLAIN took {elapsed:.2f}s")
            for row in rows:
                print(f"    {row[0]}")
    except Exception as e:
        print(f"  ✗ RDS test error: {e}")

# ── main ──────────────────────────────────────────────────────────────────────
async def main():
    print("=" * 60)
    print("AZURE SYNC DIAGNOSTICS")
    print("=" * 60)

    ct = await check_db_and_ct()
    if not ct:
        print("\nCannot continue without CT. Exiting.")
        return

    check_clock()
    cred = check_credentials(ct)
    container = check_blob_access(ct)
    blobs = check_container_structure(ct, container)
    if blobs:
        check_sync_prefixes(ct, blobs)
        check_daily_date_coverage(ct, blobs)
        check_sample_parse(ct, blobs)
    await check_db_counts()
    await check_rds_timeout()

    print("\n" + "=" * 60)
    print("DIAGNOSTICS COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    sys.path.insert(0, "/app")
    os.chdir("/app")
    asyncio.run(main())
