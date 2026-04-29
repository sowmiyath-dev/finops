import json
import logging
from datetime import date, timedelta
from typing import Optional
from app.services.aws_session import get_cost_explorer_client
from app.models.db_models import ControlTower

logger = logging.getLogger(__name__)

# Cost data is accurate up to 2 days before today
COST_LAG_DAYS = 2


def get_sync_date_range(days_back: int = 7) -> tuple[str, str]:
    """Returns (start, end) where end = today - 2 days (accurate data boundary)."""
    end = date.today() - timedelta(days=COST_LAG_DAYS)
    start = end - timedelta(days=days_back - 1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def fetch_cost_by_account(ct: ControlTower, start_date: str, end_date: str) -> list[dict]:
    """Fetch daily cost grouped by linked account + service + region + purchase type."""
    ce = get_cost_explorer_client(ct)
    records = []

    try:
        paginator_token = None
        while True:
            kwargs = dict(
                TimePeriod={"Start": start_date, "End": end_date},
                Granularity="DAILY",
                Metrics=["BlendedCost", "UnblendedCost", "NetUnblendedCost", "AmortizedCost", "UsageQuantity"],
                GroupBy=[
                    {"Type": "DIMENSION", "Key": "LINKED_ACCOUNT"},
                    {"Type": "DIMENSION", "Key": "SERVICE"},
                    {"Type": "DIMENSION", "Key": "REGION"},
                    {"Type": "DIMENSION", "Key": "PURCHASE_TYPE"},
                ],
            )
            if paginator_token:
                kwargs["NextPageToken"] = paginator_token

            resp = ce.get_cost_and_usage(**kwargs)

            for time_result in resp.get("ResultsByTime", []):
                day = time_result["TimePeriod"]["Start"]
                for group in time_result.get("Groups", []):
                    keys = group["Keys"]
                    metrics = group["Metrics"]
                    records.append({
                        "date": day,
                        "aws_account_id": keys[0] if len(keys) > 0 else "",
                        "service": keys[1] if len(keys) > 1 else "Unknown",
                        "region": keys[2] if len(keys) > 2 else "global",
                        "purchase_type": keys[3] if len(keys) > 3 else "OnDemand",
                        "blended_cost": float(metrics.get("BlendedCost", {}).get("Amount", 0)),
                        "unblended_cost": float(metrics.get("UnblendedCost", {}).get("Amount", 0)),
                        "net_unblended_cost": float(metrics.get("NetUnblendedCost", {}).get("Amount", 0)),
                        "amortized_cost": float(metrics.get("AmortizedCost", {}).get("Amount", 0)),
                        "usage_quantity": float(metrics.get("UsageQuantity", {}).get("Amount", 0)),
                        "usage_unit": metrics.get("UsageQuantity", {}).get("Unit", ""),
                        "resource_id": None,
                        "usage_type": None,
                        "operation": None,
                        "tags": None,
                    })

            paginator_token = resp.get("NextPageToken")
            if not paginator_token:
                break

    except Exception as e:
        logger.error(f"fetch_cost_by_account failed for CT {ct.name}: {e}")
        raise

    return records


def fetch_resource_costs(ct: ControlTower, aws_account_id: str, start_date: str, end_date: str) -> list[dict]:
    """Fetch resource-level costs for a specific account."""
    ce = get_cost_explorer_client(ct)
    records = []

    try:
        paginator_token = None
        while True:
            kwargs = dict(
                TimePeriod={"Start": start_date, "End": end_date},
                Granularity="DAILY",
                Metrics=["UnblendedCost", "UsageQuantity"],
                GroupBy=[
                    {"Type": "DIMENSION", "Key": "RESOURCE_ID"},
                    {"Type": "DIMENSION", "Key": "SERVICE"},
                ],
                Filter={"Dimensions": {"Key": "LINKED_ACCOUNT", "Values": [aws_account_id]}},
            )
            if paginator_token:
                kwargs["NextPageToken"] = paginator_token

            resp = ce.get_cost_and_usage_with_resources(**kwargs)

            for time_result in resp.get("ResultsByTime", []):
                day = time_result["TimePeriod"]["Start"]
                for group in time_result.get("Groups", []):
                    keys = group["Keys"]
                    metrics = group["Metrics"]
                    cost = float(metrics.get("UnblendedCost", {}).get("Amount", 0))
                    if cost == 0:
                        continue
                    records.append({
                        "date": day,
                        "aws_account_id": aws_account_id,
                        "resource_id": keys[0] if len(keys) > 0 else None,
                        "service": keys[1] if len(keys) > 1 else "Unknown",
                        "region": "global",
                        "purchase_type": "OnDemand",
                        "blended_cost": cost,
                        "unblended_cost": cost,
                        "net_unblended_cost": cost,
                        "amortized_cost": cost,
                        "usage_quantity": float(metrics.get("UsageQuantity", {}).get("Amount", 0)),
                        "usage_unit": metrics.get("UsageQuantity", {}).get("Unit", ""),
                        "usage_type": None,
                        "operation": None,
                        "tags": None,
                    })

            paginator_token = resp.get("NextPageToken")
            if not paginator_token:
                break

    except Exception as e:
        logger.warning(f"fetch_resource_costs failed for account {aws_account_id}: {e}")

    return records


def fetch_tag_costs(ct: ControlTower, tag_key: str, start_date: str, end_date: str) -> list[dict]:
    """Fetch costs grouped by a specific tag key."""
    ce = get_cost_explorer_client(ct)
    records = []

    try:
        paginator_token = None
        while True:
            kwargs = dict(
                TimePeriod={"Start": start_date, "End": end_date},
                Granularity="DAILY",
                Metrics=["UnblendedCost", "UsageQuantity"],
                GroupBy=[
                    {"Type": "DIMENSION", "Key": "LINKED_ACCOUNT"},
                    {"Type": "TAG", "Key": tag_key},
                ],
            )
            if paginator_token:
                kwargs["NextPageToken"] = paginator_token

            resp = ce.get_cost_and_usage(**kwargs)

            for time_result in resp.get("ResultsByTime", []):
                day = time_result["TimePeriod"]["Start"]
                for group in time_result.get("Groups", []):
                    keys = group["Keys"]
                    metrics = group["Metrics"]
                    tag_val = keys[1].replace(f"{tag_key}$", "") if len(keys) > 1 else ""
                    records.append({
                        "date": day,
                        "aws_account_id": keys[0] if len(keys) > 0 else "",
                        "service": "All",
                        "region": "global",
                        "purchase_type": "OnDemand",
                        "blended_cost": float(metrics.get("UnblendedCost", {}).get("Amount", 0)),
                        "unblended_cost": float(metrics.get("UnblendedCost", {}).get("Amount", 0)),
                        "net_unblended_cost": float(metrics.get("UnblendedCost", {}).get("Amount", 0)),
                        "amortized_cost": float(metrics.get("UnblendedCost", {}).get("Amount", 0)),
                        "usage_quantity": float(metrics.get("UsageQuantity", {}).get("Amount", 0)),
                        "usage_unit": "",
                        "resource_id": None,
                        "usage_type": None,
                        "operation": None,
                        "tags": json.dumps({tag_key: tag_val}),
                    })

            paginator_token = resp.get("NextPageToken")
            if not paginator_token:
                break

    except Exception as e:
        logger.warning(f"fetch_tag_costs failed for tag {tag_key}: {e}")

    return records


def fetch_available_tag_keys(ct: ControlTower) -> list[str]:
    """Return all cost allocation tag keys available in Cost Explorer."""
    try:
        ce = get_cost_explorer_client(ct)
        end = date.today() - timedelta(days=COST_LAG_DAYS)
        start = end - timedelta(days=30)
        resp = ce.list_cost_allocation_tags(
            Status="Active",
            MaxResults=200,
        )
        return [t["TagKey"] for t in resp.get("CostAllocationTags", [])]
    except Exception as e:
        logger.warning(f"fetch_available_tag_keys failed: {e}")
        return []
