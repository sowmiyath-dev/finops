import csv, io, json, time
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from app.models.database import get_db
from app.models.db_models import User, ControlTower, SubAccount, CostRecord, SyncLog
from app.models.schemas import ReportFilter
from app.services.auth_service import get_current_user
from app.services.cost_service import COST_LAG_DAYS

router = APIRouter(prefix="/reports", tags=["reports"])

# Simple in-memory cache for metadata — these rarely change
_cache: dict = {}
_CACHE_TTL = 1800  # 30 minutes

def _cache_get(key: str):
    e = _cache.get(key)
    if e and time.time() - e["t"] < _CACHE_TTL:
        return e["d"]
    return None

def _cache_set(key: str, data):
    _cache[key] = {"d": data, "t": time.time()}

METRIC_MAP = {
    "unblended_cost": CostRecord.unblended_cost,
    "blended_cost": CostRecord.blended_cost,
    "net_unblended_cost": CostRecord.net_unblended_cost,
    "amortized_cost": CostRecord.amortized_cost,
}


def _build_filters(f: ReportFilter, user_ct_ids: list[str]):
    """Build SQLAlchemy filter conditions from ReportFilter."""
    start = date.fromisoformat(f.start_date)
    end = date.fromisoformat(f.end_date)
    conditions = [
        CostRecord.date >= start,
        CostRecord.date <= end,
        CostRecord.control_tower_id.in_(user_ct_ids),
    ]
    if f.control_tower_ids:
        conditions.append(CostRecord.control_tower_id.in_(f.control_tower_ids))
    if f.account_ids:
        conditions.append(CostRecord.aws_account_id.in_(f.account_ids))
    if f.services:
        conditions.append(CostRecord.service.in_(f.services))
    if f.regions:
        conditions.append(CostRecord.region.in_(f.regions))
    if f.purchase_types:
        conditions.append(CostRecord.purchase_type.in_(f.purchase_types))
    if f.charge_types:
        conditions.append(CostRecord.line_item_type.in_(f.charge_types))
    if f.marketplace_only is True:
        conditions.append(CostRecord.is_marketplace == True)
    elif f.marketplace_only is False:
        conditions.append(CostRecord.is_marketplace == False)
    if f.tag_key and f.tag_value:
        conditions.append(CostRecord.tags.contains(f.tag_key))
    return conditions


async def _get_user_ct_ids(db: AsyncSession, user: User) -> list[str]:
    cache_key = f"ct_ids_{user.id}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached
    if user.role == "viewer":
        result = await db.execute(select(ControlTower.id))
    else:
        result = await db.execute(select(ControlTower.id).where(ControlTower.user_id == user.id))
    data = [str(r[0]) for r in result.all()]
    _cache_set(cache_key, data)
    return data


# ── Account-wise report ───────────────────────────────────────────────────────

@router.post("/account-wise")
async def account_wise(f: ReportFilter, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    if not ct_ids:
        return []
    metric_col = METRIC_MAP.get(f.metric, CostRecord.unblended_cost)
    conditions = _build_filters(f, ct_ids)

    group_cols = [CostRecord.aws_account_id, CostRecord.account_name]
    if f.granularity == "daily":
        group_cols.append(CostRecord.date)

    stmt = (
        select(*group_cols, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(*group_cols)
        .order_by(CostRecord.aws_account_id)
    )
    result = await db.execute(stmt)
    rows = result.all()

    data = []
    for row in rows:
        item = {"aws_account_id": row.aws_account_id, "account_name": row.account_name, "cost": float(row.cost or 0)}
        if f.granularity == "daily":
            item["date"] = str(row.date)
        data.append(item)
    return data


@router.post("/account-wise-true-cost")
async def account_wise_true_cost(
    f: ReportFilter,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    True cost per account = Usage cost + SP amortized cost.
    Excludes SavingsPlanRecurringFee (payer account fee) and SavingsPlanNegation.
    SP cost is already allocated per sub-account via amortized_cost in SavingsPlanCoveredUsage rows.
    """
    ct_ids = await _get_user_ct_ids(db, user)
    if not ct_ids:
        return []

    start = date.fromisoformat(f.start_date)
    end   = date.fromisoformat(f.end_date)

    base = [
        CostRecord.control_tower_id.in_(ct_ids),
        CostRecord.date >= start,
        CostRecord.date <= end,
    ]
    if f.control_tower_ids:
        base.append(CostRecord.control_tower_id.in_(f.control_tower_ids))
    if f.account_ids:
        base.append(CostRecord.aws_account_id.in_(f.account_ids))

    # Usage cost — all line items EXCEPT SP fee, SP negation, SP covered usage
    # (SP covered usage is handled separately via amortized_cost)
    usage_rows = (await db.execute(
        select(
            CostRecord.aws_account_id,
            CostRecord.account_name,
            func.sum(CostRecord.unblended_cost).label("usage_cost"),
        )
        .where(
            *base,
            CostRecord.line_item_type.notin_([
                "SavingsPlanRecurringFee",
                "SavingsPlanNegation",
                "SavingsPlanCoveredUsage",
            ]),
        )
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
    )).all()

    # SP allocated cost per account — use amortized_cost from SavingsPlanCoveredUsage
    sp_rows = (await db.execute(
        select(
            CostRecord.aws_account_id,
            func.sum(CostRecord.amortized_cost).label("sp_cost"),
            func.sum(CostRecord.unblended_cost).label("sp_on_demand"),
            func.count(func.distinct(CostRecord.resource_id)).label("sp_resources"),
        )
        .where(
            *base,
            CostRecord.line_item_type == "SavingsPlanCoveredUsage",
        )
        .group_by(CostRecord.aws_account_id)
    )).all()

    sp_map = {
        r.aws_account_id: {
            "sp_cost":      float(r.sp_cost or 0),
            "sp_on_demand": float(r.sp_on_demand or 0),
            "sp_resources": int(r.sp_resources or 0),
        }
        for r in sp_rows
    }

    result = []
    for row in usage_rows:
        sp = sp_map.get(row.aws_account_id, {"sp_cost": 0, "sp_on_demand": 0, "sp_resources": 0})
        usage_cost  = float(row.usage_cost or 0)
        sp_cost     = sp["sp_cost"]
        sp_on_demand = sp["sp_on_demand"]
        true_cost   = usage_cost + sp_cost
        savings     = sp_on_demand - sp_cost
        result.append({
            "aws_account_id": row.aws_account_id,
            "account_name":   row.account_name or row.aws_account_id,
            "usage_cost":     round(usage_cost, 4),
            "sp_cost":        round(sp_cost, 4),
            "sp_on_demand":   round(sp_on_demand, 4),
            "true_cost":      round(true_cost, 4),
            "savings":        round(savings, 4),
            "savings_pct":    round(savings / sp_on_demand * 100, 2) if sp_on_demand > 0 else 0,
            "sp_resources":   sp["sp_resources"],
        })

    result.sort(key=lambda x: x["true_cost"], reverse=True)
    return result


# ── Service-wise report ───────────────────────────────────────────────────────

@router.post("/service-wise")
async def service_wise(f: ReportFilter, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    if not ct_ids:
        return []
    metric_col = METRIC_MAP.get(f.metric, CostRecord.unblended_cost)
    conditions = _build_filters(f, ct_ids)

    group_cols = [CostRecord.service]
    if f.account_ids:
        group_cols.append(CostRecord.aws_account_id)
    if f.granularity == "daily":
        group_cols.append(CostRecord.date)

    stmt = (
        select(*group_cols, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(*group_cols)
        .order_by(func.sum(metric_col).desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    data = []
    for row in rows:
        item = {"service": row.service, "cost": float(row.cost or 0)}
        if f.account_ids:
            item["aws_account_id"] = row.aws_account_id
        if f.granularity == "daily":
            item["date"] = str(row.date)
        data.append(item)
    return data


# ── Resource-wise report ──────────────────────────────────────────────────────

@router.post("/resource-wise")
async def resource_wise(f: ReportFilter, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    if not ct_ids:
        return []
    metric_col = METRIC_MAP.get(f.metric, CostRecord.unblended_cost)
    conditions = _build_filters(f, ct_ids)
    conditions.append(CostRecord.resource_id.isnot(None))
    conditions.append(CostRecord.resource_id != "")

    # Always group by resource_id + service + account only
    # Sum all usage types and all days into one total per resource
    stmt = (
        select(
            CostRecord.resource_id,
            CostRecord.service,
            CostRecord.aws_account_id,
            CostRecord.account_name,
            CostRecord.region,
            func.sum(metric_col).label("cost"),
        )
        .where(and_(*conditions))
        .group_by(
            CostRecord.resource_id,
            CostRecord.service,
            CostRecord.aws_account_id,
            CostRecord.account_name,
            CostRecord.region,
        )
        .order_by(func.sum(metric_col).desc())
        .limit(500)
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        {
            "resource_id": row.resource_id,
            "service": row.service,
            "aws_account_id": row.aws_account_id,
            "account_name": row.account_name or "",
            "region": row.region or "",
            "cost": float(row.cost or 0),
        }
        for row in rows
    ]


# ── Tag-wise report ───────────────────────────────────────────────────────────

@router.post("/tag-wise")
async def tag_wise(f: ReportFilter, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    if not ct_ids:
        return []
    metric_col = METRIC_MAP.get(f.metric, CostRecord.unblended_cost)
    conditions = _build_filters(f, ct_ids)
    conditions.append(CostRecord.tags.isnot(None))

    stmt = (
        select(CostRecord.tags, CostRecord.aws_account_id, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(CostRecord.tags, CostRecord.aws_account_id)
        .order_by(func.sum(metric_col).desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    data = []
    for row in rows:
        try:
            tags_dict = json.loads(row.tags) if row.tags else {}
        except Exception:
            tags_dict = {}
        tag_val = tags_dict.get(f.tag_key, "") if f.tag_key else str(tags_dict)
        data.append({
            "tag_key": f.tag_key or "all",
            "tag_value": tag_val,
            "aws_account_id": row.aws_account_id,
            "cost": float(row.cost or 0),
        })
    return data


# ── Summary (for dashboard overview) ─────────────────────────────────────────

@router.post("/summary")
async def summary(f: ReportFilter, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    if not ct_ids:
        return {}

    # Cache key based on filter
    import hashlib
    cache_key = f"summary_{hashlib.md5(str(f.dict()).encode()).hexdigest()}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached

    metric_col = METRIC_MAP.get(f.metric, CostRecord.unblended_cost)
    conditions = _build_filters(f, ct_ids)

    # Run all 4 queries in parallel
    import asyncio
    total_task = db.execute(select(func.sum(metric_col)).where(and_(*conditions)))
    svc_task = db.execute(
        select(CostRecord.service, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(CostRecord.service)
        .order_by(func.sum(metric_col).desc())
        .limit(5)
    )
    trend_task = db.execute(
        select(CostRecord.date, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(CostRecord.date)
        .order_by(CostRecord.date)
    )
    acc_task = db.execute(
        select(CostRecord.aws_account_id, CostRecord.account_name, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
        .order_by(func.sum(metric_col).desc())
    )

    total_result, svc_result, trend_result, acc_result = await asyncio.gather(
        total_task, svc_task, trend_task, acc_task
    )

    total_cost = float(total_result.scalar() or 0)
    top_services = [{"service": r.service, "cost": float(r.cost or 0)} for r in svc_result.all()]
    daily_trend = [{"date": str(r.date), "cost": float(r.cost or 0)} for r in trend_result.all()]
    per_account = [{"aws_account_id": r.aws_account_id, "account_name": r.account_name, "cost": float(r.cost or 0)} for r in acc_result.all()]

    result = {
        "total_cost": total_cost,
        "top_services": top_services,
        "daily_trend": daily_trend,
        "per_account": per_account,
        "metric": f.metric,
        "period": {"start": f.start_date, "end": f.end_date},
    }
    _cache_set(cache_key, result)
    return result


# ── CSV Export ────────────────────────────────────────────────────────────────

@router.post("/export/csv")
async def export_csv(f: ReportFilter, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    if not ct_ids:
        raise HTTPException(status_code=404, detail="No control towers found")

    metric_col = METRIC_MAP.get(f.metric, CostRecord.unblended_cost)
    conditions = _build_filters(f, ct_ids)

    stmt = (
        select(
            CostRecord.date,
            CostRecord.aws_account_id,
            CostRecord.account_name,
            CostRecord.service,
            CostRecord.region,
            CostRecord.resource_id,
            CostRecord.purchase_type,
            CostRecord.usage_type,
            CostRecord.usage_quantity,
            CostRecord.usage_unit,
            CostRecord.blended_cost,
            CostRecord.unblended_cost,
            CostRecord.net_unblended_cost,
            CostRecord.amortized_cost,
            CostRecord.tags,
        )
        .where(and_(*conditions))
        .order_by(CostRecord.date, CostRecord.aws_account_id, CostRecord.service)
    )
    result = await db.execute(stmt)
    rows = result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Date", "Account ID", "Account Name", "Service", "Region",
        "Resource ID", "Purchase Type", "Usage Type", "Usage Quantity", "Usage Unit",
        "Blended Cost (USD)", "Unblended Cost (USD)", "Net Unblended Cost (USD)",
        "Amortized Cost (USD)", "Tags",
    ])
    for row in rows:
        writer.writerow([
            row.date, row.aws_account_id, row.account_name or "",
            row.service, row.region or "", row.resource_id or "",
            row.purchase_type or "", row.usage_type or "",
            float(row.usage_quantity or 0), row.usage_unit or "",
            float(row.blended_cost or 0), float(row.unblended_cost or 0),
            float(row.net_unblended_cost or 0), float(row.amortized_cost or 0),
            row.tags or "",
        ])

    output.seek(0)
    filename = f"finops_cost_{f.start_date}_{f.end_date}_{f.group_by}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── Metadata helpers ──────────────────────────────────────────────────────────

@router.get("/meta/services")
async def get_services(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    key = f"svc_{'_'.join(sorted(ct_ids))}"
    if (cached := _cache_get(key)) is not None:
        return cached
    result = await db.execute(select(CostRecord.service).where(CostRecord.control_tower_id.in_(ct_ids)).distinct())
    data = sorted([r[0] for r in result.all()])
    _cache_set(key, data)
    return data


@router.get("/meta/regions")
async def get_regions(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    key = f"reg_{'_'.join(sorted(ct_ids))}"
    if (cached := _cache_get(key)) is not None:
        return cached
    result = await db.execute(select(CostRecord.region).where(CostRecord.control_tower_id.in_(ct_ids)).distinct())
    data = sorted([r[0] for r in result.all() if r[0]])
    _cache_set(key, data)
    return data


@router.get("/meta/tag-keys")
async def get_tag_keys(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    result = await db.execute(
        select(CostRecord.tags).where(
            CostRecord.control_tower_id.in_(ct_ids),
            CostRecord.tags.isnot(None),
        ).limit(500)
    )
    keys = set()
    for row in result.all():
        try:
            d = json.loads(row[0])
            keys.update(d.keys())
        except Exception:
            pass
    return sorted(list(keys))


@router.get("/sync-logs")
async def get_sync_logs(limit: int = 100, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.control_tower_id.in_(ct_ids))
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/meta/charge-types")
async def get_charge_types(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    key = f"ct_{'_'.join(sorted(ct_ids))}"
    if (cached := _cache_get(key)) is not None:
        return cached
    result = await db.execute(
        select(CostRecord.line_item_type).where(
            CostRecord.control_tower_id.in_(ct_ids),
            CostRecord.line_item_type.isnot(None)
        ).distinct()
    )
    data = sorted([r[0] for r in result.all() if r[0]])
    _cache_set(key, data)
    return data


@router.get("/meta/resources-by-account")
async def get_resources_by_account(
    account_id: str,
    ct_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get all distinct resource IDs for a given AWS account ID, scoped to a specific CT."""
    cache_key = f"res_by_acc_{ct_id}_{account_id}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached

    ct_ids = await _get_user_ct_ids(db, user)

    # Scope to the specific CT if provided — prevents cross-CT resource bleed
    if ct_id and ct_id in ct_ids:
        scoped_ct_ids = [ct_id]
    else:
        scoped_ct_ids = ct_ids

    since = date.today() - timedelta(days=90)

    result = await db.execute(
        select(
            CostRecord.resource_id,
            CostRecord.service,
            CostRecord.region,
        )
        .where(
            CostRecord.control_tower_id.in_(scoped_ct_ids),
            CostRecord.aws_account_id == account_id,
            CostRecord.resource_id.isnot(None),
            CostRecord.resource_id != "",
            CostRecord.date >= since,
        )
        .group_by(CostRecord.resource_id, CostRecord.service, CostRecord.region)
        .order_by(CostRecord.service, CostRecord.resource_id)
        .limit(5000)
    )
    rows = result.all()
    data = [
        {"resource_id": r.resource_id, "service": r.service, "region": r.region or ""}
        for r in rows
    ]
    _cache_set(cache_key, data)
    return data


@router.get("/meta/accounts")
async def get_accounts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get all distinct account IDs and names."""
    ct_ids = await _get_user_ct_ids(db, user)
    result = await db.execute(
        select(CostRecord.aws_account_id, CostRecord.account_name)
        .where(CostRecord.control_tower_id.in_(ct_ids))
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
        .order_by(CostRecord.account_name)
    )
    return [
        {"aws_account_id": r.aws_account_id, "account_name": r.account_name or r.aws_account_id}
        for r in result.all()
    ]


@router.get("/data-boundary")
async def data_boundary():
    """Returns the most recent date for which cost data is accurate."""
    accurate_until = date.today() - timedelta(days=COST_LAG_DAYS)
    return {"accurate_until": str(accurate_until), "lag_days": COST_LAG_DAYS}


@router.get("/savings/ct-distribution")
async def savings_ct_distribution(
    ct_id: str,
    start_date: str,
    end_date: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cache_key = f"sp_dist_{ct_id}_{start_date}_{end_date}"
    if (cached := _cache_get(cache_key)) is not None:
        return cached
    from sqlalchemy import case, literal
    ct_ids = await _get_user_ct_ids(db, user)
    start = date.fromisoformat(start_date)
    end   = date.fromisoformat(end_date)

    base = [
        CostRecord.control_tower_id == ct_id,
        CostRecord.date >= start,
        CostRecord.date <= end,
    ]

    # Payer account SP fee
    payer_rows = (await db.execute(
        select(
            CostRecord.aws_account_id,
            CostRecord.account_name,
            func.sum(CostRecord.unblended_cost).label("sp_fee"),
        )
        .where(*base, CostRecord.line_item_type == "SavingsPlanRecurringFee")
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
    )).all()

    total_sp_fee = sum(float(r.sp_fee or 0) for r in payer_rows)
    payer_accounts = [
        {"aws_account_id": r.aws_account_id, "account_name": r.account_name, "sp_fee": float(r.sp_fee or 0)}
        for r in payer_rows
    ]
    payer_ids = {r["aws_account_id"] for r in payer_accounts}

    # USAGE COST = Usage + DiscountedUsage + RIFee only (no SP, no Tax/Credit/Refund)
    usage_cost_expr = func.sum(
        case(
            (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
            else_=literal(0),
        )
    ).label("usage_cost")

    # TRUE COST per account in ONE query:
    # - SavingsPlanCoveredUsage         -> amortized_cost (SP allocated share)
    # - Usage / DiscountedUsage / RIFee -> unblended_cost (actual usage charges)
    # - Everything else                 -> 0 (Tax, Credit, Refund, Fee, Negation, RecurringFee excluded)
    from sqlalchemy import case, literal
    true_cost_expr = func.sum(
        case(
            (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
            (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
            else_=literal(0),
        )
    ).label("true_cost")

    # Also get SP allocated separately for display
    sp_allocated_expr = func.sum(
        case(
            (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
            else_=literal(0),
        )
    ).label("sp_allocated")

    sp_on_demand_expr = func.sum(
        case(
            (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.unblended_cost),
            else_=literal(0),
        )
    ).label("sp_on_demand")

    sp_resources_expr = func.count(
        func.distinct(
            case(
                (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.resource_id),
                else_=None,
            )
        )
    ).label("sp_resources")

    all_rows = (await db.execute(
        select(
            CostRecord.aws_account_id,
            CostRecord.account_name,
            usage_cost_expr,
            true_cost_expr,
            sp_allocated_expr,
            sp_on_demand_expr,
            sp_resources_expr,
        )
        .where(*base)
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
    )).all()

    total_sp_on_demand = sum(float(r.sp_on_demand or 0) for r in all_rows if r.aws_account_id not in payer_ids)

    sub_accounts = []
    for row in all_rows:
        true_cost    = float(row.true_cost or 0)
        usage_cost   = float(row.usage_cost or 0)
        sp_allocated = float(row.sp_allocated or 0)
        sp_on_demand = float(row.sp_on_demand or 0)
        savings      = sp_on_demand - sp_allocated
        is_payer     = row.aws_account_id in payer_ids
        payer_sp_fee = next((p["sp_fee"] for p in payer_accounts if p["aws_account_id"] == row.aws_account_id), 0)

        sub_accounts.append({
            "aws_account_id":      row.aws_account_id,
            "account_name":        (row.account_name or row.aws_account_id) + (" (Payer)" if is_payer else ""),
            "usage_cost":          round(usage_cost, 2),
            "true_cost":           round(true_cost, 2),
            "sp_allocated":        round(sp_allocated, 2),
            "sp_on_demand":        round(sp_on_demand, 2),
            "savings":             round(savings, 2),
            "savings_pct":         round(savings / sp_on_demand * 100, 2) if sp_on_demand > 0 else 0,
            "sp_resources":        int(row.sp_resources or 0),
            "sp_share_pct":        round(sp_on_demand / total_sp_on_demand * 100, 2) if total_sp_on_demand > 0 and not is_payer else 0,
            "is_payer":            is_payer,
            "sp_fee_distributed":  round(payer_sp_fee, 2) if is_payer else 0,
        })

    sub_accounts.sort(key=lambda x: x["true_cost"], reverse=True)

    total_usage    = sum(a["usage_cost"] for a in sub_accounts if not a["is_payer"])
    total_true     = sum(a["true_cost"] for a in sub_accounts)
    total_sp_alloc = sum(a["sp_allocated"] for a in sub_accounts)
    total_savings  = sum(a["savings"] for a in sub_accounts)

    result = {
        "ct_id":              ct_id,
        "start":              start_date,
        "end":                end_date,
        "total_sp_fee":       round(total_sp_fee, 2),
        "payer_accounts":     payer_accounts,
        "total_usage_cost":   round(total_usage, 2),
        "total_true_cost":    round(total_true, 2),
        "total_sp_allocated": round(total_sp_alloc, 2),
        "total_savings":      round(total_savings, 2),
        "sub_accounts":       sub_accounts,
    }
    _cache_set(cache_key, result)
    return result
async def savings_summary(
    start_date: str,
    end_date: str,
    account_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Savings Plan allocation summary.
    For each account:
      - usage_cost       = sum of Usage line items (unblended)
      - sp_covered_cost  = sum of SavingsPlanCoveredUsage amortized_cost
                           (this IS the allocated SP fee for that account)
      - true_cost        = usage_cost + sp_covered_cost
      - on_demand_equiv  = usage_cost + SavingsPlanCoveredUsage unblended_cost
      - savings          = on_demand_equiv - true_cost
      - savings_pct      = savings / on_demand_equiv * 100
    """
    ct_ids = await _get_user_ct_ids(db, user)
    start = date.fromisoformat(start_date)
    end   = date.fromisoformat(end_date)
    acc_filter = account_ids.split(",") if account_ids else None

    base = [
        CostRecord.control_tower_id.in_(ct_ids),
        CostRecord.date >= start,
        CostRecord.date <= end,
    ]
    if acc_filter:
        base.append(CostRecord.aws_account_id.in_(acc_filter))

    # ── Usage cost per account (exclude SP/RI fee rows) ──────────────────
    usage_rows = (await db.execute(
        select(
            CostRecord.aws_account_id,
            CostRecord.account_name,
            func.sum(CostRecord.unblended_cost).label("usage_cost"),
        )
        .where(
            *base,
            CostRecord.line_item_type.in_(["Usage", "DiscountedUsage"]),
        )
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
    )).all()

    # ── SP covered usage per account ─────────────────────────────────────
    sp_rows = (await db.execute(
        select(
            CostRecord.aws_account_id,
            CostRecord.account_name,
            func.sum(CostRecord.unblended_cost).label("on_demand_equiv"),  # what it would cost on-demand
            func.sum(CostRecord.amortized_cost).label("sp_allocated"),     # actual SP cost allocated
            func.count(func.distinct(CostRecord.resource_id)).label("sp_resource_count"),
        )
        .where(
            *base,
            CostRecord.line_item_type == "SavingsPlanCoveredUsage",
        )
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
    )).all()

    # ── Total SP recurring fee (sits in payer account) ───────────────────
    sp_fee_row = (await db.execute(
        select(func.sum(CostRecord.unblended_cost).label("total_sp_fee"))
        .where(
            CostRecord.control_tower_id.in_(ct_ids),
            CostRecord.date >= start,
            CostRecord.date <= end,
            CostRecord.line_item_type == "SavingsPlanRecurringFee",
        )
    )).scalar() or 0

    # Build maps
    usage_map  = {r.aws_account_id: float(r.usage_cost or 0) for r in usage_rows}
    name_map   = {r.aws_account_id: r.account_name for r in usage_rows}
    sp_map     = {r.aws_account_id: {
        "on_demand_equiv": float(r.on_demand_equiv or 0),
        "sp_allocated":    float(r.sp_allocated or 0),
        "sp_resource_count": int(r.sp_resource_count or 0),
    } for r in sp_rows}
    for r in sp_rows:
        name_map[r.aws_account_id] = r.account_name

    all_accounts = set(usage_map.keys()) | set(sp_map.keys())

    # Total on-demand equivalent across all accounts (for % calculation)
    total_on_demand_equiv = sum(v["on_demand_equiv"] for v in sp_map.values())

    per_account = []
    for acc_id in all_accounts:
        usage_cost      = usage_map.get(acc_id, 0)
        sp              = sp_map.get(acc_id, {"on_demand_equiv": 0, "sp_allocated": 0, "sp_resource_count": 0})
        on_demand_equiv = sp["on_demand_equiv"]
        sp_allocated    = sp["sp_allocated"]
        true_cost       = usage_cost + sp_allocated
        on_demand_total = usage_cost + on_demand_equiv
        savings         = on_demand_equiv - sp_allocated  # saving vs on-demand for SP-covered resources
        savings_pct     = round(savings / on_demand_equiv * 100, 2) if on_demand_equiv > 0 else 0
        sp_share_pct    = round(on_demand_equiv / total_on_demand_equiv * 100, 2) if total_on_demand_equiv > 0 else 0

        per_account.append({
            "aws_account_id":    acc_id,
            "account_name":      name_map.get(acc_id, acc_id),
            "usage_cost":        round(usage_cost, 4),
            "sp_on_demand_equiv": round(on_demand_equiv, 4),  # what SP resources would cost on-demand
            "sp_allocated_cost": round(sp_allocated, 4),       # actual SP cost allocated to this account
            "true_cost":         round(true_cost, 4),           # usage + SP allocated
            "on_demand_total":   round(on_demand_total, 4),     # what everything would cost on-demand
            "savings":           round(savings, 4),
            "savings_pct":       savings_pct,
            "sp_share_pct":      sp_share_pct,                  # this account's % of total SP usage
            "sp_resource_count": sp["sp_resource_count"],
        })

    per_account.sort(key=lambda x: x["true_cost"], reverse=True)

    total_usage      = sum(a["usage_cost"] for a in per_account)
    total_sp_alloc   = sum(a["sp_allocated_cost"] for a in per_account)
    total_true       = sum(a["true_cost"] for a in per_account)
    total_savings    = sum(a["savings"] for a in per_account)
    total_od_equiv   = sum(a["on_demand_total"] for a in per_account)
    overall_savings_pct = round(total_savings / total_od_equiv * 100, 2) if total_od_equiv > 0 else 0

    return {
        "start": start_date,
        "end": end_date,
        "total_sp_recurring_fee": round(float(sp_fee_row), 4),
        "total_usage_cost":       round(total_usage, 4),
        "total_sp_allocated":     round(total_sp_alloc, 4),
        "total_true_cost":        round(total_true, 4),
        "total_savings":          round(total_savings, 4),
        "overall_savings_pct":    overall_savings_pct,
        "per_account":            per_account,
    }


@router.get("/savings/resources")
async def savings_resources(
    start_date: str,
    end_date: str,
    ct_id: Optional[str] = None,
    account_ids: Optional[str] = None,
    services: Optional[str] = None,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ct_ids = await _get_user_ct_ids(db, user)
    start = date.fromisoformat(start_date)
    end   = date.fromisoformat(end_date)

    # Always scope to specific CT to prevent cross-CT data bleed
    scoped_ct_ids = [ct_id] if ct_id and ct_id in ct_ids else ct_ids

    base = [
        CostRecord.control_tower_id.in_(scoped_ct_ids),
        CostRecord.date >= start,
        CostRecord.date <= end,
        CostRecord.resource_id.isnot(None),
        CostRecord.resource_id != "",
    ]
    if account_ids:
        base.append(CostRecord.aws_account_id.in_(account_ids.split(",")))
    if services:
        base.append(CostRecord.service.in_(services.split(",")))

    from sqlalchemy import case, literal

    # Step 1 — get all resources that have SP coverage
    sp_rows = (await db.execute(
        select(
            CostRecord.resource_id,
            CostRecord.aws_account_id,
            CostRecord.account_name,
            CostRecord.service,
            CostRecord.region,
            func.sum(CostRecord.unblended_cost).label("sp_on_demand_cost"),
            func.sum(CostRecord.amortized_cost).label("sp_allocated_cost"),
            func.sum(CostRecord.usage_quantity).label("sp_hours"),
            func.max(CostRecord.usage_type).label("usage_type"),
        )
        .where(and_(*base, CostRecord.line_item_type == "SavingsPlanCoveredUsage"))
        .group_by(
            CostRecord.resource_id, CostRecord.aws_account_id,
            CostRecord.account_name, CostRecord.service, CostRecord.region,
        )
        .order_by(func.sum(CostRecord.unblended_cost).desc())
        .limit(limit)
    )).all()

    if not sp_rows:
        return []

    # Step 2 — for those same resources, get uncovered Usage cost (hours beyond SP)
    sp_resource_ids = list({r.resource_id for r in sp_rows})

    usage_rows = (await db.execute(
        select(
            CostRecord.resource_id,
            CostRecord.aws_account_id,
            func.sum(CostRecord.unblended_cost).label("uncovered_cost"),
            func.sum(CostRecord.usage_quantity).label("usage_hours"),
        )
        .where(and_(
            *base,
            CostRecord.line_item_type == "Usage",
            CostRecord.resource_id.in_(sp_resource_ids),
        ))
        .group_by(CostRecord.resource_id, CostRecord.aws_account_id)
    )).all()

    # Build lookup: (resource_id, account_id) -> (uncovered_cost, usage_hours)
    usage_map = {
        (r.resource_id, r.aws_account_id): (
            float(r.uncovered_cost or 0),
            float(r.usage_hours or 0),
        )
        for r in usage_rows
    }

    result = []
    for r in sp_rows:
        sp_on_demand  = float(r.sp_on_demand_cost or 0)
        sp_allocated  = float(r.sp_allocated_cost or 0)
        uncovered, usage_hrs = usage_map.get((r.resource_id, r.aws_account_id), (0.0, 0.0))
        total_hours   = float(r.sp_hours or 0) + usage_hrs
        true_cost     = sp_allocated + uncovered
        savings       = sp_on_demand - sp_allocated  # savings only on SP-covered portion
        on_demand_total = sp_on_demand + uncovered   # full on-demand equivalent

        # Extract instance type from usage_type e.g. "ap-south-1-BoxUsage:m5.xlarge" -> "m5.xlarge"
        raw_usage_type = r.usage_type or ""
        instance_type = raw_usage_type.split(":")[-1] if ":" in raw_usage_type else ""

        result.append({
            "resource_id":       r.resource_id,
            "aws_account_id":    r.aws_account_id,
            "account_name":      r.account_name or r.aws_account_id,
            "service":           r.service,
            "region":            r.region or "",
            "instance_type":     instance_type,
            "sp_on_demand_cost": round(sp_on_demand, 4),   # what SP hours would cost on-demand
            "sp_allocated_cost": round(sp_allocated, 4),   # actual SP cost (amortized)
            "uncovered_cost":    round(uncovered, 4),       # hours beyond SP at on-demand rate
            "total_hours":       round(total_hours, 2),      # total usage hours (SP + uncovered)
            "true_cost":         round(true_cost, 4),       # sp_allocated + uncovered
            "on_demand_cost":    round(on_demand_total, 4), # full on-demand equivalent (for savings %)
            "savings":           round(savings, 4),
            "savings_pct":       round(savings / sp_on_demand * 100, 2) if sp_on_demand > 0 else 0,
        })

    return result
