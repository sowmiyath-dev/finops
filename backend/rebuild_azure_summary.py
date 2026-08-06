import asyncio
import uuid as _uuid
from app.models.database import AsyncSessionLocal, init_db
from sqlalchemy import text

CT_ID = '051dd3a4-9b33-42b4-ad09-e4606264fd11'
CT_UUID = _uuid.UUID(CT_ID)

async def rebuild():
    await init_db()

    # Step 1: get distinct months
    async with AsyncSessionLocal() as db:
        r = await db.execute(text("""
            SELECT DISTINCT TO_CHAR(date, 'YYYY-MM') AS month
            FROM azure_cost_records
            WHERE control_tower_id = :ct_id
            ORDER BY month
        """).bindparams(ct_id=CT_UUID))
        months = [row[0] for row in r.fetchall()]

    print(f'Found {len(months)} months: {months}')

    # Step 2: clear existing summary for this CT using raw connection (no timeout)
    async with AsyncSessionLocal() as db:
        conn = await db.connection()
        raw = await conn.get_raw_connection()
        await raw.driver_connection.execute('SET statement_timeout = 0')
        await db.execute(
            text('DELETE FROM azure_monthly_summary WHERE control_tower_id = :ct_id')
            .bindparams(ct_id=CT_UUID)
        )
        await db.commit()
    print('Cleared old summary rows for this CT')

    # Step 3: rebuild month by month
    for month in months:
        async with AsyncSessionLocal() as db:
            conn = await db.connection()
            raw = await conn.get_raw_connection()
            await raw.driver_connection.execute('SET statement_timeout = 0')
            await db.execute(text("""
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
                      AND control_tower_id = :ct_id
                      AND TO_CHAR(date, 'YYYY-MM') = :month
                    GROUP BY control_tower_id, TO_CHAR(date, 'YYYY-MM'), subscription_id
                ) a
                LEFT JOIN (
                    SELECT subscription_id, SUM(amortized_cost) AS amortized_cost
                    FROM azure_cost_records
                    WHERE cost_type = 'amortized'
                      AND control_tower_id = :ct_id
                      AND TO_CHAR(date, 'YYYY-MM') = :month
                    GROUP BY subscription_id
                ) m ON a.subscription_id = m.subscription_id
            """).bindparams(ct_id=CT_UUID, month=month))
            await db.commit()
        print(f'  {month} done')

    print('All months rebuilt successfully')

asyncio.run(rebuild())
