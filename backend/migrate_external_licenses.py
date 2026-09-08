"""
Migration: Create external_licenses table.

Run once:
    docker exec -it finops-backend python migrate_external_licenses.py
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
        logger.info("Creating external_licenses table...")
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS external_licenses (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                app_name VARCHAR NOT NULL,
                sno INTEGER NOT NULL DEFAULT 0,
                description VARCHAR NOT NULL,
                team VARCHAR,
                unit_cost_pa NUMERIC(18, 2) DEFAULT 0,
                unit_cost_pm NUMERIC(18, 2) DEFAULT 0,
                dc_units NUMERIC(10, 2) DEFAULT 0,
                dr_units NUMERIC(10, 2) DEFAULT 0,
                uat_units NUMERIC(10, 2) DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await db.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_el_app_name ON external_licenses (app_name)
        """))
        await db.commit()
        logger.info("external_licenses table created successfully.")


if __name__ == "__main__":
    asyncio.run(main())
