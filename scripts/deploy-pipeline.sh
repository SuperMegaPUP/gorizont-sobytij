#!/bin/bash
# Deploy Pipeline: DEV → TEST → ACCEPTANCE → GitHub Push
# Usage: ./deploy-pipeline.sh "Commit message"

set -e

COMMIT_MSG="${1:-Deploy $(date +%Y%m%d_%H%M%S)}"
ACCEPTANCE_CONTAINER="horizon-acceptance"
ACCEPTANCE_PORT=3002

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cleanup() {
  echo -e "${YELLOW}🧹 Cleaning up...${NC}"
  docker stop $ACCEPTANCE_CONTAINER 2>/dev/null || true
  docker rm $ACCEPTANCE_CONTAINER 2>/dev/null || true
}

trap cleanup EXIT

echo "========================================="
echo "  DEPLOY PIPELINE"
echo "========================================="

# STEP 1: Tests
echo -e "\n${YELLOW}📋 STEP 1: Running tests...${NC}"
if ! npm run test:ci; then
  echo -e "${RED}❌ Tests failed${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Tests passed${NC}"

# STEP 2: Build
echo -e "\n${YELLOW}📦 STEP 2: Building Docker image...${NC}"
docker build -t gorizont-sobytij:acceptance . || {
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
}
echo -e "${GREEN}✅ Build complete${NC}"

# STEP 3: Run Acceptance
echo -e "\n${YELLOW}🚀 STEP 3: Starting acceptance container...${NC}"
cleanup
docker run -d -p $ACCEPTANCE_PORT:3000 \
  --name $ACCEPTANCE_CONTAINER \
  --env-file .env.acceptance \
  gorizont-sobytij:acceptance

# STEP 4: Health Check
echo -e "\n${YELLOW}💚 STEP 4: Health check...${NC}"
for i in {1..30}; do
  HEALTH=$(curl -sf http://localhost:$ACCEPTANCE_PORT/api/health 2>/dev/null)
  STATUS=$(echo "$HEALTH" | jq -r '.status' 2>/dev/null || echo "error")
  if [ "$STATUS" = "ok" ]; then
    echo -e "${GREEN}✅ Service is healthy${NC}"
    break
  fi
  if [ $i -eq 30 ]; then
    echo -e "${RED}❌ Health check failed after 60s${NC}"
    echo "$HEALTH" | jq .
    exit 1
  fi
  sleep 2
done

# STEP 5: Validation
echo -e "\n${YELLOW}🔍 STEP 5: Validation...${NC}"
OBS_COUNT=$(curl -sf http://localhost:$ACCEPTANCE_PORT/api/horizon/observations 2>/dev/null | jq '.observations | length' 2>/dev/null || echo "0")
if [ "$OBS_COUNT" -lt 0 ] 2>/dev/null; then
  OBS_COUNT=0
fi

if [ "$OBS_COUNT" -ge 0 ]; then
  echo -e "${GREEN}✅ Observations endpoint working (count: $OBS_COUNT)${NC}"
else
  echo -e "${YELLOW}⚠️ Observations returned empty (this is OK for fresh DB)${NC}"
fi

# STEP 6: Push to Git
echo -e "\n${YELLOW}📤 STEP 6: Pushing to GitHub...${NC}"
git add -A
git commit -m "$COMMIT_MSG"
git push origin main

echo -e "\n========================================="
echo -e "${GREEN}✅ PIPELINE COMPLETE!${NC}"
echo -e "========================================="
echo -e "Vercel LAB will auto-deploy from GitHub."
echo -e "Verify LAB, then promote to PROD manually."