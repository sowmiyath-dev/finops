import io
import csv
import json
import logging
import subprocess
from datetime import date, datetime, timezone
from typing import Optional
from app.models.db_models import ControlTower
from app.services.azure_session import get_blob_service_client

logger = logging.getLogger(__name__)


def _sync_clock():
    """Force NTP sync to prevent Azure Storage AuthenticationFailed due to clock drift."""
    try:
        subprocess.run(["chronyc", "makestep"], capture_output=True, timeout=5)
    except Exception:
        try:
            subprocess.run(["ntpdate", "-u", "pool.ntp.org"], capture_output=True, timeout=5)
        except Exception:
            pass  # Best effort — log will show auth error if still drifted


def _find_latest_blob(ct: ControlTower, directory: str) -> Optional[str]:
    """Find the latest CSV blob in the given export directory."""
    blob_client = get_blob_service_client(ct)
    container = blob_client.get_container_client(ct.azure_container_name)

    prefix = f"{directory}/"
    blobs = list(container.list_blobs(name_starts_with=prefix))
    csv_blobs = [b for b in blobs if b.name.endswith(".csv")]

    if not csv_blobs:
        return None

    # Sort by last_modified descending to get latest
    csv_blobs.sort(key=lambda b: b.last_modified, reverse=True)
    return csv_blobs[0].name


def _find_blobs_for_period(ct: ControlTower, billing_period: str) -> list[str]:
    """Find CSV blobs matching a billing period folder."""
    blob_client = get_blob_service_client(ct)
    container = blob_client.get_container_client(ct.azure_container_name)

    # Azure export path: export_name/export_name/YYYYMMDD-YYYYMMDD/file.csv
    prefix = f"{ct.azure_export_name}/{ct.azure_export_name}/{billing_period}"
    blobs = list(container.list_blobs(name_starts_with=prefix))
    csv_blobs = [b.name for b in blobs if b.name.endswith(".csv")]
    return csv_blobs


def _parse_azure_row(row: dict, start: date, end: date, cost_type: str = "actual") -> Optional[dict]:
    """Parse a single Azure cost export row into Azure-specific fields."""
    date_str = row.get("Date") or row.get("UsageDateTime") or row.get("date") or ""
    if not date_str:
        return None

    try:
        if "/" in date_str:
            parts = date_str.split("/")
            row_date = date(int(parts[2]), int(parts[0]), int(parts[1]))
        else:
            row_date = date.fromisoformat(date_str[:10])
    except (ValueError, IndexError):
        return None

    if row_date < start or row_date > end:
        return None

    cost = float(row.get("CostInBillingCurrency") or row.get("Cost") or row.get("PreTaxCost") or 0)

    tags_raw = row.get("Tags") or row.get("tags") or ""
    tags = None
    if tags_raw and tags_raw.strip() not in ("", "{}"):
        try:
            # Try JSON first
            if tags_raw.strip().startswith("{"):
                tags_dict = json.loads(tags_raw)
            else:
                # Azure format: "Key1": "Val1","Key2": "Val2" (no outer braces)
                tags_dict = {}
                for kv in tags_raw.split(","):
                    kv = kv.strip()
                    if ":" in kv:
                        k, v = kv.split(":", 1)
                        tags_dict[k.strip().strip('"')] = v.strip().strip('"')
            if tags_dict:
                tags = json.dumps(tags_dict)
        except Exception:
            tags = tags_raw if tags_raw else None

    pricing_model = row.get("PricingModel") or row.get("pricingModel") or "OnDemand"
    publisher_type = row.get("PublisherType") or row.get("publisherType") or ""
    is_marketplace = "marketplace" in publisher_type.lower()
    charge_type = row.get("ChargeType") or row.get("chargeType") or "Usage"

    # Extract resource name from resource ID
    resource_id = row.get("ResourceId") or row.get("resourceId") or None
    resource_name = resource_id.split("/")[-1] if resource_id else None

    return {
        "subscription_id": row.get("SubscriptionId") or row.get("subscriptionId") or "",
        "subscription_name": row.get("SubscriptionName") or row.get("subscriptionName") or "",
        "resource_group": row.get("ResourceGroup") or row.get("resourceGroup") or "",
        "resource_id": resource_id,
        "resource_name": resource_name,
        "date": row_date,
        "billing_currency": row.get("BillingCurrencyCode") or row.get("Currency") or "USD",
        "actual_cost": cost if cost_type == "actual" else 0,
        "amortized_cost": cost if cost_type == "amortized" else 0,
        "quantity": float(row.get("Quantity") or row.get("quantity") or 0),
        "unit": row.get("UnitOfMeasure") or row.get("unitOfMeasure") or "",
        "service": row.get("MeterCategory") or row.get("ServiceName") or row.get("serviceName") or "Unknown",
        "meter_subcategory": row.get("MeterSubCategory") or row.get("meterSubCategory") or None,
        "meter_name": row.get("MeterName") or row.get("meterName") or None,
        "product_name": row.get("ProductName") or row.get("productName") or None,
        "region": row.get("ResourceLocation") or row.get("resourceLocation") or "global",
        "charge_type": charge_type,
        "pricing_model": pricing_model,
        "is_marketplace": is_marketplace,
        "tags": tags,
        "cost_type": cost_type,
    }


def stream_azure_cost_batches(ct: ControlTower, blob_name: str, start_date: str, end_date: str, batch_size: int = 500):
    """Stream-parse an Azure cost CSV blob line by line to avoid OOM."""
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    cost_type = "amortized" if "amortized" in blob_name.lower() else "actual"
    batch = []

    try:
        blob_client = get_blob_service_client(ct)
        container = blob_client.get_container_client(ct.azure_container_name)
        blob_obj = container.get_blob_client(blob_name)

        logger.info(f"Streaming Azure blob: {blob_name}")

        # Download in chunks and decode line by line — never load full file
        stream = blob_obj.download_blob()
        leftover = b""
        header_line = None
        delimiter = None
        fieldnames = None
        row_count = 0

        for chunk in stream.chunks():
            data = leftover + chunk
            lines = data.split(b"\n")
            leftover = lines[-1]  # incomplete last line saved for next chunk

            for raw_line in lines[:-1]:
                try:
                    line = raw_line.decode("utf-8-sig").rstrip("\r")
                except Exception:
                    continue

                if not line.strip():
                    continue

                if header_line is None:
                    header_line = line
                    delimiter = "\t" if "\t" in line else ","
                    reader = csv.reader(io.StringIO(line), delimiter=delimiter)
                    fieldnames = next(reader)
                    logger.info(f"Delimiter: {'TAB' if delimiter == chr(9) else 'COMMA'}, Columns: {len(fieldnames)}")
                    continue

                try:
                    reader = csv.reader(io.StringIO(line), delimiter=delimiter)
                    values = next(reader)
                    if len(values) != len(fieldnames):
                        continue
                    row = dict(zip(fieldnames, values))
                    parsed = _parse_azure_row(row, start, end, cost_type)
                    if parsed:
                        batch.append(parsed)
                        row_count += 1
                        if len(batch) >= batch_size:
                            yield batch
                            batch = []
                except Exception as e:
                    logger.debug(f"Skipping row: {e}")

        # Process leftover
        if leftover:
            try:
                line = leftover.decode("utf-8-sig").rstrip("\r")
                if line.strip() and fieldnames:
                    reader = csv.reader(io.StringIO(line), delimiter=delimiter)
                    values = next(reader)
                    if len(values) == len(fieldnames):
                        row = dict(zip(fieldnames, values))
                        parsed = _parse_azure_row(row, start, end, cost_type)
                        if parsed:
                            batch.append(parsed)
            except Exception:
                pass

        if batch:
            yield batch

        logger.info(f"Finished blob: {blob_name} — {row_count} rows parsed")

    except Exception as e:
        logger.error(f"Failed to stream Azure blob {blob_name}: {e}", exc_info=True)
        if batch:
            yield batch


def get_azure_billing_periods(start_date: str, end_date: str) -> list[str]:
    """Generate billing period folder names for Azure export."""
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    periods = []
    current = start.replace(day=1)
    while current <= end:
        if current.month == 12:
            month_end = current.replace(year=current.year + 1, month=1)
        else:
            month_end = current.replace(month=current.month + 1)
        period_str = f"{current.strftime('%Y%m%d')}-{month_end.strftime('%Y%m%d')}"
        periods.append(period_str)
        current = month_end
    return periods


def find_azure_export_blobs(ct: ControlTower, start_date: str, end_date: str, is_first_sync: bool = False) -> list[str]:
    """Find Azure cost export blobs — uses export_name from CT config, not hardcoded names."""
    _sync_clock()  # Ensure clock is in sync before Azure Storage auth
    blob_client = get_blob_service_client(ct)
    container = blob_client.get_container_client(ct.azure_container_name)
    csv_blobs: list[str] = []

    export_name = ct.azure_export_name or ""

    # Build prefixes from the actual export name configured on the CT
    # Azure exports land at: <export_name>/<export_name>/YYYYMMDD-YYYYMMDD/<file>.csv
    # Daily exports land at:  <export_name>-daily-actualcost/ etc. OR same path with daily flag
    # We scan all top-level prefixes derived from the export name to be resilient
    candidate_prefixes = []
    if export_name:
        candidate_prefixes += [
            f"{export_name}/",
            f"{export_name}-actualcost/",
            f"{export_name}-amortizedcost/",
            f"{export_name}-daily-actualcost/",
            f"{export_name}-daily-amortizedcost/",
        ]
    # Always include legacy hardcoded names as fallback
    candidate_prefixes += [
        "finoptix-actualcost/",
        "finoptix-amortizedcost/",
        "finoptix-daily-actualcost/",
        "finoptix-daily-amortizedcost/",
    ]
    # Deduplicate while preserving order
    seen: set = set()
    prefixes: list = []
    for p in candidate_prefixes:
        if p not in seen:
            seen.add(p)
            prefixes.append(p)

    for prefix in prefixes:
        blobs = list(container.list_blobs(name_starts_with=prefix))
        found = [b.name for b in blobs if b.name.endswith(".csv")]
        if found:
            csv_blobs += found
            logger.info(f"Prefix '{prefix}': found {len(found)} CSVs")

    csv_blobs = list(set(csv_blobs))
    logger.info(f"Total Azure CSV blobs for {ct.name} ({'full' if is_first_sync else 'daily'} sync): {len(csv_blobs)}")
    return csv_blobs
