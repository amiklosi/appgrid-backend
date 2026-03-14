#!/bin/bash

# PostgreSQL Restore Script
# Restores the prod database from a backup file on the remote server

set -e

# Configuration
CONTAINER="appgrid-backend-prod-db-1"
DB_NAME="appgrid_db"
DB_USER="appgrid_user"
REMOTE_HOST="maci.attilamiklosi.net"
REMOTE_PATH="~/backups"

# Check argument
if [ -z "$1" ]; then
    echo "Usage: $0 <backup-filename>"
    echo ""
    echo "Available backups on $REMOTE_HOST:"
    ssh "$REMOTE_HOST" "ls -lht $REMOTE_PATH/appgrid_db_*.sql.gz"
    exit 1
fi

BACKUP_FILE="$1"
LOCAL_TMP="/tmp/$BACKUP_FILE"

echo "[INFO] Fetching $BACKUP_FILE from $REMOTE_HOST..."
scp "$REMOTE_HOST:$REMOTE_PATH/$BACKUP_FILE" "$LOCAL_TMP"

echo "[INFO] Restoring into container: $CONTAINER"
gunzip -c "$LOCAL_TMP" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"

echo "[INFO] Cleaning up local temp file"
rm "$LOCAL_TMP"

echo "[INFO] Verifying restore..."
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "\dt"

echo "[INFO] Restore complete!"
