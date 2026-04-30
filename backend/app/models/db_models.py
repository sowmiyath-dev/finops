from sqlalchemy import Column, String, DateTime, Text, Boolean, ForeignKey, Numeric, Integer, Date, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime, timezone
import uuid

Base = declarative_base()

def utcnow():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    totp_secret = Column(String, nullable=True)
    mfa_enabled = Column(Boolean, default=False)
    role = Column(String, default="viewer")
    is_approved = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

class ControlTower(Base):
    __tablename__ = "control_towers"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    management_account_id = Column(String(12), nullable=False)
    management_account_name = Column(String, nullable=False)
    auth_method = Column(String, nullable=False)
    access_key_id = Column(String)
    encrypted_secret_key = Column(Text)
    role_arn = Column(String)
    external_id = Column(String, unique=True)
    cur_s3_bucket = Column(String, nullable=True)
    cur_s3_prefix = Column(String, nullable=True)
    is_active = Column(Boolean, default=False)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    auto_sync_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

class SubAccount(Base):
    __tablename__ = "sub_accounts"
    __table_args__ = (
        Index("ix_sub_ct", "control_tower_id"),
        Index("ix_sub_aws_id", "aws_account_id"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    control_tower_id = Column(UUID(as_uuid=True), ForeignKey("control_towers.id"), nullable=False)
    aws_account_id = Column(String(12), nullable=False)
    account_name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)

class CostRecord(Base):
    __tablename__ = "cost_records"
    __table_args__ = (
        Index("ix_cr_sub_date", "sub_account_id", "date"),
        Index("ix_cr_ct_date", "control_tower_id", "date"),
        Index("ix_cr_service", "service"),
        Index("ix_cr_date", "date"),
        Index("ix_cr_aws_id_date", "aws_account_id", "date"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    control_tower_id = Column(UUID(as_uuid=True), ForeignKey("control_towers.id"), nullable=False)
    sub_account_id = Column(UUID(as_uuid=True), ForeignKey("sub_accounts.id"), nullable=False)
    aws_account_id = Column(String(12), nullable=False)
    account_name = Column(String)
    date = Column(Date, nullable=False)
    service = Column(String, nullable=False)
    region = Column(String)
    resource_id = Column(String)
    usage_type = Column(String)
    operation = Column(String)
    blended_cost = Column(Numeric(14, 6), default=0)
    unblended_cost = Column(Numeric(14, 6), default=0)
    net_unblended_cost = Column(Numeric(14, 6), default=0)
    amortized_cost = Column(Numeric(14, 6), default=0)
    usage_quantity = Column(Numeric(18, 6), default=0)
    usage_unit = Column(String)
    purchase_type = Column(String)
    line_item_type = Column(String)        # Usage | SavingsPlanCoveredUsage | RIFee | DiscountedUsage | Credit | Tax | Fee | Refund
    is_marketplace = Column(Boolean, default=False)  # True if AWS Marketplace charge
    tags = Column(Text)
    synced_at = Column(DateTime(timezone=True), default=utcnow)

class SyncLog(Base):
    __tablename__ = "sync_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    control_tower_id = Column(UUID(as_uuid=True), ForeignKey("control_towers.id", ondelete="CASCADE"), nullable=False)
    control_tower_name = Column(String, nullable=False)
    triggered_by = Column(String, nullable=False)
    status = Column(String, nullable=False)
    records_synced = Column(Integer, default=0)
    date_range_start = Column(Date, nullable=True)
    date_range_end = Column(Date, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), default=utcnow)
    finished_at = Column(DateTime(timezone=True), nullable=True)

class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=False)
    success = Column(Boolean, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email = Column(String, nullable=False)
    action = Column(String, nullable=False)
    resource = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class CustomTag(Base):
    """Application-level custom tags — not linked to AWS resource tags."""
    __tablename__ = "custom_tags"
    __table_args__ = (
        Index("ix_custom_tag_key", "tag_key"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tag_key = Column(String, nullable=False)       # e.g. "Project"
    tag_value = Column(String, nullable=False)     # e.g. "Samil"
    color = Column(String, default="#0f2d5e")      # display color
    description = Column(String, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class ResourceTagMapping(Base):
    """Maps application custom tags to resource IDs across any cloud."""
    __tablename__ = "resource_tag_mappings"
    __table_args__ = (
        Index("ix_rtm_resource", "resource_id"),
        Index("ix_rtm_tag", "custom_tag_id"),
        Index("ix_rtm_cloud", "cloud_provider"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resource_id = Column(String, nullable=False)          # AWS resource ID / Azure resource ID
    resource_name = Column(String, nullable=True)
    cloud_provider = Column(String, nullable=False)       # aws | azure | gcp
    aws_account_id = Column(String, nullable=True)
    service = Column(String, nullable=True)
    custom_tag_id = Column(UUID(as_uuid=True), ForeignKey("custom_tags.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
