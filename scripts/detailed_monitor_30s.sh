#!/bin/bash
# detailed_monitor_30s.sh — запускает детальный мониторинг дважды с интервалом 30 секунд
# Вызывать из cron каждую минуту

SCRIPT_DIR="/home/g/orizont-sobytij/scripts"
LOG_FILE="/home/g/orizont-sobytij/data/detailed_monitor.log"

# Первый запуск
"$SCRIPT_DIR/detailed_monitor.sh"

# Ждём 30 секунд
sleep 30

# Второй запуск
"$SCRIPT_DIR/detailed_monitor.sh"