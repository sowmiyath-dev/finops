import logging
from azure.identity import ClientSecretCredential
from azure.storage.blob import BlobServiceClient
from app.models.db_models import ControlTower
from app.services.crypto_service import decrypt

logger = logging.getLogger(__name__)


def get_azure_credential(ct: ControlTower) -> ClientSecretCredential:
    return ClientSecretCredential(
        tenant_id=ct.azure_tenant_id,
        client_id=ct.azure_client_id,
        client_secret=decrypt(ct.encrypted_azure_client_secret),
    )


def get_blob_service_client(ct: ControlTower) -> BlobServiceClient:
    credential = get_azure_credential(ct)
    account_url = f"https://{ct.azure_storage_account}.blob.core.windows.net"
    return BlobServiceClient(account_url=account_url, credential=credential)


def test_azure_connectivity(ct: ControlTower) -> tuple[bool, str]:
    """Test Azure connectivity by just authenticating — no blob listing."""
    try:
        credential = get_azure_credential(ct)
        # Just get a token to verify credentials work — fast, no network blob listing
        token = credential.get_token("https://storage.azure.com/.default")
        if token and token.token:
            return True, ct.azure_tenant_id
        return False, "Could not obtain token"
    except Exception as e:
        return False, str(e)


def list_azure_subscriptions(ct: ControlTower) -> list[dict]:
    """List Azure subscriptions using the Management API."""
    try:
        from azure.mgmt.subscription import SubscriptionClient
        credential = get_azure_credential(ct)
        sub_client = SubscriptionClient(credential)
        subs = []
        for sub in sub_client.subscriptions.list():
            if sub.state and sub.state.value == "Enabled":
                subs.append({
                    "aws_account_id": sub.subscription_id,  # reuse field
                    "account_name": sub.display_name,
                })
        return subs
    except Exception as e:
        logger.warning(f"Could not list Azure subscriptions: {e}")
        return []
