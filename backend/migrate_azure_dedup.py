"""
Migration: Add unique constraint on azure_cost_records to prevent duplicate rows.

The unique key is: (control_tower_id, subscription_id, resource_id, date, cost_type, charge_type)
This ensures re-running a sync never inserts duplicate rows for the same resource/day/type.

Run once:
    docker exec -it finops-backend python migrate_azure_dedup.py
"""
import asyncio
import logging
from app.models.database import init_db, AsyncSessionLocal
from sqlalchemy import text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    await init_db()
    async with AsyncSessionLocal() as db:
        # Step 1: Remove duplicate rows — keep the latest synced_at per unique key
        logger.info("Removing duplicate azure_cost_records rows...")
        await db.execute(text("""
            DELETE FROM azure_cost_records
            WHERE id NOT IN (
                SELECT DISTINCT ON (
                    control_tower_id, subscription_id,
                    COALESCE(resource_id, ''), date, cost_type,
                    COALESCE(charge_type, '')
                ) id
                FROM azure_cost_records
                ORDER BY
                    control_tower_id, subscription_id,
                    COALESCE(resource_id, ''), date, cost_type,
                    COALESCE(charge_type, ''),
                    synced_at DESC
            )
        """))
        await db.commit()
        logger.info("Duplicates removed.")

        # Step 2: Add unique index (partial — resource_id can be NULL so use COALESCE)
        logger.info("Adding unique index...")
        await db.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uix_az_cr_dedup
            ON azure_cost_records (
                control_tower_id,
                subscription_id,
                COALESCE(resource_id, ''),
                date,
                cost_type,
                COALESCE(charge_type, '')
            )
        """))
        await db.commit()
        logger.info("Unique index uix_az_cr_dedup created successfully.")

        # Step 3: Rebuild azure_monthly_summary from clean data
        logger.info("Rebuilding azure_monthly_summary from clean data...")
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
                SELECT control_tower_id,
                       TO_CHAR(date, 'YYYY-MM') AS month,
                       subscription_id,
                       MAX(subscription_name) AS subscription_name,
                       SUM(actual_cost) AS actual_cost
                FROM azure_cost_records
                WHERE cost_type = 'actual'
                GROUP BY control_tower_id, TO_CHAR(date, 'YYYY-MM'), subscription_id
            ) a
            LEFT JOIN (
                SELECT control_tower_id,
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
        logger.info("azure_monthly_summary rebuilt. Migration complete.")


if __name__ == "__main__":
    asyncio.run(main())
