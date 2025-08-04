#!/bin/bash

# AppGrid Backend Database Restore Script
# Restores database from backup file

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
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

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if backup file is provided
if [ $# -eq 0 ]; then
    print_error "Usage: $0 <backup_file>"
    print_status "Available backups:"
    ls -1 data/backups/appgrid_backup_*.sql.gz 2>/dev/null || echo "No backups found"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    # Try to find it in backups directory
    if [ -f "data/backups/$BACKUP_FILE" ]; then
        BACKUP_FILE="data/backups/$BACKUP_FILE"
    else
        print_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi
fi

print_warning "⚠️  WARNING: This will replace all current data!"
print_status "Backup file: $BACKUP_FILE"
echo -n "Are you sure you want to continue? (yes/no): "
read -r CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    print_status "Restore cancelled"
    exit 0
fi

# Check if database container is running
if ! docker-compose -f docker-compose.prod.yml ps db | grep -q "Up"; then
    print_error "Database container is not running"
    print_status "Starting database..."
    docker-compose -f docker-compose.prod.yml up -d db
    sleep 10
fi

print_status "Creating backup of current database before restore..."
CURRENT_BACKUP="data/backups/pre_restore_backup_$(date +"%Y%m%d_%H%M%S").sql"
docker-compose -f docker-compose.prod.yml exec -T db pg_dump -U appgrid_user -d appgrid_db > "$CURRENT_BACKUP"
gzip "$CURRENT_BACKUP"
print_success "Current database backed up to: ${CURRENT_BACKUP}.gz"

print_status "Stopping application to prevent connections..."
docker-compose -f docker-compose.prod.yml stop app

print_status "Dropping and recreating database..."
docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d postgres -c "DROP DATABASE IF EXISTS appgrid_db;"
docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d postgres -c "CREATE DATABASE appgrid_db;"

print_status "Restoring database from backup..."

# Check if backup is compressed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    zcat "$BACKUP_FILE" | docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db
else
    cat "$BACKUP_FILE" | docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db
fi

print_status "Restarting application..."
docker-compose -f docker-compose.prod.yml start app

# Wait for application to start
sleep 10

# Health check
print_status "Performing health check..."
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    print_success "✅ Database restore completed successfully!"
    print_success "Application is running and healthy"
else
    print_error "Restore completed but health check failed"
    print_status "Check application logs:"
    docker-compose -f docker-compose.prod.yml logs --tail=20 app
fi

print_status "Current service status:"
docker-compose -f docker-compose.prod.yml ps