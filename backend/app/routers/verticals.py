from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from pydantic import BaseModel
from datetime import date, timedelta

from app.models.database import get_db
from app.models.db_models import (
    User, Vertical, Business, Owner, Application, ApplicationResource, CostRecord,
    CustomTag, ResourceTagMapping
)
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/verticals", tags=["verticals"])


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

    stmt = (
        select(period_expr, func.sum(CostRecord.unblended_cost).label("cost"))
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
    """Sum cost for given resource IDs PLUS all records for given account IDs.
    This captures account-level charges (support, tax, credits) with no resource_id.
    """
    from sqlalchemy import or_
    if not resource_ids and not account_ids:
        return []
    if granularity == "monthly":
        period_expr = func.to_char(CostRecord.date, "YYYY-MM").label("period")
    elif granularity == "weekly":
        period_expr = func.to_char(func.date_trunc("week", CostRecord.date), "YYYY-MM-DD").label("period")
    else:
        period_expr = func.cast(CostRecord.date, CostRecord.date.type).label("period")

    conditions = [CostRecord.date >= start, CostRecord.date <= end]
    clauses = []
    if resource_ids:
        clauses.append(CostRecord.resource_id.in_(resource_ids))
    if account_ids:
        clauses.append(CostRecord.aws_account_id.in_(account_ids))
    conditions.append(or_(*clauses))

    stmt = (
        select(period_expr, func.sum(CostRecord.unblended_cost).label("cost"))
        .where(*conditions)
        .group_by("period")
        .order_by("period")
    )
    rows = (await db.execute(stmt)).all()
    return [{"period": str(r.period), "cost": float(r.cost or 0)} for r in rows]


# ═════════════════════════════════════════════════════════════════════════════
# STATIC ROUTES FIRST
# ═════════════════════════════════════════════════════════════════════════════

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

    added = 0
    for rid in payload.resource_ids:
        for tag in [t for t in [vertical_tag, business_tag] if t]:
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
            "vertical_id": str(b.vertical_id)}


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
         "color": b.color, "owner_name": b.owner_name, "owner_email": b.owner_email}
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
    """Cost for all resources tagged with Business=<business_name>."""
    start, end = _date_range(granularity)
    if start_date:
        start = date.fromisoformat(start_date)
    if end_date:
        end = date.fromisoformat(end_date)

    biz = (await db.execute(select(Business).where(Business.id == business_id))).scalar_one_or_none()
    if not biz:
        raise HTTPException(404)

    # Get resource IDs tagged with Business=<name>
    resource_ids = list(set((await db.execute(
        select(ResourceTagMapping.resource_id)
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "business",
            func.lower(CustomTag.tag_value) == biz.name.lower(),
        )
    )).scalars().all()))

    # Also get account IDs for account-level charges
    account_ids = list(set((await db.execute(
        select(ResourceTagMapping.aws_account_id)
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(
            func.lower(CustomTag.tag_key) == "business",
            func.lower(CustomTag.tag_value) == biz.name.lower(),
            ResourceTagMapping.aws_account_id.isnot(None),
        )
    )).scalars().all()))

    trend = await _cost_for_resources_and_accounts(db, resource_ids, account_ids, start, end, granularity)
    total = sum(p["cost"] for p in trend)

    return {
        "business_id": business_id,
        "business_name": biz.name,
        "granularity": granularity,
        "start": str(start),
        "end": str(end),
        "total_cost": total,
        "resource_count": len(resource_ids),
        "trend": trend,
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

    tagged_ids = await _tagged_resource_ids_for_vertical(db, vertical.name)

    # Get tagged account IDs so we can include account-level charges (null resource_id)
    tagged_account_ids = list(set(
        (await db.execute(
            select(ResourceTagMapping.aws_account_id)
            .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
            .where(
                func.lower(CustomTag.tag_key) == "vertical",
                func.lower(CustomTag.tag_value) == vertical.name.lower(),
                ResourceTagMapping.aws_account_id.isnot(None),
            )
        )).scalars().all()
    ))

    owners = (await db.execute(
        select(Owner).where(Owner.vertical_id == vertical_id).order_by(Owner.name)
    )).scalars().all()

    result = []
    owner_resource_ids = set()

    for owner in owners:
        apps = (await db.execute(
            select(Application).where(Application.owner_id == owner.id)
        )).scalars().all()

        all_resource_ids = []
        for app in apps:
            res = (await db.execute(
                select(ApplicationResource.resource_id)
                .where(ApplicationResource.application_id == app.id)
            )).scalars().all()
            all_resource_ids.extend(res)

        owner_resource_ids.update(all_resource_ids)
        merged = list(set(all_resource_ids))
        trend = await _cost_for_resources(db, merged, start, end, granularity)
        total = sum(p["cost"] for p in trend)
        result.append({
            "owner_id": str(owner.id),
            "owner_name": owner.name,
            "app_count": len(apps),
            "resource_count": len(merged),
            "total_cost": total,
            "trend": trend,
        })

    # Unassigned: tagged resources not under any owner + account-level charges
    unassigned_ids = [r for r in tagged_ids if r not in owner_resource_ids]
    if unassigned_ids or tagged_account_ids:
        trend = await _cost_for_resources_and_accounts(
            db, unassigned_ids, tagged_account_ids, start, end, granularity
        )
        total = sum(p["cost"] for p in trend)
        result.append({
            "owner_id": "unassigned",
            "owner_name": "Unassigned (via Tag)",
            "app_count": 0,
            "resource_count": len(unassigned_ids),
            "total_cost": total,
            "trend": trend,
        })

    return {
        "vertical_id": vertical_id,
        "granularity": granularity,
        "start": str(start),
        "end": str(end),
        "tagged_resource_count": len(tagged_ids),
        "tagged_account_ids": tagged_account_ids,
        "owners": result,
    }


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
