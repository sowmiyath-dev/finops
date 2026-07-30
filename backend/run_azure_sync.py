"""Run Azure sync directly — bypasses FastAPI background task executor deadlock."""
import asyncio, logging, uuid
from datetime import date, datetime, timezone, timedelta
from sqlalchemy import select, update, delete, text
from app.models.database import AsyncSessionLocal, SyncSessionLocal
from app.models.db_models import ControlTower, SubAccount, SyncLog, AzureCostRecord
from app.services.azure_cost_service import stream_azure_cost_batches, find_azure_export_blobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

CT_ID = "051dd3a4-9b33-42b4-ad09-e4606264fd11"
START_DATE = "2026-07-01"
END_DATE = "2026-07-30"


async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ControlTower).where(ControlTower.id == CT_ID))
        ct = result.scalar_one_or_none()
        if not ct:
            logger.error("CT not found"); return

        sync_log = SyncLog(
            control_tower_id=ct.id, control_tower_name=ct.name,
            triggered_by="manual-script", status="started",
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        sync_log_id = sync_log.id

    logger.info(f"Sync started: {START_DATE} to {END_DATE}")

    # Find blobs
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(ControlTower).where(ControlTower.id == CT_ID))
        ct = result.scalar_one_or_none()

    csv_blobs = [
        "finoptix-daily-actualcost/all-subs-daily-actualcost/20260701-20260731/all-subs-daily-actualcost_0606bf22-8341-45e4-ad81-d0aef47b82ec.csv",
        "finoptix-daily-amortizedcost/all-subs-daily-amortizedcost/20260701-20260731/all-subs-daily-amortizedcost_571b556d-ed84-41ab-8979-fac156c745c1.csv",
    ]
    logger.info(f"Using {len(csv_blobs)} specific blob(s)")

    # Delete existing records for date range
    start_dt = date.fromisoformat(START_DATE)
    end_dt = date.fromisoformat(END_DATE)
    async with SyncSessionLocal() as db:
        await db.execute(
            delete(AzureCostRecord).where(
                AzureCostRecord.control_tower_id == CT_ID,
                AzureCostRecord.date >= start_dt,
                AzureCostRecord.date <= end_dt,
            )
        )
        await db.commit()
    logger.info(f"Deleted existing records for {START_DATE} to {END_DATE}")

    total_inserted = 0

    for blob_idx, blob_name in enumerate(csv_blobs):
        logger.info(f"Blob {blob_idx+1}/{len(csv_blobs)}: {blob_name}")
        try:
            blob_inserted = 0
            for batch in stream_azure_cost_batches(ct, blob_name, START_DATE, END_DATE, 1000):
                if not batch:
                    continue
                async with SyncSessionLocal() as db:
                    await db.execute(text("""
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
                            "id": str(uuid.uuid4()), "ct_id": CT_ID,
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
                    blob_inserted += len(batch)
                    total_inserted += len(batch)
            logger.info(f"Blob {blob_idx+1} done: {blob_inserted} rows inserted (total: {total_inserted})")
        except Exception as e:
            logger.error(f"Blob {blob_name} failed: {e}", exc_info=True)
            continue

    # Finalize
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(SyncLog).where(SyncLog.id == sync_log_id).values(
                status="completed", records_synced=total_inserted,
                date_range_start=start_dt, date_range_end=end_dt,
                finished_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()

    logger.info(f"Sync complete: {total_inserted} total records inserted")

    # Refresh monthly summary
    from app.routers.towers import _refresh_azure_monthly_summary
    await _refresh_azure_monthly_summary(CT_ID)
    logger.info("Monthly summary refreshed")


asyncio.run(main())
