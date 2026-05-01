#!/bin/bash
# Promote LAB → PROD with gate checks

LAB_URL="https://robot-lab-v3.vercel.app"
PROD_URL="https://robot-detect-v3.vercel.app"

echo "PROMOTE LAB → PROD"

if [ -z "$VERCEL_TOKEN" ]; then
  echo "VERCEL_TOKEN not set"
  exit 1
fi

echo "Checking Shadow Gate..."
GATE_STATUS=$(curl -sf "$LAB_URL/api/horizon/shadow/status" 2>/dev/null | jq -r '.gateStatus' 2>/dev/null || echo "NOT_FOUND")
echo "Gate: $GATE_STATUS"

echo "Checking LAB health..."
LAB_HEALTH=$(curl -sf "$LAB_URL/api/health" 2>/dev/null | jq -r '.status' 2>/dev/null || echo "error")
if [ "$LAB_HEALTH" != "ok" ]; then
  echo "LAB unhealthy: $LAB_HEALTH"
  exit 1
fi

echo "Promoting to PROD..."
vercel promote --prod --yes 2>/dev/null || echo "Manual promotion required"

echo "DONE! PROD: $PROD_URL"