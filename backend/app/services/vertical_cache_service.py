"""
Refreshes the vertical_cost_cache table after every sync.
Called from towers._do_sync() and also on-demand from the vertical summary endpoint.
"""
import logging
from datetime import date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func, case, literal, text

from app.models.db_models import (
    CostRecord, CustomTag, ResourceTagMapping, Vertical, VerticalCostCache
)
from app.models.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

GRANULARITIES = {
    "monthly": ("YYYY-MM", date.today().replace(month=1, day=1), date.today()),
    "weekly":  ("IYYY-IW", date.today() - timedelta(weeks=12), date.today()),
    "daily":   ("YYYY-MM-DD", date.today() - timedelta(days=30), date.today()),
}


async def refresh_vertical_cost_cache():
    """Recompute vertical_cost_cache for all verticals × all granularities.
    Runs in ~1 query per granularity (3 total) instead of per-request JOINs.
    """
    logger.info("vertical_cache: starting refresh")
    async with AsyncSessionLocal() as db:
        verticals = (await db.execute(select(Vertical))).scalars().all()
        if not verticals:
            return

        true_cost_expr = func.sum(
            case(
                (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
                (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
                else_=literal(0),
            )
        ).label("cost")

        for gran, (fmt, start, end) in GRANULARITIES.items():
            period_expr = func.to_char(CostRecord.date, fmt).label("period")

            # Single query: CustomTag → ResourceTagMapping → CostRecord grouped by vertical_name + period
            rows = (await db.execute(
                select(
                    CustomTag.tag_value.label("vertical_name"),
                    period_expr,
                    true_cost_expr,
                    func.count(func.distinct(ResourceTagMapping.resource_id)).label("resource_count"),
                )
                .join(ResourceTagMapping, ResourceTagMapping.custom_tag_id == CustomTag.id)
                .join(CostRecord, CostRecord.resource_id == ResourceTagMapping.resource_id)
                .where(
                    CustomTag.tag_key == "Vertical",
                    CostRecord.date >= start,
                    CostRecord.date <= end,
                )
                .group_by(CustomTag.tag_value, "period")
            )).all()

            # Delete old cache for this granularity and re-insert
            await db.execute(
                delete(VerticalCostCache).where(VerticalCostCache.granularity == gran)
            )
            for r in rows:
                db.add(VerticalCostCache(
                    vertical_name=r.vertical_name,
                    granularity=gran,
                    period=r.period,
                    total_cost=float(r.cost or 0),
                    resource_count=int(r.resource_count or 0),
                ))
            await db.commit()
            logger.info(f"vertical_cache: {gran} refreshed — {len(rows)} rows")

    logger.info("vertical_cache: refresh complete")
