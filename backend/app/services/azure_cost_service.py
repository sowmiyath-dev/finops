import io
import csv
import json
import logging
from datetime import date
from typing import Optional
from app.models.db_models import ControlTower
from app.services.azure_session import get_blob_service_client

logger = logging.getLogger(__name__)


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


def _parse_azure_row(row: dict, start: date, end: date) -> Optional[dict]:
    """Parse a single Azure cost export row."""
    # Date column can be "Date" or "UsageDateTime"
    date_str = row.get("Date") or row.get("UsageDateTime") or row.get("date") or ""
    if not date_str:
        return None

    # Handle both YYYY-MM-DD and MM/DD/YYYY formats
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

    # Parse tags - Azure stores as JSON string or key:value pairs
    tags_raw = row.get("Tags") or row.get("tags") or ""
    tags = None
    if tags_raw and tags_raw != "{}":
        try:
            if tags_raw.startswith("{"):
                tags_dict = json.loads(tags_raw)
            else:
                # Handle "key1:val1,key2:val2" format
                tags_dict = dict(kv.split(":", 1) for kv in tags_raw.split(",") if ":" in kv)
            if tags_dict:
                tags = json.dumps(tags_dict)
        except (json.JSONDecodeError, ValueError):
            pass

    # Determine purchase type
    pricing_model = row.get("PricingModel") or row.get("pricingModel") or ""
    if "Reservation" in pricing_model:
        purchase_type = "Reserved"
    elif "SavingsPlan" in pricing_model or "Savings" in pricing_model:
        purchase_type = "SavingsPlan"
    elif "Spot" in pricing_model:
        purchase_type = "Spot"
    else:
        purchase_type = "OnDemand"

    # Determine if marketplace
    publisher_type = row.get("PublisherType") or row.get("publisherType") or ""
    is_marketplace = "marketplace" in publisher_type.lower()

    charge_type = row.get("ChargeType") or row.get("chargeType") or "Usage"

    return {
        "date": row_date,
        "aws_account_id": row.get("SubscriptionId") or row.get("subscriptionId") or "",
        "account_name": row.get("SubscriptionName") or row.get("subscriptionName") or "",
        "service": row.get("ServiceName") or row.get("MeterCategory") or row.get("serviceName") or "Unknown",
        "region": row.get("ResourceLocation") or row.get("resourceLocation") or "global",
        "resource_id": row.get("ResourceId") or row.get("resourceId") or None,
        "usage_type": row.get("MeterSubCategory") or row.get("meterSubCategory") or None,
        "operation": row.get("MeterName") or row.get("meterName") or None,
        "blended_cost": cost,
        "unblended_cost": cost,
        "net_unblended_cost": cost,
        "amortized_cost": cost,
        "usage_quantity": float(row.get("Quantity") or row.get("quantity") or 0),
        "usage_unit": row.get("UnitOfMeasure") or row.get("unitOfMeasure") or "",
        "purchase_type": purchase_type,
        "line_item_type": charge_type,
        "is_marketplace": is_marketplace,
        "tags": tags,
    }


def stream_azure_cost_batches(ct: ControlTower, blob_name: str, start_date: str, end_date: str, batch_size: int = 5000):
    """Stream-parse an Azure cost CSV blob and yield batches."""
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    batch = []

    try:
        blob_client = get_blob_service_client(ct)
        container = blob_client.get_container_client(ct.azure_container_name)
        blob = container.get_blob_client(blob_name)

        logger.info(f"Streaming Azure blob: {blob_name}")
        download = blob.download_blob()
        content = download.readall().decode("utf-8")

        reader = csv.DictReader(io.StringIO(content))
        for row in reader:
            try:
                parsed = _parse_azure_row(row, start, end)
                if parsed:
                    batch.append(parsed)
                    if len(batch) >= batch_size:
                        yield batch
                        batch = []
            except Exception as e:
                logger.debug(f"Skipping Azure row: {e}")

        if batch:
            yield batch

        logger.info(f"Finished streaming Azure blob: {blob_name}")

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
    """Find Azure cost export blobs.
    - First sync: reads from historical directories (export_name-actual, export_name-amortized)
    - Daily sync: reads from daily export directories under export_name/
    """
    blob_client = get_blob_service_client(ct)
    container = blob_client.get_container_client(ct.azure_container_name)
    base = ct.azure_export_name  # e.g. "finoptix"
    csv_blobs: list[str] = []

    if is_first_sync:
        # Historical paths: finoptix-actual/ and finoptix-amortized/
        for prefix in [f"{base}-actual/", f"{base}-amortized/"]:
            blobs = list(container.list_blobs(name_starts_with=prefix))
            csv_blobs += [b.name for b in blobs if b.name.endswith(".csv")]
            logger.info(f"Historical prefix '{prefix}': found {len([b for b in blobs if b.name.endswith('.csv')])} CSVs")
    else:
        # Daily paths: finoptix/finoptixs-Cost-export-actual/ and finoptix/finoptixs-cost-export-amortized/
        for prefix in [
            f"{base}/{base}s-Cost-export-actual/",
            f"{base}/{base}s-cost-export-amortized/",
            f"{base}/{base}s-Cost-export-amortized/",
            f"{base}/",  # fallback — scan entire base directory
        ]:
            blobs = list(container.list_blobs(name_starts_with=prefix))
            found = [b.name for b in blobs if b.name.endswith(".csv")]
            if found:
                csv_blobs += found
                logger.info(f"Daily prefix '{prefix}': found {len(found)} CSVs")
                break  # stop at first prefix that has files

    # Deduplicate
    csv_blobs = list(set(csv_blobs))
    logger.info(f"Total Azure CSV blobs for {ct.name} ({'first' if is_first_sync else 'daily'} sync): {len(csv_blobs)}")
    return csv_blobs
