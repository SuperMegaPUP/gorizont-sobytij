#!/bin/bash
# detailed_monitor.sh — детальный мониторинг всех тикеров каждую минуту

URL="https://robot-lab-v3.vercel.app/api/horizon/top100"
DATA_DIR="/home/g/orizont-sobytij/data/detailed"
LOG_FILE="/home/g/orizont-sobytij/data/detailed_monitor.log"
MAX_DAYS=20

mkdir -p "$DATA_DIR"
mkdir -p "$(dirname "$LOG_FILE")"
chmod -R 777 "$DATA_DIR" 2>/dev/null

CURRENT_DATE=$(date -u +"%Y-%m-%d")
OUTPUT_FILE="$DATA_DIR/$CURRENT_DATE.jsonl"

log() {
    echo "[$(date -d '+3 hours' '+%Y-%m-%d %H:%M:%S') МСК] $1" | tee -a "$LOG_FILE"
}

log "=== Detailed monitor started ==="

# Очистка
find "$DATA_DIR" -name "*.jsonl" -mtime +$MAX_DAYS -delete 2>/dev/null

log "Fetching data..."

# Retry loop
RESPONSE=""
for i in 1 2 3; do
    log "Attempt $i..."
    RESPONSE=$(curl -s -X POST "$URL" -H "Content-Type: application/json" -d '{"force": false}' --max-time 60 2>&1)
    if [ -n "$RESPONSE" ] && echo "$RESPONSE" | head -c 100 | grep -q "success"; then
        log "Data OK"
        break
    fi
    log "Attempt $i failed"
    sleep 2
done

if ! echo "$RESPONSE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    log "ERROR: Invalid JSON"
    exit 1
fi

# Записываем
BEFORE=$(wc -l < "$OUTPUT_FILE" 2>/dev/null || echo 0)
echo "$RESPONSE" | python3 - <<'PY' 2>&1 | tee -a "$LOG_FILE"
import sys, json
from datetime import datetime

try:
    data = json.load(sys.stdin)
    tickers = data.get('data', [])
    outfile = sys.argv[1]
    
    with open(outfile, 'a') as f:
        for t in tickers:
            record = {
                'ts': int(datetime.now().timestamp() * 1000),
                'ticker': t.get('ticker', ''),
                'name': t.get('name', ''),
                'bsci': t.get('bsci', 0),
                'prevBsci': t.get('prevBsci', 0),
                'alertLevel': t.get('alertLevel', ''),
                'direction': t.get('direction', ''),
                'confidence': t.get('confidence', 0),
                'detectorScores': t.get('detectorScores', {}),
                'vpin': t.get('vpin', 0),
                'cumDelta': t.get('cumDelta', 0),
                'ofi': t.get('ofi', 0),
                'realtimeOFI': t.get('realtimeOFI', 0),
                'turnover': t.get('turnover', 0),
                'moexTurnover': t.get('moexTurnover', 0),
                'keySignal': t.get('keySignal', ''),
                'action': t.get('action', ''),
                'quickStatus': t.get('quickStatus', ''),
                'taContext': t.get('taContext', {}),
                'robotContext': t.get('robotContext', {}),
                'convergenceScore': t.get('convergenceScore', {}),
            }
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
    
    print(f"Written: {len(tickers)} tickers")
except Exception as e:
    print(f"ERROR: {e}")
PY

AFTER=$(wc -l < "$OUTPUT_FILE" 2>/dev/null || echo 0)
WRITTEN=$((AFTER - BEFORE))
log "Total in file: $AFTER, written this run: $WRITTEN"
log "=== Finished ==="