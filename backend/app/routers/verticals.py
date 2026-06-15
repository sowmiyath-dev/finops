from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from pydantic import BaseModel
from datetime import date, timedelta
import json, hashlib, os

from app.models.database import get_db
from app.models.db_models import (
    User, Vertical, Business, Owner, Application, ApplicationResource, CostRecord,
    CustomTag, ResourceTagMapping
)
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/verticals", tags=["verticals"])

# ── Redis cache (optional — gracefully skipped if Redis not available) ────────
_redis = None

async def _get_redis():
    global _redis
    if _redis is not None:
        return _redis
    try:
        import redis.asyncio as aioredis
        _redis = await aioredis.from_url(
            os.getenv("REDIS_URL", "redis://redis:6379"),
            encoding="utf-8", decode_responses=True,
            socket_connect_timeout=2, socket_timeout=2,
        )
        await _redis.ping()
        return _redis
    except Exception:
        _redis = None
        return None

async def _cache_get(key: str) -> Optional[dict]:
    try:
        r = await _get_redis()
        if not r:
            return None
        val = await r.get(key)
        return json.loads(val) if val else None
    except Exception:
        return None

async def _cache_set(key: str, data, ttl: int = 300):
    try:
        r = await _get_redis()
        if r:
            await r.setex(key, ttl, json.dumps(data, default=str))
    except Exception:
        pass

async def _cache_delete_pattern(pattern: str):
    try:
        r = await _get_redis()
        if r:
            keys = await r.keys(pattern)
            if keys:
                await r.delete(*keys)
    except Exception:
        pass


# ── Schemas ───────────────────────────────────────────────────────────────────

class VerticalCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#0f2d5e"

class OwnerCreate(BaseModel):
    name: str
    email: Optional[str] = None

class BusinessCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#0f2d5e"
    owner_name: Optional[str] = None
    owner_email: Optional[str] = None
    cost_type: Optional[str] = "resource"  # resource | account


class AppCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#0f2d5e"

class AppResourceAssign(BaseModel):
    resource_ids: list[str]
    cloud_provider: str = "aws"
    aws_account_id: Optional[str] = None
    service: Optional[str] = None
    resource_name: Optional[str] = None

class BulkTagByAccount(BaseModel):
    vertical_id: str
    business_id: Optional[str] = None
    billing_tag: Optional[str] = None
    aws_account_id: str
    resource_ids: list[str]
    cloud_provider: str = "aws"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _date_range(granularity: str) -> tuple[date, date]:
    today = date.today()
    if granularity == "daily":
        return today - timedelta(days=30), today
    elif granularity == "weekly":
        return today - timedelta(weeks=12), today
    else:
        return today.replace(month=1, day=1), today


async def _tagged_resource_ids_for_vertical(db: AsyncSession, vertical_name: str) -> list[str]:
    rows = (await db.execute(
        select(ResourceTagMapping.resource_id)
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "vertical",
            func.lower(CustomTag.tag_value) == vertical_name.lower(),
        )
    )).scalars().all()
    return list(set(rows))


async def _cost_for_resources(
    db: AsyncSession,
    resource_ids: list[str],
    start: date,
    end: date,
    granularity: str,
) -> list[dict]:
    if not resource_ids:
        return []
    if granularity == "monthly":
        period_expr = func.to_char(CostRecord.date, "YYYY-MM").label("period")
    elif granularity == "weekly":
        period_expr = func.to_char(func.date_trunc("week", CostRecord.date), "YYYY-MM-DD").label("period")
    else:
        period_expr = func.cast(CostRecord.date, CostRecord.date.type).label("period")

    # True cost = Usage/DiscountedUsage/RIFee (unblended) + SP covered (amortized)
    # Exclude Tax, Credit, Refund, Fee, Negation, RecurringFee
    from sqlalchemy import case, literal
    true_cost_expr = func.sum(
        case(
            (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
            (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
            else_=literal(0),
        )
    ).label("cost")

    stmt = (
        select(period_expr, true_cost_expr)
        .where(
            CostRecord.resource_id.in_(resource_ids),
            CostRecord.date >= start,
            CostRecord.date <= end,
        )
        .group_by("period")
        .order_by("period")
    )
    rows = (await db.execute(stmt)).all()
    return [{"period": str(r.period), "cost": float(r.cost or 0)} for r in rows]


async def _cost_for_resources_and_accounts(
    db: AsyncSession,
    resource_ids: list[str],
    account_ids: list[str],
    start: date,
    end: date,
    granularity: str,
) -> list[dict]:
    from sqlalchemy import or_, case
    if not resource_ids and not account_ids:
        return []
    if granularity == "monthly":
        period_expr = func.to_char(CostRecord.date, "YYYY-MM").label("period")
    elif granularity == "weekly":
        period_expr = func.to_char(func.date_trunc("week", CostRecord.date), "YYYY-MM-DD").label("period")
    else:
        period_expr = func.cast(CostRecord.date, CostRecord.date.type).label("period")

    # True cost: SP covered uses amortized, Usage/DiscountedUsage/RIFee uses unblended
    # Exclude Tax, Credit, Refund, Fee, Negation, RecurringFee
    from sqlalchemy import or_, case, literal
    true_cost_expr = func.sum(
        case(
            (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
            (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
            else_=literal(0),
        )
    ).label("cost")

    conditions = [
        CostRecord.date >= start,
        CostRecord.date <= end,
    ]
    clauses = []
    if resource_ids:
        clauses.append(CostRecord.resource_id.in_(resource_ids))
    if account_ids:
        clauses.append(CostRecord.aws_account_id.in_(account_ids))
    conditions.append(or_(*clauses))

    stmt = (
        select(period_expr, true_cost_expr)
        .where(*conditions)
        .group_by("period")
        .order_by("period")
    )
    rows = (await db.execute(stmt)).all()
    return [{"period": str(r.period), "cost": float(r.cost or 0)} for r in rows]


# ═════════════════════════════════════════════════════════════════════════════
# STATIC ROUTES FIRST
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/report")
async def vertical_report(
    start_date: str,
    end_date: str,
    group_by: str = "vertical",
    vertical_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from sqlalchemy import or_

    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)

    vid_filter = [v.strip() for v in vertical_ids.split(",") if v.strip()] if vertical_ids else []

    # Load all verticals
    vert_q = select(Vertical)
    if vid_filter:
        vert_q = vert_q.where(Vertical.id.in_(vid_filter))
    verticals = (await db.execute(vert_q.order_by(Vertical.name))).scalars().all()
    vert_names = [v.name for v in verticals]
    if not vert_names:
        return {"rows": [], "total": 0, "start": start_date, "end": end_date, "group_by": group_by}

    # ── OWNER group_by: use businesses.owner_name ─────────────────────────────────────────────
    if group_by == "owner":
        # Get all businesses with owner_name for the selected verticals
        biz_rows = (await db.execute(
            select(Business.id, Business.name, Business.owner_name, Vertical.name.label("vertical_name"))
            .join(Vertical, Vertical.id == Business.vertical_id)
            .where(
                Vertical.name.in_(vert_names),
                Business.owner_name.isnot(None),
                Business.owner_name != "",
            )
            .order_by(Business.owner_name)
        )).all()

        if not biz_rows:
            return {"rows": [], "total": 0, "start": start_date, "end": end_date, "group_by": group_by}

        # Group businesses by owner_name
        # owner_name → {verticals: set, businesses: set, biz_names: list}
        owner_map: dict[str, dict] = {}
        for b in biz_rows:
            oname = b.owner_name.strip()
            if oname not in owner_map:
                owner_map[oname] = {"verticals": set(), "businesses": set(), "biz_ids": []}
            owner_map[oname]["verticals"].add(b.vertical_name)
            owner_map[oname]["businesses"].add(b.name)
            owner_map[oname]["biz_ids"].append(str(b.id))

        # For each owner, get cost via Business tag on resources
        result_rows = []
        for oname, info in owner_map.items():
            biz_names_lower = [b.lower() for b in info["businesses"]]

            # Get resource IDs tagged with any of this owner's businesses
            biz_tag_ids_subq = (
                select(CustomTag.id)
                .where(
                    func.lower(CustomTag.tag_key) == "business",
                    func.lower(CustomTag.tag_value).in_(biz_names_lower),
                )
                .scalar_subquery()
            )
            res_subq = (
                select(ResourceTagMapping.resource_id)
                .where(ResourceTagMapping.custom_tag_id.in_(biz_tag_ids_subq))
                .scalar_subquery()
            )
            from sqlalchemy import case as sa_case6, literal as sa_literal6
            true_cost_col6 = sa_case6(
                (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
                (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
                else_=sa_literal6(0),
            )
            cost_row = (await db.execute(
                select(
                    func.sum(true_cost_col6).label("cost"),
                    func.count(func.distinct(CostRecord.resource_id)).label("resource_count"),
                )
                .where(
                    CostRecord.resource_id.in_(res_subq),
                    CostRecord.date >= start,
                    CostRecord.date <= end,
                )
            )).one()

            result_rows.append({
                "owner": oname,
                "verticals": ", ".join(sorted(info["verticals"])),
                "businesses": ", ".join(sorted(info["businesses"])),
                "vertical": ", ".join(sorted(info["verticals"])),
                "business": ", ".join(sorted(info["businesses"])),
                "billing_tag": "—",
                "label": oname,
                "total_cost": float(cost_row.cost or 0),
                "resource_count": int(cost_row.resource_count or 0),
            })

        result_rows.sort(key=lambda x: x["total_cost"], reverse=True)
        total = sum(r["total_cost"] for r in result_rows)
        return {"rows": result_rows, "total": total, "start": start_date, "end": end_date, "group_by": group_by}

    # ── All other group_by modes (vertical / business / billing) ──────────────────────────────
    # Get all tag mappings
    tag_rows = (await db.execute(
        select(
            ResourceTagMapping.resource_id,
            ResourceTagMapping.aws_account_id,
            CustomTag.tag_key,
            CustomTag.tag_value,
        )
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(func.lower(CustomTag.tag_key).in_(["vertical", "business", "billing"]))
    )).all()

    res_tags: dict[str, dict] = {}
    for row in tag_rows:
        rid = row.resource_id
        if rid not in res_tags:
            res_tags[rid] = {"vertical": None, "business": None, "billing": None}
        key = row.tag_key.lower()
        if key in ("vertical", "business", "billing"):
            res_tags[rid][key] = row.tag_value

    valid_resource_ids = [
        rid for rid, tags in res_tags.items()
        if tags["vertical"] and tags["vertical"].lower() in [n.lower() for n in vert_names]
    ]
    if not valid_resource_ids:
        return {"rows": [], "total": 0, "start": start_date, "end": end_date, "group_by": group_by}

    vert_tag_ids_subq = (
        select(CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "vertical",
            func.lower(CustomTag.tag_value).in_([n.lower() for n in vert_names]),
        ).scalar_subquery()
    )
    res_subq = (
        select(ResourceTagMapping.resource_id)
        .where(ResourceTagMapping.custom_tag_id.in_(vert_tag_ids_subq))
        .scalar_subquery()
    )
    from sqlalchemy import or_, case as sa_case4, literal as sa_literal4
    true_cost_col4 = sa_case4(
        (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
        (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
        else_=sa_literal4(0),
    )
    cost_rows = (await db.execute(
        select(CostRecord.resource_id, func.sum(true_cost_col4).label("cost"))
        .where(CostRecord.resource_id.in_(res_subq), CostRecord.date >= start, CostRecord.date <= end)
        .group_by(CostRecord.resource_id)
    )).all()
    res_cost: dict[str, float] = {row.resource_id: float(row.cost or 0) for row in cost_rows}

    agg: dict[str, dict] = {}
    for rid in valid_resource_ids:
        tags = res_tags.get(rid, {})
        cost = res_cost.get(rid, 0)
        vertical_name = tags.get("vertical") or "Unknown"
        business_name = tags.get("business") or "—"
        billing_tag   = tags.get("billing")  or "—"

        if group_by == "vertical":
            key = vertical_name
            label = vertical_name
        elif group_by == "business":
            key = f"{vertical_name}|{business_name}"
            label = business_name
        else:  # billing
            key = f"{vertical_name}|{billing_tag}"
            label = billing_tag

        if key not in agg:
            agg[key] = {
                "vertical": vertical_name,
                "business": business_name if group_by != "vertical" else "—",
                "billing_tag": billing_tag if group_by == "billing" else "—",
                "label": label,
                "total_cost": 0.0,
                "resource_count": 0,
            }
        agg[key]["total_cost"] += cost
        agg[key]["resource_count"] += 1

    rows = sorted(agg.values(), key=lambda x: x["total_cost"], reverse=True)
    total = sum(r["total_cost"] for r in rows)
    return {"rows": rows, "total": total, "start": start_date, "end": end_date, "group_by": group_by}


@router.get("/summary")
async def verticals_summary(
    granularity: str = "monthly",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.models.db_models import VerticalCostCache

    # Try Redis cache first (5 min)
    cache_key = f"verticals:summary:{granularity}"
    cached = await _cache_get(cache_key)
    if cached is not None:
        return cached

    start, end = _date_range(granularity)

    # 1. Load all verticals
    verticals = (await db.execute(select(Vertical).order_by(Vertical.name))).scalars().all()
    if not verticals:
        return []

    # 2. Read from pre-aggregated cache table (fast — tiny table)
    cache_rows = (await db.execute(
        select(
            VerticalCostCache.vertical_name,
            func.sum(VerticalCostCache.total_cost).label("total_cost"),
            func.max(VerticalCostCache.resource_count).label("resource_count"),
        )
        .where(VerticalCostCache.granularity == granularity)
        .group_by(VerticalCostCache.vertical_name)
    )).all()

    cost_by_name: dict = {}

    if cache_rows:
        # Cache hit — fast path
        for r in cache_rows:
            cost_by_name[r.vertical_name.lower()] = {
                "total_cost": float(r.total_cost or 0),
                "resource_count": int(r.resource_count or 0),
            }
    else:
        # Cache miss — fall back to live query and trigger background refresh
        import asyncio
        from app.services.vertical_cache_service import refresh_vertical_cost_cache
        asyncio.create_task(refresh_vertical_cost_cache())

        from sqlalchemy import case as sa_case3, literal as sa_literal3
        true_cost_col3 = sa_case3(
            (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
            (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
            else_=sa_literal3(0),
        )
        tagged_cost_rows = (await db.execute(
            select(
                CustomTag.tag_value.label("vertical_name"),
                func.sum(true_cost_col3).label("cost"),
                func.count(func.distinct(ResourceTagMapping.resource_id)).label("resource_count"),
            )
            .join(ResourceTagMapping, ResourceTagMapping.custom_tag_id == CustomTag.id)
            .join(CostRecord, CostRecord.resource_id == ResourceTagMapping.resource_id)
            .where(
                CustomTag.tag_key == "Vertical",
                CostRecord.date >= start,
                CostRecord.date <= end,
            )
            .group_by(CustomTag.tag_value)
        )).all()
        for r in tagged_cost_rows:
            cost_by_name[r.vertical_name.lower()] = {
                "total_cost": float(r.cost or 0),
                "resource_count": int(r.resource_count or 0),
            }

    # 3. Owner + app counts per vertical (cheap metadata query)
    owner_rows = (await db.execute(
        select(
            Owner.vertical_id,
            func.count(func.distinct(Owner.id)).label("owner_count"),
            func.count(func.distinct(Application.id)).label("app_count"),
        )
        .outerjoin(Application, Application.owner_id == Owner.id)
        .group_by(Owner.vertical_id)
    )).all()
    meta_by_vid: dict = {
        str(r.vertical_id): {"owner_count": r.owner_count, "app_count": r.app_count}
        for r in owner_rows
    }

    result = []
    for v in verticals:
        c = cost_by_name.get(v.name.lower(), {"total_cost": 0.0, "resource_count": 0})
        m = meta_by_vid.get(str(v.id), {"owner_count": 0, "app_count": 0})
        result.append({
            "id": str(v.id),
            "name": v.name,
            "color": v.color,
            "description": v.description,
            "total_cost": c["total_cost"],
            "resource_count": c["resource_count"],
            "owner_count": m["owner_count"],
            "app_count": m["app_count"],
            "start": str(start),
            "end": str(end),
        })
    await _cache_set(cache_key, result, ttl=300)
    return result


@router.get("/{vertical_id}/businesses-cost")
async def businesses_cost_bulk(
    vertical_id: str,
    granularity: str = "monthly",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return total cost for ALL businesses in a vertical respecting cost_type per business."""
    cache_key = f"verticals:biz_costs:{vertical_id}:{granularity}:{start_date}:{end_date}"
    cached = await _cache_get(cache_key)
    if cached is not None:
        return cached

    start, end = _date_range(granularity)
    if start_date:
        start = date.fromisoformat(start_date)
    if end_date:
        end = date.fromisoformat(end_date)

    businesses = (await db.execute(
        select(Business).where(Business.vertical_id == vertical_id).order_by(Business.name)
    )).scalars().all()
    if not businesses:
        return {}

    from sqlalchemy import case as sa_case_b, literal as sa_literal_b
    true_cost_b = sa_case_b(
        (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
        (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
        else_=sa_literal_b(0),
    )

    # Split businesses by cost_type
    account_level_biz = [b for b in businesses if (b.cost_type or "resource") == "account"]
    resource_level_biz = [b for b in businesses if (b.cost_type or "resource") == "resource"]

    result: dict[str, float] = {str(b.id): 0.0 for b in businesses}

    # Account-level: single batch query — 2 queries total regardless of business count
    if account_level_biz:
        biz_names_acct = [b.name.lower() for b in account_level_biz]
        acct_tag_rows = (await db.execute(
            select(
                ResourceTagMapping.aws_account_id,
                CustomTag.tag_value.label("biz_name"),
            )
            .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
            .where(
                func.lower(CustomTag.tag_key) == "business",
                func.lower(CustomTag.tag_value).in_(biz_names_acct),
                ResourceTagMapping.aws_account_id.isnot(None),
            )
        )).all()

        biz_to_accounts: dict[str, list[str]] = {}
        for row in acct_tag_rows:
            key = row.biz_name.upper()
            if key not in biz_to_accounts:
                biz_to_accounts[key] = []
            biz_to_accounts[key].append(row.aws_account_id)

        all_acct_ids = list(set(aid for aids in biz_to_accounts.values() for aid in aids))
        if all_acct_ids:
            acct_cost_rows = (await db.execute(
                select(
                    CostRecord.aws_account_id,
                    func.sum(true_cost_b).label("cost"),
                )
                .where(
                    CostRecord.date >= start,
                    CostRecord.date <= end,
                    CostRecord.aws_account_id.in_(all_acct_ids),
                )
                .group_by(CostRecord.aws_account_id)
            )).all()
            acct_cost_map = {r.aws_account_id: float(r.cost or 0) for r in acct_cost_rows}
            for biz in account_level_biz:
                acct_ids = biz_to_accounts.get(biz.name.upper(), [])
                result[str(biz.id)] = sum(acct_cost_map.get(aid, 0.0) for aid in acct_ids)

    # Resource-level: single bulk query via resource_tag_mappings
    if resource_level_biz:
        biz_names = [b.name for b in resource_level_biz]
        rows = (await db.execute(
            select(
                CustomTag.tag_value.label("biz_name"),
                func.sum(true_cost_b).label("cost"),
            )
            .join(ResourceTagMapping, ResourceTagMapping.custom_tag_id == CustomTag.id)
            .join(CostRecord, CostRecord.resource_id == ResourceTagMapping.resource_id)
            .where(
                CustomTag.tag_key == "Business",
                CustomTag.tag_value.in_(biz_names),
                CostRecord.date >= start,
                CostRecord.date <= end,
            )
            .group_by(CustomTag.tag_value)
        )).all()
        cost_by_name = {r.biz_name: float(r.cost or 0) for r in rows}
        for biz in resource_level_biz:
            result[str(biz.id)] = cost_by_name.get(biz.name, 0.0)

    await _cache_set(cache_key, result, ttl=300)
    return result


@router.post("/seed", status_code=201)
async def seed_verticals(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    SEED_DATA = [
        {"name": "NOVAC",     "color": "#0f2d5e", "businesses": ["IDC", "APPSUPPORT", "SOC"]},
        {"name": "L&D",       "color": "#8e44ad", "businesses": ["AXLE", "MYCOACH", "MIGOTO", "ARVR", "IMMERZ"]},
        {"name": "Lending",   "color": "#1d8348", "businesses": ["SFL"]},
        {"name": "Insurance", "color": "#1a6fa8", "businesses": ["SGIC", "SLIC"]},
        {"name": "Non-SFL",   "color": "#c0392b", "businesses": ["WEALTH", "AMC", "SKI", "SAMIL", "SHRIRAM CREDIT"]},
        {"name": "EBS",       "color": "#ec7211", "businesses": ["SOJATIA", "NESTAVIA", "INDOSTAR", "PAHAL", "FINERGY", "ZMSL", "CMPS", "THFL", "SDS", "SME", "KAZITO", "SARC"]},
    ]
    created_v = []
    created_b = []
    for d in SEED_DATA:
        v = (await db.execute(select(Vertical).where(Vertical.name == d["name"]))).scalar_one_or_none()
        if not v:
            v = Vertical(name=d["name"], color=d["color"])
            db.add(v)
            await db.flush()
            created_v.append(d["name"])
        for bname in d["businesses"]:
            exists = (await db.execute(
                select(Business).where(Business.vertical_id == v.id, Business.name == bname)
            )).scalar_one_or_none()
            if not exists:
                db.add(Business(vertical_id=v.id, name=bname, color=d["color"]))
                created_b.append(bname)
    await db.commit()
    return {"seeded_verticals": created_v, "seeded_businesses": created_b}


@router.post("/bulk-tag-account", status_code=201)
async def bulk_tag_account(
    payload: BulkTagByAccount,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)

    vertical = (await db.execute(
        select(Vertical).where(Vertical.id == payload.vertical_id)
    )).scalar_one_or_none()
    if not vertical:
        raise HTTPException(404, "Vertical not found")

    # Get business name if business_id provided
    business_name = None
    if payload.business_id:
        biz = (await db.execute(
            select(Business).where(Business.id == payload.business_id)
        )).scalar_one_or_none()
        if biz:
            business_name = biz.name

    async def _get_or_create_tag(key: str, value: str, color: str) -> CustomTag:
        tag = (await db.execute(
            select(CustomTag).where(
                func.lower(CustomTag.tag_key) == key.lower(),
                func.lower(CustomTag.tag_value) == value.lower(),
            )
        )).scalar_one_or_none()
        if not tag:
            tag = CustomTag(
                tag_key=key,
                tag_value=value,
                color=color,
                description=f"Auto-created for {key}={value}",
                created_by=user.id,
            )
            db.add(tag)
            await db.flush()
        return tag

    # Create Vertical tag
    vertical_tag = await _get_or_create_tag("Vertical", vertical.name, vertical.color)

    # Create Business tag if business selected
    business_tag = None
    if business_name:
        business_tag = await _get_or_create_tag("Business", business_name, vertical.color)

    # Create Billing tag if provided
    billing_tag = None
    if payload.billing_tag and payload.billing_tag.strip():
        billing_tag = await _get_or_create_tag("Billing", payload.billing_tag.strip(), "#16a085")

    added = 0
    for rid in payload.resource_ids:
        # Skip wildcard, empty or obviously invalid resource IDs
        if not rid or rid.strip() in ("*", "-", "—", "null", "none", ""):
            continue
        rid = rid.strip()
        for tag in [t for t in [vertical_tag, business_tag, billing_tag] if t]:
            exists = (await db.execute(
                select(ResourceTagMapping).where(
                    ResourceTagMapping.resource_id == rid,
                    ResourceTagMapping.custom_tag_id == tag.id,
                )
            )).scalar_one_or_none()
            if not exists:
                db.add(ResourceTagMapping(
                    resource_id=rid,
                    cloud_provider=payload.cloud_provider,
                    aws_account_id=payload.aws_account_id,
                    custom_tag_id=tag.id,
                    created_by=user.id,
                ))
        added += 1

    await db.commit()
    tags_created = f"Vertical={vertical.name}"
    if business_name:
        tags_created += f", Business={business_name}"
    if payload.billing_tag:
        tags_created += f", Billing={payload.billing_tag}"

    # Invalidate vertical cost cache so next summary request sees fresh data
    import asyncio
    from app.services.vertical_cache_service import refresh_vertical_cost_cache
    asyncio.create_task(refresh_vertical_cost_cache())

    return {"tagged": added, "tags": tags_created, "account": payload.aws_account_id}


@router.get("/apps/{app_id}/cost")
async def app_cost(
    app_id: str,
    granularity: str = "monthly",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _date_range(granularity)
    if start_date:
        start = date.fromisoformat(start_date)
    if end_date:
        end = date.fromisoformat(end_date)

    resource_ids = (await db.execute(
        select(ApplicationResource.resource_id).where(ApplicationResource.application_id == app_id)
    )).scalars().all()

    trend = await _cost_for_resources(db, list(set(resource_ids)), start, end, granularity)
    total = sum(p["cost"] for p in trend)

    cloud_rows = (await db.execute(
        select(ApplicationResource.cloud_provider, func.count(ApplicationResource.id).label("cnt"))
        .where(ApplicationResource.application_id == app_id)
        .group_by(ApplicationResource.cloud_provider)
    )).all()

    return {
        "app_id": app_id,
        "granularity": granularity,
        "start": str(start),
        "end": str(end),
        "total_cost": total,
        "resource_count": len(set(resource_ids)),
        "cloud_breakdown": [{"cloud": r.cloud_provider, "count": r.cnt} for r in cloud_rows],
        "trend": trend,
    }


@router.get("/apps/{app_id}/resources")
async def list_app_resources(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(ApplicationResource).where(ApplicationResource.application_id == app_id)
    )).scalars().all()
    return [
        {
            "id": str(r.id),
            "resource_id": r.resource_id,
            "resource_name": r.resource_name,
            "cloud_provider": r.cloud_provider,
            "aws_account_id": r.aws_account_id,
            "service": r.service,
        }
        for r in rows
    ]


@router.post("/apps/{app_id}/resources", status_code=201)
async def assign_resources(
    app_id: str,
    payload: AppResourceAssign,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    added = 0
    for rid in payload.resource_ids:
        if not rid or rid.strip() in ("*", "-", "—", "null", "none", ""):
            continue
        rid = rid.strip()
        exists = (await db.execute(
            select(ApplicationResource).where(
                ApplicationResource.application_id == app_id,
                ApplicationResource.resource_id == rid,
            )
        )).scalar_one_or_none()
        if not exists:
            db.add(ApplicationResource(
                application_id=app_id,
                resource_id=rid,
                resource_name=payload.resource_name,
                cloud_provider=payload.cloud_provider,
                aws_account_id=payload.aws_account_id,
                service=payload.service,
            ))
            added += 1
    await db.commit()
    return {"added": added}


@router.delete("/apps/{app_id}/resources/{resource_id}", status_code=204)
async def remove_resource(
    app_id: str,
    resource_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    rows = (await db.execute(
        select(ApplicationResource).where(
            ApplicationResource.application_id == app_id,
            ApplicationResource.resource_id == resource_id,
        )
    )).scalars().all()
    for r in rows:
        await db.delete(r)
    await db.commit()


@router.delete("/apps/{app_id}", status_code=204)
async def delete_app(
    app_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    a = (await db.execute(
        select(Application).where(Application.id == app_id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    await db.delete(a)
    await db.commit()


# ── Business CRUD ────────────────────────────────────────────────────────────

@router.get("/businesses/{business_id}")
async def get_business(
    business_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    b = (await db.execute(select(Business).where(Business.id == business_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404)
    return {"id": str(b.id), "name": b.name, "description": b.description,
            "color": b.color, "owner_name": b.owner_name, "owner_email": b.owner_email,
            "cost_type": b.cost_type or "resource",
            "vertical_id": str(b.vertical_id)}


@router.patch("/businesses/{business_id}", status_code=200)
async def update_business(
    business_id: str,
    payload: BusinessCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    b = (await db.execute(select(Business).where(Business.id == business_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404)
    if payload.name:
        b.name = payload.name
    if payload.owner_name is not None:
        b.owner_name = payload.owner_name
    if payload.owner_email is not None:
        b.owner_email = payload.owner_email
    if payload.color:
        b.color = payload.color
    if payload.cost_type is not None:
        b.cost_type = payload.cost_type
    await db.commit()
    await db.refresh(b)
    return {"id": str(b.id), "name": b.name, "owner_name": b.owner_name, "owner_email": b.owner_email, "cost_type": b.cost_type}


@router.delete("/businesses/{business_id}", status_code=204)
async def delete_business(
    business_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    b = (await db.execute(select(Business).where(Business.id == business_id))).scalar_one_or_none()
    if not b:
        raise HTTPException(404)
    await db.delete(b)
    await db.commit()


# ═════════════════════════════════════════════════════════════════════════════
# DYNAMIC ROUTES
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/")
async def list_verticals(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(select(Vertical).order_by(Vertical.name))).scalars().all()
    return [{"id": str(v.id), "name": v.name, "description": v.description, "color": v.color} for v in rows]


@router.post("/", status_code=201)
async def create_vertical(
    payload: VerticalCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    v = Vertical(name=payload.name, description=payload.description, color=payload.color)
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return {"id": str(v.id), "name": v.name, "color": v.color}


@router.delete("/{vertical_id}", status_code=204)
async def delete_vertical(
    vertical_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "editor"):
        raise HTTPException(403)
    v = (await db.execute(
        select(Vertical).where(Vertical.id == vertical_id)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404)
    await db.delete(v)
    await db.commit()


@router.get("/{vertical_id}/businesses")
async def list_businesses(
    vertical_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(Business).where(Business.vertical_id == vertical_id).order_by(Business.name)
    )).scalars().all()
    return [
        {"id": str(b.id), "name": b.name, "description": b.description,
         "color": b.color, "owner_name": b.owner_name, "owner_email": b.owner_email,
         "cost_type": b.cost_type or "resource"}
        for b in rows
    ]


@router.get("/{vertical_id}/businesses/{business_id}/cost")
async def business_cost(
    vertical_id: str,
    business_id: str,
    granularity: str = "monthly",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _date_range(granularity)
    if start_date:
        start = date.fromisoformat(start_date)
    if end_date:
        end = date.fromisoformat(end_date)

    biz = (await db.execute(select(Business).where(Business.id == business_id))).scalar_one_or_none()
    if not biz:
        raise HTTPException(404)

    cost_type = biz.cost_type or "resource"

    # Get tagged resource IDs and account IDs
    resource_ids = list(set((await db.execute(
        select(ResourceTagMapping.resource_id)
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "business",
            func.lower(CustomTag.tag_value) == biz.name.lower(),
        )
    )).scalars().all()))

    account_ids = list(set((await db.execute(
        select(ResourceTagMapping.aws_account_id)
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "business",
            func.lower(CustomTag.tag_value) == biz.name.lower(),
            ResourceTagMapping.aws_account_id.isnot(None),
        )
    )).scalars().all()))

    from sqlalchemy import case as sa_case5, literal as sa_literal5
    true_cost_col5 = sa_case5(
        (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
        (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
        else_=sa_literal5(0),
    )

    if cost_type == "account" and account_ids:
        # Account-level: sum all cost records for tagged accounts (matches CT dashboard)
        if granularity == "monthly":
            period_expr = func.to_char(CostRecord.date, "YYYY-MM").label("period")
        elif granularity == "weekly":
            period_expr = func.to_char(func.date_trunc("week", CostRecord.date), "YYYY-MM-DD").label("period")
        else:
            period_expr = func.cast(CostRecord.date, CostRecord.date.type).label("period")

        trend_rows = (await db.execute(
            select(period_expr, func.sum(true_cost_col5).label("cost"))
            .where(
                CostRecord.date >= start,
                CostRecord.date <= end,
                CostRecord.aws_account_id.in_(account_ids),
            )
            .group_by("period").order_by("period")
        )).all()
        trend = [{"period": str(r.period), "cost": float(r.cost or 0)} for r in trend_rows]
        total = sum(p["cost"] for p in trend)

        # Per-account breakdown
        acc_rows = (await db.execute(
            select(
                CostRecord.aws_account_id,
                CostRecord.account_name,
                func.sum(true_cost_col5).label("cost"),
            )
            .where(
                CostRecord.date >= start,
                CostRecord.date <= end,
                CostRecord.aws_account_id.in_(account_ids),
            )
            .group_by(CostRecord.aws_account_id, CostRecord.account_name)
            .order_by(func.sum(true_cost_col5).desc())
        )).all()
        per_account = [
            {
                "aws_account_id": r.aws_account_id,
                "account_name": r.account_name or r.aws_account_id,
                "cost": float(r.cost or 0),
            }
            for r in acc_rows
        ]
    else:
        # Resource-level: tagged resource_ids + null-resource rows for tagged accounts
        trend = await _cost_for_resources_and_accounts(db, resource_ids, account_ids, start, end, granularity)
        total = sum(p["cost"] for p in trend)
        per_account = []
        if account_ids:
            from sqlalchemy import or_
            acc_rows = (await db.execute(
                select(
                    CostRecord.aws_account_id,
                    CostRecord.account_name,
                    func.sum(true_cost_col5).label("cost"),
                )
                .where(
                    CostRecord.date >= start,
                    CostRecord.date <= end,
                    CostRecord.aws_account_id.in_(account_ids),
                    or_(
                        CostRecord.resource_id.in_(resource_ids) if resource_ids else False,
                        CostRecord.resource_id.is_(None),
                    )
                )
                .group_by(CostRecord.aws_account_id, CostRecord.account_name)
                .order_by(func.sum(true_cost_col5).desc())
            )).all()
            per_account = [
                {
                    "aws_account_id": r.aws_account_id,
                    "account_name": r.account_name or r.aws_account_id,
                    "cost": float(r.cost or 0),
                }
                for r in acc_rows
            ]

    return {
        "business_id": business_id,
        "business_name": biz.name,
        "cost_type": cost_type,
        "granularity": granularity,
        "start": str(start),
        "end": str(end),
        "total_cost": total,
        "resource_count": len(resource_ids),
        "trend": trend,
        "per_account": per_account,
    }


@router.post("/{vertical_id}/businesses", status_code=201)
async def create_business(
    vertical_id: str,
    payload: BusinessCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    v = (await db.execute(select(Vertical).where(Vertical.id == vertical_id))).scalar_one_or_none()
    if not v:
        raise HTTPException(404)
    b = Business(
        vertical_id=vertical_id,
        name=payload.name,
        description=payload.description,
        color=payload.color or v.color,
        owner_name=payload.owner_name,
        owner_email=payload.owner_email,
    )
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return {"id": str(b.id), "name": b.name, "color": b.color}


@router.get("/{vertical_id}/cost")
async def vertical_cost(
    vertical_id: str,
    granularity: str = "monthly",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    cache_key = f"verticals:cost:{vertical_id}:{granularity}:{start_date}:{end_date}"
    cached = await _cache_get(cache_key)
    if cached is not None:
        return cached

    start, end = _date_range(granularity)
    if start_date:
        start = date.fromisoformat(start_date)
    if end_date:
        end = date.fromisoformat(end_date)

    vertical = (await db.execute(
        select(Vertical).where(Vertical.id == vertical_id)
    )).scalar_one_or_none()
    if not vertical:
        raise HTTPException(404)

    if granularity == "monthly":
        period_expr = func.to_char(CostRecord.date, "YYYY-MM").label("period")
    elif granularity == "weekly":
        period_expr = func.to_char(func.date_trunc("week", CostRecord.date), "YYYY-MM-DD").label("period")
    else:
        period_expr = func.cast(CostRecord.date, CostRecord.date.type).label("period")

    # ── Query 1: all tagged resource IDs + account IDs for this vertical ──
    tag_rows = (await db.execute(
        select(
            ResourceTagMapping.resource_id,
            ResourceTagMapping.aws_account_id,
        )
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "vertical",
            func.lower(CustomTag.tag_value) == vertical.name.lower(),
        )
    )).all()

    all_tagged_resource_ids = list(set(r.resource_id for r in tag_rows))
    tagged_account_ids = list(set(r.aws_account_id for r in tag_rows if r.aws_account_id))

    # ── Query 2: all owner→app→resource mappings in one shot ──────────────
    owner_app_res_rows = (await db.execute(
        select(
            Owner.id.label("owner_id"),
            Owner.name.label("owner_name"),
            Application.id.label("app_id"),
            ApplicationResource.resource_id,
        )
        .join(Application, Application.owner_id == Owner.id)
        .join(ApplicationResource, ApplicationResource.application_id == Application.id)
        .where(Owner.vertical_id == vertical_id)
    )).all()

    # ── Query 3: app counts per owner (for owners with no resources too) ──
    owner_app_count_rows = (await db.execute(
        select(
            Owner.id.label("owner_id"),
            Owner.name.label("owner_name"),
            func.count(Application.id).label("app_count"),
        )
        .outerjoin(Application, Application.owner_id == Owner.id)
        .where(Owner.vertical_id == vertical_id)
        .group_by(Owner.id, Owner.name)
        .order_by(Owner.name)
    )).all()

    # Build owner → resource_ids map
    owner_resources: dict[str, set] = {}
    owner_names: dict[str, str] = {}
    for row in owner_app_res_rows:
        oid = str(row.owner_id)
        if oid not in owner_resources:
            owner_resources[oid] = set()
            owner_names[oid] = row.owner_name
        owner_resources[oid].add(row.resource_id)

    all_owner_resource_ids = set(rid for rids in owner_resources.values() for rid in rids)

    # ── Query 4: cost for ALL owner resources in ONE query grouped by owner ──
    result = []

    if owner_app_count_rows:
        # Build resource_id → owner_id mapping in Python
        res_to_owner: dict[str, str] = {}
        for row in owner_app_res_rows:
            res_to_owner[row.resource_id] = str(row.owner_id)

        # Single cost query using a subquery instead of IN(list) to avoid
        # sending thousands of parameters over the wire
        if all_owner_resource_ids:
            # Use subquery: SELECT resource_id FROM application_resources
            # WHERE application_id IN (SELECT id FROM applications WHERE owner_id IN (...))
            owner_ids = list(owner_resources.keys())
            app_subq = (
                select(Application.id)
                .join(Owner, Owner.id == Application.owner_id)
                .where(Owner.vertical_id == vertical_id)
                .scalar_subquery()
            )
            res_subq = (
                select(ApplicationResource.resource_id)
                .where(ApplicationResource.application_id.in_(app_subq))
                .scalar_subquery()
            )
            from sqlalchemy import case as sa_case, literal as sa_literal
            true_cost_col = sa_case(
                (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
                (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
                else_=sa_literal(0),
            )
            cost_rows = (await db.execute(
                select(
                    period_expr,
                    CostRecord.resource_id,
                    func.sum(true_cost_col).label("cost"),
                )
                .where(
                    CostRecord.resource_id.in_(res_subq),
                    CostRecord.date >= start,
                    CostRecord.date <= end,
                )
                .group_by("period", CostRecord.resource_id)
                .order_by("period")
            )).all()

            # Aggregate by owner in Python
            owner_period_cost: dict[str, dict[str, float]] = {}
            for row in cost_rows:
                oid = res_to_owner.get(row.resource_id)
                if not oid:
                    continue
                if oid not in owner_period_cost:
                    owner_period_cost[oid] = {}
                p = str(row.period)
                owner_period_cost[oid][p] = owner_period_cost[oid].get(p, 0) + float(row.cost or 0)
        else:
            owner_period_cost = {}

        for row in owner_app_count_rows:
            oid = str(row.owner_id)
            period_map = owner_period_cost.get(oid, {})
            trend = [{"period": p, "cost": c} for p, c in sorted(period_map.items())]
            total = sum(period_map.values())
            result.append({
                "owner_id": oid,
                "owner_name": row.owner_name,
                "app_count": row.app_count,
                "resource_count": len(owner_resources.get(oid, set())),
                "total_cost": total,
                "trend": trend,
            })

    # ── Unassigned: tagged resources not under any owner ──────────────────
    unassigned_ids = [r for r in all_tagged_resource_ids if r not in all_owner_resource_ids]

    if unassigned_ids or tagged_account_ids:
        from sqlalchemy import or_
        clauses = []
        if unassigned_ids:
            clauses.append(CostRecord.resource_id.in_(unassigned_ids))
        if tagged_account_ids:
            clauses.append(CostRecord.aws_account_id.in_(tagged_account_ids))

        from sqlalchemy import or_, case as sa_case2, literal as sa_literal2
        unassigned_cost_col = sa_case2(
            (CostRecord.line_item_type == "SavingsPlanCoveredUsage", CostRecord.amortized_cost),
            (CostRecord.line_item_type.in_(["Usage", "DiscountedUsage", "RIFee"]), CostRecord.unblended_cost),
            else_=sa_literal2(0),
        )
        unassigned_rows = (await db.execute(
            select(period_expr, func.sum(unassigned_cost_col).label("cost"))
            .where(
                CostRecord.date >= start,
                CostRecord.date <= end,
                or_(*clauses),
            )
            .group_by("period")
            .order_by("period")
        )).all()

        trend = [{"period": str(r.period), "cost": float(r.cost or 0)} for r in unassigned_rows]
        total = sum(t["cost"] for t in trend)
        result.append({
            "owner_id": "unassigned",
            "owner_name": "Unassigned (via Tag)",
            "app_count": 0,
            "resource_count": len(unassigned_ids),
            "total_cost": total,
            "trend": trend,
        })

    response = {
        "vertical_id": vertical_id,
        "granularity": granularity,
        "start": str(start),
        "end": str(end),
        "tagged_resource_count": len(all_tagged_resource_ids),
        "tagged_account_ids": tagged_account_ids,
        "owners": result,
    }
    await _cache_set(cache_key, response, ttl=300)
    return response


@router.get("/{vertical_id}/tagged-accounts")
async def vertical_tagged_accounts(
    vertical_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all distinct accounts that have resources tagged to this vertical."""
    vertical = (await db.execute(
        select(Vertical).where(Vertical.id == vertical_id)
    )).scalar_one_or_none()
    if not vertical:
        raise HTTPException(404)

    rows = (await db.execute(
        select(
            ResourceTagMapping.aws_account_id,
            func.count(ResourceTagMapping.id).label("resource_count"),
        )
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "vertical",
            func.lower(CustomTag.tag_value) == vertical.name.lower(),
            ResourceTagMapping.aws_account_id.isnot(None),
        )
        .group_by(ResourceTagMapping.aws_account_id)
        .order_by(ResourceTagMapping.aws_account_id)
    )).all()

    # Get account names from cost_records
    account_names = {}
    if rows:
        acct_ids = [r.aws_account_id for r in rows]
        name_rows = (await db.execute(
            select(CostRecord.aws_account_id, CostRecord.account_name)
            .where(CostRecord.aws_account_id.in_(acct_ids))
            .group_by(CostRecord.aws_account_id, CostRecord.account_name)
        )).all()
        for nr in name_rows:
            account_names[nr.aws_account_id] = nr.account_name

    return [
        {
            "aws_account_id": r.aws_account_id,
            "account_name": account_names.get(r.aws_account_id, r.aws_account_id),
            "resource_count": r.resource_count,
        }
        for r in rows
    ]


@router.get("/{vertical_id}/tagged-resources")
async def vertical_tagged_resources(
    vertical_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    vertical = (await db.execute(
        select(Vertical).where(Vertical.id == vertical_id)
    )).scalar_one_or_none()
    if not vertical:
        raise HTTPException(404)

    rows = (await db.execute(
        select(
            ResourceTagMapping.resource_id,
            ResourceTagMapping.resource_name,
            ResourceTagMapping.cloud_provider,
            ResourceTagMapping.aws_account_id,
            ResourceTagMapping.service,
        )
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "vertical",
            func.lower(CustomTag.tag_value) == vertical.name.lower(),
        )
    )).all()

    return [
        {
            "resource_id": r.resource_id,
            "resource_name": r.resource_name,
            "cloud_provider": r.cloud_provider,
            "aws_account_id": r.aws_account_id,
            "service": r.service,
        }
        for r in rows
    ]


@router.get("/{vertical_id}/owners")
async def list_owners(
    vertical_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(Owner).where(Owner.vertical_id == vertical_id).order_by(Owner.name)
    )).scalars().all()
    return [{"id": str(o.id), "name": o.name, "email": o.email, "vertical_id": vertical_id} for o in rows]


@router.post("/{vertical_id}/owners", status_code=201)
async def create_owner(
    vertical_id: str,
    payload: OwnerCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    v = (await db.execute(
        select(Vertical).where(Vertical.id == vertical_id)
    )).scalar_one_or_none()
    if not v:
        raise HTTPException(404)
    o = Owner(vertical_id=vertical_id, name=payload.name, email=payload.email)
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return {"id": str(o.id), "name": o.name, "email": o.email}


@router.delete("/{vertical_id}/owners/{owner_id}", status_code=204)
async def delete_owner(
    vertical_id: str,
    owner_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    o = (await db.execute(
        select(Owner).where(Owner.id == owner_id, Owner.vertical_id == vertical_id)
    )).scalar_one_or_none()
    if not o:
        raise HTTPException(404)
    await db.delete(o)
    await db.commit()


@router.get("/{vertical_id}/owners/{owner_id}/cost")
async def owner_cost(
    vertical_id: str,
    owner_id: str,
    granularity: str = "monthly",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _date_range(granularity)
    if start_date:
        start = date.fromisoformat(start_date)
    if end_date:
        end = date.fromisoformat(end_date)

    apps = (await db.execute(
        select(Application).where(Application.owner_id == owner_id).order_by(Application.name)
    )).scalars().all()

    result = []
    for app in apps:
        res_rows = (await db.execute(
            select(ApplicationResource.resource_id)
            .where(ApplicationResource.application_id == app.id)
        )).scalars().all()
        resource_ids = list(set(res_rows))
        trend = await _cost_for_resources(db, resource_ids, start, end, granularity)
        total = sum(p["cost"] for p in trend)
        result.append({
            "app_id": str(app.id),
            "app_name": app.name,
            "app_color": app.color,
            "resource_count": len(resource_ids),
            "total_cost": total,
            "trend": trend,
        })

    return {"owner_id": owner_id, "granularity": granularity, "start": str(start), "end": str(end), "apps": result}


@router.get("/{vertical_id}/owners/{owner_id}/apps")
async def list_apps(
    vertical_id: str,
    owner_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(Application).where(Application.owner_id == owner_id).order_by(Application.name)
    )).scalars().all()
    return [{"id": str(a.id), "name": a.name, "description": a.description, "color": a.color} for a in rows]


@router.post("/{vertical_id}/owners/{owner_id}/apps", status_code=201)
async def create_app(
    vertical_id: str,
    owner_id: str,
    payload: AppCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    o = (await db.execute(
        select(Owner).where(Owner.id == owner_id)
    )).scalar_one_or_none()
    if not o:
        raise HTTPException(404)
    a = Application(owner_id=owner_id, name=payload.name, description=payload.description, color=payload.color)
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return {"id": str(a.id), "name": a.name, "color": a.color}
