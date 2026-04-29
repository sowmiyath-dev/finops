import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from app.models.db_models import ControlTower
from app.services.crypto_service import decrypt


def get_boto3_session(ct: ControlTower) -> boto3.Session:
    if ct.auth_method == "keys":
        return boto3.Session(
            aws_access_key_id=ct.access_key_id,
            aws_secret_access_key=decrypt(ct.encrypted_secret_key),
        )
    elif ct.auth_method == "role":
        sts = boto3.client("sts")
        assumed = sts.assume_role(
            RoleArn=ct.role_arn,
            RoleSessionName="FinOpsCURSession",
            ExternalId=ct.external_id,
        )
        creds = assumed["Credentials"]
        return boto3.Session(
            aws_access_key_id=creds["AccessKeyId"],
            aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"],
        )
    raise ValueError("Unknown auth method")


def test_connectivity(ct: ControlTower) -> tuple[bool, str]:
    try:
        session = get_boto3_session(ct)
        sts = session.client("sts")
        identity = sts.get_caller_identity()
        return True, identity.get("Account", "")
    except (ClientError, NoCredentialsError, Exception) as e:
        return False, str(e)


def get_cost_explorer_client(ct: ControlTower):
    session = get_boto3_session(ct)
    return session.client("ce", region_name="us-east-1")


def get_organizations_client(ct: ControlTower):
    session = get_boto3_session(ct)
    return session.client("organizations", region_name="us-east-1")


def list_org_accounts(ct: ControlTower) -> list[dict]:
    """List all active accounts in the AWS Organization."""
    try:
        org = get_organizations_client(ct)
        accounts = []
        paginator = org.get_paginator("list_accounts")
        for page in paginator.paginate():
            for acc in page["Accounts"]:
                if acc["Status"] == "ACTIVE":
                    accounts.append({
                        "aws_account_id": acc["Id"],
                        "account_name": acc["Name"],
                    })
        return accounts
    except Exception as e:
        raise RuntimeError(f"Failed to list org accounts: {e}")
