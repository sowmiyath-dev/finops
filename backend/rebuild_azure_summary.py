import asyncio
import uuid as _uuid
import os
import asyncpg
from app.config import settings

CT_ID = '051dd3a4-9b33-42b4-ad09-e4606264fd11'
CT_UUID = str(_uuid.UUID(CT_ID))

# Strip asyncpg+postgresql:// -> postgresql:// for asyncpg.connect
def _pg_dsn(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://")

async def rebuild():
    dsn = _pg_dsn(settings.DATABASE_URL)

    # Raw asyncpg connection — no command_timeout, no statement_timeout
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    await conn.execute("SET statement_timeout = 0")

    try:
        # Step 1: get distinct months
        rows = await conn.fetch("""
            SELECT DISTINCT TO_CHAR(date, 'YYYY-MM') AS month
            FROM azure_cost_records
            WHERE control_tower_id = $1::uuid
            ORDER BY month
        """, CT_UUID)
        months = [r['month'] for r in rows]
        print(f'Found {len(months)} months: {months}')

        # Step 2: clear existing summary for this CT
        deleted = await conn.execute(
            "DELETE FROM azure_monthly_summary WHERE control_tower_id = $1::uuid",
            CT_UUID
        )
        print(f'Cleared old summary: {deleted}')

        # Step 3: rebuild month by month
        for month in months:
            await conn.execute("""
                INSERT INTO azure_monthly_summary
                    (id, control_tower_id, month, subscription_id, subscription_name,
                     actual_cost, amortized_cost, refreshed_at)
                SELECT gen_random_uuid(), a.control_tower_id, a.month,
                       a.subscription_id, a.subscription_name,
                       COALESCE(a.actual_cost, 0), COALESCE(m.amortized_cost, 0), NOW()
                FROM (
                    SELECT control_tower_id, TO_CHAR(date, 'YYYY-MM') AS month,
                           subscription_id, MAX(subscription_name) AS subscription_name,
                           SUM(actual_cost) AS actual_cost
                    FROM azure_cost_records
                    WHERE cost_type = 'actual'
                      AND control_tower_id = $1::uuid
                      AND TO_CHAR(date, 'YYYY-MM') = $2
                    GROUP BY control_tower_id, TO_CHAR(date, 'YYYY-MM'), subscription_id
                ) a
                LEFT JOIN (
                    SELECT subscription_id, SUM(amortized_cost) AS amortized_cost
                    FROM azure_cost_records
                    WHERE cost_type = 'amortized'
                      AND control_tower_id = $1::uuid
                      AND TO_CHAR(date, 'YYYY-MM') = $2
                    GROUP BY subscription_id
                ) m ON a.subscription_id = m.subscription_id
            """, CT_UUID, month)
            print(f'  {month} done')

        print('All months rebuilt successfully')

    finally:
        await conn.close()

asyncio.run(rebuild())
