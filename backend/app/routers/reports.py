import csv, io, json
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, cast, String

from app.models.database import get_db
from app.models.db_models import User, ControlTower, SubAccount, CostRecord, SyncLog
from app.models.schemas import ReportFilter
from app.services.auth_service import get_current_user
from app.services.cost_service import COST_LAG_DAYS, fetch_available_tag_keys

router = APIRouter(prefix="/reports", tags=["reports"])

METRIC_MAP = {
    "unblended_cost": CostRecord.unblended_cost,
    "blended_cost": CostRecord.blended_cost,
    "net_unblended_cost": CostRecord.net_unblended_cost,
    "amortized_cost": CostRecord.amortized_cost,
}


def _build_filters(f: ReportFilter, user_ct_ids: list[str]):
    """Build SQLAlchemy filter conditions from ReportFilter."""
    conditions = [
        CostRecord.date >= f.start_date,
        CostRecord.date <= f.end_date,
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
    if f.tag_key and f.tag_value:
        conditions.append(CostRecord.tags.contains(f.tag_key))
    return conditions


async def _get_user_ct_ids(db: AsyncSession, user: User) -> list[str]:
    if user.role == "viewer":
        result = await db.execute(select(ControlTower.id))
    else:
        result = await db.execute(select(ControlTower.id).where(ControlTower.user_id == user.id))
    return [str(r[0]) for r in result.all()]


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

    group_cols = [CostRecord.resource_id, CostRecord.service, CostRecord.aws_account_id]
    if f.granularity == "daily":
        group_cols.append(CostRecord.date)

    stmt = (
        select(*group_cols, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(*group_cols)
        .order_by(func.sum(metric_col).desc())
        .limit(500)
    )
    result = await db.execute(stmt)
    rows = result.all()

    data = []
    for row in rows:
        item = {
            "resource_id": row.resource_id,
            "service": row.service,
            "aws_account_id": row.aws_account_id,
            "cost": float(row.cost or 0),
        }
        if f.granularity == "daily":
            item["date"] = str(row.date)
        data.append(item)
    return data


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
    metric_col = METRIC_MAP.get(f.metric, CostRecord.unblended_cost)
    conditions = _build_filters(f, ct_ids)

    total_stmt = select(func.sum(metric_col)).where(and_(*conditions))
    total_result = await db.execute(total_stmt)
    total_cost = float(total_result.scalar() or 0)

    # top 5 services
    svc_stmt = (
        select(CostRecord.service, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(CostRecord.service)
        .order_by(func.sum(metric_col).desc())
        .limit(5)
    )
    svc_result = await db.execute(svc_stmt)
    top_services = [{"service": r.service, "cost": float(r.cost or 0)} for r in svc_result.all()]

    # daily trend
    trend_stmt = (
        select(CostRecord.date, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(CostRecord.date)
        .order_by(CostRecord.date)
    )
    trend_result = await db.execute(trend_stmt)
    daily_trend = [{"date": str(r.date), "cost": float(r.cost or 0)} for r in trend_result.all()]

    # per account
    acc_stmt = (
        select(CostRecord.aws_account_id, CostRecord.account_name, func.sum(metric_col).label("cost"))
        .where(and_(*conditions))
        .group_by(CostRecord.aws_account_id, CostRecord.account_name)
        .order_by(func.sum(metric_col).desc())
    )
    acc_result = await db.execute(acc_stmt)
    per_account = [{"aws_account_id": r.aws_account_id, "account_name": r.account_name, "cost": float(r.cost or 0)} for r in acc_result.all()]

    return {
        "total_cost": total_cost,
        "top_services": top_services,
        "daily_trend": daily_trend,
        "per_account": per_account,
        "metric": f.metric,
        "period": {"start": f.start_date, "end": f.end_date},
    }


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
    result = await db.execute(
        select(CostRecord.service).where(CostRecord.control_tower_id.in_(ct_ids)).distinct()
    )
    return sorted([r[0] for r in result.all()])


@router.get("/meta/regions")
async def get_regions(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ct_ids = await _get_user_ct_ids(db, user)
    result = await db.execute(
        select(CostRecord.region).where(CostRecord.control_tower_id.in_(ct_ids)).distinct()
    )
    return sorted([r[0] for r in result.all() if r[0]])


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


@router.get("/data-boundary")
async def data_boundary():
    """Returns the most recent date for which cost data is accurate."""
    accurate_until = date.today() - timedelta(days=COST_LAG_DAYS)
    return {"accurate_until": str(accurate_until), "lag_days": COST_LAG_DAYS}
