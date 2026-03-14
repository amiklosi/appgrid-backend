#!/bin/bash

# PostgreSQL Backup Script
# Dumps the prod database from the Docker container and copies it to remote server

set -e

# Configuration
CONTAINER="appgrid-backend-prod-db-1"
DB_NAME="appgrid_db"
DB_USER="appgrid_user"
REMOTE_HOST="maci.attilamiklosi.net"
REMOTE_PATH="~/backups"
BACKUP_DIR="/tmp/appgrid-backups"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="appgrid_db_${DATE}.sql.gz"

# Create local temp directory
mkdir -p "$BACKUP_DIR"

echo "[INFO] Dumping database from container: $CONTAINER"
docker exec "$CONTAINER" \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --no-owner --no-privileges \
    | gzip > "$BACKUP_DIR/$BACKUP_FILE"

echo "[INFO] Backup created: $BACKUP_DIR/$BACKUP_FILE ($(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1))"

echo "[INFO] Copying to $REMOTE_HOST:$REMOTE_PATH/"
scp "$BACKUP_DIR/$BACKUP_FILE" "$REMOTE_HOST:$REMOTE_PATH/"

echo "[INFO] Cleaning up local file"
rm "$BACKUP_DIR/$BACKUP_FILE"

echo "[INFO] Removing remote backups older than 30 days"
ssh "$REMOTE_HOST" "find $REMOTE_PATH -name 'appgrid_db_*.sql.gz' -type f -mtime +30 -delete"

echo "[INFO] Done. Remote backups remaining: $(ssh "$REMOTE_HOST" "find $REMOTE_PATH -name 'appgrid_db_*.sql.gz' -type f | wc -l")"
