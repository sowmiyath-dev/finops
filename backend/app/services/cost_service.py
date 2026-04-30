import io
import gzip
import json
import csv
import logging
from datetime import date, timedelta
from typing import Optional
from app.services.aws_session import get_boto3_session
from app.models.db_models import ControlTower

logger = logging.getLogger(__name__)

# Cost data is accurate up to 2 days before today
COST_LAG_DAYS = 2


def get_sync_date_range(days_back: int = 7) -> tuple[str, str]:
    """Returns (start, end) where end = today - 2 days (accurate data boundary)."""
    end = date.today() - timedelta(days=COST_LAG_DAYS)
    start = end - timedelta(days=days_back - 1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def get_full_year_date_range() -> tuple[str, str]:
    """Returns Jan 1 of current year to today - 2 days."""
    end = date.today() - timedelta(days=COST_LAG_DAYS)
    start = date(end.year, 1, 1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _get_s3_client(ct: ControlTower):
    session = get_boto3_session(ct)
    return session.client("s3", region_name="us-east-1")


def _get_latest_manifest(ct: ControlTower, billing_period: str) -> Optional[dict]:
    """
    Fetch the latest manifest JSON for a given billing period.
    billing_period format: YYYYMMDD-YYYYMMDD  e.g. 20260401-20260501
    """
    s3 = _get_s3_client(ct)
    bucket = ct.cur_s3_bucket
    prefix = ct.cur_s3_prefix  # e.g. rilcurmall/rilcurmall26NN

    manifest_key = f"{prefix}/{billing_period}/{prefix.split('/')[-1]}-Manifest.json"

    try:
        obj = s3.get_object(Bucket=bucket, Key=manifest_key)
        manifest = json.loads(obj["Body"].read().decode("utf-8"))
        logger.info(f"Loaded manifest: {manifest_key}")
        return manifest
    except Exception as e:
        logger.warning(f"Could not load manifest {manifest_key}: {e}")
        return None


def _get_billing_periods_for_range(start_date: str, end_date: str) -> list[str]:
    """
    Returns list of billing period folder names that cover the given date range.
    e.g. for April 2026 → ['20260401-20260501']
    """
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)

    periods = set()
    current = start
    while current <= end:
        # Billing period is first day of month to first day of next month
        period_start = current.replace(day=1)
        if period_start.month == 12:
            period_end = period_start.replace(year=period_start.year + 1, month=1)
        else:
            period_end = period_start.replace(month=period_start.month + 1)

        period_str = f"{period_start.strftime('%Y%m%d')}-{period_end.strftime('%Y%m%d')}"
        periods.add(period_str)
        # Move to next month
        current = period_end

    return sorted(list(periods))


def _parse_cur_csv_gz(ct: ControlTower, report_key: str, start_date: str, end_date: str) -> list[dict]:
    """Download and parse a single CUR CSV.GZ file from S3."""
    s3 = _get_s3_client(ct)
    records = []

    try:
        obj = s3.get_object(Bucket=ct.cur_s3_bucket, Key=report_key)
        compressed = obj["Body"].read()
        decompressed = gzip.decompress(compressed)
        content = decompressed.decode("utf-8")

        reader = csv.DictReader(io.StringIO(content))

        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)

        for row in reader:
            try:
                # Parse date from UsageStartDate
                usage_start = row.get("lineItem/UsageStartDate", "")
                if not usage_start:
                    continue
                row_date = date.fromisoformat(usage_start[:10])

                # Filter by date range
                if row_date < start or row_date > end:
                    continue

                # Skip zero cost rows
                unblended = float(row.get("lineItem/UnblendedCost", 0) or 0)
                blended = float(row.get("lineItem/BlendedCost", 0) or 0)
                if unblended == 0 and blended == 0:
                    continue

                # Extract tag columns (resourceTags/user:*)
                tags = {}
                for col, val in row.items():
                    if col.startswith("resourceTags/user:") and val:
                        tag_key = col.replace("resourceTags/user:", "")
                        tags[tag_key] = val

                # Determine purchase type
                line_item_type = row.get("lineItem/LineItemType", "Usage")
                savings_arn = row.get("savingsPlan/SavingsPlanARN", "")
                reservation_id = row.get("reservation/SubscriptionId", "")

                if savings_arn:
                    purchase_type = "SavingsPlan"
                elif reservation_id:
                    purchase_type = "Reserved"
                elif line_item_type == "Spot":
                    purchase_type = "Spot"
                else:
                    purchase_type = "OnDemand"

                # Detect marketplace
                legal_entity = row.get("lineItem/LegalEntity", "")
                bill_entity = row.get("bill/BillingEntity", "")
                is_marketplace = (
                    "marketplace" in legal_entity.lower() or
                    "marketplace" in bill_entity.lower() or
                    line_item_type == "Marketplace"
                )

                records.append({
                    "date": row_date,
                    "aws_account_id": row.get("lineItem/UsageAccountId", ""),
                    "service": row.get("lineItem/ProductCode", row.get("product/ProductName", "Unknown")),
                    "region": row.get("product/region", row.get("product/regionCode", "global")),
                    "resource_id": row.get("lineItem/ResourceId") or None,
                    "usage_type": row.get("lineItem/UsageType") or None,
                    "operation": row.get("lineItem/Operation") or None,
                    "blended_cost": blended,
                    "unblended_cost": unblended,
                    "net_unblended_cost": float(row.get("lineItem/NetUnblendedCost", 0) or 0),
                    "amortized_cost": float(
                        row.get("reservation/EffectiveCost", 0) or
                        row.get("savingsPlan/SavingsPlanEffectiveCost", 0) or
                        unblended
                    ),
                    "usage_quantity": float(row.get("lineItem/UsageAmount", 0) or 0),
                    "usage_unit": row.get("pricing/unit", ""),
                    "purchase_type": purchase_type,
                    "line_item_type": line_item_type,
                    "is_marketplace": is_marketplace,
                    "tags": json.dumps(tags) if tags else None,
                })

            except Exception as row_err:
                logger.debug(f"Skipping row due to error: {row_err}")
                continue

        logger.info(f"Parsed {len(records)} records from {report_key}")

    except Exception as e:
        logger.error(f"Failed to parse CUR file {report_key}: {e}")

    return records


def fetch_cur_from_s3(ct: ControlTower, start_date: str, end_date: str) -> list[dict]:
    """
    Main function — fetches CUR data from S3 for the given date range.
    Reads manifest to find latest CSV files, downloads and parses them.
    """
    if not ct.cur_s3_bucket or not ct.cur_s3_prefix:
        raise ValueError(f"CUR S3 bucket/prefix not configured for Control Tower: {ct.name}")

    all_records = []
    billing_periods = _get_billing_periods_for_range(start_date, end_date)

    logger.info(f"Fetching CUR for CT {ct.name} | periods: {billing_periods} | range: {start_date} → {end_date}")

    for period in billing_periods:
        manifest = _get_latest_manifest(ct, period)
        if not manifest:
            logger.warning(f"No manifest found for period {period}, skipping")
            continue

        report_keys = manifest.get("reportKeys", [])
        logger.info(f"Period {period}: found {len(report_keys)} CUR files")

        for key in report_keys:
            records = _parse_cur_csv_gz(ct, key, start_date, end_date)
            all_records.extend(records)

    logger.info(f"Total CUR records fetched for CT {ct.name}: {len(all_records)}")
    return all_records
