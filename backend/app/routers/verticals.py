from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import Optional
from pydantic import BaseModel
from datetime import date, timedelta

from app.models.database import get_db
from app.models.db_models import (
    User, Vertical, Owner, Application, ApplicationResource, CostRecord, ResourceTagMapping
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _date_range(granularity: str) -> tuple[date, date]:
    today = date.today()
    if granularity == "daily":
        return today - timedelta(days=30), today
    elif granularity == "weekly":
        return today - timedelta(weeks=12), today
    else:  # monthly
        return today.replace(month=1, day=1), today


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
        period_expr = func.to_char(
            func.date_trunc("week", CostRecord.date), "YYYY-MM-DD"
        ).label("period")
    else:
        period_expr = func.cast(CostRecord.date, type_=CostRecord.date.type).label("period")

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


# ── Vertical CRUD ─────────────────────────────────────────────────────────────

@router.get("/")
async def list_verticals(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(Vertical).order_by(Vertical.name))).scalars().all()
    return [{"id": str(v.id), "name": v.name, "description": v.description, "color": v.color} for v in rows]


@router.post("/", status_code=201)
async def create_vertical(payload: VerticalCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(403, "Viewers cannot create verticals")
    v = Vertical(name=payload.name, description=payload.description, color=payload.color)
    db.add(v)
    await db.commit()
    await db.refresh(v)
    return {"id": str(v.id), "name": v.name, "color": v.color}


@router.delete("/{vertical_id}", status_code=204)
async def delete_vertical(vertical_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "editor"):
        raise HTTPException(403, "Insufficient permissions")
    v = (await db.execute(select(Vertical).where(Vertical.id == vertical_id))).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vertical not found")
    await db.delete(v)
    await db.commit()


# ── Owner CRUD ────────────────────────────────────────────────────────────────

@router.get("/{vertical_id}/owners")
async def list_owners(vertical_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(Owner).where(Owner.vertical_id == vertical_id).order_by(Owner.name)
    )).scalars().all()
    return [{"id": str(o.id), "name": o.name, "email": o.email, "vertical_id": vertical_id} for o in rows]


@router.post("/{vertical_id}/owners", status_code=201)
async def create_owner(vertical_id: str, payload: OwnerCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(403, "Viewers cannot create owners")
    v = (await db.execute(select(Vertical).where(Vertical.id == vertical_id))).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vertical not found")
    o = Owner(vertical_id=vertical_id, name=payload.name, email=payload.email)
    db.add(o)
    await db.commit()
    await db.refresh(o)
    return {"id": str(o.id), "name": o.name, "email": o.email}


@router.delete("/{vertical_id}/owners/{owner_id}", status_code=204)
async def delete_owner(vertical_id: str, owner_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(403)
    o = (await db.execute(select(Owner).where(Owner.id == owner_id, Owner.vertical_id == vertical_id))).scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Owner not found")
    await db.delete(o)
    await db.commit()


# ── Application CRUD ──────────────────────────────────────────────────────────

@router.get("/{vertical_id}/owners/{owner_id}/apps")
async def list_apps(vertical_id: str, owner_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(Application).where(Application.owner_id == owner_id).order_by(Application.name)
    )).scalars().all()
    return [{"id": str(a.id), "name": a.name, "description": a.description, "color": a.color} for a in rows]


@router.post("/{vertical_id}/owners/{owner_id}/apps", status_code=201)
async def create_app(vertical_id: str, owner_id: str, payload: AppCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(403)
    o = (await db.execute(select(Owner).where(Owner.id == owner_id))).scalar_one_or_none()
    if not o:
        raise HTTPException(404, "Owner not found")
    a = Application(owner_id=owner_id, name=payload.name, description=payload.description, color=payload.color)
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return {"id": str(a.id), "name": a.name, "color": a.color}


@router.delete("/apps/{app_id}", status_code=204)
async def delete_app(app_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(403)
    a = (await db.execute(select(Application).where(Application.id == app_id))).scalar_one_or_none()
    if not a:
        raise HTTPException(404)
    await db.delete(a)
    await db.commit()


# ── Application Resources ─────────────────────────────────────────────────────

@router.post("/apps/{app_id}/resources", status_code=201)
async def assign_resources(app_id: str, payload: AppResourceAssign, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
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


@router.get("/apps/{app_id}/resources")
async def list_app_resources(app_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(ApplicationResource).where(ApplicationResource.application_id == app_id)
    )).scalars().all()
    return [
        {"id": str(r.id), "resource_id": r.resource_id, "resource_name": r.resource_name,
         "cloud_provider": r.cloud_provider, "aws_account_id": r.aws_account_id, "service": r.service}
        for r in rows
    ]


@router.delete("/apps/{app_id}/resources/{resource_id}", status_code=204)
async def remove_resource(app_id: str, resource_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(403)
    await db.execute(
        select(ApplicationResource).where(
            ApplicationResource.application_id == app_id,
            ApplicationResource.resource_id == resource_id,
        )
    )
    rows = (await db.execute(
        select(ApplicationResource).where(
            ApplicationResource.application_id == app_id,
            ApplicationResource.resource_id == resource_id,
        )
    )).scalars().all()
    for r in rows:
        await db.delete(r)
    await db.commit()


# ── Cost APIs ─────────────────────────────────────────────────────────────────

@router.get("/{vertical_id}/cost")
async def vertical_cost(
    vertical_id: str,
    granularity: str = "monthly",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cost breakdown by owner for a vertical."""
    start, end = _date_range(granularity)
    if start_date:
        start = date.fromisoformat(start_date)
    if end_date:
        end = date.fromisoformat(end_date)

    owners = (await db.execute(
        select(Owner).where(Owner.vertical_id == vertical_id).order_by(Owner.name)
    )).scalars().all()

    result = []
    for owner in owners:
        apps = (await db.execute(
            select(Application).where(Application.owner_id == owner.id)
        )).scalars().all()

        all_resource_ids = []
        for app in apps:
            res = (await db.execute(
                select(ApplicationResource.resource_id).where(ApplicationResource.application_id == app.id)
            )).scalars().all()
            all_resource_ids.extend(res)

        # Also include resources tagged via custom tags where tag_key="Application" and tag_value=app.name
        for app in apps:
            tagged = (await db.execute(
                select(ResourceTagMapping.resource_id)
                .join(ResourceTagMapping.__table__)
                .where(ResourceTagMapping.resource_id.isnot(None))
            )).scalars().all()

        trend = await _cost_for_resources(db, list(set(all_resource_ids)), start, end, granularity)
        total = sum(p["cost"] for p in trend)
        result.append({
            "owner_id": str(owner.id),
            "owner_name": owner.name,
            "app_count": len(apps),
            "resource_count": len(set(all_resource_ids)),
            "total_cost": total,
            "trend": trend,
        })

    return {"vertical_id": vertical_id, "granularity": granularity, "start": str(start), "end": str(end), "owners": result}


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
    """Cost breakdown by application for an owner."""
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
            select(ApplicationResource.resource_id).where(ApplicationResource.application_id == app.id)
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


@router.get("/apps/{app_id}/cost")
async def app_cost(
    app_id: str,
    granularity: str = "monthly",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cost trend for a single application."""
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

    # Cloud breakdown
    cloud_stmt = (
        select(ApplicationResource.cloud_provider, func.count(ApplicationResource.id).label("cnt"))
        .where(ApplicationResource.application_id == app_id)
        .group_by(ApplicationResource.cloud_provider)
    )
    cloud_rows = (await db.execute(cloud_stmt)).all()

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


# ── Seed default verticals ────────────────────────────────────────────────────

@router.post("/seed", status_code=201)
async def seed_verticals(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Seed the 4 default verticals if they don't exist."""
    if user.role not in ("owner", "editor"):
        raise HTTPException(403)
    defaults = [
        {"name": "Lending", "color": "#0f2d5e"},
        {"name": "Insurance", "color": "#1d8348"},
        {"name": "EBS", "color": "#ec7211"},
        {"name": "L&D", "color": "#8e44ad"},
    ]
    created = []
    for d in defaults:
        exists = (await db.execute(select(Vertical).where(Vertical.name == d["name"]))).scalar_one_or_none()
        if not exists:
            v = Vertical(name=d["name"], color=d["color"])
            db.add(v)
            created.append(d["name"])
    await db.commit()
    return {"seeded": created}
