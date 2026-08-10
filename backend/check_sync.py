import asyncio
from app.models.database import init_db, AsyncSessionLocal
from sqlalchemy import text

async def run():
    await init_db()
    async with AsyncSessionLocal() as db:
        r1 = await db.execute(text("SELECT COUNT(*) FROM azure_cost_records"))
        r2 = await db.execute(text("""
            SELECT TO_CHAR(date, 'YYYY-MM') as month, cost_type, COUNT(*) as rows,
                   ROUND(SUM(actual_cost)::numeric, 2) as actual,
                   ROUND(SUM(amortized_cost)::numeric, 2) as amortized
            FROM azure_cost_records
            GROUP BY TO_CHAR(date, 'YYYY-MM'), cost_type
            ORDER BY month, cost_type
        """))
        total = r1.scalar()
        rows = r2.all()
        print(f"Total rows: {total}")
        if rows:
            print(f"{'Month':<10} {'Type':<12} {'Rows':<10} {'Actual':>15} {'Amortized':>15}")
            print("-" * 65)
            for row in rows:
                print(f"{row.month:<10} {row.cost_type:<12} {row.rows:<10} {float(row.actual):>15.2f} {float(row.amortized):>15.2f}")
        else:
            print("No data yet.")

asyncio.run(run())
