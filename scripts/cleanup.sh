#!/bin/bash

# AppGrid Backend Cleanup Script
# Cleans up Docker images, containers, and old backups

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

echo "🧹 AppGrid Backend Cleanup - $(date)"

# Function to get size before and after
get_docker_space() {
    docker system df | grep "Total" | awk '{print $4}'
}

SPACE_BEFORE=$(get_docker_space)
print_status "Docker space usage before cleanup: $SPACE_BEFORE"

echo

# Clean up stopped containers
print_status "Removing stopped containers..."
STOPPED_CONTAINERS=$(docker container prune -f 2>&1 | grep "Total reclaimed space" || echo "No stopped containers to remove")
echo "$STOPPED_CONTAINERS"

# Clean up unused images
print_status "Removing unused Docker images..."
UNUSED_IMAGES=$(docker image prune -f 2>&1 | grep "Total reclaimed space" || echo "No unused images to remove")
echo "$UNUSED_IMAGES"

# Clean up unused volumes (be careful with this)
print_status "Checking for unused volumes..."
UNUSED_VOLUMES=$(docker volume ls -qf dangling=true)
if [ -n "$UNUSED_VOLUMES" ]; then
    print_warning "Found unused volumes (NOT removing automatically for safety):"
    docker volume ls -f dangling=true
    print_warning "To remove manually: docker volume prune"
else
    print_success "No unused volumes found"
fi

# Clean up unused networks
print_status "Removing unused networks..."
UNUSED_NETWORKS=$(docker network prune -f 2>&1 | grep "Total reclaimed space" || echo "No unused networks to remove")
echo "$UNUSED_NETWORKS"

# Clean up build cache
print_status "Removing Docker build cache..."
BUILD_CACHE=$(docker builder prune -f 2>&1 | grep "Total reclaimed space" || echo "No build cache to remove")
echo "$BUILD_CACHE"

echo

# Clean up old backups (keep last 30 days)
print_status "Cleaning up old database backups (keeping last 30 days)..."
if [ -d "data/backups" ]; then
    OLD_BACKUPS=$(find data/backups -name "*.sql.gz" -mtime +30 -type f)
    if [ -n "$OLD_BACKUPS" ]; then
        echo "Removing old backups:"
        find data/backups -name "*.sql.gz" -mtime +30 -type f -print -delete
        print_success "Old backups removed"
    else
        print_success "No old backups to remove"
    fi
else
    print_status "No backup directory found"
fi

# Clean up old log files (keep last 7 days)
print_status "Cleaning up old log files (keeping last 7 days)..."
if [ -d "data/logs" ]; then
    OLD_LOGS=$(find data/logs -name "*.log" -mtime +7 -type f)
    if [ -n "$OLD_LOGS" ]; then
        echo "Removing old logs:"
        find data/logs -name "*.log" -mtime +7 -type f -print -delete
        print_success "Old logs removed"
    else
        print_success "No old logs to remove"
    fi
else
    print_status "No logs directory found"
fi

echo

# Show space savings
SPACE_AFTER=$(get_docker_space)
print_status "Docker space usage after cleanup: $SPACE_AFTER"

# Show current status
print_status "Current Docker system usage:"
docker system df

echo

# Show current backups
print_status "Current backups:"
if [ -d "data/backups" ]; then
    ls -lh data/backups/*.sql.gz 2>/dev/null || echo "No backup files found"
else
    echo "No backup directory found"
fi

echo

# Restart containers to free up any memory leaks
print_status "Restarting containers to free up memory..."
docker-compose -f docker-compose.prod.yml restart

# Wait a moment for services to come back up
sleep 10

# Quick health check
print_status "Performing health check after cleanup..."
if curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
    print_success "✅ Cleanup completed successfully - Application is healthy!"
else
    print_warning "⚠️  Cleanup completed but health check failed - check application status"
    docker-compose -f docker-compose.prod.yml ps
fi

echo
print_success "🎉 Cleanup completed!"
print_status "Space saved: Previous($SPACE_BEFORE) → Current($SPACE_AFTER)"