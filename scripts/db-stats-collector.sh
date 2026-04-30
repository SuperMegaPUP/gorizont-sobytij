#!/bin/bash
# ===========================================
# DB Stats Collector
# Собирает статистику с Neon (PostgreSQL) + Redis
# и сохраняет в JSONL формате
# ===========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="/home/g/gorizont-sobytij"
OUTPUT_DIR="$PROJECT_DIR/data/db-stats"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_FILE="$OUTPUT_DIR/${TIMESTAMP}.jsonl"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }

# Create output directory
mkdir -p "$OUTPUT_DIR"

log "Starting DB stats collection..."

# ===========================================
# 1. Collect from PostgreSQL (Neon) via Prisma
# ===========================================

log "Collecting PostgreSQL (Neon) data..."

PG_STATS=$(cd "$PROJECT_DIR" && npx prisma execute '
SELECT 
  COUNT(*) as total_observations,
  COUNT(DISTINCT ticker) as unique_tickers,
  AVG(bsci) as avg_bsci,
  MIN(bsci) as min_bsci,
  MAX(bsci) as max_bsci,
  COUNT(CASE WHEN alertLevel = '\''GREEN'\'' THEN 1 END) as green_alerts,
  COUNT(CASE WHEN alertLevel = '\''YELLOW'\'' THEN 1 END) as yellow_alerts,
  COUNT(CASE WHEN alertLevel = '\''ORANGE'\'' THEN 1 END) as orange_alerts,
  COUNT(CASE WHEN alertLevel = '\''RED'\'' THEN 1 END) as red_alerts,
  COUNT(CASE WHEN direction = '\''BULLISH'\'' THEN 1 END) as bullish_count,
  COUNT(CASE WHEN direction = '\''BEARISH'\'' THEN 1 END) as bearish_count,
  COUNT(CASE WHEN direction = '\''NEUTRAL'\'' THEN 1 END) as neutral_count,
  MIN(timestamp) as earliest_obs,
  MAX(timestamp) as latest_obs
FROM observations;
' --format=json 2>/dev/null || echo '{"error": "Prisma query failed"}')

# Get detector stats
DETECTOR_STATS=$(cd "$PROJECT_DIR" && npx prisma execute '
SELECT 
  detector,
  COUNT(*) as count,
  AVG(score) as avg_score,
  MIN(score) as min_score,
  MAX(score) as max_score,
  COUNT(CASE WHEN signal = '\''BULLISH'\'' THEN 1 END) as bullish_signals,
  COUNT(CASE WHEN signal = '\''BEARISH'\'' THEN 1 END) as bearish_signals
FROM detector_scores
GROUP BY detector
ORDER BY detector;
' --format=json 2>/dev/null || echo '[]')

# Get BSCI log stats
BSCI_LOG_STATS=$(cd "$PROJECT_DIR" && npx prisma execute '
SELECT 
  COUNT(*) as total_logs,
  COUNT(DISTINCT ticker) as tickers,
  AVG(bsci) as avg_bsci,
  MIN(bsci) as min_bsci,
  MAX(bsci) as max_bsci
FROM bsci_log;
' --format=json 2>/dev/null || echo '{"error": "BSCI log query failed"}')

# Get BSCI weights
BSCI_WEIGHTS=$(cd "$PROJECT_DIR" && npx prisma execute '
SELECT detector, weight, accuracy, totalSignals, correctSignals
FROM bsci_weights
ORDER BY detector;
' --format=json 2>/dev/null || echo '[]')

# Get reports count
REPORTS_STATS=$(cd "$PROJECT_DIR" && npx prisma execute '
SELECT 
  COUNT(*) as total_reports,
  COUNT(DISTINCT ticker) as tickers,
  COUNT(CASE WHEN reportType = '\''full'\'' THEN 1 END) as full_reports,
  COUNT(CASE WHEN reportType = '\''hint'\'' THEN 1 END) as hint_reports,
  COUNT(CASE WHEN reportType = '\''horizon'\'' THEN 1 END) as horizon_reports
FROM reports;
' --format=json 2>/dev/null || echo '{"error": "Reports query failed"}')

# ===========================================
# 2. Collect from Redis
# ===========================================

log "Collecting Redis data..."

# Redis connection info from .env.local
REDIS_URL="redis://default:mZv87MZXthQawhs92dYhkSj2UDfFPeAN@redis-17047.crce296.us-east-1-6.ec2.cloud.redislabs.com:17047"

# Get all horizon:* keys
REDIS_KEYS=$(redis-cli -u "$REDIS_URL" --no-auth-warning KEYS 'horizon:*' 2>/dev/null | head -50 || echo "")

# Count keys by pattern
REDIS_KEYS_COUNT=$(redis-cli -u "$REDIS_URL" --no-auth-warning KEYS 'horizon:*' 2>/dev/null | wc -l || echo "0")

# Get scanner cache info
SCANNER_CACHE_TTL=$(redis-cli -u "$REDIS_URL" --no-auth-warning TTL 'horizon:scanner:top100' 2>/dev/null || echo "0")

# Get signals count
SIGNALS_COUNT=$(redis-cli -u "$REDIS_URL" --no-auth-warning LLEN 'horizon:signals:active' 2>/dev/null || echo "0")

# Get algo pack cache
ALGOPACK_TTL=$(redis-cli -u "$REDIS_URL" --no-auth-warning TTL 'horizon:algopack:latest' 2>/dev/null || echo "0")

# ===========================================
# 3. Build JSON output
# ===========================================

log "Building JSON output..."

# Current timestamp in ms
TS_MS=$(date +%s)000

# Get today date
TODAY=$(date +%Y-%m-%d)

cat > "$OUTPUT_FILE" << EOF
{"ts": $TS_MS, "source": "neon_postgresql", "collection": "observations", "data": $PG_STATS, "collectedAt": "$TODAY"}
{"ts": $TS_MS, "source": "neon_postgresql", "collection": "detector_scores", "data": $DETECTOR_STATS, "collectedAt": "$TODAY"}
{"ts": $TS_MS, "source": "neon_postgresql", "collection": "bsci_log", "data": $BSCI_LOG_STATS, "collectedAt": "$TODAY"}
{"ts": $TS_MS, "source": "neon_postgresql", "collection": "bsci_weights", "data": $BSCI_WEIGHTS, "collectedAt": "$TODAY"}
{"ts": $TS_MS, "source": "neon_postgresql", "collection": "reports", "data": $REPORTS_STATS, "collectedAt": "$TODAY"}
{"ts": $TS_MS, "source": "redis", "collection": "keys", "data": {"totalKeys": $REDIS_KEYS_COUNT, "scannerTTL": $SCANNER_CACHE_TTL, "signalsCount": $SIGNALS_COUNT, "algopackTTL": $ALGOPACK_TTL, "sampleKeys": "$(echo $REDIS_KEYS | tr '\n' ',' | sed 's/,$//')"}, "collectedAt": "$TODAY"}
EOF

log "Stats saved to: $OUTPUT_FILE"
log "File size: $(du -h "$OUTPUT_FILE" | cut -f1)"

# Show summary
echo ""
echo "==========================================="
echo "📊 DB STATS SUMMARY"
echo "==========================================="
echo "PostgreSQL (Neon):"
echo "$PG_STATS" | jq -r 'to_entries[] | "  \(.key): \(.value)"' 2>/dev/null || echo "  (query output above)"
echo ""
echo "Redis:"
echo "  Total keys: $REDIS_KEYS_COUNT"
echo "  Scanner cache TTL: $SCANNER_CACHE_TTL sec"
echo "  Active signals: $SIGNALS_COUNT"
echo "  AlgoPack cache TTL: $ALGOPACK_TTL sec"
echo "==========================================="

log "Done!"