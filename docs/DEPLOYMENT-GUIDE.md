# AWS Deployment Guide - Step by Step

This guide provides step-by-step instructions for deploying your latest changes to AWS ECS Fargate.

## Prerequisites

- AWS CLI installed and configured (`aws --version`)
- Docker installed (`docker --version`)
- Git repository with your latest changes committed
- AWS credentials with permissions for:
  - ECR (Elastic Container Registry)
  - ECS (Elastic Container Service)
  - IAM (for task execution roles)

## Deployment Configuration

**Current Setup:**
- **Region:** `us-west-2`
- **ECR Repository:** `the1-repo`
- **Stage Cluster:** `the1-stage`
- **Stage Service:** `the1-stage-service`
- **Prod Cluster:** `the1-prod`
- **Prod Service:** `the1-prod-service`
- **Prod Task Definition:** `the1-prod-task`

---

## Option 1: Automated Deployment via GitHub Actions (Recommended)

This is the easiest method - just push to the appropriate branch.

### For Stage Environment:

1. **Commit your changes:**
   ```bash
   git add .
   git commit -m "Your deployment message"
   ```

2. **Push to stage branch:**
   ```bash
   git push origin stage
   ```

3. **Monitor deployment:**
   - Go to GitHub → Your Repository → Actions tab
   - Watch the "Deploy stage" workflow run
   - It will automatically:
     - Build Docker image
     - Push to ECR
     - Force new ECS deployment

### For Production Environment:

1. **Commit your changes:**
   ```bash
   git add .
   git commit -m "Your deployment message"
   ```

2. **Push to prod branch:**
   ```bash
   git push origin prod
   ```

3. **Monitor deployment:**
   - Go to GitHub → Your Repository → Actions tab
   - Watch the "Deploy prod" workflow run
   - It will automatically:
     - Build Docker image
     - Push to ECR
     - Update task definition
     - Update ECS service

**Note:** Make sure GitHub Secrets are configured:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

---

## Option 2: Manual Deployment via AWS CLI

Use this method if you want to deploy directly without using GitHub Actions.

### Step 1: Configure AWS CLI

```bash
# Verify AWS CLI is configured
aws configure list

# If not configured, run:
aws configure
# Enter your:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region: us-west-2
# - Default output format: json
```

### Step 2: Get AWS Account ID

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account ID: $ACCOUNT_ID"
```

### Step 3: Set Environment Variables

```bash
export AWS_REGION=us-west-2
export ECR_REPOSITORY=the1-repo
export IMAGE_TAG=latest  # or use: prod, stage, or a version tag
export ECS_CLUSTER=the1-prod  # or the1-stage for staging
export ECS_SERVICE=the1-prod-service  # or the1-stage-service for staging
export ECR_URI=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}
```

### Step 4: Login to Amazon ECR

```bash
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI}
```

### Step 5: Build Docker Image

```bash
# Navigate to project root (where Dockerfile is located)
cd /Users/sagivdaniel/Documents/THEONE/server

# Build the image
docker build -t ${ECR_URI}:${IMAGE_TAG} .
```

### Step 6: Push Image to ECR

```bash
docker push ${ECR_URI}:${IMAGE_TAG}
```

### Step 7: Deploy to ECS

#### For Stage Environment (Simple Force Deployment):

```bash
aws ecs update-service \
  --cluster the1-stage \
  --service the1-stage-service \
  --force-new-deployment \
  --region ${AWS_REGION}
```

#### For Production Environment (Update Task Definition):

```bash
# Step 7a: Get current task definition
aws ecs describe-task-definition \
  --task-definition the1-prod-task \
  --query taskDefinition > task-definition.json

# Step 7b: Update image URI in task definition
# Install jq if not installed: brew install jq (macOS) or apt-get install jq (Linux)
jq --arg IMAGE_URI "${ECR_URI}:${IMAGE_TAG}" \
  '.containerDefinitions[0].image = $IMAGE_URI' \
  task-definition.json > updated-task-definition.json

# Step 7c: Remove fields that shouldn't be in new task definition
jq 'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .placementConstraints, .compatibilities, .registeredAt, .registeredBy)' \
  updated-task-definition.json > final-task-definition.json

# Step 7d: Register new task definition
aws ecs register-task-definition \
  --cli-input-json file://final-task-definition.json \
  --region ${AWS_REGION}

# Step 7e: Get the new task definition ARN
TASK_DEF_ARN=$(aws ecs describe-task-definition \
  --task-definition the1-prod-task \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text \
  --region ${AWS_REGION})

# Step 7f: Update ECS service with new task definition
aws ecs update-service \
  --cluster the1-prod \
  --service the1-prod-service \
  --task-definition "${TASK_DEF_ARN}" \
  --region ${AWS_REGION}

# Cleanup temporary files
rm task-definition.json updated-task-definition.json final-task-definition.json
```

### Step 8: Monitor Deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster ${ECS_CLUSTER} \
  --services ${ECS_SERVICE} \
  --region ${AWS_REGION} \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount,deployments:deployments[*].{status:status,desiredCount:desiredCount,runningCount:runningCount}}'

# Watch deployment progress
aws ecs describe-services \
  --cluster ${ECS_CLUSTER} \
  --services ${ECS_SERVICE} \
  --region ${AWS_REGION} \
  --query 'services[0].deployments[*].{status:status,desiredCount:desiredCount,runningCount:runningCount,createdAt:createdAt}'
```

---

## Option 3: Quick Manual Deployment Script

Save this as `deploy.sh` in your project root:

```bash
#!/bin/bash

# Configuration
ENVIRONMENT=${1:-prod}  # prod or stage
AWS_REGION=us-west-2
ECR_REPOSITORY=the1-repo
IMAGE_TAG=${2:-latest}

if [ "$ENVIRONMENT" = "prod" ]; then
  ECS_CLUSTER=the1-prod
  ECS_SERVICE=the1-prod-service
  TASK_DEFINITION=the1-prod-task
else
  ECS_CLUSTER=the1-stage
  ECS_SERVICE=the1-stage-service
  TASK_DEFINITION=the1-stage-task
fi

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}

echo "🚀 Deploying to ${ENVIRONMENT} environment..."
echo "ECR URI: ${ECR_URI}:${IMAGE_TAG}"

# Login to ECR
echo "📦 Logging into ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI}

# Build image
echo "🔨 Building Docker image..."
docker build -t ${ECR_URI}:${IMAGE_TAG} .

# Push image
echo "⬆️  Pushing image to ECR..."
docker push ${ECR_URI}:${IMAGE_TAG}

# Deploy to ECS
if [ "$ENVIRONMENT" = "prod" ]; then
  echo "📋 Updating task definition..."
  aws ecs describe-task-definition --task-definition ${TASK_DEFINITION} --query taskDefinition > task-def.json
  jq --arg IMAGE_URI "${ECR_URI}:${IMAGE_TAG}" '.containerDefinitions[0].image = $IMAGE_URI' task-def.json > updated-task-def.json
  jq 'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .placementConstraints, .compatibilities, .registeredAt, .registeredBy)' updated-task-def.json > final-task-def.json
  aws ecs register-task-definition --cli-input-json file://final-task-def.json --region ${AWS_REGION}
  TASK_DEF_ARN=$(aws ecs describe-task-definition --task-definition ${TASK_DEFINITION} --query 'taskDefinition.taskDefinitionArn' --output text --region ${AWS_REGION})
  echo "🔄 Updating ECS service..."
  aws ecs update-service --cluster ${ECS_CLUSTER} --service ${ECS_SERVICE} --task-definition "${TASK_DEF_ARN}" --region ${AWS_REGION}
  rm task-def.json updated-task-def.json final-task-def.json
else
  echo "🔄 Forcing new deployment..."
  aws ecs update-service --cluster ${ECS_CLUSTER} --service ${ECS_SERVICE} --force-new-deployment --region ${AWS_REGION}
fi

echo "✅ Deployment initiated! Monitor progress in AWS Console or with:"
echo "aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${ECS_SERVICE} --region ${AWS_REGION}"
```

**Usage:**
```bash
# Make script executable
chmod +x deploy.sh

# Deploy to production
./deploy.sh prod

# Deploy to staging
./deploy.sh stage

# Deploy with custom tag
./deploy.sh prod v1.2.3
```

---

## Important Notes

### Environment Variables

Make sure all required environment variables are set in your ECS Task Definition:
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing secret
- `OPENAI_API_KEY` - OpenAI API key for bot features
- `GP_APP_NAME` - Global Payments app name
- `GP_APP_KEY` - Global Payments app key
- `GP_MERCHANT_ID` - Global Payments merchant ID
- Any other variables from your `.env` file

**To update environment variables in ECS:**
1. Go to AWS Console → ECS → Task Definitions
2. Select your task definition
3. Create new revision
4. Update environment variables in container definition
5. Update service to use new task definition

### Verification Checklist

After deployment, verify:

- [ ] Service is running (check ECS console)
- [ ] Tasks are healthy (no stopped tasks)
- [ ] Application is accessible (test your API endpoints)
- [ ] Database connection works
- [ ] Environment variables are correct
- [ ] Logs are being generated (CloudWatch)

### Troubleshooting

**If deployment fails:**

1. **Check ECS Service Events:**
   ```bash
   aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${ECS_SERVICE} --query 'services[0].events[0:5]'
   ```

2. **Check Task Logs:**
   - Go to CloudWatch Logs
   - Find log group for your ECS service
   - Check recent log streams

3. **Check Task Status:**
   ```bash
   aws ecs list-tasks --cluster ${ECS_CLUSTER} --service-name ${ECS_SERVICE}
   aws ecs describe-tasks --cluster ${ECS_CLUSTER} --tasks <TASK_ARN>
   ```

4. **Common Issues:**
   - **Image pull errors:** Check ECR permissions
   - **Task fails to start:** Check environment variables and task definition
   - **Health check failures:** Verify application is listening on correct port (80)
   - **Out of memory:** Increase task memory allocation

---

## Quick Reference Commands

```bash
# View running services
aws ecs list-services --cluster the1-prod --region us-west-2

# View service details
aws ecs describe-services --cluster the1-prod --services the1-prod-service --region us-west-2

# View recent task definitions
aws ecs list-task-definitions --family-prefix the1-prod-task --region us-west-2

# View ECR images
aws ecr describe-images --repository-name the1-repo --region us-west-2

# View service logs (requires CloudWatch log group name)
aws logs tail /ecs/the1-prod-service --follow --region us-west-2
```

---

## Next Steps After Deployment

1. **Test your endpoints** - Verify all API endpoints are working
2. **Check bot functionality** - Test bot features if deployed
3. **Monitor logs** - Watch CloudWatch logs for any errors
4. **Verify database** - Ensure MongoDB connection is stable
5. **Test payments** - If payment features were updated, test payment flows

---

**Last Updated:** Based on current GitHub Actions workflows and ECS configuration











