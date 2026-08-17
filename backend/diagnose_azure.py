"""
Azure Sync Diagnostics -- run inside backend container:
  docker-compose exec backend python diagnose_azure.py
"""
import asyncio, sys, os, time
from datetime import date, datetime, timezone

CT_ID = "051dd3a4-9b33-42b4-ad09-e4606264fd11"

# -- 1. DB connection + fetch CT ----------------------------------------------
async def check_db_and_ct():
    print("\n=== [1] DB CONNECTION + CONTROL TOWER ===")
    from app.models.database import AsyncSessionLocal
    from app.models.db_models import ControlTower
    from sqlalchemy import select, text
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
            print("  OK DB connected")
            result = await db.execute(select(ControlTower).where(ControlTower.id == CT_ID))
            ct = result.scalar_one_or_none()
            if not ct:
                print(f"  FAIL ControlTower {CT_ID} NOT FOUND in DB")
                return None
            print(f"  OK CT found: name={ct.name}, provider={ct.cloud_provider}")
            print(f"    tenant_id={ct.azure_tenant_id}")
            print(f"    client_id={ct.azure_client_id}")
            print(f"    storage_account={ct.azure_storage_account}")
            print(f"    container_name={ct.azure_container_name}")
            print(f"    export_name={ct.azure_export_name}")
            print(f"    secret_set={'YES' if ct.encrypted_azure_client_secret else 'NO'}")
            return ct
    except Exception as e:
        print(f"  FAIL DB error: {e}")
        return None


# -- 2. Azure credential + token ----------------------------------------------
def check_credentials(ct):
    print("\n=== [2] AZURE CREDENTIALS ===")
    try:
        from app.services.azure_session import get_azure_credential
        cred = get_azure_credential(ct)
        t0 = time.time()
        token = cred.get_token("https://storage.azure.com/.default")
        elapsed = time.time() - t0
        if token and token.token:
            exp = datetime.fromtimestamp(token.expires_on, tz=timezone.utc)
            print(f"  OK Token obtained in {elapsed:.1f}s, expires: {exp.isoformat()}")
            return cred
        else:
            print("  FAIL Token empty")
            return None
    except Exception as e:
        print(f"  FAIL Credential error: {e}")
        return None


# -- 3. Clock + network -------------------------------------------------------
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
    print(f"  System UTC: {datetime.now(timezone.utc).isoformat()}")

    print("\n=== [3b] NETWORK REACHABILITY ===")
    import socket
    hosts = [
        ("login.microsoftonline.com", 443),
        ("blob.core.windows.net", 443),
    ]
    for host, port in hosts:
        try:
            t0 = time.time()
            sock = socket.create_connection((host, port), timeout=5)
            sock.close()
            print(f"  OK {host}:{port} reachable in {time.time()-t0:.2f}s")
        except Exception as e:
            print(f"  FAIL {host}:{port} UNREACHABLE: {e}")


# -- 4. Blob container access -------------------------------------------------
def check_blob_access(ct):
    print("\n=== [4] BLOB STORAGE ACCESS ===")
    try:
        from app.services.azure_session import get_blob_service_client
        client = get_blob_service_client(ct)
        container = client.get_container_client(ct.azure_container_name)
        props = container.get_container_properties()
        print(f"  OK Container '{ct.azure_container_name}' accessible")
        return container
    except Exception as e:
        print(f"  FAIL Blob access error: {e}")
        return None


# -- 5. Container structure ---------------------------------------------------
def check_container_structure(ct, container):
    print("\n=== [5] CONTAINER STRUCTURE (top-level folders) ===")
    try:
        from app.services.azure_session import get_blob_service_client
        blob_svc = get_blob_service_client(ct)
        cont = blob_svc.get_container_client(ct.azure_container_name)
        blobs = list(cont.list_blobs())
        print(f"  Total blobs in container: {len(blobs)}")
        seen = set()
        for b in blobs:
            seen.add(b.name.split("/")[0])
        print(f"  Top-level folders ({len(seen)}):")
        for f in sorted(seen):
            count = sum(1 for b in blobs if b.name.startswith(f + "/") and b.name.endswith(".csv"))
            print(f"    {f}/  -> {count} CSV files")
        return blobs
    except Exception as e:
        print(f"  FAIL Container listing error: {e}")
        return []


# -- 6. Sync prefixes check ---------------------------------------------------
def check_sync_prefixes(ct, blobs):
    print("\n=== [6] SYNC PREFIXES CHECK ===")
    export_name = ct.azure_export_name or ""
    prefixes = []
    if export_name:
        prefixes += [
            f"{export_name}/",
            f"{export_name}-actualcost/",
            f"{export_name}-amortizedcost/",
            f"{export_name}-daily-actualcost/",
            f"{export_name}-daily-amortizedcost/",
        ]
    prefixes += [
        "finoptix-actualcost/",
        "finoptix-amortizedcost/",
        "finoptix-daily-actualcost/",
        "finoptix-daily-amortizedcost/",
    ]
    prefixes = list(dict.fromkeys(prefixes))
    print(f"  export_name from CT config: '{export_name}'")
    for prefix in prefixes:
        found = [b for b in blobs if b.name.startswith(prefix) and b.name.endswith(".csv")]
        if found:
            latest = max(found, key=lambda b: b.last_modified)
            oldest = min(found, key=lambda b: b.last_modified)
            print(f"  OK {prefix}: {len(found)} CSVs")
            print(f"      oldest: {oldest.name} ({oldest.last_modified.date()})")
            print(f"      latest: {latest.name} ({latest.last_modified.date()})")
        else:
            print(f"  -- {prefix}: 0 CSVs (not found)")


# -- 7. Daily blob date coverage ----------------------------------------------
def check_daily_date_coverage(ct, blobs):
    print("\n=== [7] DAILY BLOB DATE COVERAGE ===")
    today = date.today()
    print(f"  Today: {today}")
    export_name = ct.azure_export_name or "finoptix"
    daily_prefixes = [
        f"{export_name}-daily-actualcost/",
        f"{export_name}-daily-amortizedcost/",
        "finoptix-daily-actualcost/",
        "finoptix-daily-amortizedcost/",
    ]
    for prefix in list(dict.fromkeys(daily_prefixes)):
        found = [b for b in blobs if b.name.startswith(prefix) and b.name.endswith(".csv")]
        if not found:
            continue
        dates = sorted(set(b.last_modified.date() for b in found))
        lag = (today - dates[-1]).days
        status = "OK" if lag == 0 else f"WARNING {lag} day(s) old"
        print(f"  {prefix}: {len(found)} files, {dates[0]} -> {dates[-1]}  [{status}]")


# -- 8. Sample blob parse -----------------------------------------------------
def check_sample_parse(ct, blobs):
    print("\n=== [8] SAMPLE BLOB PARSE ===")
    # Prefer daily actual, fall back to any CSV
    candidates = [b for b in blobs if "daily" in b.name.lower() and "actual" in b.name.lower() and b.name.endswith(".csv")]
    if not candidates:
        candidates = [b for b in blobs if b.name.endswith(".csv")]
    if not candidates:
        print("  No blobs to sample")
        return
    sample = max(candidates, key=lambda b: b.last_modified)
    print(f"  Sampling: {sample.name}")
    try:
        from app.services.azure_cost_service import stream_azure_cost_batches
        today = date.today()
        # Try current month
        start = today.replace(day=1).isoformat()
        end = today.isoformat()
        rows = 0
        for batch in stream_azure_cost_batches(ct, sample.name, start, end, 500):
            rows += len(batch)
            if rows >= 500:
                break
        print(f"  Current month ({start} -> {end}): {rows} rows")
        if rows == 0:
            # Try full year
            year_start = today.replace(month=1, day=1).isoformat()
            rows2 = 0
            for batch in stream_azure_cost_batches(ct, sample.name, year_start, end, 500):
                rows2 += len(batch)
                if rows2 >= 500:
                    break
            print(f"  Full year ({year_start} -> {end}): {rows2} rows")
            if rows2 == 0:
                print("  WARNING 0 rows in both ranges -- check date column format in blob")
    except Exception as e:
        print(f"  FAIL Parse error: {e}")


# -- 9. DB record counts ------------------------------------------------------
async def check_db_counts():
    print("\n=== [9] DB RECORD COUNTS ===")
    from app.models.database import AsyncSessionLocal
    from sqlalchemy import text
    import uuid as _uuid
    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text("SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=_uuid.UUID(CT_ID)))
            print(f"  azure_cost_records total: {r.scalar()}")

            r = await db.execute(text("SELECT cost_type, COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id GROUP BY cost_type").bindparams(id=_uuid.UUID(CT_ID)))
            for row in r.fetchall():
                print(f"    cost_type={row[0]}: {row[1]} rows")

            r = await db.execute(text("SELECT MIN(date), MAX(date) FROM azure_cost_records WHERE control_tower_id = :id").bindparams(id=_uuid.UUID(CT_ID)))
            row = r.fetchone()
            print(f"  Date range in DB: {row[0]} -> {row[1]}")

            r = await db.execute(text("SELECT status, records_synced, error_message, started_at, finished_at FROM sync_logs WHERE control_tower_id = :id ORDER BY started_at DESC LIMIT 5").bindparams(id=_uuid.UUID(CT_ID)))
            print("\n  Last 5 sync logs:")
            for row in r.fetchall():
                duration = (row[4] - row[3]).seconds if row[3] and row[4] else "?"
                print(f"    [{row[0]}] records={row[1]} duration={duration}s error={row[2]}")
    except Exception as e:
        print(f"  FAIL DB count error: {e}")


# -- 10. Delete timeout test --------------------------------------------------
async def check_delete_timeout():
    print("\n=== [10] DELETE TIMEOUT TEST ===")
    from app.models.database import SyncSessionLocal
    from sqlalchemy import text
    import uuid as _uuid
    today = date.today()
    start = today.replace(day=1)
    end = today
    try:
        async with SyncSessionLocal() as db:
            t0 = time.time()
            r = await db.execute(
                text("EXPLAIN SELECT COUNT(*) FROM azure_cost_records WHERE control_tower_id = :id AND date >= :s AND date <= :e")
                .bindparams(id=_uuid.UUID(CT_ID), s=start, e=end)
            )
            elapsed = time.time() - t0
            print(f"  EXPLAIN took {elapsed:.2f}s (using SyncSessionLocal with 5min timeout)")
            for row in r.fetchall():
                print(f"    {row[0]}")
    except Exception as e:
        print(f"  FAIL: {e}")


# -- main ---------------------------------------------------------------------
async def main():
    print("=" * 60)
    print("AZURE SYNC DIAGNOSTICS")
    print("=" * 60)

    ct = await check_db_and_ct()
    if not ct:
        print("\nCannot continue without CT. Exiting.")
        return

    check_clock()
    check_credentials(ct)
    container = check_blob_access(ct)
    blobs = check_container_structure(ct, container)
    if blobs:
        check_sync_prefixes(ct, blobs)
        check_daily_date_coverage(ct, blobs)
        check_sample_parse(ct, blobs)
    await check_db_counts()
    await check_delete_timeout()

    print("\n" + "=" * 60)
    print("DIAGNOSTICS COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    sys.path.insert(0, "/app")
    os.chdir("/app")
    asyncio.run(main())
