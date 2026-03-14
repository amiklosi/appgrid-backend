#!/bin/bash

# Web Folder Backup Script
# Tars the ~/web folder and copies it to remote server

set -e

# Configuration
REMOTE_HOST="maci.attilamiklosi.net"
REMOTE_PATH="~/backups"
BACKUP_DIR="/tmp/appgrid-backups"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="web_${DATE}.tar.gz"

# Create local temp directory
mkdir -p "$BACKUP_DIR"

echo "[INFO] Creating tar of ~/web..."
tar -czf "$BACKUP_DIR/$BACKUP_FILE" \
    --exclude="web/nginx-proxy/volumes/nginx/certs" \
    --exclude="web/nginx-proxy/volumes/nginx/acme" \
    --exclude="web/nginx-proxy/volumes/nginx/conf.d" \
    --warning=no-file-changed \
    -C "$HOME" web || [ $? -eq 1 ]

echo "[INFO] Backup created: $BACKUP_DIR/$BACKUP_FILE ($(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1))"

echo "[INFO] Copying to $REMOTE_HOST:$REMOTE_PATH/"
scp "$BACKUP_DIR/$BACKUP_FILE" "$REMOTE_HOST:$REMOTE_PATH/"

echo "[INFO] Cleaning up local file"
rm "$BACKUP_DIR/$BACKUP_FILE"

echo "[INFO] Removing remote backups older than 30 days"
ssh "$REMOTE_HOST" "find $REMOTE_PATH -name 'web_*.tar.gz' -type f -mtime +30 -delete"

echo "[INFO] Done. Remote backups remaining: $(ssh "$REMOTE_HOST" "find $REMOTE_PATH -name 'web_*.tar.gz' -type f | wc -l")"
