import asyncio
import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import Optional
from pydantic import BaseModel
from datetime import date
import json

from app.models.database import get_db
from app.models.db_models import AzureCostRecord, AzureBusinessMapping, ControlTower
from app.services.auth_service import get_current_user
from app.models.db_models import User

router = APIRouter(prefix="/azure-costs", tags=["azure-costs"])

# Simple in-memory cache
_cache: dict = {}
_CACHE_TTL = 3600  # 1 hour
_CT_IDS_TTL = 300  # 5 min for user CT ids

def _cache_get(key: str, ttl: int = _CACHE_TTL):
    e = _cache.get(key)
    if e and time.time() - e["t"] < ttl:
        return e["d"]
    return None

def _cache_set(key: str, data):
    _cache[key] = {"d": data, "t": time.time()}


def _parse_dates(start_date: Optional[str], end_date: Optional[str]):
    today = date.today()
    start = date.fromisoformat(start_date) if start_date else today.replace(day=1)
    end = date.fromisoformat(end_date) if end_date else today
    return start, end


async def _get_amortized_map(db, conditions_amortized, group_col):
    rows = (await db.execute(
        select(group_col, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(*conditions_amortized).group_by(group_col)
    )).all()
    return {str(r[0]): float(r[1] or 0) for r in rows}


def _build_row(actual, amortized_map, key):
    actual_val = float(actual or 0)
    amortized_val = amortized_map.get(str(key), actual_val)
    savings = max(0, actual_val - amortized_val)
    return actual_val, amortized_val, savings, amortized_val if amortized_val > 0 else actual_val


# ── Combined endpoint for fast initial page load ─────────────────────────────

@router.get("/overview")
async def cost_overview(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns summary + subscriptions using pre-aggregated table for fast load."""
    from app.models.db_models import AzureMonthlySummary
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_overview_{start}_{end}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached

    # Build month list in range
    months, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append(f"{y}-{m:02d}")
        m += 1
        if m > 12: m, y = 1, y + 1

    # Query pre-aggregated summary table — tiny, fast
    rows = (await db.execute(
        select(
            AzureMonthlySummary.subscription_id,
            AzureMonthlySummary.subscription_name,
            func.sum(AzureMonthlySummary.actual_cost).label("actual_cost"),
            func.sum(AzureMonthlySummary.amortized_cost).label("amortized_cost"),
        )
        .where(AzureMonthlySummary.month.in_(months))
        .group_by(AzureMonthlySummary.subscription_id, AzureMonthlySummary.subscription_name)
        .order_by(func.sum(AzureMonthlySummary.actual_cost).desc())
    )).all()

    subscriptions = []
    total_actual = total_amortized = 0.0

    if rows:
        for r in rows:
            actual = float(r.actual_cost or 0)
            amortized = float(r.amortized_cost or 0)
            savings = max(0, actual - amortized)
            total_actual += actual
            total_amortized += amortized
            subscriptions.append({
                "subscription_id": r.subscription_id,
                "subscription_name": r.subscription_name or r.subscription_id,
                "actual_cost": actual, "amortized_cost": amortized,
                "sp_allocated": amortized,
                "savings": savings, "true_cost": amortized if amortized > 0 else actual,
            })
    else:
        # Fallback to raw table if summary not yet populated
        ca = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual"]
        cm = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized"]
        actual_sub_r, amortized_sub_r = await asyncio.gather(
            db.execute(select(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name,
                              func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
                       .where(*ca).group_by(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name)
                       .order_by(func.sum(AzureCostRecord.actual_cost).desc())),
            db.execute(select(AzureCostRecord.subscription_id, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
                       .where(*cm).group_by(AzureCostRecord.subscription_id)),
        )
        amortized_map = {r.subscription_id: float(r.amortized_cost or 0) for r in amortized_sub_r.all()}
        for r in actual_sub_r.all():
            actual = float(r.actual_cost or 0)
            amortized = amortized_map.get(r.subscription_id, actual)
            savings = max(0, actual - amortized)
            total_actual += actual
            total_amortized += amortized
            subscriptions.append({
                "subscription_id": r.subscription_id,
                "subscription_name": r.subscription_name or r.subscription_id,
                "actual_cost": actual, "amortized_cost": amortized,
                "sp_allocated": amortized,
                "savings": savings, "true_cost": amortized if amortized > 0 else actual,
            })

    savings_total = max(0, total_actual - total_amortized)
    result = {
        "summary": {
            "actual_cost": total_actual, "amortized_cost": total_amortized,
            "sp_allocated": total_amortized,
            "savings": savings_total,
            "true_cost": total_amortized if total_amortized > 0 else total_actual,
        },
        "subscriptions": subscriptions,
    }
    _cache_set(cache_key, result)
    return result


# ── Summary card totals ───────────────────────────────────────────────────────

@router.get("/summary")
async def cost_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.db_models import AzureMonthlySummary
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_summary_{start}_{end}_{subscription_id}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached

    # Build month list
    months, y, m = [], start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append(f"{y}-{m:02d}")
        m += 1
        if m > 12: m, y = 1, y + 1

    cond = [AzureMonthlySummary.month.in_(months)]
    if subscription_id:
        cond.append(AzureMonthlySummary.subscription_id == subscription_id)

    row = (await db.execute(
        select(func.sum(AzureMonthlySummary.actual_cost).label("actual"),
               func.sum(AzureMonthlySummary.amortized_cost).label("amortized"))
        .where(*cond)
    )).one()

    actual = float(row.actual or 0)
    amortized = float(row.amortized or 0)

    # Fallback to raw if summary empty
    if actual == 0 and not subscription_id:
        ca = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual"]
        cm = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized"]
        actual_t, amortized_t = await asyncio.gather(
            db.execute(select(func.sum(AzureCostRecord.actual_cost)).where(*ca)),
            db.execute(select(func.sum(AzureCostRecord.amortized_cost)).where(*cm)),
        )
        actual = float(actual_t.scalar() or 0)
        amortized = float(amortized_t.scalar() or 0)

    savings = max(0, actual - amortized)
    result = {"actual_cost": actual, "amortized_cost": amortized, "savings": savings,
              "sp_allocated": amortized, "true_cost": amortized if amortized > 0 else actual}
    _cache_set(cache_key, result)
    return result


# ── Subscriptions ─────────────────────────────────────────────────────────────

@router.get("/subscriptions")
async def cost_by_subscription(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_subs_{start}_{end}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached
    ca = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual"]
    cm = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized"]

    actual_rows = (await db.execute(
        select(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name,
               func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*ca).group_by(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
    )).all()

    amortized_map = await _get_amortized_map(db, cm, AzureCostRecord.subscription_id)

    result = []
    for r in actual_rows:
        actual, amortized, savings, true_cost = _build_row(r.actual_cost, amortized_map, r.subscription_id)
        result.append({
            "subscription_id": r.subscription_id,
            "subscription_name": r.subscription_name or r.subscription_id,
            "actual_cost": actual, "amortized_cost": amortized,
            "savings": savings, "true_cost": true_cost,
        })
    _cache_set(cache_key, result)
    return result


# ── Resource Groups ───────────────────────────────────────────────────────────

@router.get("/resource-groups")
async def cost_by_resource_group(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_rg_{start}_{end}_{subscription_id}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached
    ca = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual",
          AzureCostRecord.resource_group.isnot(None), AzureCostRecord.resource_group != ""]
    cm = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized",
          AzureCostRecord.resource_group.isnot(None), AzureCostRecord.resource_group != ""]
    if subscription_id:
        ca.append(AzureCostRecord.subscription_id == subscription_id)
        cm.append(AzureCostRecord.subscription_id == subscription_id)

    actual_rows = (await db.execute(
        select(AzureCostRecord.resource_group, AzureCostRecord.subscription_name,
               func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*ca).group_by(AzureCostRecord.resource_group, AzureCostRecord.subscription_name)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
    )).all()

    amortized_map = await _get_amortized_map(db, cm, AzureCostRecord.resource_group)

    result = []
    for r in actual_rows:
        actual, amortized, savings, true_cost = _build_row(r.actual_cost, amortized_map, r.resource_group)
        result.append({
            "resource_group": r.resource_group,
            "subscription_name": r.subscription_name,
            "actual_cost": actual, "amortized_cost": amortized,
            "sp_allocated": amortized,
            "savings": savings, "true_cost": true_cost,
        })
    _cache_set(cache_key, result)
    return result


# ── Services ──────────────────────────────────────────────────────────────────

@router.get("/services")
async def cost_by_service(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_svc_{start}_{end}_{subscription_id}_{resource_group}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached
    ca = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual"]
    cm = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized"]
    if subscription_id:
        ca.append(AzureCostRecord.subscription_id == subscription_id)
        cm.append(AzureCostRecord.subscription_id == subscription_id)
    if resource_group:
        ca.append(AzureCostRecord.resource_group == resource_group)
        cm.append(AzureCostRecord.resource_group == resource_group)

    actual_rows = (await db.execute(
        select(AzureCostRecord.service, func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*ca).group_by(AzureCostRecord.service)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
    )).all()

    amortized_map = await _get_amortized_map(db, cm, AzureCostRecord.service)

    result = []
    for r in actual_rows:
        actual, amortized, savings, true_cost = _build_row(r.actual_cost, amortized_map, r.service)
        result.append({
            "service": r.service or "Unknown",
            "actual_cost": actual, "amortized_cost": amortized,
            "savings": savings, "true_cost": true_cost,
        })
    _cache_set(cache_key, result)
    return result


# ── Tags ──────────────────────────────────────────────────────────────────────

@router.get("/tags")
async def cost_by_tag(
    tag_key: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_tags_{tag_key}_{start}_{end}_{subscription_id}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached

    # Use PostgreSQL JSON operator to extract tag value in SQL — avoids Python-side loop
    from sqlalchemy import cast, text
    from sqlalchemy.dialects.postgresql import JSONB

    tag_val_expr = func.coalesce(
        func.nullif(func.trim(func.replace(
            func.replace(
                func.json_extract_path_text(
                    func.cast(AzureCostRecord.tags, type_=text("json")), tag_key
                ), '"', ''
            ), "'", ''
        )), ''),
        'Untagged'
    ).label("tag_value")

    base_cond = [
        AzureCostRecord.date >= start, AzureCostRecord.date <= end,
        AzureCostRecord.tags.isnot(None), AzureCostRecord.tags != '{}', AzureCostRecord.tags != '',
    ]
    if subscription_id:
        base_cond.append(AzureCostRecord.subscription_id == subscription_id)

    actual_rows = (await db.execute(
        select(tag_val_expr, func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*base_cond, AzureCostRecord.cost_type == "actual")
        .group_by(text("tag_value"))
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
    )).all()

    amortized_rows = (await db.execute(
        select(tag_val_expr, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(*base_cond, AzureCostRecord.cost_type == "amortized")
        .group_by(text("tag_value"))
    )).all()

    amortized_agg = {r.tag_value: float(r.amortized_cost or 0) for r in amortized_rows}

    result = []
    for r in actual_rows:
        actual = float(r.actual_cost or 0)
        amortized = amortized_agg.get(r.tag_value, actual)
        savings = max(0, actual - amortized)
        result.append({
            "tag_key": tag_key, "tag_value": r.tag_value,
            "actual_cost": actual, "amortized_cost": amortized,
            "savings": savings, "true_cost": amortized if amortized > 0 else actual,
        })
    _cache_set(cache_key, result)
    return result


@router.get("/tag-keys")
async def get_tag_keys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if (cached := _cache_get("az_tag_keys")) is not None:
        return cached
    rows = (await db.execute(
        select(AzureCostRecord.tags)
        .where(AzureCostRecord.tags.isnot(None), AzureCostRecord.cost_type == "actual")
        .limit(200)
    )).scalars().all()
    keys: set = set()
    for tags_str in rows:
        try:
            keys.update(json.loads(tags_str).keys())
        except Exception:
            pass
    result = sorted(list(keys))
    _cache_set("az_tag_keys", result)
    return result


# ── Daily trend ───────────────────────────────────────────────────────────────

@router.get("/daily-trend")
async def daily_trend(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_trend_{start}_{end}_{subscription_id}_{resource_group}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached
    ca = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual"]
    cm = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized"]
    if subscription_id:
        ca.append(AzureCostRecord.subscription_id == subscription_id)
        cm.append(AzureCostRecord.subscription_id == subscription_id)
    if resource_group:
        ca.append(AzureCostRecord.resource_group == resource_group)
        cm.append(AzureCostRecord.resource_group == resource_group)

    actual_rows = (await db.execute(
        select(AzureCostRecord.date, func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*ca).group_by(AzureCostRecord.date).order_by(AzureCostRecord.date)
    )).all()

    amortized_map = {str(r.date): float(r.amortized_cost or 0) for r in (await db.execute(
        select(AzureCostRecord.date, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(*cm).group_by(AzureCostRecord.date)
    )).all()}

    result = [
        {
            "date": str(r.date),
            "actual_cost": float(r.actual_cost or 0),
            "amortized_cost": amortized_map.get(str(r.date), float(r.actual_cost or 0)),
            "savings": max(0, float(r.actual_cost or 0) - amortized_map.get(str(r.date), float(r.actual_cost or 0))),
        }
        for r in actual_rows
    ]
    _cache_set(cache_key, result)
    return result


# ── RI/SP savings resources ───────────────────────────────────────────────────

@router.get("/savings-resources")
async def savings_resources(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    limit: int = 200,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resources with RI/SP pricing model — shows actual vs amortized cost and savings."""
    start, end = _parse_dates(start_date, end_date)

    ca = [AzureCostRecord.date >= start, AzureCostRecord.date <= end,
          AzureCostRecord.cost_type == "actual",
          AzureCostRecord.pricing_model.in_(["Reservation", "SavingsPlan"]),
          AzureCostRecord.resource_id.isnot(None), AzureCostRecord.resource_id != ""]
    cm = [AzureCostRecord.date >= start, AzureCostRecord.date <= end,
          AzureCostRecord.cost_type == "amortized",
          AzureCostRecord.pricing_model.in_(["Reservation", "SavingsPlan"]),
          AzureCostRecord.resource_id.isnot(None), AzureCostRecord.resource_id != ""]
    if subscription_id:
        ca.append(AzureCostRecord.subscription_id == subscription_id)
        cm.append(AzureCostRecord.subscription_id == subscription_id)

    actual_rows = (await db.execute(
        select(AzureCostRecord.resource_id, AzureCostRecord.resource_name,
               AzureCostRecord.service, AzureCostRecord.resource_group,
               AzureCostRecord.subscription_name, AzureCostRecord.pricing_model,
               func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*ca)
        .group_by(AzureCostRecord.resource_id, AzureCostRecord.resource_name,
                  AzureCostRecord.service, AzureCostRecord.resource_group,
                  AzureCostRecord.subscription_name, AzureCostRecord.pricing_model)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
        .limit(limit)
    )).all()

    amortized_map = {r.resource_id: float(r.amortized_cost or 0) for r in (await db.execute(
        select(AzureCostRecord.resource_id, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(*cm).group_by(AzureCostRecord.resource_id)
    )).all()}

    result = []
    for r in actual_rows:
        actual = float(r.actual_cost or 0)
        amortized = amortized_map.get(r.resource_id, actual)
        savings = max(0, actual - amortized)
        result.append({
            "resource_id": r.resource_id,
            "resource_name": r.resource_name or r.resource_id.split("/")[-1],
            "service": r.service,
            "resource_group": r.resource_group,
            "subscription_name": r.subscription_name,
            "pricing_model": r.pricing_model,
            "actual_cost": actual,
            "amortized_cost": amortized,
            "savings": savings,
            "savings_pct": round(savings / actual * 100, 2) if actual > 0 else 0,
        })
    return result


# ── Resources list ────────────────────────────────────────────────────────────

@router.get("/resources")
async def cost_by_resource(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    resource_group: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    conditions = [AzureCostRecord.date >= start, AzureCostRecord.date <= end,
                  AzureCostRecord.cost_type == "actual",
                  AzureCostRecord.resource_id.isnot(None), AzureCostRecord.resource_id != ""]
    if subscription_id:
        conditions.append(AzureCostRecord.subscription_id == subscription_id)
    if resource_group:
        conditions.append(AzureCostRecord.resource_group == resource_group)

    rows = (await db.execute(
        select(AzureCostRecord.resource_id, AzureCostRecord.resource_name,
               AzureCostRecord.service, AzureCostRecord.resource_group,
               func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*conditions)
        .group_by(AzureCostRecord.resource_id, AzureCostRecord.resource_name,
                  AzureCostRecord.service, AzureCostRecord.resource_group)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
        .limit(200)
    )).all()

    return [{"resource_id": r.resource_id,
             "resource_name": r.resource_name or r.resource_id.split("/")[-1],
             "service": r.service, "resource_group": r.resource_group,
             "actual_cost": float(r.actual_cost or 0)} for r in rows]


# ── Meta endpoints ────────────────────────────────────────────────────────────

@router.get("/meta/subscriptions")
async def list_subscriptions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.db_models import AzureMonthlySummary
    cache_key = "az_meta_subs"
    if (cached := _cache_get(cache_key)) is not None:
        return cached
    rows = (await db.execute(
        select(AzureMonthlySummary.subscription_id, AzureMonthlySummary.subscription_name)
        .group_by(AzureMonthlySummary.subscription_id, AzureMonthlySummary.subscription_name)
        .order_by(AzureMonthlySummary.subscription_name)
    )).all()
    result = [{"subscription_id": r.subscription_id, "subscription_name": r.subscription_name or r.subscription_id} for r in rows]
    _cache_set(cache_key, result)
    return result


@router.get("/meta/resource-groups")
async def list_resource_groups(
    subscription_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [AzureCostRecord.cost_type == "actual",
                  AzureCostRecord.resource_group.isnot(None), AzureCostRecord.resource_group != ""]
    if subscription_id:
        conditions.append(AzureCostRecord.subscription_id == subscription_id)
    rows = (await db.execute(
        select(AzureCostRecord.resource_group, AzureCostRecord.subscription_name)
        .where(*conditions)
        .group_by(AzureCostRecord.resource_group, AzureCostRecord.subscription_name)
        .order_by(AzureCostRecord.resource_group)
    )).all()
    return [{"resource_group": r.resource_group, "subscription_name": r.subscription_name} for r in rows]


# ── Vertical modal — dedicated no-cache subscription list ───────────────────

@router.get("/vertical/list-subscriptions")
async def vertical_list_subscriptions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """No-cache, no date filter. Returns all subscriptions ever synced.
    Tries AzureMonthlySummary first (fast), falls back to AzureCostRecord.
    """
    from app.models.db_models import AzureMonthlySummary
    from sqlalchemy import text

    # Try summary table first — always has data if sync ran
    try:
        rows = (await db.execute(
            select(
                AzureMonthlySummary.subscription_id,
                AzureMonthlySummary.subscription_name,
                func.sum(AzureMonthlySummary.actual_cost).label("total_cost"),
            )
            .group_by(AzureMonthlySummary.subscription_id, AzureMonthlySummary.subscription_name)
            .order_by(AzureMonthlySummary.subscription_name)
        )).all()
        if rows:
            return [
                {
                    "subscription_id": r.subscription_id,
                    "subscription_name": r.subscription_name or r.subscription_id,
                    "total_cost": float(r.total_cost or 0),
                }
                for r in rows
            ]
    except Exception:
        pass

    # Fallback: raw azure_cost_records — no cost_type filter so we get everything
    rows = (await db.execute(
        select(
            AzureCostRecord.subscription_id,
            AzureCostRecord.subscription_name,
        )
        .group_by(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name)
        .order_by(AzureCostRecord.subscription_name)
    )).all()
    return [
        {
            "subscription_id": r.subscription_id,
            "subscription_name": r.subscription_name or r.subscription_id,
            "total_cost": 0,
        }
        for r in rows
    ]


# ── Vertical tag modal — no-cache direct queries ─────────────────────────────

@router.get("/vertical/subscriptions")
async def vertical_subscriptions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Direct query — no cache. For vertical Add Azure Resources modal."""
    rows = (await db.execute(
        select(
            AzureCostRecord.subscription_id,
            AzureCostRecord.subscription_name,
        )
        .where(AzureCostRecord.cost_type == "actual")
        .group_by(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name)
        .order_by(AzureCostRecord.subscription_name)
    )).all()
    return [
        {"subscription_id": r.subscription_id, "subscription_name": r.subscription_name or r.subscription_id}
        for r in rows
    ]


@router.get("/vertical/resource-groups")
async def vertical_resource_groups(
    subscription_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Direct query — no cache. Resource groups for a subscription."""
    rows = (await db.execute(
        select(AzureCostRecord.resource_group)
        .where(
            AzureCostRecord.subscription_id == subscription_id,
            AzureCostRecord.cost_type == "actual",
            AzureCostRecord.resource_group.isnot(None),
            AzureCostRecord.resource_group != "",
        )
        .group_by(AzureCostRecord.resource_group)
        .order_by(AzureCostRecord.resource_group)
    )).all()
    return [{"resource_group": r.resource_group} for r in rows]


@router.get("/vertical/resources")
async def vertical_resources(
    subscription_id: str,
    resource_group: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Direct query — no cache. Resources for a subscription/resource group."""
    conditions = [
        AzureCostRecord.subscription_id == subscription_id,
        AzureCostRecord.cost_type == "actual",
        AzureCostRecord.resource_id.isnot(None),
        AzureCostRecord.resource_id != "",
    ]
    if resource_group:
        conditions.append(AzureCostRecord.resource_group == resource_group)
    rows = (await db.execute(
        select(
            AzureCostRecord.resource_id,
            AzureCostRecord.resource_name,
            AzureCostRecord.service,
            AzureCostRecord.resource_group,
        )
        .where(*conditions)
        .group_by(
            AzureCostRecord.resource_id, AzureCostRecord.resource_name,
            AzureCostRecord.service, AzureCostRecord.resource_group,
        )
        .order_by(AzureCostRecord.service, AzureCostRecord.resource_name)
        .limit(500)
    )).all()
    return [{
        "resource_id": r.resource_id,
        "resource_name": r.resource_name or r.resource_id.split("/")[-1],
        "service": r.service,
        "resource_group": r.resource_group,
    } for r in rows]


# ── Azure resource browsing for tag manager ──────────────────────────────────

@router.get("/browse/subscriptions")
async def browse_subscriptions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all subscriptions with their last month actual cost."""
    from app.models.db_models import AzureMonthlySummary
    from datetime import date as dt
    cache_key = "az_browse_subs"
    if (cached := _cache_get(cache_key)) is not None:
        return cached

    n = dt.today()
    last_month = f"{n.year}-{(n.month-1):02d}" if n.month > 1 else f"{n.year-1}-12"

    # Use summary table only — fast, no raw scan
    rows = (await db.execute(
        select(
            AzureMonthlySummary.subscription_id,
            AzureMonthlySummary.subscription_name,
            func.sum(AzureMonthlySummary.actual_cost).label("total_cost"),
        )
        .group_by(AzureMonthlySummary.subscription_id, AzureMonthlySummary.subscription_name)
        .order_by(AzureMonthlySummary.subscription_name)
    )).all()

    cost_rows = (await db.execute(
        select(AzureMonthlySummary.subscription_id, func.sum(AzureMonthlySummary.actual_cost).label("cost"))
        .where(AzureMonthlySummary.month == last_month)
        .group_by(AzureMonthlySummary.subscription_id)
    )).all()
    cost_map = {r.subscription_id: float(r.cost or 0) for r in cost_rows}

    if rows:
        result = [{
            "subscription_id": r.subscription_id,
            "subscription_name": r.subscription_name or r.subscription_id,
            "resource_count": 0,
            "last_month_cost": cost_map.get(r.subscription_id, 0),
        } for r in rows]
        _cache_set(cache_key, result)
        return result

    # Fallback: use ControlTower records with cloud_provider=azure
    ct_rows = (await db.execute(
        select(ControlTower.id, ControlTower.name)
        .where(ControlTower.cloud_provider == "azure")
        .order_by(ControlTower.name)
    )).all()
    result = [{
        "subscription_id": str(r.id),
        "subscription_name": r.name,
        "resource_count": 0,
        "last_month_cost": 0,
    } for r in ct_rows]
    _cache_set(cache_key, result)
    return result


@router.get("/browse/resource-groups")
async def browse_resource_groups(
    subscription_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List resource groups in a subscription."""
    rows = (await db.execute(
        select(
            AzureCostRecord.resource_group,
            func.count(func.distinct(AzureCostRecord.resource_id)).label("resource_count"),
        )
        .where(
            AzureCostRecord.subscription_id == subscription_id,
            AzureCostRecord.cost_type == "actual",
            AzureCostRecord.resource_group.isnot(None),
            AzureCostRecord.resource_group != "",
        )
        .group_by(AzureCostRecord.resource_group)
        .order_by(AzureCostRecord.resource_group)
    )).all()
    return [{"resource_group": r.resource_group, "resource_count": r.resource_count} for r in rows]


@router.get("/browse/resources")
async def browse_resources(
    subscription_id: str,
    resource_group: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List resources in a subscription/resource group."""
    conditions = [
        AzureCostRecord.subscription_id == subscription_id,
        AzureCostRecord.cost_type == "actual",
        AzureCostRecord.resource_id.isnot(None),
        AzureCostRecord.resource_id != "",
    ]
    if resource_group:
        conditions.append(AzureCostRecord.resource_group == resource_group)

    rows = (await db.execute(
        select(
            AzureCostRecord.resource_id,
            AzureCostRecord.resource_name,
            AzureCostRecord.service,
            AzureCostRecord.resource_group,
        )
        .where(*conditions)
        .group_by(AzureCostRecord.resource_id, AzureCostRecord.resource_name,
                  AzureCostRecord.service, AzureCostRecord.resource_group)
        .order_by(AzureCostRecord.service, AzureCostRecord.resource_name)
        .limit(500)
    )).all()
    return [{
        "resource_id": r.resource_id,
        "resource_name": r.resource_name or r.resource_id.split("/")[-1],
        "service": r.service,
        "resource_group": r.resource_group,
    } for r in rows]


@router.get("/browse/tag-values")
async def browse_azure_tag_values(
    tag_key: str,
    subscription_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List unique values for a given tag key in Azure records."""
    conditions = [AzureCostRecord.cost_type == "actual", AzureCostRecord.tags.isnot(None)]
    if subscription_id:
        conditions.append(AzureCostRecord.subscription_id == subscription_id)

    rows = (await db.execute(
        select(AzureCostRecord.tags, AzureCostRecord.resource_id,
               AzureCostRecord.resource_name, AzureCostRecord.resource_group,
               AzureCostRecord.subscription_name)
        .where(*conditions)
        .group_by(AzureCostRecord.tags, AzureCostRecord.resource_id,
                  AzureCostRecord.resource_name, AzureCostRecord.resource_group,
                  AzureCostRecord.subscription_name)
        .limit(2000)
    )).all()

    # Group resources by tag value
    value_map: dict = {}
    for r in rows:
        try:
            tags = json.loads(r.tags) if r.tags else {}
        except Exception:
            continue
        val = tags.get(tag_key) or tags.get(tag_key.lower())
        if not val:
            continue
        if val not in value_map:
            value_map[val] = []
        value_map[val].append({
            "resource_id": r.resource_id,
            "resource_name": r.resource_name or (r.resource_id.split("/")[-1] if r.resource_id else ""),
            "resource_group": r.resource_group,
            "subscription_name": r.subscription_name,
        })

    return [{
        "tag_value": val,
        "resource_count": len(resources),
        "resources": resources[:50],  # cap at 50 per value for display
    } for val, resources in sorted(value_map.items())]


# ── Business mapping CRUD ─────────────────────────────────────────────────────

class MappingCreate(BaseModel):
    business_id: str
    control_tower_id: str
    mapping_type: str
    subscription_id: Optional[str] = None
    subscription_name: Optional[str] = None
    resource_group: Optional[str] = None
    tag_key: Optional[str] = None
    tag_value: Optional[str] = None
    resource_ids: Optional[list[str]] = None


@router.get("/mappings/{business_id}")
async def get_business_mappings(
    business_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(AzureBusinessMapping).where(AzureBusinessMapping.business_id == business_id)
    )).scalars().all()
    return [{"id": str(r.id), "mapping_type": r.mapping_type,
             "subscription_id": r.subscription_id, "subscription_name": r.subscription_name,
             "resource_group": r.resource_group, "tag_key": r.tag_key, "tag_value": r.tag_value,
             "resource_ids": json.loads(r.resource_ids) if r.resource_ids else []} for r in rows]


@router.post("/mappings", status_code=201)
async def create_business_mapping(
    payload: MappingCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    m = AzureBusinessMapping(
        business_id=payload.business_id, control_tower_id=payload.control_tower_id,
        mapping_type=payload.mapping_type, subscription_id=payload.subscription_id,
        subscription_name=payload.subscription_name, resource_group=payload.resource_group,
        tag_key=payload.tag_key, tag_value=payload.tag_value,
        resource_ids=json.dumps(payload.resource_ids) if payload.resource_ids else None,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": str(m.id)}


@router.delete("/mappings/{mapping_id}", status_code=204)
async def delete_business_mapping(
    mapping_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    m = (await db.execute(select(AzureBusinessMapping).where(AzureBusinessMapping.id == mapping_id))).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await db.commit()


# ── Azure cost per business ───────────────────────────────────────────────────

@router.get("/business-costs")
async def all_business_azure_costs(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    cache_key = f"az_biz_costs_{start}_{end}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached

    mappings = (await db.execute(select(AzureBusinessMapping))).scalars().all()
    if not mappings:
        return {}

    # Group mappings by type to batch queries
    sub_mappings = [m for m in mappings if m.mapping_type == "subscription"]
    rg_mappings = [m for m in mappings if m.mapping_type == "resource_group"]
    tag_mappings = [m for m in mappings if m.mapping_type == "tag"]
    res_mappings = [m for m in mappings if m.mapping_type == "resource"]

    result: dict = {str(m.business_id): {"actual_cost": 0.0, "savings": 0.0, "true_cost": 0.0} for m in mappings}

    async def _query_costs(conditions_actual, conditions_amortized, group_col):
        actual_t, amortized_t = await asyncio.gather(
            db.execute(select(group_col, func.sum(AzureCostRecord.actual_cost).label("c")).where(*conditions_actual).group_by(group_col)),
            db.execute(select(group_col, func.sum(AzureCostRecord.amortized_cost).label("c")).where(*conditions_amortized).group_by(group_col)),
        )
        actual_map = {str(r[0]): float(r[1] or 0) for r in actual_t.all()}
        amortized_map = {str(r[0]): float(r[1] or 0) for r in amortized_t.all()}
        return actual_map, amortized_map

    base_a = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual"]
    base_m = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized"]

    # Subscription-level mappings — 2 queries total
    if sub_mappings:
        sub_ids = list({m.subscription_id for m in sub_mappings})
        actual_map, amortized_map = await _query_costs(
            [*base_a, AzureCostRecord.subscription_id.in_(sub_ids)],
            [*base_m, AzureCostRecord.subscription_id.in_(sub_ids)],
            AzureCostRecord.subscription_id,
        )
        for m in sub_mappings:
            biz_id = str(m.business_id)
            actual = actual_map.get(m.subscription_id, 0)
            amortized = amortized_map.get(m.subscription_id, actual)
            result[biz_id]["actual_cost"] += actual
            result[biz_id]["savings"] += max(0, actual - amortized)
            result[biz_id]["true_cost"] += amortized if amortized > 0 else actual

    # Resource group-level — 2 queries
    if rg_mappings:
        rg_ids = list({m.resource_group for m in rg_mappings})
        actual_map, amortized_map = await _query_costs(
            [*base_a, AzureCostRecord.resource_group.in_(rg_ids)],
            [*base_m, AzureCostRecord.resource_group.in_(rg_ids)],
            AzureCostRecord.resource_group,
        )
        for m in rg_mappings:
            biz_id = str(m.business_id)
            actual = actual_map.get(m.resource_group, 0)
            amortized = amortized_map.get(m.resource_group, actual)
            result[biz_id]["actual_cost"] += actual
            result[biz_id]["savings"] += max(0, actual - amortized)
            result[biz_id]["true_cost"] += amortized if amortized > 0 else actual

    # Tag and resource mappings — sequential (rare, usually few)
    for m in tag_mappings + res_mappings:
        biz_id = str(m.business_id)
        base = [AzureCostRecord.date >= start, AzureCostRecord.date <= end]
        if m.mapping_type == "tag":
            base.append(AzureCostRecord.tags.contains(f'"{m.tag_key}"'))
            if m.tag_value:
                base.append(AzureCostRecord.tags.contains(f'"{m.tag_value}"'))
        else:
            rids = json.loads(m.resource_ids) if m.resource_ids else []
            if not rids:
                continue
            base.append(AzureCostRecord.resource_id.in_(rids))

        actual_t, amortized_t = await asyncio.gather(
            db.execute(select(func.sum(AzureCostRecord.actual_cost)).where(*base, AzureCostRecord.cost_type == "actual")),
            db.execute(select(func.sum(AzureCostRecord.amortized_cost)).where(*base, AzureCostRecord.cost_type == "amortized")),
        )
        actual = float(actual_t.scalar() or 0)
        amortized = float(amortized_t.scalar() or 0)
        result[biz_id]["actual_cost"] += actual
        result[biz_id]["savings"] += max(0, actual - amortized)
        result[biz_id]["true_cost"] += amortized if amortized > 0 else actual

    # Remove zero-cost businesses
    result = {k: v for k, v in result.items() if v["actual_cost"] > 0 or v["true_cost"] > 0}
    _cache_set(cache_key, result)
    return result
