#!/bin/bash

# AppGrid Backend Deployment Script
# This script deploys the application using Docker Compose

set -e  # Exit on any error

echo "🚀 Starting AppGrid Backend deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_warning ".env file not found. Creating from template..."
    if [ -f ".env.production" ]; then
        cp .env.production .env
        print_warning "Please edit .env file with your configuration:"
        print_warning "  - POSTGRES_PASSWORD=your_secure_password"
        print_warning "  - REVENUECAT_AUTH_TOKEN=your_token"
        print_error "Edit .env file and run this script again."
        exit 1
    else
        print_error "No .env template found. Please create .env file manually."
        exit 1
    fi
fi

# Validate required environment variables
print_status "Validating environment configuration..."

if ! grep -q "POSTGRES_PASSWORD=" .env || grep -q "POSTGRES_PASSWORD=your_secure_database_password" .env; then
    print_error "POSTGRES_PASSWORD not configured in .env file"
    exit 1
fi

if ! grep -q "REVENUECAT_AUTH_TOKEN=" .env || grep -q "REVENUECAT_AUTH_TOKEN=your_production_revenuecat_auth_token" .env; then
    print_error "REVENUECAT_AUTH_TOKEN not configured in .env file"
    exit 1
fi

print_success "Environment configuration validated"

# Create data directories if they don't exist
print_status "Creating data directories..."
mkdir -p data/{postgres,backups,logs}
chmod 700 data/postgres
chmod 755 data/{backups,logs}
print_success "Data directories created"

# Stop existing containers if running
print_status "Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true
print_success "Existing containers stopped"

# Pull latest images
print_status "Pulling Docker images..."
docker-compose -f docker-compose.prod.yml pull

# Build and start services
print_status "Building and starting services..."
docker-compose -f docker-compose.prod.yml up -d --build

# Wait for services to be healthy
print_status "Waiting for services to start..."
sleep 10

# Check if services are running
print_status "Checking service status..."

if docker-compose -f docker-compose.prod.yml ps | grep -q "Up"; then
    print_success "Services are running"
else
    print_error "Some services failed to start"
    docker-compose -f docker-compose.prod.yml logs
    exit 1
fi

# Verify database initialization
print_status "Verifying database initialization..."
sleep 5

if docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db -c "\d" > /dev/null 2>&1; then
    TABLE_COUNT=$(docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db -c "\d" 2>/dev/null | grep -c "table" || echo "0")
    if [ "$TABLE_COUNT" -ge "5" ]; then
        print_success "Database initialized successfully with $TABLE_COUNT tables"
    else
        print_warning "Database has only $TABLE_COUNT tables (expected 5+)"
    fi
else
    print_error "Database connection failed during verification"
fi

# Test application health
print_status "Testing application health..."
sleep 5

if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    print_success "Application health check passed"
else
    print_warning "Application health check failed - it may still be starting"
fi

# Show service status
print_status "Service Status:"
docker-compose -f docker-compose.prod.yml ps

print_success "🎉 Deployment completed successfully!"
echo
echo -e "${BLUE}📍 Access Points:${NC}"
echo "  • API: http://localhost:3000"
echo "  • Webhook: http://localhost:3000/webhook/revenuecat"
echo "  • Database Admin: http://localhost:8080"
echo "  • Health Check: http://localhost:3000/health"
echo
echo -e "${BLUE}📊 Useful Commands:${NC}"
echo "  • View logs: docker-compose -f docker-compose.prod.yml logs -f"
echo "  • Stop services: docker-compose -f docker-compose.prod.yml down"
echo "  • Restart services: docker-compose -f docker-compose.prod.yml restart"
echo "  • Update: ./scripts/update.sh"
echo "  • Backup: ./scripts/backup.sh"
echo
echo -e "${YELLOW}🛠️  Troubleshooting:${NC}"
echo "  • If database tables are missing, remove volumes and redeploy:"
echo "    docker-compose -f docker-compose.prod.yml down -v"
echo "    ./scripts/deploy.sh"
echo "  • Check service health: ./scripts/health-check.sh"
echo
print_success "AppGrid Backend is ready for production!"