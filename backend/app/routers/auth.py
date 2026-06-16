from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta, timezone
import pyotp, qrcode, io, base64

from app.models.database import get_db
from app.models.db_models import User, AuditLog, LoginAttempt
from app.models.schemas import UserCreate, UserLogin, Token, UserOut, LoginResponse, MFAValidate, MFAConfirm, AdminCreateUser, ResetPassword
from app.services.auth_service import (
    hash_password, verify_password, create_access_token,
    create_temp_token, decode_temp_token, get_current_user,
)
from app.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_ATTEMPTS = 20
LOCKOUT_MINUTES = 15


async def _check_rate_limit(email: str, ip: str, db: AsyncSession):
    window = datetime.now(timezone.utc) - timedelta(minutes=LOCKOUT_MINUTES)
    result = await db.execute(
        select(func.count()).where(
            LoginAttempt.email == email,
            LoginAttempt.ip_address == ip,
            LoginAttempt.success == False,
            LoginAttempt.created_at >= window,
        )
    )
    if result.scalar() >= MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {LOCKOUT_MINUTES} minutes.")


async def _log_attempt(email: str, ip: str, success: bool, db: AsyncSession):
    db.add(LoginAttempt(email=email, ip_address=ip, success=success))
    await db.commit()


async def _audit(user: User, action: str, resource: str, ip: str, db: AsyncSession):
    db.add(AuditLog(user_id=user.id, email=user.email, action=action, resource=resource, ip_address=ip))
    await db.commit()


def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    return forwarded.split(",")[0].strip() if forwarded else request.client.host


@router.post("/signup", response_model=UserOut, status_code=201)
async def signup(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    is_admin = payload.email == settings.ADMIN_EMAIL
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role="owner" if is_admin else "viewer",
        is_approved=True if is_admin else False,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=LoginResponse)
async def login(payload: UserLogin, request: Request, db: AsyncSession = Depends(get_db)):
    ip = _get_ip(request)
    await _check_rate_limit(payload.email, ip, db)
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        await _log_attempt(payload.email, ip, False, db)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_approved:
        await _log_attempt(payload.email, ip, False, db)
        raise HTTPException(status_code=403, detail="pending_approval")
    await _log_attempt(payload.email, ip, True, db)
    await _audit(user, "login", "portal", ip, db)
    temp_token = create_temp_token(str(user.id))
    if user.must_reset_password:
        return {"status": "password_reset_required", "temp_token": temp_token}
    if not user.mfa_enabled:
        return {"status": "mfa_setup", "temp_token": temp_token}
    return {"status": "mfa_required", "temp_token": temp_token}


@router.post("/reset-password")
async def reset_password(payload: ResetPassword, db: AsyncSession = Depends(get_db)):
    user_id = decode_temp_token(payload.temp_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.hashed_password = hash_password(payload.new_password)
    user.must_reset_password = False
    await db.commit()
    # After reset, proceed to MFA setup/validate
    new_temp_token = create_temp_token(str(user.id))
    if not user.mfa_enabled:
        return {"status": "mfa_setup", "temp_token": new_temp_token}
    return {"status": "mfa_required", "temp_token": new_temp_token}


@router.get("/mfa/qr")
async def get_mfa_qr(temp_token: str, db: AsyncSession = Depends(get_db)):
    user_id = decode_temp_token(temp_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA already configured")
    if not user.totp_secret:
        user.totp_secret = pyotp.random_base32()
        await db.commit()
    totp = pyotp.TOTP(user.totp_secret)
    uri = totp.provisioning_uri(name=user.email, issuer_name="FinOps CUR Portal")
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return {"qr_base64": b64, "secret": user.totp_secret}


@router.post("/mfa/confirm")
async def confirm_mfa(payload: MFAConfirm, temp_token: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = decode_temp_token(temp_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.totp_secret:
        raise HTTPException(status_code=400, detail="MFA setup not initiated")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(payload.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid code")
    user.mfa_enabled = True
    await db.commit()
    await _audit(user, "mfa_setup", "portal", _get_ip(request), db)
    return {"access_token": create_access_token({"sub": str(user.id)}), "token_type": "bearer"}


@router.post("/mfa/validate", response_model=Token)
async def validate_mfa(payload: MFAValidate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = decode_temp_token(payload.temp_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.mfa_enabled or not user.totp_secret:
        raise HTTPException(status_code=400, detail="MFA not configured")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(payload.code, valid_window=1):
        await _log_attempt(user.email, _get_ip(request), False, db)
        raise HTTPException(status_code=400, detail="Invalid authenticator code")
    await _audit(user, "mfa_login", "portal", _get_ip(request), db)
    return {"access_token": create_access_token({"sub": str(user.id)}), "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
