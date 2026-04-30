#!/bin/bash
# JSONL cleanup script - удаляет файлы старше 20 дней

RETENTION_DAYS=20
DATA_DIR="/home/g/gorizont-sobytij/data"

echo "$(date): Starting JSONL cleanup (retention: $RETENTION_DAYS days)"

# Find and delete JSONL files older than RETENTION_DAYS
find "$DATA_DIR" -name "*.jsonl" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null

# Also clean up any broken symlinks
find "$DATA_DIR" -type l -delete 2>/dev/null

echo "$(date): Cleanup complete"