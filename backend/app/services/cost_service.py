import io
import gzip
import json
import csv
import logging
from datetime import date, timedelta, timezone, time
from typing import Optional

_IST = timezone(timedelta(hours=5, minutes=30))
from app.services.aws_session import get_boto3_session
from app.models.db_models import ControlTower

logger = logging.getLogger(__name__)

COST_LAG_DAYS = 1

# Keep these line item types even if unblended+blended = 0
_KEEP_ZERO_COST_TYPES = {"Tax", "Fee", "OCBLateFee", "Credit", "Refund", "BundledDiscount"}


def get_sync_date_range(days_back: int = 7) -> tuple[str, str]:
    end = date.today() - timedelta(days=COST_LAG_DAYS)
    start = end - timedelta(days=days_back - 1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def get_full_year_date_range() -> tuple[str, str]:
    end = date.today() - timedelta(days=COST_LAG_DAYS)
    start = date(end.year, 1, 1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _get_s3_client(ct: ControlTower):
    session = get_boto3_session(ct)
    return session.client("s3", region_name="us-east-1")


def _get_latest_manifest(ct: ControlTower, billing_period: str) -> Optional[dict]:
    s3 = _get_s3_client(ct)
    bucket = ct.cur_s3_bucket
    prefix = ct.cur_s3_prefix.rstrip("/")
    parts = prefix.split("/")
    if len(parts) >= 2 and parts[-1] == parts[-2]:
        base_path = "/".join(parts[:-1])
    else:
        base_path = prefix

    billing_prefix = f"{base_path}/{billing_period}/"
    logger.info(f"Looking for manifest under: s3://{bucket}/{billing_prefix}")

    try:
        resp = s3.list_objects_v2(
            Bucket=bucket, Prefix=billing_prefix, Delimiter="/", MaxKeys=1000
        )
        subfolders = sorted(
            [p["Prefix"] for p in resp.get("CommonPrefixes", [])],
            reverse=True
        )

        if not subfolders:
            logger.warning(f"No subfolders found under {billing_prefix}")
            return None

        latest_folder = subfolders[0]
        logger.info(f"Latest timestamp folder: {latest_folder}")

        resp2 = s3.list_objects_v2(Bucket=bucket, Prefix=latest_folder, MaxKeys=50)
        manifest_keys = [
            o["Key"] for o in resp2.get("Contents", [])
            if o["Key"].endswith("-Manifest.json")
        ]

        if not manifest_keys:
            logger.warning(f"No manifest found in {latest_folder}")
            return None

        manifest_key = manifest_keys[0]
        logger.info(f"Found manifest: {manifest_key}")

        obj = s3.get_object(Bucket=bucket, Key=manifest_key)
        manifest = json.loads(obj["Body"].read().decode("utf-8"))
        logger.info(f"Loaded manifest: {manifest_key}")
        return manifest

    except Exception as e:
        logger.warning(f"Could not load manifest for period {billing_period}: {e}")
        return None


def _get_billing_periods_for_range(start_date: str, end_date: str) -> list[str]:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    periods = set()
    current = start
    while current <= end:
        period_start = current.replace(day=1)
        if period_start.month == 12:
            period_end = period_start.replace(year=period_start.year + 1, month=1)
        else:
            period_end = period_start.replace(month=period_start.month + 1)
        period_str = f"{period_start.strftime('%Y%m%d')}-{period_end.strftime('%Y%m%d')}"
        periods.add(period_str)
        current = period_end
    return sorted(list(periods))


def _parse_row(row: dict, start: date, end: date) -> Optional[dict]:
    """Parse a single CUR row. Returns None if row should be skipped."""
    usage_start = row.get("lineItem/UsageStartDate", "")
    if not usage_start:
        return None
    # Use UTC date to match AWS portal date grouping — do NOT convert to IST
    # AWS Cost Explorer groups by UTC date; converting to IST shifts rows across day boundaries
    try:
        row_date = date.fromisoformat(usage_start[:10])
    except ValueError:
        return None
    if row_date < start or row_date > end:
        return None

    line_item_type = row.get("lineItem/LineItemType", "Usage")
    unblended = float(row.get("lineItem/UnblendedCost", 0) or 0)
    blended = float(row.get("lineItem/BlendedCost", 0) or 0)

    # Skip zero-cost rows EXCEPT for Tax, Fee, OCBLateFee etc.
    if unblended == 0 and blended == 0 and line_item_type not in _KEEP_ZERO_COST_TYPES:
        return None

    tags = {}
    for col, val in row.items():
        if col.startswith("resourceTags/user:") and val:
            tags[col.replace("resourceTags/user:", "")] = val

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

    legal_entity = row.get("lineItem/LegalEntity", "")
    bill_entity = row.get("bill/BillingEntity", "")
    is_marketplace = (
        "marketplace" in legal_entity.lower() or
        "marketplace" in bill_entity.lower() or
        line_item_type == "Marketplace"
    )

    return {
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
    }


def _parse_cur_csv_gz(ct: ControlTower, report_key: str, start_date: str, end_date: str) -> list[dict]:
    s3 = _get_s3_client(ct)
    records = []
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    try:
        obj = s3.get_object(Bucket=ct.cur_s3_bucket, Key=report_key)
        with gzip.open(obj["Body"], mode="rt", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    parsed = _parse_row(row, start, end)
                    if parsed:
                        records.append(parsed)
                except Exception as e:
                    logger.debug(f"Skipping row: {e}")
        logger.info(f"Parsed {len(records)} records from {report_key}")
    except Exception as e:
        logger.error(f"Failed to parse {report_key}: {e}", exc_info=True)
    return records


def fetch_cur_from_s3(ct: ControlTower, start_date: str, end_date: str) -> list[dict]:
    if not ct.cur_s3_bucket or not ct.cur_s3_prefix:
        raise ValueError(f"CUR S3 bucket/prefix not configured for CT: {ct.name}")
    all_records = []
    billing_periods = _get_billing_periods_for_range(start_date, end_date)
    logger.info(f"Fetching CUR for CT {ct.name} | periods: {billing_periods} | range: {start_date} → {end_date}")
    for period in billing_periods:
        manifest = _get_latest_manifest(ct, period)
        if not manifest:
            logger.warning(f"No manifest for period {period}, skipping")
            continue
        report_keys = manifest.get("reportKeys", [])
        logger.info(f"Period {period}: found {len(report_keys)} CUR files")
        for key in report_keys:
            all_records.extend(_parse_cur_csv_gz(ct, key, start_date, end_date))
    logger.info(f"Total CUR records fetched for CT {ct.name}: {len(all_records)}")
    return all_records


def get_report_keys_for_period(ct: ControlTower, period: str) -> list[str]:
    manifest = _get_latest_manifest(ct, period)
    if not manifest:
        return []
    keys = manifest.get("reportKeys", [])
    logger.info(f"Period {period}: found {len(keys)} CUR files")
    return keys


def fetch_cur_single_file(ct: ControlTower, report_key: str, start_date: str, end_date: str) -> list[dict]:
    return _parse_cur_csv_gz(ct, report_key, start_date, end_date)


def stream_cur_file_batches(ct: ControlTower, report_key: str, start_date: str, end_date: str, batch_size: int = 5000):
    """Stream-parse a CUR file and yield batches of records."""
    s3 = _get_s3_client(ct)
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    batch = []

    try:
        logger.info(f"Streaming {report_key}...")
        obj = s3.get_object(Bucket=ct.cur_s3_bucket, Key=report_key)

        with gzip.open(obj["Body"], mode="rt", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    parsed = _parse_row(row, start, end)
                    if parsed:
                        batch.append(parsed)
                        if len(batch) >= batch_size:
                            yield batch
                            batch = []
                except Exception as e:
                    logger.debug(f"Skipping row: {e}")

        if batch:
            yield batch

        logger.info(f"Finished streaming {report_key}")

    except Exception as e:
        logger.error(f"Failed to stream {report_key}: {e}", exc_info=True)
        if batch:
            yield batch
