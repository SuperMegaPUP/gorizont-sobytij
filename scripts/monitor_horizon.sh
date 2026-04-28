#!/bin/bash
# monitor_horizon.sh — мониторинг метрик Горизонта каждые 5 минут
# Запускать: cd /home/g/gorizont-sobytij && ./scripts/monitor_horizon.sh &

URL="https://robot-lab-v3.vercel.app/api/horizon/top100"
OUTPUT_FILE="/home/g/gorizont-sobytij/data/horizon_metrics.csv"
MAX_RETRIES=3

# Создаем директорию если нет
mkdir -p /home/g/gorizont-sobytij/data

# Заголовок CSV если файл пустой
if [ ! -f "$OUTPUT_FILE" ]; then
    echo "timestamp,bsci_mean,bsci_max,bsci_min,alert_count,watch_count,cipher_avg,graviton_avg,accretor_avg,wavefunction_avg,attractor_avg,darkmatter_avg,entangle_avg,decoherence_avg,hawking_avg,predator_avg" > "$OUTPUT_FILE"
fi

# Функция измерения (время МСК UTC+3)
measure() {
    TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S")
    TIMESTAMP_MSK=$(date -d '+3 hours' "+%Y-%m-%d %H:%M:%S")
    echo "[$(date -d '+3 hours' '+%H:%M:%S') МСК] Measuring..."

    RESPONSE=$(curl -s -X POST "$URL" -H "Content-Type: application/json" -d '{"force": false}' --max-time 60 2>&1)

    if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
        echo "[$(date -d '+3 hours' '+%H:%M:%S') МСК] ERROR: No response"
        return 1
    fi

    # Проверяем что ответ JSON
    if ! echo "$RESPONSE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
        echo "[$(date -d '+3 hours' '+%H:%M:%S') МСК] ERROR: Invalid JSON"
        return 1
    fi

    # Парсим метрики через Python
    METRICS=$(echo "$RESPONSE" | python3 -c "
import sys, json

try:
    d = json.load(sys.stdin)
    data = d.get('data', [])

    # BSCI
    bsci_vals = [t.get('bsci', 0) for t in data if t.get('bsci')]
    bsci_mean = sum(bsci_vals)/len(bsci_vals) if bsci_vals else 0
    bsci_max = max(bsci_vals) if bsci_vals else 0
    bsci_min = min(bsci_vals) if bsci_vals else 0

    # ALERT/WATCH
    alerts = len([t for t in data if t.get('action') == 'ALERT'])
    watch = len([t for t in data if t.get('action') == 'WATCH'])

    # Detector averages
    dets = {}
    for t in data:
        for d, s in t.get('detectorScores', {}).items():
            if d not in dets: dets[d] = []
            dets[d].append(s)

    cipher = sum(dets.get('CIPHER', [0]))/len(dets.get('CIPHER', [1])) if dets.get('CIPHER') else 0
    graviton = sum(dets.get('GRAVITON', [0]))/len(dets.get('GRAVITON', [1])) if dets.get('GRAVITON') else 0
    accretor = sum(dets.get('ACCRETOR', [0]))/len(dets.get('ACCRETOR', [1])) if dets.get('ACCRETOR') else 0
    wavefunction = sum(dets.get('WAVEFUNCTION', [0]))/len(dets.get('WAVEFUNCTION', [1])) if dets.get('WAVEFUNCTION') else 0
    attractor = sum(dets.get('ATTRACTOR', [0]))/len(dets.get('ATTRACTOR', [1])) if dets.get('ATTRACTOR') else 0
    darkmatter = sum(dets.get('DARKMATTER', [0]))/len(dets.get('DARKMATTER', [1])) if dets.get('DARKMATTER') else 0
    entangle = sum(dets.get('ENTANGLE', [0]))/len(dets.get('ENTANGLE', [1])) if dets.get('ENTANGLE') else 0
    decoherence = sum(dets.get('DECOHERENCE', [0]))/len(dets.get('DECOHERENCE', [1])) if dets.get('DECOHERENCE') else 0
    hawking = sum(dets.get('HAWKING', [0]))/len(dets.get('HAWKING', [1])) if dets.get('HAWKING') else 0
    predator = sum(dets.get('PREDATOR', [0]))/len(dets.get('PREDATOR', [1])) if dets.get('PREDATOR') else 0

    print(f'{bsci_mean:.4f},{bsci_max:.4f},{bsci_min:.4f},{alerts},{watch},{cipher:.4f},{graviton:.4f},{accretor:.4f},{wavefunction:.4f},{attractor:.4f},{darkmatter:.4f},{entangle:.4f},{decoherence:.4f},{hawking:.4f},{predator:.4f}')

except Exception as e:
    print('ERROR')
" 2>/dev/null)

    if [ "$METRICS" = "ERROR" ] || [ -z "$METRICS" ]; then
        echo "[$(date -d '+3 hours' '+%H:%M:%S') МСК] ERROR: Parse failed"
        return 1
    fi

    # Записываем в CSV (время МСК UTC+3)
    echo "$(date -d '+3 hours' '+%Y-%m-%d %H:%M:%S'),$METRICS" >> "$OUTPUT_FILE"
    echo "[$(date -d '+3 hours' '+%H:%M:%S') МСК] OK: BSCI_mean=$(echo "$METRICS" | cut -d',' -f1)"
}

# Основной цикл — для cron запускаем один раз и выходим
# INTERVAL=300  # 5 минут

# echo "Starting Horizon Monitor..."
# echo "Output: $OUTPUT_FILE"
# echo "Interval: $INTERVAL seconds"
# echo "Press Ctrl+C to stop"
# echo ""

# Запускаем один раз для cron
measure

# Для ручного запуска можно раскомментировать:
# while true; do
#     measure
#     sleep $INTERVAL
# done