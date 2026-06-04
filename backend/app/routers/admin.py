from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.database import get_db
from app.models.db_models import User
from app.models.schemas import AdminCreateUser, UserOut
from app.services.auth_service import get_current_user, hash_password
from app.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_owner(user: User):
    if user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner only")


@router.get("/users", response_model=list[UserOut])
async def list_users(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    result = await db.execute(select(User))
    return result.scalars().all()


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(payload: AdminCreateUser, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        is_approved=True,
        must_reset_password=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user


@router.patch("/users/{user_id}/approve")
async def approve_user(user_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_approved = True
    await db.commit()
    return {"approved": True}


@router.patch("/users/{user_id}/role")
async def change_role(user_id: str, role: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    if role not in ("owner", "editor", "viewer"):
        raise HTTPException(status_code=400, detail="Invalid role")
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.role = role
    await db.commit()
    return {"role": target.role}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_owner(user)
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if str(target.email) == settings.ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot delete admin")
    await db.delete(target)
    await db.commit()
