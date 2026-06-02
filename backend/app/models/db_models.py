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
    cloud_provider = Column(String, default="aws")  # aws | azure | gcp
    management_account_id = Column(String, nullable=False)
    management_account_name = Column(String, nullable=False)
    auth_method = Column(String, nullable=False)
    # AWS fields
    access_key_id = Column(String)
    encrypted_secret_key = Column(Text)
    role_arn = Column(String)
    external_id = Column(String, unique=True)
    cur_s3_bucket = Column(String, nullable=True)
    cur_s3_prefix = Column(String, nullable=True)
    # Azure fields
    azure_tenant_id = Column(String, nullable=True)
    azure_client_id = Column(String, nullable=True)
    encrypted_azure_client_secret = Column(Text, nullable=True)
    azure_storage_account = Column(String, nullable=True)
    azure_container_name = Column(String, nullable=True)
    azure_export_name = Column(String, nullable=True)
    # Common
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
        Index("ix_cr_resource_id", "resource_id"),           # vertical cost queries
        Index("ix_cr_resource_date", "resource_id", "date"), # vertical cost with date filter
        Index("ix_cr_resource_date_type", "resource_id", "date", "line_item_type"),  # covers CASE filter
        Index("ix_cr_account_date_type", "aws_account_id", "date", "line_item_type"),  # account cost queries
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
    cloud_provider = Column(String, default="aws")  # aws | azure | gcp
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


# ── Verticals / Owners / Applications ───────────────────────────────────────

class Vertical(Base):
    """Business unit / vertical (e.g. Lending, Insurance, EBS, L&D)."""
    __tablename__ = "verticals"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False, unique=True)
    description = Column(String, nullable=True)
    color = Column(String, default="#0f2d5e")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Business(Base):
    """Business entity within a vertical (e.g. IDC, SFL, SGIC)."""
    __tablename__ = "businesses"
    __table_args__ = (Index("ix_business_vertical", "vertical_id"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vertical_id = Column(UUID(as_uuid=True), ForeignKey("verticals.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    color = Column(String, default="#0f2d5e")
    owner_name = Column(String, nullable=True)  # business owner
    owner_email = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Owner(Base):
    """Team or person owning applications within a business."""
    __tablename__ = "owners"
    __table_args__ = (Index("ix_owner_business", "business_id"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vertical_id = Column(UUID(as_uuid=True), ForeignKey("verticals.id", ondelete="CASCADE"), nullable=False)
    business_id = Column(UUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Application(Base):
    """Project / application grouping resources across clouds."""
    __tablename__ = "applications"
    __table_args__ = (Index("ix_app_owner", "owner_id"),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("owners.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    color = Column(String, default="#0f2d5e")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class ApplicationResource(Base):
    """Resources (any cloud) assigned to an application."""
    __tablename__ = "application_resources"
    __table_args__ = (
        Index("ix_appres_app", "application_id"),
        Index("ix_appres_resource", "resource_id"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    application_id = Column(UUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False)
    resource_id = Column(String, nullable=False)
    resource_name = Column(String, nullable=True)
    cloud_provider = Column(String, nullable=False, default="aws")  # aws | azure | gcp
    aws_account_id = Column(String, nullable=True)
    service = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class CustomTag(Base):
    """Application-level custom tags — not linked to AWS resource tags."""
    __tablename__ = "custom_tags"
    __table_args__ = (
        Index("ix_custom_tag_key", "tag_key"),
        Index("ix_custom_tag_key_value", "tag_key", "tag_value"),  # covers vertical/business lookups
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tag_key = Column(String, nullable=False)       # e.g. "Project"
    tag_value = Column(String, nullable=False)     # e.g. "Samil"
    color = Column(String, default="#0f2d5e")      # display color
    description = Column(String, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class VerticalCostCache(Base):
    """Pre-aggregated cost per vertical per period — refreshed after each sync.
    Replaces expensive real-time JOIN queries on cost_records.
    """
    __tablename__ = "vertical_cost_cache"
    __table_args__ = (
        Index("ix_vcc_vertical_gran_period", "vertical_name", "granularity", "period"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vertical_name = Column(String, nullable=False)   # e.g. "Non-SFL"
    granularity = Column(String, nullable=False)     # daily | weekly | monthly
    period = Column(String, nullable=False)          # e.g. "2024-01" or "2024-01-15"
    total_cost = Column(Numeric(18, 4), default=0)
    resource_count = Column(Integer, default=0)
    refreshed_at = Column(DateTime(timezone=True), default=utcnow)


class ResourceTagMapping(Base):
    """Maps application custom tags to resource IDs across any cloud."""
    __tablename__ = "resource_tag_mappings"
    __table_args__ = (
        Index("ix_rtm_resource", "resource_id"),
        Index("ix_rtm_tag", "custom_tag_id"),
        Index("ix_rtm_cloud", "cloud_provider"),
        Index("ix_rtm_tag_resource", "custom_tag_id", "resource_id"),  # covers tag→resource joins
        Index("ix_rtm_tag_account", "custom_tag_id", "aws_account_id"),  # covers account lookups
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
