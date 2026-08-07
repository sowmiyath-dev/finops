# Finoptix AI Chatbot — Complete Guide
# Document Date: 2026

---

## 1. What Is the Finoptix AI Chatbot?

The Finoptix AI Chatbot is an intelligent cost assistant built directly into the Finoptix
FinOps platform. It uses AWS Bedrock (Claude 3 by Anthropic) to let users ask plain-English
questions about their AWS and Azure cloud costs and get instant, data-driven answers.

Instead of manually navigating reports and filters, users simply type a question like
"Why did my bill spike in August?" and the AI reads your actual cost data from the database
and answers in plain English with specific numbers.

The AI never has direct access to your database. Your FastAPI backend fetches the relevant
cost data, formats it, and sends it to the AI. The AI only sees what you give it.
Your data never leaves your AWS account.

---

## 2. What the Chatbot Can Do

### 2.1 Cost Chat
Users ask any question about their cloud spend. The backend fetches relevant data
from PostgreSQL and sends it to Claude 3 Haiku via AWS Bedrock Lambda.

Example questions and answers:

  Question: "Which service cost the most this month?"
  Answer:   "EC2 was your top service at Rs.3,24,500 (38% of total spend in August)"

  Question: "Why did my bill increase in August?"
  Answer:   "August spend was Rs.8.4L, up 23% from July. Main drivers:
             - EC2 increased Rs.1.2L — 3 new instances launched on Aug 5
             - RDS increased Rs.45,000 — storage auto-scaled
             - S3 stayed flat at Rs.92,000"

  Question: "Which account is spending the most?"
  Answer:   "Account prod-workloads (123456789) spent Rs.5.1L this month,
             60% of your total AWS spend"

  Question: "Compare my AWS vs Azure spend this quarter"
  Answer:   "Q3 total: AWS Rs.24.3L, Azure Rs.8.7L. AWS is 74% of total.
             Azure grew 12% vs Q2, AWS grew 8%"

  Question: "Which region is most expensive?"
  Answer:   "ap-south-1 (Mumbai) accounts for 71% of your EC2 spend at Rs.2.3L"

  Question: "Show me idle resources"
  Answer:   "Based on your data, EC2 usage drops 85% on weekends for 3 instances.
             Estimated savings with scheduled stop: Rs.18,000/month"

### 2.2 Monthly Summary Report
One click generates a full plain-English executive report for any month.

  Example output for August 2025:

  Total Spend: Rs.8,42,300 (up 23% vs July)

  Top Cost Drivers:
  - EC2: Rs.3,24,500 (38%) — up 31% vs July
  - RDS: Rs.1,85,000 (22%) — up 8% vs July
  - S3: Rs.92,000 (11%) — flat

  Accounts Over Budget:
  - prod-workloads: Rs.5.1L (budget Rs.4L)

  Recommendations:
  - 2 EC2 instances running 24/7 with less than 10% weekend usage
    Scheduled stop saves approximately Rs.18,000/month
  - 3 unattached EBS volumes costing Rs.4,200/month — delete if unused
  - S3 bucket finops-logs has no lifecycle policy — 180GB older than 1 year

---

## 3. Use Cases

### Use Case 1 — Finance Team Monthly Review
  Who:    Finance manager
  Action: Opens Finoptix, clicks AI Chat, types "Give me August cost summary"
  Result: Gets a full executive report in 5 seconds instead of building it manually

### Use Case 2 — DevOps Engineer Investigating a Spike
  Who:    DevOps engineer
  Action: Sees cost spike in dashboard, asks "Why did EC2 cost jump on Aug 12?"
  Result: AI identifies the specific accounts and services that spiked on that date

### Use Case 3 — Cost Allocation by Team
  Who:    Engineering manager
  Action: Asks "How much did the Lending vertical spend last month?"
  Result: AI reads vertical cost data and breaks it down by owner and application

### Use Case 4 — Optimization Review
  Who:    Cloud architect
  Action: Asks "Which resources look idle or underutilized?"
  Result: AI identifies patterns like weekend usage drops, unattached volumes, etc.

### Use Case 5 — Multi-Cloud Comparison
  Who:    CTO or VP Engineering
  Action: Asks "Compare our AWS and Azure spend for Q3"
  Result: AI reads both cost_records and azure_cost_records and gives a comparison

### Use Case 6 — Account-Level Drill Down
  Who:    Account owner
  Action: Asks "What is SFL-PROD spending on RDS this month?"
  Result: AI filters by account and service and gives the exact number

### Use Case 7 — Budget Tracking
  Who:    Finance team
  Action: Asks "Which accounts exceeded their budget this month?"
  Result: AI compares actual spend against configured budgets and lists overages

---

## 4. How It Works — Full Workflow

### Step-by-Step Flow

  1. User opens the Finoptix dashboard at https://finoptix.novactech.in
  2. User clicks the AI Chat icon (bottom right of dashboard)
  3. User types a question in the chat panel
  4. Frontend sends POST /api/ai/chat with { question, ct_id, month }
  5. FastAPI backend receives the request
  6. Backend queries PostgreSQL for relevant cost data based on the question context
     Example query:
       SELECT service, SUM(unblended_cost) as total
       FROM cost_records
       WHERE control_tower_id = ct_id
       AND date >= '2025-08-01' AND date <= '2025-08-31'
       GROUP BY service ORDER BY total DESC LIMIT 10
  7. Backend builds a cost_data dictionary: { EC2: 324500, RDS: 185000, S3: 92000 }
  8. Backend calls AWS Lambda (finops-ai-lambda-cost-chat) via boto3 using EC2 instance role
  9. Lambda receives { action: "chat", question: "...", cost_data: {...} }
  10. Lambda builds the Claude prompt:
        System: "You are a FinOps AI assistant. Answer questions about cloud costs
                 based only on the data provided. Be concise and specific.
                 Format currency in INR with commas."
        User:   "Cost data: { EC2: 324500, RDS: 185000, S3: 92000 }
                 Question: Which service cost the most this month?"
  11. Lambda calls AWS Bedrock — Claude 3 Haiku model
  12. Claude reads the data and question, generates the answer
  13. Lambda returns the answer text to FastAPI backend
  14. FastAPI returns { answer: "EC2 was your top service at Rs.3,24,500..." }
  15. Frontend displays the answer in the chat panel

### Architecture Diagram

  Browser (Next.js UI)
       |
       | POST /api/ai/chat
       |
       v
  EC2 FastAPI Backend
       |
       | 1. Query PostgreSQL for cost data
       | 2. Build cost_data dict
       | 3. boto3 lambda.invoke() using EC2 IAM instance role
       |
       v
  AWS Lambda (finops-ai-lambda-cost-chat)
       |
       | bedrock:InvokeModel
       |
       v
  AWS Bedrock — Claude 3 Haiku (chat) / Claude 3 Sonnet (summary)
       |
       | answer text
       |
       v
  Lambda returns answer to FastAPI
       |
       v
  FastAPI returns JSON to Frontend
       |
       v
  Chat panel shows answer to user

### Models Used

  Chat queries    : Claude 3 Haiku  — fast, cheap, good for Q&A
  Monthly summary : Claude 3 Sonnet — smarter, better for long reports
  Region          : ap-south-1 (Mumbai)

---

## 5. Enhancement Ideas

### 5.1 Anomaly Detection and Explanation
  What:  Automatically detect unusual cost spikes and explain them
  How:   Run a nightly job comparing daily spend to 30-day average
         If spend is more than 2x average, trigger AI to explain it
  Value: Proactive alerts instead of users discovering spikes manually

### 5.2 Cost Forecasting
  What:  Predict next month spend based on historical trends
  How:   Send last 6 months of monthly totals to Claude
         Ask it to project next month with reasoning
  Value: Finance team can plan budgets more accurately

### 5.3 Optimization Recommendations Engine
  What:  Weekly AI-generated list of cost saving opportunities
  How:   Analyze usage patterns — weekend drops, unattached volumes,
         reserved instance coverage gaps, S3 lifecycle gaps
  Value: Actionable savings without manual analysis

### 5.4 Natural Language to SQL (Text2SQL)
  What:  User asks any question, AI writes the DB query and runs it
  How:   Send DB schema to Claude, ask it to generate SQL for the question
         Backend executes the SQL safely and returns results
  Value: Non-technical users can query cost data without knowing SQL

### 5.5 Automated Weekly Email Report
  What:  Every Monday, send each CT owner a cost summary email
  How:   Worker job runs weekly, calls AI summary endpoint per CT,
         formats as HTML email, sends via SES
  Value: Stakeholders get cost visibility without logging in

### 5.6 Budget Alert Explanation
  What:  When a budget alert fires, AI explains why the budget was exceeded
  How:   CloudWatch alarm triggers Lambda, Lambda fetches cost data,
         calls Bedrock to generate explanation, sends via SNS email
  Value: Alerts with context instead of just a number

### 5.7 Multi-Turn Conversation
  What:  Chat remembers previous messages in the session
  How:   Frontend maintains conversation history array,
         sends full history with each request to Lambda
  Value: Users can ask follow-up questions naturally

### 5.8 PDF Report Export
  What:  Download the AI-generated monthly summary as a PDF
  How:   Backend renders the AI response as HTML, converts to PDF using weasyprint
  Value: Finance team can share reports externally

---

## 6. AWS Resources Created by CFTs

### Stack 1 — finops-ai-iam (01-iam.yaml)
  Resources created:
  - BedrockInvokeRole     : IAM role for Lambda to call Bedrock and Secrets Manager
  - EC2BedrockRole        : IAM role for EC2 instance to call Lambda and Bedrock
  - EC2InstanceProfile    : Instance profile to attach EC2BedrockRole to the EC2

### Stack 2 — finops-ai-secrets (02-secrets.yaml)
  Resources created:
  - FinOpsAISecret        : Secrets Manager secret at finops/prod/ai-config
                            Stores model IDs, temperature, system prompts

### Stack 3 — finops-ai-lambda (03-lambda-ai.yaml)
  Resources created:
  - CostChatLambda        : Python 3.11 Lambda function with inline handler
                            Handles both chat and summary actions
                            Calls Bedrock Claude 3 Haiku or Sonnet
  - CostChatLambdaLogGroup: CloudWatch log group with 30-day retention
  - CostChatLambdaUrl     : Lambda function URL with IAM auth and CORS

### Stack 4 — finops-ai-apigw (04-apigateway-ai.yaml)
  Resources created:
  - FinOpsAIRestApi       : Regional REST API Gateway
  - AiResource            : /ai path resource
  - ChatResource          : /ai/chat path resource
  - ChatMethod            : POST /ai/chat — proxies to Lambda
  - ChatOptionsMethod     : OPTIONS /ai/chat — CORS preflight
  - SummaryResource       : /ai/summary path resource
  - SummaryMethod         : POST /ai/summary — proxies to Lambda
  - SummaryOptionsMethod  : OPTIONS /ai/summary — CORS preflight
  - ChatLambdaPermission  : Allows API Gateway to invoke Lambda
  - ApiDeployment         : API Gateway deployment
  - ApiStage              : prod stage with throttling and metrics

### Stack 5 — finops-ai-monitoring (05-monitoring.yaml)
  Resources created:
  - AIAlertTopic          : SNS topic for all AI alerts
  - AIAlertEmailSubscription : Email subscription to SNS topic
  - LambdaErrorAlarm      : Fires when Lambda errors >= 5 in 5 minutes
  - LambdaThrottleAlarm   : Fires when Lambda throttles >= 10 in 5 minutes
  - LambdaDurationAlarm   : Fires when p95 duration >= 45 seconds
  - Api5xxAlarm           : Fires when API Gateway 5XX errors >= 5 in 5 minutes
  - BedrockBudget         : Monthly Bedrock spend budget with 80% and 100% alerts
  - AIMonitoringDashboard : CloudWatch dashboard with Lambda and API metrics

---

## 7. Pre-Deployment — AWS Console Steps

These steps must be done manually in the AWS Console before running any CFT.

### Step 1 — Enable Bedrock Model Access

  1. Open AWS Console
  2. Search for "Bedrock" in the search bar
  3. Click "Amazon Bedrock"
  4. In the left menu click "Model access"
  5. Click "Modify model access" button (top right)
  6. Check the following models:
       Anthropic section:
         - Claude 3 Haiku    (for chat — fast and cheap)
         - Claude 3 Sonnet   (for monthly summaries — more detailed)
       Amazon section:
         - Titan Embeddings V2 (for future knowledge base use)
  7. Click "Save changes"
  8. Wait 2 to 5 minutes
  9. Refresh the page — status should show "Access granted" for all three
  10. Make sure you are in region: ap-south-1 (Mumbai)

  Note: If you do not see ap-south-1 in the region dropdown for Bedrock,
  Claude 3 models may not be available there yet. In that case use us-east-1
  and update BedrockRegion parameter in all CFT deployments.

### Step 2 — Verify AWS CLI Access

  Run this on your local machine:
    aws sts get-caller-identity
    aws configure get region

  The region should return ap-south-1.
  The caller identity should show your AWS account ID.

---

## 8. Complete Deployment Guide

### Prerequisites
  - AWS CLI installed and configured (aws configure)
  - CloudFormation deploy permissions in your AWS account
  - Git installed on local machine
  - EC2 instance ID of the Finoptix server (format: i-xxxxxxxxxxxxxxxxx)
  - Bedrock model access enabled (see Section 7 above)

---

### Stack 1 — Deploy IAM Roles

  aws cloudformation deploy \
    --template-file cfts/01-iam.yaml \
    --stack-name finops-ai-iam \
    --parameter-overrides Environment=prod \
    --capabilities CAPABILITY_NAMED_IAM \
    --region ap-south-1

  After deploy, get the outputs:
    aws cloudformation describe-stacks \
      --stack-name finops-ai-iam \
      --query "Stacks[0].Outputs" \
      --region ap-south-1

  Save these values:
    BedrockInvokeRoleArn   — used in Stack 3
    EC2InstanceProfileArn  — used to attach to EC2

---

### Attach IAM Role to EC2 Instance

  Replace i-xxxxxxxxxxxxxxxxx with your actual EC2 instance ID.

  PROFILE_ARN=$(aws cloudformation describe-stacks \
    --stack-name finops-ai-iam \
    --query "Stacks[0].Outputs[?OutputKey=='EC2InstanceProfileArn'].OutputValue" \
    --output text --region ap-south-1)

  aws ec2 associate-iam-instance-profile \
    --instance-id i-xxxxxxxxxxxxxxxxx \
    --iam-instance-profile Arn=$PROFILE_ARN \
    --region ap-south-1

  Verify it worked:
    aws ec2 describe-iam-instance-profile-associations \
      --filters Name=instance-id,Values=i-xxxxxxxxxxxxxxxxx \
      --region ap-south-1

  This allows the FastAPI backend on EC2 to call Lambda and Bedrock
  without any hardcoded AWS keys.

---

### Stack 2 — Deploy Secrets

  aws cloudformation deploy \
    --template-file cfts/02-secrets.yaml \
    --stack-name finops-ai-secrets \
    --parameter-overrides \
      Environment=prod \
      BedrockRegion=ap-south-1 \
      DefaultModelId=anthropic.claude-3-haiku-20240307-v1:0 \
      SummaryModelId=anthropic.claude-3-sonnet-20240229-v1:0 \
    --region ap-south-1

  After deploy, get the secret ARN:
    aws cloudformation describe-stacks \
      --stack-name finops-ai-secrets \
      --query "Stacks[0].Outputs[?OutputKey=='AISecretArn'].OutputValue" \
      --output text --region ap-south-1

---

### Stack 3 — Deploy Lambda

  BEDROCK_ROLE=$(aws cloudformation describe-stacks \
    --stack-name finops-ai-iam \
    --query "Stacks[0].Outputs[?OutputKey=='BedrockInvokeRoleArn'].OutputValue" \
    --output text --region ap-south-1)

  SECRET_ARN=$(aws cloudformation describe-stacks \
    --stack-name finops-ai-secrets \
    --query "Stacks[0].Outputs[?OutputKey=='AISecretArn'].OutputValue" \
    --output text --region ap-south-1)

  aws cloudformation deploy \
    --template-file cfts/03-lambda-ai.yaml \
    --stack-name finops-ai-lambda \
    --parameter-overrides \
      Environment=prod \
      BedrockInvokeRoleArn=$BEDROCK_ROLE \
      AISecretArn=$SECRET_ARN \
      BedrockRegion=ap-south-1 \
      DefaultModelId=anthropic.claude-3-haiku-20240307-v1:0 \
      SummaryModelId=anthropic.claude-3-sonnet-20240229-v1:0 \
      LambdaTimeout=60 \
      LambdaMemorySize=512 \
    --capabilities CAPABILITY_NAMED_IAM \
    --region ap-south-1

  After deploy, get Lambda name:
    aws cloudformation describe-stacks \
      --stack-name finops-ai-lambda \
      --query "Stacks[0].Outputs" \
      --region ap-south-1

  Save these values:
    CostChatLambdaArn   — used in Stack 4
    CostChatLambdaName  — used in Stack 4 and Stack 5

---

### Stack 4 — Deploy API Gateway

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

  After deploy, get the API endpoint URL:
    aws cloudformation describe-stacks \
      --stack-name finops-ai-apigw \
      --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
      --output text --region ap-south-1

  This gives you: https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/prod
  Save this URL — you will need it for the backend .env file.

---

### Stack 5 — Deploy Monitoring

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
      AlertEmail=sowmiya_th@novactech.in \
      BedrockCostBudgetUSD=50 \
    --region ap-south-1

---

### Backend Integration — Add AI Router

  Create file: backend/app/routers/ai.py

    import boto3, json, os
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel
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
        if os.getenv("AI_ENABLED", "false").lower() != "true":
            raise HTTPException(status_code=503, detail="AI features not enabled")
        answer = _invoke_lambda({"action": "chat", "question": req.question, "cost_data": req.cost_data})
        return {"answer": answer}

    @router.post("/summary")
    async def cost_summary(req: SummaryRequest, user: User = Depends(get_current_user)):
        if os.getenv("AI_ENABLED", "false").lower() != "true":
            raise HTTPException(status_code=503, detail="AI features not enabled")
        answer = _invoke_lambda({"action": "summary", "cost_data": req.cost_data})
        return {"summary": answer, "month": req.month}

  Register in backend/app/main.py — add these two lines:
    from app.routers import ai
    app.include_router(ai.router)

  Add to backend/requirements.txt:
    boto3>=1.34.0

---

### Update Backend .env on EC2

  SSH into EC2:
    ssh finops@<your-ec2-ip>
    cd /home/finops/finops-cur-dashboard

  Add these lines to backend/.env:
    AI_ENABLED=true
    BEDROCK_REGION=ap-south-1
    AI_LAMBDA_NAME=finops-ai-lambda-cost-chat
    AI_API_GATEWAY_URL=https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/prod

---

### Pull and Rebuild on EC2

  cd /home/finops/finops-cur-dashboard
  git pull origin main
  docker-compose up -d --build backend

---

### Smoke Test

  Test Lambda directly from AWS CLI:
    aws lambda invoke \
      --function-name finops-ai-lambda-cost-chat \
      --payload '{"action":"chat","question":"What is my top service?","cost_data":{"EC2":324500,"RDS":185000,"S3":92000}}' \
      --cli-binary-format raw-in-base64-out \
      --region ap-south-1 \
      response.json

    cat response.json

  Expected output:
    {"statusCode": 200, "body": "{\"answer\": \"EC2 was your top service at Rs.3,24,500...\"}"}

  Test via API Gateway:
    curl -X POST \
      https://xxxxxxxxxx.execute-api.ap-south-1.amazonaws.com/prod/ai/chat \
      -H "Content-Type: application/json" \
      -d '{"action":"chat","question":"What is my top service?","cost_data":{"EC2":324500}}'

  Test via FastAPI backend:
    curl -X POST \
      https://finoptix.novactech.in/api/ai/chat \
      -H "Authorization: Bearer YOUR_JWT_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"question":"What is my top service?","cost_data":{"EC2":324500},"ct_id":"your-ct-id"}'

---

## 9. Stack Deployment Order Summary

  Order   Stack Name              Template              What It Creates
  ------  ----------------------  --------------------  ----------------------------------------
  1       finops-ai-iam           01-iam.yaml           IAM roles for Lambda and EC2
  2       EC2 profile attach      (CLI command)         Attach IAM role to EC2 instance
  3       finops-ai-secrets       02-secrets.yaml       Secrets Manager with model config
  4       finops-ai-lambda        03-lambda-ai.yaml     Lambda function with Bedrock handler
  5       finops-ai-apigw         04-apigateway-ai.yaml REST API Gateway endpoints
  6       finops-ai-monitoring    05-monitoring.yaml    CloudWatch alarms and budget alerts
  7       Backend code update     ai.py + main.py       FastAPI AI router
  8       EC2 .env update         backend/.env          Enable AI feature flag
  9       EC2 rebuild             docker-compose        Restart backend with new code

---

## 10. Cost Estimate

  Service                           Usage per Month         Estimated Cost (USD)
  --------------------------------  ----------------------  --------------------
  Bedrock Claude 3 Haiku            1000 chat queries       $0.25
  Bedrock Claude 3 Sonnet           100 monthly summaries   $0.30
  Lambda invocations + duration     1100 x 60s x 512MB      $0.10
  API Gateway requests              1100 requests           $0.004
  Secrets Manager                   1 secret                $0.40
  CloudWatch alarms                 5 alarms                $0.50
  TOTAL                                                     ~$1.55 per month

  This is essentially free for internal tool usage at this scale.

---

## 11. Teardown (Remove All AI Resources)

  Run in this order:
    aws cloudformation delete-stack --stack-name finops-ai-monitoring --region ap-south-1
    aws cloudformation delete-stack --stack-name finops-ai-apigw --region ap-south-1
    aws cloudformation delete-stack --stack-name finops-ai-lambda --region ap-south-1
    aws cloudformation delete-stack --stack-name finops-ai-secrets --region ap-south-1
    aws cloudformation delete-stack --stack-name finops-ai-iam --region ap-south-1

  Also remove from backend/.env:
    AI_ENABLED=false

  Rebuild backend:
    docker-compose up -d --build backend

---

## 12. Security Notes

  - EC2 uses IAM instance role — no hardcoded AWS keys anywhere
  - Lambda uses a dedicated IAM role with least-privilege Bedrock access
  - API Gateway has throttling: 50 req/sec rate, 100 burst
  - All endpoints require JWT authentication via FastAPI dependency
  - Cost data never leaves your AWS account — AI only sees what backend sends
  - Bedrock model invocations are logged in CloudWatch
  - Monthly budget alert fires at 80% of $50 limit

---

## 13. Files Reference

  cfts/01-iam.yaml              IAM roles for Lambda and EC2 Bedrock access
  cfts/02-secrets.yaml          Secrets Manager with Bedrock model IDs and prompts
  cfts/03-lambda-ai.yaml        Lambda function — chat and summary handler
  cfts/04-apigateway-ai.yaml    REST API Gateway with /ai/chat and /ai/summary
  cfts/05-monitoring.yaml       CloudWatch alarms, SNS, Bedrock budget, dashboard
  cfts/DEPLOYMENT_GUIDE.md      Original deployment guide (shorter version)
  backend/app/routers/ai.py     FastAPI AI router (to be created during integration)
