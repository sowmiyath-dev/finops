# FinOps AI/ML Integration — Complete Deployment Guide

## Architecture Overview

```
Browser (Next.js)
    │
    ▼
EC2 (FastAPI backend)  ──────────────────────────────────────────────────────┐
    │                                                                         │
    │  POST /ai/chat  (with cost data + question)                             │
    │  POST /ai/summary (with monthly cost data)                              │
    ▼                                                                         │
API Gateway (04-apigateway-ai)                                               │
    │                                                                         │
    ▼                                                                         │
Lambda (03-lambda-ai)                                                        │
    │                                                                         │
    ▼                                                                         │
AWS Bedrock (Claude 3 Haiku / Sonnet)  ◄─────────────────────────────────────┘
```

**Features enabled:**
- 💬 Cost Chat — ask anything about your AWS/Azure spend
- 📋 Monthly Summary — auto-generate plain-English cost reports
- 🚨 CloudWatch alarms + Bedrock budget alerts
- 🔒 IAM-secured Lambda URL + API Gateway

---

## Prerequisites

1. AWS CLI configured: `aws configure`
2. Bedrock model access enabled in `ap-south-1`:
   - Go to AWS Console → Bedrock → Model Access
   - Enable: `Claude 3 Haiku`, `Claude 3 Sonnet`, `Titan Embeddings V2`
3. CloudFormation deploy permissions

---

## Step 1 — Deploy IAM Roles

```bash
aws cloudformation deploy \
  --template-file cfts/01-iam.yaml \
  --stack-name finops-ai-iam \
  --parameter-overrides \
    Environment=prod \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-south-1
```

**Save outputs:**
```bash
aws cloudformation describe-stacks \
  --stack-name finops-ai-iam \
  --query "Stacks[0].Outputs" \
  --region ap-south-1
```

Note down:
- `BedrockInvokeRoleArn`
- `EC2BedrockRoleArn`
- `EC2InstanceProfileArn`

---

## Step 2 — Attach IAM Role to EC2 Instance

This allows your FastAPI backend to call Bedrock directly without hardcoded keys.

```bash
# Replace i-xxxxxxxxxxxxxxxxx with your EC2 instance ID
aws ec2 associate-iam-instance-profile \
  --instance-id i-xxxxxxxxxxxxxxxxx \
  --iam-instance-profile Arn=<EC2InstanceProfileArn from Step 1> \
  --region ap-south-1
```

Verify:
```bash
aws ec2 describe-iam-instance-profile-associations \
  --filters Name=instance-id,Values=i-xxxxxxxxxxxxxxxxx \
  --region ap-south-1
```

---

## Step 3 — Deploy Secrets

```bash
aws cloudformation deploy \
  --template-file cfts/02-secrets.yaml \
  --stack-name finops-ai-secrets \
  --parameter-overrides \
    Environment=prod \
    BedrockRegion=ap-south-1 \
    DefaultModelId=anthropic.claude-3-haiku-20240307-v1:0 \
    SummaryModelId=anthropic.claude-3-sonnet-20240229-v1:0 \
  --region ap-south-1
```

---

## Step 4 — Deploy Lambda

```bash
# Get BedrockInvokeRoleArn and AISecretArn from previous stacks
BEDROCK_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name finops-ai-iam \
  --query "Stacks[0].Outputs[?OutputKey=='BedrockInvokeRoleArn'].OutputValue" \
  --output text --region ap-south-1)

AI_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name finops-ai-secrets \
  --query "Stacks[0].Outputs[?OutputKey=='AISecretArn'].OutputValue" \
  --output text --region ap-south-1)

aws cloudformation deploy \
  --template-file cfts/03-lambda-ai.yaml \
  --stack-name finops-ai-lambda \
  --parameter-overrides \
    Environment=prod \
    BedrockInvokeRoleArn=$BEDROCK_ROLE_ARN \
    AISecretArn=$AI_SECRET_ARN \
    BedrockRegion=ap-south-1 \
    DefaultModelId=anthropic.claude-3-haiku-20240307-v1:0 \
    SummaryModelId=anthropic.claude-3-sonnet-20240229-v1:0 \
    LambdaTimeout=60 \
    LambdaMemorySize=512 \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-south-1
```

**Save Lambda outputs:**
```bash
aws cloudformation describe-stacks \
  --stack-name finops-ai-lambda \
  --query "Stacks[0].Outputs" \
  --region ap-south-1
```

Note down:
- `CostChatLambdaArn`
- `CostChatLambdaName`

---

## Step 5 — Deploy API Gateway

```bash
LAMBDA_ARN=$(aws cloudformation describe-stacks \
  --stack-name finops-ai-lambda \
  --query "Stacks[0].Outputs[?OutputKey=='CostChatLambdaArn'].OutputValue" \
  --output text --region ap-south-1)

LAMBDA_NAME=$(aws cloudformation describe-stacks \
  --stack-name finops-ai-lambda \
  --query "Stacks[0].Outputs[?OutputKey=='CostChatLambdaName'].OutputValue" \
  --output text --region ap-south-1)

aws cloudformation deploy \
  --template-file cfts/04-apigateway-ai.yaml \
  --stack-name finops-ai-apigw \
  --parameter-overrides \
    Environment=prod \
    CostChatLambdaArn=$LAMBDA_ARN \
    CostChatLambdaName=$LAMBDA_NAME \
    AllowOrigin=https://finoptix.novactech.in \
    ThrottlingRateLimit=50 \
    ThrottlingBurstLimit=100 \
  --region ap-south-1
```

**Get the API endpoint:**
```bash
aws cloudformation describe-stacks \
  --stack-name finops-ai-apigw \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
  --output text --region ap-south-1
```

This gives you: `https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/prod`

---

## Step 6 — Deploy Monitoring

```bash
LAMBDA_NAME=$(aws cloudformation describe-stacks \
  --stack-name finops-ai-lambda \
  --query "Stacks[0].Outputs[?OutputKey=='CostChatLambdaName'].OutputValue" \
  --output text --region ap-south-1)

API_ID=$(aws cloudformation describe-stacks \
  --stack-name finops-ai-apigw \
  --query "Stacks[0].Outputs[?OutputKey=='ApiId'].OutputValue" \
  --output text --region ap-south-1)

aws cloudformation deploy \
  --template-file cfts/05-monitoring.yaml \
  --stack-name finops-ai-monitoring \
  --parameter-overrides \
    Environment=prod \
    CostChatLambdaName=$LAMBDA_NAME \
    ApiId=$API_ID \
    AlertEmail=your-email@example.com \
    BedrockCostBudgetUSD=50 \
  --region ap-south-1
```

---

## Step 7 — Add AI config to backend .env

SSH into EC2 and add to `/home/finops/finops-cur-dashboard/backend/.env`:

```bash
# AI/ML - Bedrock
AI_ENABLED=true
BEDROCK_REGION=ap-south-1
AI_API_GATEWAY_URL=https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/prod
AI_CHAT_ENDPOINT=/ai/chat
AI_SUMMARY_ENDPOINT=/ai/summary
```

---

## Step 8 — Add AI router to FastAPI backend

Create `backend/app/routers/ai.py`:

```python
import boto3
import json
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services.auth_service import get_current_user
from app.models.db_models import User

router = APIRouter(prefix="/ai", tags=["ai"])

class ChatRequest(BaseModel):
    question: str
    cost_data: dict
    ct_id: str

class SummaryRequest(BaseModel):
    cost_data: dict
    month: str
    ct_id: str

def _invoke_lambda(payload: dict) -> str:
    client = boto3.client("lambda", region_name=os.getenv("BEDROCK_REGION", "ap-south-1"))
    # Direct Lambda invoke from EC2 using instance role — no API Gateway needed
    func_name = os.getenv("AI_LAMBDA_NAME", "finops-ai-lambda-cost-chat")
    response = client.invoke(
        FunctionName=func_name,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload),
    )
    result = json.loads(response["Payload"].read())
    body = json.loads(result.get("body", "{}"))
    if "error" in body:
        raise HTTPException(status_code=500, detail=body["error"])
    return body.get("answer", "")

@router.post("/chat")
async def cost_chat(req: ChatRequest, user: User = Depends(get_current_user)):
    if not os.getenv("AI_ENABLED", "false").lower() == "true":
        raise HTTPException(status_code=503, detail="AI features not enabled")
    answer = _invoke_lambda({
        "action": "chat",
        "question": req.question,
        "cost_data": req.cost_data,
    })
    return {"answer": answer}

@router.post("/summary")
async def cost_summary(req: SummaryRequest, user: User = Depends(get_current_user)):
    if not os.getenv("AI_ENABLED", "false").lower() == "true":
        raise HTTPException(status_code=503, detail="AI features not enabled")
    answer = _invoke_lambda({
        "action": "summary",
        "cost_data": req.cost_data,
    })
    return {"summary": answer, "month": req.month}
```

Register in `backend/app/main.py`:
```python
from app.routers import ai
app.include_router(ai.router)
```

Add to `requirements.txt`:
```
boto3>=1.34.0
```

---

## Step 9 — Rebuild and restart backend on EC2

```bash
cd /home/finops/finops-cur-dashboard
git pull origin main
docker-compose up -d --build backend
```

---

## Step 10 — Test

```bash
# Test Lambda directly
aws lambda invoke \
  --function-name finops-ai-lambda-cost-chat \
  --payload '{"action":"chat","question":"What is my top service?","cost_data":{"EC2":5000,"S3":1200,"RDS":3000}}' \
  --cli-binary-format raw-in-base64-out \
  response.json \
  --region ap-south-1

cat response.json

# Test via API Gateway
curl -X POST \
  https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/prod/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"action":"chat","question":"What is my top service?","cost_data":{"EC2":5000}}'
```

---

## Stack Summary

| Stack | Template | Purpose |
|---|---|---|
| `finops-ai-iam` | 01-iam.yaml | IAM roles for Lambda + EC2 Bedrock access |
| `finops-ai-secrets` | 02-secrets.yaml | Bedrock model config in Secrets Manager |
| `finops-ai-lambda` | 03-lambda-ai.yaml | Lambda function — chat + summary handler |
| `finops-ai-apigw` | 04-apigateway-ai.yaml | REST API Gateway with /ai/chat + /ai/summary |
| `finops-ai-monitoring` | 05-monitoring.yaml | CloudWatch alarms + Bedrock budget alert |

---

## Cost Estimate (ap-south-1)

| Service | Usage | Est. Monthly Cost |
|---|---|---|
| Bedrock Claude 3 Haiku | 1000 chat queries/month | ~$0.25 |
| Bedrock Claude 3 Sonnet | 100 summaries/month | ~$0.30 |
| Lambda | 1100 invocations × 60s × 512MB | ~$0.10 |
| API Gateway | 1100 requests | ~$0.004 |
| **Total** | | **~$0.65/month** |

---

## Teardown (if needed)

```bash
aws cloudformation delete-stack --stack-name finops-ai-monitoring --region ap-south-1
aws cloudformation delete-stack --stack-name finops-ai-apigw --region ap-south-1
aws cloudformation delete-stack --stack-name finops-ai-lambda --region ap-south-1
aws cloudformation delete-stack --stack-name finops-ai-secrets --region ap-south-1
aws cloudformation delete-stack --stack-name finops-ai-iam --region ap-south-1
```
