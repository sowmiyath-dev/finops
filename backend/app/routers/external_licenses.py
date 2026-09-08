from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel
from decimal import Decimal

from app.models.database import get_db
from app.models.db_models import ExternalLicense, User
from app.services.auth_service import get_current_user

router = APIRouter(prefix="/external-licenses", tags=["external-licenses"])

DEFAULT_LICENSES = [
    {"sno": 1,  "description": "RHEL",                        "team": "DCEBS", "unit_cost_pa": 0,        "unit_cost_pm": 0},
    {"sno": 2,  "description": "MSSQL Ent",                   "team": "DCEBS", "unit_cost_pa": 278196,   "unit_cost_pm": 23183},
    {"sno": 3,  "description": "MSSQL Std",                   "team": "DCEBS", "unit_cost_pa": 89068,    "unit_cost_pm": 7422},
    {"sno": 4,  "description": "Fortigate License",           "team": "NOC",   "unit_cost_pa": 142000,   "unit_cost_pm": 11833},
    {"sno": 5,  "description": "Security",                    "team": "SOC",   "unit_cost_pa": 40000,    "unit_cost_pm": 3333},
    {"sno": 6,  "description": "Dynatrace",                   "team": "DCEBS", "unit_cost_pa": 100000,   "unit_cost_pm": 8333},
    {"sno": 7,  "description": "Veeam Backup",                "team": "DCEBS", "unit_cost_pa": 16260,    "unit_cost_pm": 1355},
    {"sno": 8,  "description": "Site24/7",                    "team": "DCEBS", "unit_cost_pa": 740,      "unit_cost_pm": 62},
    {"sno": 9,  "description": "OpsRamp",                     "team": "DCEBS", "unit_cost_pa": 6500,     "unit_cost_pm": 542},
    {"sno": 10, "description": "Color Token",                 "team": "NOC",   "unit_cost_pa": 11500,    "unit_cost_pm": 958},
    {"sno": 11, "description": "CSPM",                        "team": "SOC",   "unit_cost_pa": 3400,     "unit_cost_pm": 283},
    {"sno": 12, "description": "Manage Engine Patch manager", "team": "DCEBS", "unit_cost_pa": 564,      "unit_cost_pm": 47},
    {"sno": 13, "description": "ME Service Desk plus",        "team": "DCEBS", "unit_cost_pa": 805,      "unit_cost_pm": 67},
    {"sno": 14, "description": "SIEM",                        "team": "SOC",   "unit_cost_pa": 900000,   "unit_cost_pm": 75000},
    {"sno": 15, "description": "EDR",                         "team": "SOC",   "unit_cost_pa": 4500,     "unit_cost_pm": 375},
    {"sno": 16, "description": "F5 DXC",                      "team": "SOC",   "unit_cost_pa": 800000,   "unit_cost_pm": 66667},
    {"sno": 17, "description": "VAPT (GBT, BBT, VA/PT)",      "team": "SOC",   "unit_cost_pa": 195000,   "unit_cost_pm": 16250},
    {"sno": 18, "description": "Brand Monitoring",            "team": "SOC",   "unit_cost_pa": 0,        "unit_cost_pm": 0},
    {"sno": 19, "description": "Recon Service",               "team": "SOC",   "unit_cost_pa": 500000,   "unit_cost_pm": 41667},
    {"sno": 20, "description": "MSSP",                        "team": "SOC",   "unit_cost_pa": 1800000,  "unit_cost_pm": 150000},
    {"sno": 21, "description": "PIM",                         "team": "SOC",   "unit_cost_pa": 20000,    "unit_cost_pm": 1700},
]


class LicenseRow(BaseModel):
    sno: int
    description: str
    team: Optional[str] = None
    unit_cost_pa: float = 0
    unit_cost_pm: float = 0
    dc_units: float = 0
    dr_units: float = 0
    uat_units: float = 0


class LicenseBulkSave(BaseModel):
    rows: list[LicenseRow]


def _row_to_dict(r: ExternalLicense) -> dict:
    pm = float(r.unit_cost_pm or 0)
    dc = float(r.dc_units or 0)
    dr = float(r.dr_units or 0)
    uat = float(r.uat_units or 0)
    dc_cost = dc * pm
    dr_cost = dr * pm
    uat_cost = uat * pm
    total_units = dc + dr + uat
    total_cost = dc_cost + dr_cost + uat_cost
    return {
        "id": str(r.id),
        "sno": r.sno,
        "description": r.description,
        "team": r.team,
        "unit_cost_pa": float(r.unit_cost_pa or 0),
        "unit_cost_pm": pm,
        "dc_units": dc,
        "dr_units": dr,
        "uat_units": uat,
        "dc_cost": dc_cost,
        "dr_cost": dr_cost,
        "uat_cost": uat_cost,
        "total_units": total_units,
        "total_cost": total_cost,
    }


@router.get("/{app_name}")
async def get_licenses(
    app_name: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(ExternalLicense)
        .where(ExternalLicense.app_name == app_name)
        .order_by(ExternalLicense.sno)
    )).scalars().all()

    # Auto-seed defaults if no rows exist for this app
    if not rows:
        for d in DEFAULT_LICENSES:
            db.add(ExternalLicense(app_name=app_name, **d))
        await db.commit()
        rows = (await db.execute(
            select(ExternalLicense)
            .where(ExternalLicense.app_name == app_name)
            .order_by(ExternalLicense.sno)
        )).scalars().all()

    return [_row_to_dict(r) for r in rows]


@router.put("/{app_name}")
async def save_licenses(
    app_name: str,
    payload: LicenseBulkSave,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role == "viewer":
        raise HTTPException(403)

    # Delete existing rows for this app and replace
    existing = (await db.execute(
        select(ExternalLicense).where(ExternalLicense.app_name == app_name)
    )).scalars().all()
    for r in existing:
        await db.delete(r)
    await db.flush()

    for row in payload.rows:
        db.add(ExternalLicense(
            app_name=app_name,
            sno=row.sno,
            description=row.description,
            team=row.team,
            unit_cost_pa=Decimal(str(row.unit_cost_pa)),
            unit_cost_pm=Decimal(str(row.unit_cost_pm)),
            dc_units=Decimal(str(row.dc_units)),
            dr_units=Decimal(str(row.dr_units)),
            uat_units=Decimal(str(row.uat_units)),
        ))
    await db.commit()
    return {"saved": len(payload.rows)}
