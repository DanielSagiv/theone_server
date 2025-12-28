#!/bin/bash

# AWS Deployment Script for THE1 Platform
# Usage: ./deploy.sh [environment] [image-tag]
# Example: ./deploy.sh prod latest
# Example: ./deploy.sh stage v1.0.0

set -e  # Exit on error

# Configuration
ENVIRONMENT=${1:-prod}  # prod or stage (default: prod)
AWS_REGION=us-west-2
ECR_REPOSITORY=the1-repo
IMAGE_TAG=${2:-latest}

# Validate environment
if [ "$ENVIRONMENT" != "prod" ] && [ "$ENVIRONMENT" != "stage" ]; then
  echo "❌ Error: Environment must be 'prod' or 'stage'"
  echo "Usage: ./deploy.sh [prod|stage] [image-tag]"
  exit 1
fi

# Set environment-specific variables
if [ "$ENVIRONMENT" = "prod" ]; then
  ECS_CLUSTER=the1-prod
  ECS_SERVICE=the1-prod-service
  TASK_DEFINITION=the1-prod-task
  USE_TASK_DEF_UPDATE=true
else
  ECS_CLUSTER=the1-stage
  ECS_SERVICE=the1-stage-service
  TASK_DEFINITION=the1-stage-task
  USE_TASK_DEF_UPDATE=false
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}🚀 THE1 Platform Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Environment: ${GREEN}${ENVIRONMENT}${NC}"
echo -e "Image Tag: ${GREEN}${IMAGE_TAG}${NC}"
echo -e "Cluster: ${GREEN}${ECS_CLUSTER}${NC}"
echo -e "Service: ${GREEN}${ECS_SERVICE}${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

if ! command -v aws &> /dev/null; then
  echo -e "${RED}❌ AWS CLI is not installed${NC}"
  exit 1
fi

if ! command -v docker &> /dev/null; then
  echo -e "${RED}❌ Docker is not installed${NC}"
  exit 1
fi

if [ "$USE_TASK_DEF_UPDATE" = true ] && ! command -v jq &> /dev/null; then
  echo -e "${RED}❌ jq is not installed (required for prod deployment)${NC}"
  echo -e "${YELLOW}Install with: brew install jq (macOS) or apt-get install jq (Linux)${NC}"
  exit 1
fi

# Verify AWS credentials
echo -e "${YELLOW}🔐 Verifying AWS credentials...${NC}"
if ! aws sts get-caller-identity &> /dev/null; then
  echo -e "${RED}❌ AWS credentials not configured${NC}"
  echo -e "${YELLOW}Run: aws configure${NC}"
  exit 1
fi

# Get AWS Account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI=${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}

echo -e "${GREEN}✅ Prerequisites check passed${NC}"
echo -e "AWS Account ID: ${GREEN}${ACCOUNT_ID}${NC}"
echo -e "ECR URI: ${GREEN}${ECR_URI}:${IMAGE_TAG}${NC}"
echo ""

# Step 1: Login to ECR
echo -e "${BLUE}Step 1/6:${NC} 📦 Logging into Amazon ECR..."
if aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI} 2>/dev/null; then
  echo -e "${GREEN}✅ ECR login successful${NC}"
else
  echo -e "${RED}❌ ECR login failed${NC}"
  exit 1
fi
echo ""

# Step 2: Build Docker image
echo -e "${BLUE}Step 2/6:${NC} 🔨 Building Docker image..."
if docker build -t ${ECR_URI}:${IMAGE_TAG} .; then
  echo -e "${GREEN}✅ Docker image built successfully${NC}"
else
  echo -e "${RED}❌ Docker build failed${NC}"
  exit 1
fi
echo ""

# Step 3: Push image to ECR
echo -e "${BLUE}Step 3/6:${NC} ⬆️  Pushing image to ECR..."
if docker push ${ECR_URI}:${IMAGE_TAG}; then
  echo -e "${GREEN}✅ Image pushed successfully${NC}"
else
  echo -e "${RED}❌ Image push failed${NC}"
  exit 1
fi
echo ""

# Step 4: Update task definition (prod only)
if [ "$USE_TASK_DEF_UPDATE" = true ]; then
  echo -e "${BLUE}Step 4/6:${NC} 📋 Updating task definition..."
  
  # Get current task definition
  if ! aws ecs describe-task-definition --task-definition ${TASK_DEFINITION} --query taskDefinition > task-def.json 2>/dev/null; then
    echo -e "${RED}❌ Failed to get task definition${NC}"
    exit 1
  fi
  
  # Update image URI
  if ! jq --arg IMAGE_URI "${ECR_URI}:${IMAGE_TAG}" '.containerDefinitions[0].image = $IMAGE_URI' task-def.json > updated-task-def.json; then
    echo -e "${RED}❌ Failed to update task definition${NC}"
    rm -f task-def.json updated-task-def.json
    exit 1
  fi
  
  # Remove fields that shouldn't be in new task definition
  if ! jq 'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .placementConstraints, .compatibilities, .registeredAt, .registeredBy)' updated-task-def.json > final-task-def.json; then
    echo -e "${RED}❌ Failed to clean task definition${NC}"
    rm -f task-def.json updated-task-def.json final-task-def.json
    exit 1
  fi
  
  # Register new task definition
  if aws ecs register-task-definition --cli-input-json file://final-task-def.json --region ${AWS_REGION} > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Task definition updated${NC}"
  else
    echo -e "${RED}❌ Failed to register task definition${NC}"
    rm -f task-def.json updated-task-def.json final-task-def.json
    exit 1
  fi
  
  # Get new task definition ARN
  TASK_DEF_ARN=$(aws ecs describe-task-definition --task-definition ${TASK_DEFINITION} --query 'taskDefinition.taskDefinitionArn' --output text --region ${AWS_REGION})
  
  # Cleanup
  rm -f task-def.json updated-task-def.json final-task-def.json
  
  echo ""
else
  TASK_DEF_ARN=""
  echo -e "${BLUE}Step 4/6:${NC} ⏭️  Skipping task definition update (stage uses force deployment)"
  echo ""
fi

# Step 5: Update ECS service
echo -e "${BLUE}Step 5/6:${NC} 🔄 Updating ECS service..."

if [ "$USE_TASK_DEF_UPDATE" = true ]; then
  # Production: Update with new task definition
  if aws ecs update-service \
    --cluster ${ECS_CLUSTER} \
    --service ${ECS_SERVICE} \
    --task-definition "${TASK_DEF_ARN}" \
    --region ${AWS_REGION} > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Service updated with new task definition${NC}"
  else
    echo -e "${RED}❌ Failed to update service${NC}"
    exit 1
  fi
else
  # Stage: Force new deployment
  if aws ecs update-service \
    --cluster ${ECS_CLUSTER} \
    --service ${ECS_SERVICE} \
    --force-new-deployment \
    --region ${AWS_REGION} > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Service deployment forced${NC}"
  else
    echo -e "${RED}❌ Failed to update service${NC}"
    exit 1
  fi
fi
echo ""

# Step 6: Monitor deployment
echo -e "${BLUE}Step 6/6:${NC} 📊 Checking deployment status..."
sleep 3

SERVICE_STATUS=$(aws ecs describe-services \
  --cluster ${ECS_CLUSTER} \
  --services ${ECS_SERVICE} \
  --region ${AWS_REGION} \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount}' \
  --output json)

RUNNING_COUNT=$(echo $SERVICE_STATUS | jq -r '.runningCount // 0')
DESIRED_COUNT=$(echo $SERVICE_STATUS | jq -r '.desiredCount // 0')
STATUS=$(echo $SERVICE_STATUS | jq -r '.status // "UNKNOWN"')

echo -e "Service Status: ${GREEN}${STATUS}${NC}"
echo -e "Running Tasks: ${GREEN}${RUNNING_COUNT}${NC} / ${DESIRED_COUNT}"
echo ""

# Summary
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ Deployment initiated successfully!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "📋 Deployment Details:"
echo -e "  Environment: ${GREEN}${ENVIRONMENT}${NC}"
echo -e "  Image: ${GREEN}${ECR_URI}:${IMAGE_TAG}${NC}"
echo -e "  Cluster: ${GREEN}${ECS_CLUSTER}${NC}"
echo -e "  Service: ${GREEN}${ECS_SERVICE}${NC}"
echo ""
echo -e "📊 Monitor deployment:"
echo -e "  ${YELLOW}aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${ECS_SERVICE} --region ${AWS_REGION}${NC}"
echo ""
echo -e "🌐 AWS Console:"
echo -e "  ${YELLOW}https://console.aws.amazon.com/ecs/v2/clusters/${ECS_CLUSTER}/services/${ECS_SERVICE}?region=${AWS_REGION}${NC}"
echo ""
echo -e "${YELLOW}⏳ Deployment typically takes 2-5 minutes to complete${NC}"
echo ""











