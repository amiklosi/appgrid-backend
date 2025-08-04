#!/bin/bash

# AppGrid Backend Update Script
# Updates the application from Git and restarts services

set -e

echo "🔄 Starting AppGrid Backend update..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Backup before update
print_status "Creating backup before update..."
./scripts/backup.sh

# Check for uncommitted changes
if ! git diff --quiet; then
    print_warning "Uncommitted changes detected. Stashing..."
    git stash
fi

# Pull latest changes
print_status "Pulling latest changes from Git..."
git pull origin main

# Check if docker-compose files changed
if git diff --name-only HEAD@{1} HEAD | grep -q "docker-compose"; then
    print_status "Docker Compose configuration changed, rebuilding..."
    REBUILD=true
else
    REBUILD=false
fi

# Update services
print_status "Updating services..."

if [ "$REBUILD" = true ]; then
    print_status "Rebuilding containers with new configuration..."
    docker-compose -f docker-compose.prod.yml up -d --build
else
    print_status "Restarting containers..."
    docker-compose -f docker-compose.prod.yml pull
    docker-compose -f docker-compose.prod.yml up -d
fi

# Wait for services to restart
print_status "Waiting for services to restart..."
sleep 15

# Health check
print_status "Performing health check..."
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    print_success "Health check passed"
else
    print_error "Health check failed"
    print_status "Service logs:"
    docker-compose -f docker-compose.prod.yml logs --tail=20
    exit 1
fi

# Clean up old images
print_status "Cleaning up old Docker images..."
docker image prune -f

print_success "✅ Update completed successfully!"
print_status "Current status:"
docker-compose -f docker-compose.prod.yml ps