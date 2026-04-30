from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, and_
from typing import Optional
from pydantic import BaseModel
from uuid import UUID

from app.models.database import get_db
from app.models.db_models import User, CustomTag, ResourceTagMapping, CostRecord
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/tags", tags=["tags"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CustomTagCreate(BaseModel):
    tag_key: str
    tag_value: str
    color: str = "#0f2d5e"
    description: Optional[str] = None

class ResourceTagAssign(BaseModel):
    resource_ids: list[str]
    custom_tag_ids: list[str]
    cloud_provider: str = "aws"
    aws_account_id: Optional[str] = None
    service: Optional[str] = None
    resource_name: Optional[str] = None


# ── Custom Tag CRUD ───────────────────────────────────────────────────────────

@router.get("/")
async def list_tags(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(select(CustomTag).order_by(CustomTag.tag_key, CustomTag.tag_value))
    tags = result.scalars().all()
    return [
        {
            "id": str(t.id),
            "tag_key": t.tag_key,
            "tag_value": t.tag_value,
            "color": t.color,
            "description": t.description,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in tags
    ]


@router.post("/", status_code=201)
async def create_tag(payload: CustomTagCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot create tags")
    # Check duplicate
    existing = await db.execute(
        select(CustomTag).where(
            CustomTag.tag_key == payload.tag_key,
            CustomTag.tag_value == payload.tag_value,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Tag with this key:value already exists")
    tag = CustomTag(
        tag_key=payload.tag_key,
        tag_value=payload.tag_value,
        color=payload.color,
        description=payload.description,
        created_by=user.id,
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return {"id": str(tag.id), "tag_key": tag.tag_key, "tag_value": tag.tag_value, "color": tag.color}


@router.delete("/{tag_id}", status_code=204)
async def delete_tag(tag_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot delete tags")
    result = await db.execute(select(CustomTag).where(CustomTag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    await db.delete(tag)
    await db.commit()


# ── Resource Tag Assignments ──────────────────────────────────────────────────

@router.post("/assign", status_code=201)
async def assign_tags(payload: ResourceTagAssign, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Assign one or more custom tags to one or more resources (bulk support)."""
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot assign tags")

    created = 0
    for resource_id in payload.resource_ids:
        for tag_id in payload.custom_tag_ids:
            # Skip if already assigned
            existing = await db.execute(
                select(ResourceTagMapping).where(
                    ResourceTagMapping.resource_id == resource_id,
                    ResourceTagMapping.custom_tag_id == tag_id,
                )
            )
            if existing.scalar_one_or_none():
                continue
            db.add(ResourceTagMapping(
                resource_id=resource_id,
                resource_name=payload.resource_name,
                cloud_provider=payload.cloud_provider,
                aws_account_id=payload.aws_account_id,
                service=payload.service,
                custom_tag_id=tag_id,
                created_by=user.id,
            ))
            created += 1

    await db.commit()
    return {"assigned": created, "resources": len(payload.resource_ids), "tags": len(payload.custom_tag_ids)}


@router.delete("/assign/{resource_id}/{tag_id}", status_code=204)
async def remove_tag_from_resource(resource_id: str, tag_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot remove tags")
    await db.execute(
        delete(ResourceTagMapping).where(
            ResourceTagMapping.resource_id == resource_id,
            ResourceTagMapping.custom_tag_id == tag_id,
        )
    )
    await db.commit()


@router.get("/resource/{resource_id}")
async def get_resource_tags(resource_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Get all custom tags assigned to a specific resource."""
    result = await db.execute(
        select(ResourceTagMapping, CustomTag)
        .join(CustomTag, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .where(ResourceTagMapping.resource_id == resource_id)
    )
    rows = result.all()
    return [
        {
            "mapping_id": str(row.ResourceTagMapping.id),
            "resource_id": row.ResourceTagMapping.resource_id,
            "tag_id": str(row.CustomTag.id),
            "tag_key": row.CustomTag.tag_key,
            "tag_value": row.CustomTag.tag_value,
            "color": row.CustomTag.color,
        }
        for row in rows
    ]


@router.get("/cost-by-tag/{tag_id}")
async def cost_by_custom_tag(
    tag_id: str,
    start_date: str,
    end_date: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get total cost for all resources assigned to a custom tag."""
    from datetime import date
    from sqlalchemy import func

    # Get all resource IDs with this tag
    mappings = await db.execute(
        select(ResourceTagMapping.resource_id, ResourceTagMapping.aws_account_id)
        .where(ResourceTagMapping.custom_tag_id == tag_id)
    )
    resource_ids = [r.resource_id for r in mappings.all()]

    if not resource_ids:
        return {"total_cost": 0, "resource_count": 0, "resources": []}

    # Sum cost for those resources
    from app.models.db_models import CostRecord
    stmt = (
        select(
            CostRecord.resource_id,
            CostRecord.service,
            CostRecord.aws_account_id,
            func.sum(CostRecord.unblended_cost).label("cost"),
        )
        .where(
            CostRecord.resource_id.in_(resource_ids),
            CostRecord.date >= date.fromisoformat(start_date),
            CostRecord.date <= date.fromisoformat(end_date),
        )
        .group_by(CostRecord.resource_id, CostRecord.service, CostRecord.aws_account_id)
        .order_by(func.sum(CostRecord.unblended_cost).desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    total = sum(float(r.cost or 0) for r in rows)
    return {
        "total_cost": total,
        "resource_count": len(rows),
        "resources": [
            {
                "resource_id": r.resource_id,
                "service": r.service,
                "aws_account_id": r.aws_account_id,
                "cost": float(r.cost or 0),
            }
            for r in rows
        ],
    }


@router.get("/summary")
async def tags_summary(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Get all tags with their resource counts."""
    from sqlalchemy import func
    result = await db.execute(
        select(
            CustomTag.id,
            CustomTag.tag_key,
            CustomTag.tag_value,
            CustomTag.color,
            CustomTag.description,
            func.count(ResourceTagMapping.id).label("resource_count"),
        )
        .outerjoin(ResourceTagMapping, ResourceTagMapping.custom_tag_id == CustomTag.id)
        .group_by(CustomTag.id, CustomTag.tag_key, CustomTag.tag_value, CustomTag.color, CustomTag.description)
        .order_by(CustomTag.tag_key, CustomTag.tag_value)
    )
    rows = result.all()
    return [
        {
            "id": str(r.id),
            "tag_key": r.tag_key,
            "tag_value": r.tag_value,
            "color": r.color,
            "description": r.description,
            "resource_count": r.resource_count,
        }
        for r in rows
    ]
