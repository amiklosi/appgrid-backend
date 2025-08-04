#!/bin/bash

# AppGrid Backend Status Script
# Shows comprehensive status of all services

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

echo "📊 AppGrid Backend Status - $(date)"
echo

# Check if docker-compose file exists
if [ ! -f "docker-compose.prod.yml" ]; then
    print_error "docker-compose.prod.yml not found"
    exit 1
fi

# Container Status
print_header "Container Status"
docker-compose -f docker-compose.prod.yml ps
echo

# Service Health Checks
print_header "Service Health Checks"

# App health check
if curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
    print_success "Application: HEALTHY"
else
    print_error "Application: UNHEALTHY"
fi

# Database check
if docker-compose -f docker-compose.prod.yml exec -T db pg_isready -U appgrid_user -d appgrid_db > /dev/null 2>&1; then
    print_success "Database: CONNECTED"
else
    print_error "Database: DISCONNECTED"
fi

# Adminer check
if curl -f -s http://localhost:8080 > /dev/null 2>&1; then
    print_success "Database Admin: ACCESSIBLE"
else
    print_warning "Database Admin: NOT ACCESSIBLE"
fi

echo

# Resource Usage
print_header "Resource Usage"

# Container stats
if command -v docker &> /dev/null; then
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}" $(docker-compose -f docker-compose.prod.yml ps -q) 2>/dev/null || echo "Unable to get container stats"
fi

echo

# System Resources
print_header "System Resources"

# Memory
MEMORY_INFO=$(free -h | grep Mem)
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
echo "Memory: $MEMORY_INFO"
if [ "$MEMORY_USAGE" -gt 80 ]; then
    print_warning "Memory usage: ${MEMORY_USAGE}%"
else
    print_success "Memory usage: ${MEMORY_USAGE}%"
fi

# Disk space
DISK_INFO=$(df -h / | tail -1)
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
echo "Disk: $DISK_INFO"
if [ "$DISK_USAGE" -gt 80 ]; then
    print_warning "Disk usage: ${DISK_USAGE}%"
else
    print_success "Disk usage: ${DISK_USAGE}%"
fi

echo

# Network Connectivity
print_header "Network Connectivity"

# Check if ports are listening
if netstat -tuln 2>/dev/null | grep -q ":3000 "; then
    print_success "Port 3000: LISTENING"
else
    print_error "Port 3000: NOT LISTENING"
fi

if netstat -tuln 2>/dev/null | grep -q ":5432 "; then
    print_success "Port 5432: LISTENING"
else
    print_error "Port 5432: NOT LISTENING"
fi

if netstat -tuln 2>/dev/null | grep -q ":8080 "; then
    print_success "Port 8080: LISTENING"
else
    print_warning "Port 8080: NOT LISTENING"
fi

echo

# Database Info
print_header "Database Information"
if docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db -c "SELECT current_database(), current_user, version();" 2>/dev/null; then
    echo
    echo "Database size:"
    docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db -c "SELECT pg_size_pretty(pg_database_size('appgrid_db')) as database_size;" 2>/dev/null
    echo
    echo "Table sizes:"
    docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db -c "SELECT schemaname,tablename,pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size FROM pg_tables WHERE schemaname='public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;" 2>/dev/null
else
    print_error "Unable to connect to database"
fi

echo

# Recent Activity
print_header "Recent Activity"
echo "Last 5 webhook events (if any):"
docker-compose -f docker-compose.prod.yml exec -T db psql -U appgrid_user -d appgrid_db -c "SELECT created_at, event_type, app_user_id, processed_successfully FROM webhook_events ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || echo "No webhook events or unable to query database"

echo

# Access Points
print_header "Access Points"
echo "🌐 Application: http://localhost:3000"
echo "🪝 Webhook: http://localhost:3000/webhook/revenuecat"
echo "🏥 Health Check: http://localhost:3000/health"
echo "🗄️  Database Admin: http://localhost:8080"
echo "📊 Container Stats: docker-compose -f docker-compose.prod.yml stats"
echo "📋 Logs: ./scripts/logs.sh"

echo
print_success "✅ Status check completed!"