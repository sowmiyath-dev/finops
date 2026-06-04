from pydantic import BaseModel, EmailStr, field_serializer
from typing import Optional, Any
from datetime import datetime, date, timezone
from uuid import UUID


def _to_utc_iso(v: Optional[datetime]) -> Optional[str]:
    if v is None:
        return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v.isoformat()


# ── Auth ──────────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class UserOut(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str]
    mfa_enabled: bool
    role: str
    is_approved: bool
    must_reset_password: bool = False
    class Config:
        from_attributes = True

class LoginResponse(BaseModel):
    status: str
    access_token: Optional[str] = None
    token_type: str = "bearer"
    temp_token: Optional[str] = None

class MFAValidate(BaseModel):
    temp_token: str
    code: str

class MFAConfirm(BaseModel):
    code: str

class ResetPassword(BaseModel):
    temp_token: str
    new_password: str

class AdminCreateUser(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    password: str
    role: str = "viewer"


# ── Control Tower ─────────────────────────────────────────────────────────────
class OnboardKeys(BaseModel):
    name: str
    management_account_name: str
    access_key_id: str
    secret_access_key: str
    cur_s3_bucket: str
    cur_s3_prefix: str

class OnboardRole(BaseModel):
    name: str
    management_account_name: str
    role_arn: str
    external_id: Optional[str] = None
    cur_s3_bucket: str
    cur_s3_prefix: str

class OnboardAzure(BaseModel):
    name: str
    tenant_id: str
    client_id: str
    client_secret: str
    storage_account: str
    container_name: str
    export_name: str

class SubAccountOut(BaseModel):
    id: UUID
    aws_account_id: str
    account_name: str
    is_active: bool
    class Config:
        from_attributes = True

class ControlTowerOut(BaseModel):
    id: UUID
    name: str
    cloud_provider: str = "aws"
    management_account_id: str
    management_account_name: str
    auth_method: str
    is_active: bool
    auto_sync_enabled: bool
    cur_s3_bucket: Optional[str] = None
    cur_s3_prefix: Optional[str] = None
    azure_tenant_id: Optional[str] = None
    azure_storage_account: Optional[str] = None
    azure_container_name: Optional[str] = None
    azure_export_name: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    external_id: Optional[str] = None
    sub_accounts: list[SubAccountOut] = []

    @field_serializer("last_synced_at")
    def serialize_dt(self, v: Optional[datetime]) -> Optional[str]:
        return _to_utc_iso(v)

    class Config:
        from_attributes = True


# ── Sync Log ──────────────────────────────────────────────────────────────────
class SyncLogOut(BaseModel):
    id: UUID
    control_tower_name: str
    triggered_by: str
    status: str
    records_synced: int
    date_range_start: Optional[date]
    date_range_end: Optional[date]
    error_message: Optional[str]
    started_at: datetime
    finished_at: Optional[datetime]

    @field_serializer("started_at", "finished_at")
    def serialize_dt(self, v: Optional[datetime]) -> Optional[str]:
        return _to_utc_iso(v)

    class Config:
        from_attributes = True


# ── Cost Report Filters ───────────────────────────────────────────────────────
class ReportFilter(BaseModel):
    control_tower_ids: Optional[list[str]] = None
    account_ids: Optional[list[str]] = None
    services: Optional[list[str]] = None
    regions: Optional[list[str]] = None
    purchase_types: Optional[list[str]] = None
    charge_types: Optional[list[str]] = None       # Usage | SavingsPlanCoveredUsage | RIFee | DiscountedUsage | Credit | Tax | Fee | Refund
    marketplace_only: Optional[bool] = None        # True = marketplace only, False = exclude marketplace
    tag_key: Optional[str] = None
    tag_value: Optional[str] = None
    start_date: str
    end_date: str
    granularity: str = "daily"
    metric: str = "unblended_cost"
    group_by: str = "account"
