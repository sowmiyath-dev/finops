import io
import gzip
import json
import csv
import logging
from datetime import date, timedelta, timezone, time
from typing import Optional

try:
    import pyarrow.parquet as pq
    import pyarrow as pa
    _PARQUET_AVAILABLE = True
except ImportError:
    _PARQUET_AVAILABLE = False

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


_PARQUET_COL_MAP = {
    "line_item_usage_start_date":           "lineItem/UsageStartDate",
    "line_item_usage_account_id":           "lineItem/UsageAccountId",
    "line_item_product_code":               "lineItem/ProductCode",
    "line_item_usage_type":                 "lineItem/UsageType",
    "line_item_operation":                  "lineItem/Operation",
    "line_item_resource_id":                "lineItem/ResourceId",
    "line_item_line_item_type":             "lineItem/LineItemType",
    "line_item_unblended_cost":             "lineItem/UnblendedCost",
    "line_item_blended_cost":               "lineItem/BlendedCost",
    "line_item_net_unblended_cost":         "lineItem/NetUnblendedCost",
    "line_item_usage_amount":               "lineItem/UsageAmount",
    "line_item_legal_entity":               "lineItem/LegalEntity",
    "product_region":                       "product/region",
    "product_region_code":                  "product/regionCode",
    "product_product_name":                 "product/ProductName",
    "product_instance_type":                "product/instanceType",
    "product_operating_system":             "product/operatingSystem",
    "product_volume_type":                  "product/volumeType",
    "product_volume_api_name":              "product/volumeApiName",
    "product_storage_media":                "product/storageMedia",
    "pricing_unit":                         "pricing/unit",
    "reservation_subscription_id":          "reservation/SubscriptionId",
    "reservation_effective_cost":           "reservation/EffectiveCost",
    "savings_plan_savings_plan_a_r_n":      "savingsPlan/SavingsPlanARN",
    "savings_plan_savings_plan_effective_cost": "savingsPlan/SavingsPlanEffectiveCost",
    "bill_billing_entity":                  "bill/BillingEntity",
}


def _normalize_parquet_row(row: dict) -> dict:
    """Convert Parquet underscore column names to CSV slash notation."""
    normalized = {}
    for k, v in row.items():
        mapped = _PARQUET_COL_MAP.get(k)
        # Convert datetime objects to ISO string
        if hasattr(v, 'isoformat'):
            v = v.isoformat()
        if mapped:
            normalized[mapped] = str(v) if v is not None else ""
        elif k.startswith("resource_tags_user_"):
            tag_key = "resourceTags/user:" + k[len("resource_tags_user_"):]
            normalized[tag_key] = str(v) if v else ""
        else:
            normalized[k] = str(v) if v is not None else ""
    return normalized


def _parse_row(row: dict, start: date, end: date) -> Optional[dict]:
    """Parse a single CUR row (CSV or Parquet). Returns None if row should be skipped."""
    # Parquet CUR uses underscore column names; CSV uses slash notation
    # Normalize to slash notation for unified parsing
    if "line_item_usage_start_date" in row and "lineItem/UsageStartDate" not in row:
        row = _normalize_parquet_row(row)

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
        # AWS auto-managed tags (aws: prefix) — capture attachment/source info
        elif col.startswith("resourceTags/aws:") and val:
            k = col.replace("resourceTags/aws:", "aws:")
            tags[k] = val

    # Capture product-level attributes useful for resource description
    # stored under reserved keys prefixed with "__" to avoid collision with user tags
    for src_col, tag_key in (
        ("product/instanceType",    "__instanceType"),
        ("product/operatingSystem", "__os"),
        ("product/volumeType",      "__volumeType"),
        ("product/volumeApiName",   "__volumeApiName"),
        ("product/storageMedia",    "__storageMedia"),
        ("product/snapshotArchiveTier", "__snapshotTier"),
    ):
        val = row.get(src_col, "").strip()
        if val:
            tags[tag_key] = val

    # For EC2: if product/instanceType is missing, extract from lineItem/UsageType BoxUsage:TYPE
    if not tags.get("__instanceType"):
        ut = row.get("lineItem/UsageType", "")
        if ":" in ut:
            candidate = ut.split(":")[-1]
            # Only use if it looks like an instance type (e.g. m5a.large, t3.micro)
            if "." in candidate and not candidate.startswith("EBS"):
                tags["__instanceType"] = candidate

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


def _list_parquet_files_hive(ct: ControlTower, start_date: str, end_date: str) -> list[str]:
    """Discover Parquet files from Hive-partitioned CUR (no manifest).
    Supports paths like: prefix/year=2026/month=6/*.snappy.parquet
    """
    s3 = _get_s3_client(ct)
    bucket = ct.cur_s3_bucket
    prefix = _clean_prefix(ct.cur_s3_prefix)
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)

    keys = []
    # Iterate over each month in the range
    current = start.replace(day=1)
    while current <= end:
        year_prefix = f"{prefix}/year={current.year}/month={current.month}/"
        logger.info(f"Scanning Hive partition: s3://{bucket}/{year_prefix}")
        try:
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=bucket, Prefix=year_prefix):
                for obj in page.get("Contents", []):
                    if obj["Key"].endswith(".parquet") or obj["Key"].endswith(".snappy.parquet"):
                        keys.append(obj["Key"])
        except Exception as e:
            logger.warning(f"Could not list {year_prefix}: {e}")
        # Advance to next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)
    logger.info(f"Found {len(keys)} Parquet files for range {start_date} → {end_date}")
    return keys


def _parse_cur_parquet(ct: ControlTower, report_key: str, start_date: str, end_date: str) -> list[dict]:
    """Parse a CUR Parquet file from S3."""
    if not _PARQUET_AVAILABLE:
        raise RuntimeError("pyarrow is not installed. Run: pip install pyarrow")
    s3 = _get_s3_client(ct)
    records = []
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    try:
        obj = s3.get_object(Bucket=ct.cur_s3_bucket, Key=report_key)
        buf = io.BytesIO(obj["Body"].read())
        table = pq.read_table(buf)
        for batch in table.to_batches(max_chunksize=5000):
            df = batch.to_pydict()
            row_count = len(next(iter(df.values())))
            for i in range(row_count):
                row = {col: (df[col][i] if df[col][i] is not None else "") for col in df}
                try:
                    parsed = _parse_row(row, start, end)
                    if parsed:
                        records.append(parsed)
                except Exception as e:
                    logger.debug(f"Skipping row: {e}")
        logger.info(f"Parsed {len(records)} records from Parquet {report_key}")
    except Exception as e:
        logger.error(f"Failed to parse Parquet {report_key}: {e}", exc_info=True)
    return records


def stream_parquet_file_batches(ct: ControlTower, report_key: str, start_date: str, end_date: str, batch_size: int = 5000):
    """Stream-parse a CUR Parquet file and yield batches of records."""
    if not _PARQUET_AVAILABLE:
        raise RuntimeError("pyarrow is not installed. Run: pip install pyarrow")
    s3 = _get_s3_client(ct)
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    batch = []
    try:
        logger.info(f"Streaming Parquet {report_key}...")
        obj = s3.get_object(Bucket=ct.cur_s3_bucket, Key=report_key)
        buf = io.BytesIO(obj["Body"].read())
        table = pq.read_table(buf)
        for arrow_batch in table.to_batches(max_chunksize=batch_size):
            df = arrow_batch.to_pydict()
            row_count = len(next(iter(df.values())))
            for i in range(row_count):
                row = {col: (df[col][i] if df[col][i] is not None else "") for col in df}
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
        logger.info(f"Finished streaming Parquet {report_key}")
    except Exception as e:
        logger.error(f"Failed to stream Parquet {report_key}: {e}", exc_info=True)
        if batch:
            yield batch


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


def is_parquet_cur(ct: ControlTower) -> bool:
    """Returns True if this CT's CUR is Parquet/Hive-partitioned (no manifest).
    Checks prefix for 'year=' marker or ':parquet' format flag.
    Falls back to S3 probe.
    """
    prefix = (ct.cur_s3_prefix or "").rstrip("/")
    if "year=" in prefix or prefix.endswith(".parquet") or prefix.endswith(":parquet"):
        return True
    # Probe S3 for year= subfolders — indicates Hive-partitioned Parquet CUR
    try:
        s3 = _get_s3_client(ct)
        resp = s3.list_objects_v2(
            Bucket=ct.cur_s3_bucket, Prefix=prefix + "/", Delimiter="/", MaxKeys=20
        )
        for cp in resp.get("CommonPrefixes", []):
            if "year=" in cp["Prefix"]:
                logger.info(f"Detected Hive/Parquet CUR for {ct.name} via S3 probe")
                return True
    except Exception as e:
        logger.warning(f"is_parquet_cur probe failed for {ct.name}: {e}")
    return False


def _clean_prefix(prefix: str) -> str:
    """Strip format flags from prefix before using in S3 paths."""
    return prefix.rstrip("/").removesuffix(":parquet")


def fetch_cur_from_s3(ct: ControlTower, start_date: str, end_date: str) -> list[dict]:
    if not ct.cur_s3_bucket or not ct.cur_s3_prefix:
        raise ValueError(f"CUR S3 bucket/prefix not configured for CT: {ct.name}")
    all_records = []
    if is_parquet_cur(ct):
        keys = _list_parquet_files_hive(ct, start_date, end_date)
        for key in keys:
            all_records.extend(_parse_cur_parquet(ct, key, start_date, end_date))

    else:
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


def get_report_keys_for_period(ct: ControlTower, period: str, start_date: str = None, end_date: str = None) -> list[str]:
    """Returns file keys for a billing period. For Parquet/Hive CURs, uses date-based discovery."""
    parquet = is_parquet_cur(ct)
    logger.info(f"get_report_keys_for_period: CT={ct.name} prefix={ct.cur_s3_prefix} is_parquet={parquet} period={period} start={start_date} end={end_date}")
    if parquet:
        if not start_date or not end_date:
            start_date = f"{period[:4]}-{period[4:6]}-{period[6:8]}"
            end_date = f"{period[9:13]}-{period[13:15]}-{period[15:17]}"
        keys = _list_parquet_files_hive(ct, start_date, end_date)
        logger.info(f"Parquet keys found: {keys}")
        return keys
    manifest = _get_latest_manifest(ct, period)
    if not manifest:
        return []
    keys = manifest.get("reportKeys", [])
    logger.info(f"Period {period}: found {len(keys)} CUR files")
    return keys


def fetch_cur_single_file(ct: ControlTower, report_key: str, start_date: str, end_date: str) -> list[dict]:
    return _parse_cur_csv_gz(ct, report_key, start_date, end_date)


def stream_cur_file_batches(ct: ControlTower, report_key: str, start_date: str, end_date: str, batch_size: int = 5000):
    """Stream-parse a CUR file (CSV.GZ or Parquet) and yield batches of records."""
    if report_key.endswith(".parquet") or report_key.endswith(".snappy.parquet"):
        yield from stream_parquet_file_batches(ct, report_key, start_date, end_date, batch_size)
        return

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
