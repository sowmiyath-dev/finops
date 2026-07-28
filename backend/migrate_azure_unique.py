"""
Add unique constraint to azure_cost_records for ON CONFLICT DO NOTHING upsert.
Run once: docker-compose exec backend python migrate_azure_unique.py
"""
import asyncio, sys, os

async def main():
    sys.path.insert(0, "/app")
    os.chdir("/app")
    from app.models.database import engine
    from sqlalchemy import text

    async with engine.begin() as conn:
        # Disable statement timeout for this migration — operations on large tables need more time
        await conn.execute(text("SET statement_timeout = 0"))
        await conn.execute(text("SET lock_timeout = '10min'"))

        # Check if constraint already exists
        r = await conn.execute(text("""
            SELECT 1 FROM pg_constraint
            WHERE conname = 'uq_azure_cost_record'
        """))
        if r.scalar():
            print("Constraint already exists — nothing to do.")
            return

        print("Adding unique constraint on azure_cost_records...")
        print("(This may take a few minutes on large tables)")

        # First remove exact duplicates keeping one row per unique key
        await conn.execute(text("""
            DELETE FROM azure_cost_records a
            USING azure_cost_records b
            WHERE a.id > b.id
              AND a.control_tower_id = b.control_tower_id
              AND a.subscription_id = b.subscription_id
              AND COALESCE(a.resource_id, '') = COALESCE(b.resource_id, '')
              AND a.date = b.date
              AND a.cost_type = b.cost_type
              AND COALESCE(a.service, '') = COALESCE(b.service, '')
        """))
        print("Duplicates removed.")

        # Add unique constraint
        await conn.execute(text("""
            ALTER TABLE azure_cost_records
            ADD CONSTRAINT uq_azure_cost_record
            UNIQUE (control_tower_id, subscription_id, resource_id, date, cost_type, service)
        """))
        print("✓ Unique constraint added successfully.")

asyncio.run(main())
