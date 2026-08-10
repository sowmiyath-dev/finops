import io
import csv
import json
import logging
import subprocess
from datetime import date, datetime, timezone, timedelta
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


def stream_azure_cost_batches(ct: ControlTower, blob_name: str, start_date: str, end_date: str, batch_size: int = 500, container_name: str = None):
    """Stream-parse an Azure cost CSV blob line by line to avoid OOM."""
    import gzip as _gzip
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    cost_type = "amortized" if "amortized" in blob_name.lower() else "actual"
    batch = []

    try:
        blob_client = get_blob_service_client(ct)
        container = blob_client.get_container_client(container_name or ct.azure_container_name)
        blob_obj = container.get_blob_client(blob_name)

        logger.info(f"Streaming Azure blob: {blob_name}")

        stream = blob_obj.download_blob()
        leftover = b""
        header_line = None
        delimiter = None
        fieldnames = None
        row_count = 0

        # For .gz files, decompress the full content then iterate lines
        if blob_name.endswith(".gz"):
            raw = stream.readall()
            lines = _gzip.decompress(raw).split(b"\n")
            chunks_iter = [b"\n".join(lines)]
        else:
            chunks_iter = stream.chunks()

        for chunk in chunks_iter:
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


def _get_month_folder_variants(month_start: date) -> list[str]:
    """Return all possible Azure export folder name variants for a given month."""
    if month_start.month == 12:
        next_month = month_start.replace(year=month_start.year + 1, month=1, day=1)
    else:
        next_month = month_start.replace(month=month_start.month + 1, day=1)
    month_end_inclusive = next_month - timedelta(days=1)
    # Azure uses either YYYYMMDD-YYYYMMDD (end-inclusive) or YYYYMMDD-YYYYMMDD (next month start)
    return [
        f"{month_start.strftime('%Y%m%d')}-{month_end_inclusive.strftime('%Y%m%d')}",
        f"{month_start.strftime('%Y%m%d')}-{next_month.strftime('%Y%m%d')}",
    ]


def get_full_month_range_for_dates(start_date: str, end_date: str) -> tuple[date, date]:
    """Expand a date range to cover full calendar months — used for delete+reinsert."""
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    full_start = start.replace(day=1)
    if end.month == 12:
        full_end = end.replace(year=end.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        full_end = end.replace(month=end.month + 1, day=1) - timedelta(days=1)
    return full_start, full_end


def find_azure_export_blobs(ct: ControlTower, start_date: str, end_date: str, is_first_sync: bool = False) -> list[tuple[str, str]]:
    """Find all Azure cost export blobs covering the months in the given date range.
    Returns list of (container_name, blob_name) tuples.

    Storage account: finoptixcostexports

    Container: cost-exports
        Jan-May actual   : finoptix-actualcost/all-subs-actualcost-YYYY-MM/YYYYMMDD-YYYYMMDD/<file>.csv
        Jan-May amortized: finoptix-amortizedcost/all-subs-amortizedcost-YYYY-MM/YYYYMMDD-YYYYMMDD/<file>.csv
        Aug+ actual      : finoptix-daily-actualcost/all-subs-daily-actualcost/YYYYMMDD-YYYYMMDD/<file>.csv
        Aug+ amortized   : finoptix-daily-amortizedcost/all-subs-daily-amortizedcost/YYYYMMDD-YYYYMMDD/<file>.csv

    Container: finoptixcostexports
        Jun-Jul actual   : cost-exports/finoptix-actualcost/finoptix-actualcost-<monthname><year>/YYYYMMDD-YYYYMMDD/<file>.csv
        Jun-Jul amortized: cost-exports/finoptix-amortizedcost/finoptix-amortizedcost-<monthname><year>/YYYYMMDD-YYYYMMDD/<file>.csv
    """
    _sync_clock()
    blob_svc = get_blob_service_client(ct)
    csv_blobs: list[tuple[str, str]] = []  # (container_name, blob_name)

    export_name = ct.azure_export_name or "finoptix"
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)

    # Collect all month start dates in range
    month_starts: list[date] = []
    cur = start.replace(day=1)
    while cur <= end:
        month_starts.append(cur)
        if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1, day=1)
        else:
            cur = cur.replace(month=cur.month + 1, day=1)

    # is_daily_sync = True ONLY when scheduler triggers (is_first_sync=False AND start is current month start)
    # Manual syncs with force_start always go through full historical path
    today = date.today()
    is_daily_sync = (not is_first_sync) and (start == today.replace(day=1)) and (end == today)

    def _scan(container_name: str, prefixes: list[str]) -> list[tuple[str, str]]:
        found = []
        try:
            container = blob_svc.get_container_client(container_name)
            seen: set[str] = set()
            for prefix in prefixes:
                if prefix in seen:
                    continue
                seen.add(prefix)
                try:
                    blobs = list(container.list_blobs(name_starts_with=prefix))
                    matched = [b.name for b in blobs if b.name.endswith(".csv") or b.name.endswith(".csv.gz")]
                    if matched:
                        found += [(container_name, b) for b in matched]
                        logger.info(f"Container '{container_name}' prefix '{prefix}': {len(matched)} blob(s)")
                except Exception as e:
                    logger.warning(f"Container '{container_name}' prefix '{prefix}' failed: {e}")
        except Exception as e:
            logger.warning(f"Cannot access container '{container_name}': {e}")
        return found

    if is_daily_sync:
        # Daily sync — ONLY cost-exports container, ONLY daily paths
        # cost-exports/finoptix-daily/all-subs-daily-actualcost/YYYYMMDD-YYYYMMDD/
        # cost-exports/finoptix-daily-amortizedcost/all-subs-daily-amortizedcost/YYYYMMDD-YYYYMMDD/
        daily_prefixes = []
        for month_start in month_starts:
            for folder in _get_month_folder_variants(month_start):
                daily_prefixes += [
                    f"{export_name}-daily/all-subs-daily-actualcost/{folder}/",
                    f"{export_name}-daily-amortizedcost/all-subs-daily-amortizedcost/{folder}/",
                ]
        csv_blobs = _scan("cost-exports", daily_prefixes)
    else:
        # Full / historical sync — scan both containers
        cost_exports_prefixes = []
        finoptix_container_prefixes = []

        for month_start in month_starts:
            month_label = month_start.strftime('%Y-%m')       # e.g. 2026-06
            month_name  = month_start.strftime('%B').lower()  # e.g. june
            year        = month_start.strftime('%Y')          # e.g. 2026

            for folder in _get_month_folder_variants(month_start):
                # cost-exports container:
                # Jan-May: finoptix-actualcost/all-subs-actualcost-YYYY-MM/
                # Jan-May: finoptix-amortizedcost/all-subs-amortizedcost-YYYY-MM/
                # Aug+:    finoptix-daily/all-subs-daily-actualcost/
                # Aug+:    finoptix-daily-amortizedcost/all-subs-daily-amortizedcost/
                cost_exports_prefixes += [
                    f"{export_name}-actualcost/all-subs-actualcost-{month_label}/{folder}/",
                    f"{export_name}-amortizedcost/all-subs-amortizedcost-{month_label}/{folder}/",
                    f"{export_name}-daily/all-subs-daily-actualcost/{folder}/",
                    f"{export_name}-daily-amortizedcost/all-subs-daily-amortizedcost/{folder}/",
                ]
                # finoptixcostexports container:
                # Jun-Jul: cost-exports/finoptix-actualcost/finoptix-actualcost-june2026/
                # Jun-Jul: cost-exports/finoptix-amortizedcost/finoptix-amortizedcost-june2026/
                finoptix_container_prefixes += [
                    f"cost-exports/{export_name}-actualcost/{export_name}-actualcost-{month_name}{year}/{folder}/",
                    f"cost-exports/{export_name}-amortizedcost/{export_name}-amortizedcost-{month_name}{year}/{folder}/",
                ]

        csv_blobs  = _scan("cost-exports", cost_exports_prefixes)
        csv_blobs += _scan("finoptixcostexports", finoptix_container_prefixes)

    # Deduplicate
    csv_blobs = list(set(csv_blobs))
    logger.info(f"Total blobs found for {start_date} to {end_date}: {len(csv_blobs)}")
    return csv_blobs
