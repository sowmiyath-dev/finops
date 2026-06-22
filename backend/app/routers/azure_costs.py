from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct
from typing import Optional
from pydantic import BaseModel
from datetime import date, timedelta
import json

from app.models.database import get_db
from app.models.db_models import AzureCostRecord, AzureBusinessMapping, Business, ControlTower
from app.services.auth_service import get_current_user
from app.models.db_models import User

router = APIRouter(prefix="/azure-costs", tags=["azure-costs"])


def _parse_dates(start_date: Optional[str], end_date: Optional[str]):
    today = date.today()
    start = date.fromisoformat(start_date) if start_date else today.replace(day=1)
    end = date.fromisoformat(end_date) if end_date else today
    return start, end


# ── Cost Explorer endpoints ───────────────────────────────────────────────────

@router.get("/subscriptions")
async def cost_by_subscription(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)

    # Get actual cost
    actual_rows = (await db.execute(
        select(
            AzureCostRecord.subscription_id,
            AzureCostRecord.subscription_name,
            func.sum(AzureCostRecord.actual_cost).label("actual_cost"),
        )
        .where(AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual")
        .group_by(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
    )).all()

    # Get amortized cost
    amortized_map = {r.subscription_id: float(r.amortized_cost or 0) for r in (await db.execute(
        select(AzureCostRecord.subscription_id, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized")
        .group_by(AzureCostRecord.subscription_id)
    )).all()}

    result = []
    for r in actual_rows:
        actual = float(r.actual_cost or 0)
        amortized = amortized_map.get(r.subscription_id, actual)  # fallback to actual if no amortized
        savings = max(0, actual - amortized)
        result.append({
            "subscription_id": r.subscription_id,
            "subscription_name": r.subscription_name or r.subscription_id,
            "actual_cost": actual,
            "amortized_cost": amortized,
            "savings": savings,
            "true_cost": amortized if amortized > 0 else actual,
        })
    return result


@router.get("/resource-groups")
async def cost_by_resource_group(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    subscription_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start, end = _parse_dates(start_date, end_date)
    conditions_actual = [
        AzureCostRecord.date >= start, AzureCostRecord.date <= end,
        AzureCostRecord.cost_type == "actual",
        AzureCostRecord.resource_group.isnot(None), AzureCostRecord.resource_group != "",
    ]
    conditions_amortized = [
        AzureCostRecord.date >= start, AzureCostRecord.date <= end,
        AzureCostRecord.cost_type == "amortized",
        AzureCostRecord.resource_group.isnot(None), AzureCostRecord.resource_group != "",
    ]
    if subscription_id:
        conditions_actual.append(AzureCostRecord.subscription_id == subscription_id)
        conditions_amortized.append(AzureCostRecord.subscription_id == subscription_id)

    actual_rows = (await db.execute(
        select(AzureCostRecord.resource_group, AzureCostRecord.subscription_name,
               func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*conditions_actual)
        .group_by(AzureCostRecord.resource_group, AzureCostRecord.subscription_name)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
    )).all()

    amortized_map = {r.resource_group: float(r.amortized_cost or 0) for r in (await db.execute(
        select(AzureCostRecord.resource_group, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(*conditions_amortized).group_by(AzureCostRecord.resource_group)
    )).all()}

    result = []
    for r in actual_rows:
        actual = float(r.actual_cost or 0)
        amortized = amortized_map.get(r.resource_group, actual)
        savings = max(0, actual - amortized)
        result.append({
            "resource_group": r.resource_group,
            "subscription_name": r.subscription_name,
            "actual_cost": actual,
            "amortized_cost": amortized,
            "savings": savings,
            "true_cost": amortized if amortized > 0 else actual,
        })
    return result


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
    conditions_a = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "actual"]
    conditions_m = [AzureCostRecord.date >= start, AzureCostRecord.date <= end, AzureCostRecord.cost_type == "amortized"]
    if subscription_id:
        conditions_a.append(AzureCostRecord.subscription_id == subscription_id)
        conditions_m.append(AzureCostRecord.subscription_id == subscription_id)
    if resource_group:
        conditions_a.append(AzureCostRecord.resource_group == resource_group)
        conditions_m.append(AzureCostRecord.resource_group == resource_group)

    actual_rows = (await db.execute(
        select(AzureCostRecord.service, func.sum(AzureCostRecord.actual_cost).label("actual_cost"))
        .where(*conditions_a).group_by(AzureCostRecord.service)
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
    )).all()

    amortized_map = {r.service: float(r.amortized_cost or 0) for r in (await db.execute(
        select(AzureCostRecord.service, func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(*conditions_m).group_by(AzureCostRecord.service)
    )).all()}

    result = []
    for r in actual_rows:
        actual = float(r.actual_cost or 0)
        amortized = amortized_map.get(r.service, actual)
        savings = max(0, actual - amortized)
        result.append({
            "service": r.service or "Unknown",
            "actual_cost": actual,
            "amortized_cost": amortized,
            "savings": savings,
            "true_cost": amortized if amortized > 0 else actual,
        })
    return result


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
    conditions = [
        AzureCostRecord.date >= start,
        AzureCostRecord.date <= end,
        AzureCostRecord.cost_type == "actual",
        AzureCostRecord.tags.isnot(None),
    ]
    if subscription_id:
        conditions.append(AzureCostRecord.subscription_id == subscription_id)

    rows = (await db.execute(
        select(AzureCostRecord.tags, func.sum(AzureCostRecord.actual_cost).label("actual_cost"),
               func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"))
        .where(*conditions)
        .group_by(AzureCostRecord.tags)
    )).all()

    agg: dict = {}
    for r in rows:
        try:
            tags = json.loads(r.tags) if r.tags else {}
        except Exception:
            continue
        val = tags.get(tag_key) or tags.get(tag_key.lower()) or "Untagged"
        if val not in agg:
            agg[val] = {"actual_cost": 0.0, "amortized_cost": 0.0}
        agg[val]["actual_cost"] += float(r.actual_cost or 0)
        agg[val]["amortized_cost"] += float(r.amortized_cost or 0)

    return [
        {
            "tag_key": tag_key,
            "tag_value": k,
            "actual_cost": v["actual_cost"],
            "amortized_cost": v["amortized_cost"],
            "savings": max(0, v["actual_cost"] - v["amortized_cost"]),
            "true_cost": v["amortized_cost"],
        }
        for k, v in sorted(agg.items(), key=lambda x: x[1]["actual_cost"], reverse=True)
    ]


@router.get("/tag-keys")
async def get_tag_keys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(AzureCostRecord.tags)
        .where(AzureCostRecord.tags.isnot(None), AzureCostRecord.cost_type == "actual")
        .limit(500)
    )).scalars().all()
    keys: set = set()
    for tags_str in rows:
        try:
            tags = json.loads(tags_str)
            keys.update(tags.keys())
        except Exception:
            pass
    return sorted(list(keys))


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
    conditions = [
        AzureCostRecord.date >= start,
        AzureCostRecord.date <= end,
        AzureCostRecord.cost_type == "actual",
    ]
    if subscription_id:
        conditions.append(AzureCostRecord.subscription_id == subscription_id)
    if resource_group:
        conditions.append(AzureCostRecord.resource_group == resource_group)

    rows = (await db.execute(
        select(
            AzureCostRecord.date,
            func.sum(AzureCostRecord.actual_cost).label("actual_cost"),
            func.sum(AzureCostRecord.amortized_cost).label("amortized_cost"),
        )
        .where(*conditions)
        .group_by(AzureCostRecord.date)
        .order_by(AzureCostRecord.date)
    )).all()

    return [
        {
            "date": str(r.date),
            "actual_cost": float(r.actual_cost or 0),
            "amortized_cost": float(r.amortized_cost or 0),
            "savings": max(0, float(r.actual_cost or 0) - float(r.amortized_cost or 0)),
        }
        for r in rows
    ]


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
    conditions = [
        AzureCostRecord.date >= start,
        AzureCostRecord.date <= end,
        AzureCostRecord.cost_type == "actual",
        AzureCostRecord.resource_id.isnot(None),
        AzureCostRecord.resource_id != "",
    ]
    if subscription_id:
        conditions.append(AzureCostRecord.subscription_id == subscription_id)
    if resource_group:
        conditions.append(AzureCostRecord.resource_group == resource_group)

    rows = (await db.execute(
        select(
            AzureCostRecord.resource_id,
            AzureCostRecord.resource_name,
            AzureCostRecord.service,
            AzureCostRecord.resource_group,
            func.sum(AzureCostRecord.actual_cost).label("actual_cost"),
        )
        .where(*conditions)
        .group_by(
            AzureCostRecord.resource_id, AzureCostRecord.resource_name,
            AzureCostRecord.service, AzureCostRecord.resource_group,
        )
        .order_by(func.sum(AzureCostRecord.actual_cost).desc())
        .limit(200)
    )).all()

    return [
        {
            "resource_id": r.resource_id,
            "resource_name": r.resource_name or r.resource_id.split("/")[-1],
            "service": r.service,
            "resource_group": r.resource_group,
            "actual_cost": float(r.actual_cost or 0),
        }
        for r in rows
    ]


# ── Subscription / RG listing for mapping UI ─────────────────────────────────

@router.get("/meta/subscriptions")
async def list_subscriptions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name)
        .where(AzureCostRecord.cost_type == "actual")
        .group_by(AzureCostRecord.subscription_id, AzureCostRecord.subscription_name)
        .order_by(AzureCostRecord.subscription_name)
    )).all()
    return [{"subscription_id": r.subscription_id, "subscription_name": r.subscription_name or r.subscription_id} for r in rows]


@router.get("/meta/resource-groups")
async def list_resource_groups(
    subscription_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [AzureCostRecord.cost_type == "actual", AzureCostRecord.resource_group.isnot(None), AzureCostRecord.resource_group != ""]
    if subscription_id:
        conditions.append(AzureCostRecord.subscription_id == subscription_id)
    rows = (await db.execute(
        select(AzureCostRecord.resource_group, AzureCostRecord.subscription_name)
        .where(*conditions)
        .group_by(AzureCostRecord.resource_group, AzureCostRecord.subscription_name)
        .order_by(AzureCostRecord.resource_group)
    )).all()
    return [{"resource_group": r.resource_group, "subscription_name": r.subscription_name} for r in rows]


# ── Business mapping CRUD ─────────────────────────────────────────────────────

class MappingCreate(BaseModel):
    business_id: str
    control_tower_id: str
    mapping_type: str           # subscription | resource_group | tag | resource
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
    return [
        {
            "id": str(r.id),
            "mapping_type": r.mapping_type,
            "subscription_id": r.subscription_id,
            "subscription_name": r.subscription_name,
            "resource_group": r.resource_group,
            "tag_key": r.tag_key,
            "tag_value": r.tag_value,
            "resource_ids": json.loads(r.resource_ids) if r.resource_ids else [],
        }
        for r in rows
    ]


@router.post("/mappings", status_code=201)
async def create_business_mapping(
    payload: MappingCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)
    m = AzureBusinessMapping(
        business_id=payload.business_id,
        control_tower_id=payload.control_tower_id,
        mapping_type=payload.mapping_type,
        subscription_id=payload.subscription_id,
        subscription_name=payload.subscription_name,
        resource_group=payload.resource_group,
        tag_key=payload.tag_key,
        tag_value=payload.tag_value,
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
    m = (await db.execute(
        select(AzureBusinessMapping).where(AzureBusinessMapping.id == mapping_id)
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await db.commit()


# ── Azure cost per business (used by FinOps dashboard) ───────────────────────

@router.get("/business-costs")
async def all_business_azure_costs(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return {business_id: {actual, savings, true_cost}} for all businesses with Azure mappings."""
    start, end = _parse_dates(start_date, end_date)

    mappings = (await db.execute(select(AzureBusinessMapping))).scalars().all()
    if not mappings:
        return {}

    result: dict = {}

    for m in mappings:
        biz_id = str(m.business_id)
        conditions = [
            AzureCostRecord.date >= start,
            AzureCostRecord.date <= end,
        ]

        if m.mapping_type == "subscription":
            conditions.append(AzureCostRecord.subscription_id == m.subscription_id)
        elif m.mapping_type == "resource_group":
            conditions.append(AzureCostRecord.resource_group == m.resource_group)
            if m.subscription_id:
                conditions.append(AzureCostRecord.subscription_id == m.subscription_id)
        elif m.mapping_type == "tag":
            conditions.append(AzureCostRecord.tags.contains(f'"{m.tag_key}"'))
            if m.tag_value:
                conditions.append(AzureCostRecord.tags.contains(f'"{m.tag_value}"'))
        elif m.mapping_type == "resource":
            resource_ids = json.loads(m.resource_ids) if m.resource_ids else []
            if not resource_ids:
                continue
            conditions.append(AzureCostRecord.resource_id.in_(resource_ids))

        # Get actual cost
        actual_row = (await db.execute(
            select(func.sum(AzureCostRecord.actual_cost).label("cost"))
            .where(*conditions, AzureCostRecord.cost_type == "actual")
        )).scalar() or 0

        # Get amortized cost
        amortized_row = (await db.execute(
            select(func.sum(AzureCostRecord.amortized_cost).label("cost"))
            .where(*conditions, AzureCostRecord.cost_type == "amortized")
        )).scalar() or 0

        actual = float(actual_row)
        amortized = float(amortized_row)

        if biz_id not in result:
            result[biz_id] = {"actual_cost": 0.0, "savings": 0.0, "true_cost": 0.0}
        result[biz_id]["actual_cost"] += actual
        result[biz_id]["savings"] += max(0, actual - amortized)
        result[biz_id]["true_cost"] += amortized if amortized > 0 else actual

    return result
