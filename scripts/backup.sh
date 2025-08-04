#!/bin/bash

# AppGrid Backend Database Backup Script
# Creates a backup of the PostgreSQL database

set -e

echo "💾 Starting database backup..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create backup directory if it doesn't exist
mkdir -p data/backups

# Generate backup filename with timestamp
BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="data/backups/appgrid_backup_${BACKUP_DATE}.sql"

# Check if database container is running
if ! docker-compose -f docker-compose.prod.yml ps db | grep -q "Up"; then
    print_error "Database container is not running"
    exit 1
fi

print_status "Creating database backup..."
print_status "Backup file: ${BACKUP_FILE}"

# Create backup
docker-compose -f docker-compose.prod.yml exec -T db pg_dump -U appgrid_user -d appgrid_db > "${BACKUP_FILE}"

# Check if backup was successful
if [ -s "${BACKUP_FILE}" ]; then
    # Compress backup
    gzip "${BACKUP_FILE}"
    BACKUP_FILE="${BACKUP_FILE}.gz"
    
    # Get backup size
    BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    
    print_success "Backup created successfully!"
    print_status "File: ${BACKUP_FILE}"
    print_status "Size: ${BACKUP_SIZE}"
    
    # Clean up old backups (keep last 7 days)
    print_status "Cleaning up old backups (keeping last 7 days)..."
    find data/backups -name "appgrid_backup_*.sql.gz" -mtime +7 -delete
    
    # List current backups
    print_status "Available backups:"
    ls -lh data/backups/appgrid_backup_*.sql.gz 2>/dev/null || echo "No backups found"
    
else
    print_error "Backup failed - file is empty or not created"
    rm -f "${BACKUP_FILE}"
    exit 1
fi

print_success "✅ Database backup completed successfully!"