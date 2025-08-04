#!/bin/bash

# AppGrid Backend Health Check Script
# Monitors application health and sends alerts if needed

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

# Configuration
HEALTH_ENDPOINT="http://localhost:3000/health"
WEBHOOK_ENDPOINT="http://localhost:3000/webhook/revenuecat"
DB_ADMIN_ENDPOINT="http://localhost:8080"
LOG_FILE="data/logs/health-check.log"

# Create log directory if it doesn't exist
mkdir -p data/logs

# Function to log with timestamp
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Function to check if service responds
check_endpoint() {
    local endpoint=$1
    local name=$2
    local timeout=${3:-10}
    
    if curl -f -s --max-time "$timeout" "$endpoint" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to check Docker container status
check_container() {
    local service=$1
    if docker-compose -f docker-compose.prod.yml ps "$service" | grep -q "Up"; then
        return 0
    else
        return 1
    fi
}

# Function to get container stats
get_container_stats() {
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" $(docker-compose -f docker-compose.prod.yml ps -q) 2>/dev/null || echo "Unable to get container stats"
}

# Main health check
echo "🏥 AppGrid Backend Health Check - $(date)"
log_message "Starting health check"

OVERALL_STATUS="HEALTHY"

# Check Docker containers
print_status "Checking Docker containers..."

SERVICES=("app" "db" "adminer")
for service in "${SERVICES[@]}"; do
    if check_container "$service"; then
        print_success "$service container: RUNNING"
        log_message "$service container: RUNNING"
    else
        print_error "$service container: STOPPED"
        log_message "ERROR: $service container: STOPPED"
        OVERALL_STATUS="UNHEALTHY"
    fi
done

# Check application endpoints
print_status "Checking application endpoints..."

# Health endpoint
if check_endpoint "$HEALTH_ENDPOINT" "Health Check" 10; then
    print_success "Health endpoint: RESPONDING"
    log_message "Health endpoint: RESPONDING"
else
    print_error "Health endpoint: NOT RESPONDING"
    log_message "ERROR: Health endpoint: NOT RESPONDING"
    OVERALL_STATUS="UNHEALTHY"
fi

# Webhook endpoint (expect 401 without auth)
if curl -f -s --max-time 10 "$WEBHOOK_ENDPOINT" > /dev/null 2>&1; then
    print_success "Webhook endpoint: ACCESSIBLE"
    log_message "Webhook endpoint: ACCESSIBLE"
else
    # Check if it's a 401 (expected without auth)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$WEBHOOK_ENDPOINT" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "401" ]; then
        print_success "Webhook endpoint: ACCESSIBLE (401 auth required - expected)"
        log_message "Webhook endpoint: ACCESSIBLE (401)"
    else
        print_error "Webhook endpoint: NOT ACCESSIBLE (HTTP $HTTP_CODE)"
        log_message "ERROR: Webhook endpoint: NOT ACCESSIBLE (HTTP $HTTP_CODE)"
        OVERALL_STATUS="UNHEALTHY"
    fi
fi

# Database admin endpoint
if check_endpoint "$DB_ADMIN_ENDPOINT" "Database Admin" 5; then
    print_success "Database admin: ACCESSIBLE"
    log_message "Database admin: ACCESSIBLE"
else
    print_warning "Database admin: NOT ACCESSIBLE"
    log_message "WARNING: Database admin: NOT ACCESSIBLE"
fi

# Check database connectivity
print_status "Checking database connectivity..."
if docker-compose -f docker-compose.prod.yml exec -T db pg_isready -U appgrid_user -d appgrid_db > /dev/null 2>&1; then
    print_success "Database: CONNECTED"
    log_message "Database: CONNECTED"
else
    print_error "Database: CONNECTION FAILED"
    log_message "ERROR: Database: CONNECTION FAILED"
    OVERALL_STATUS="UNHEALTHY"
fi

# System resource check
print_status "Checking system resources..."

# Memory usage
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100.0}')
if [ "$MEMORY_USAGE" -gt 90 ]; then
    print_error "Memory usage: ${MEMORY_USAGE}% (HIGH)"
    log_message "ERROR: Memory usage: ${MEMORY_USAGE}% (HIGH)"
    OVERALL_STATUS="UNHEALTHY"
elif [ "$MEMORY_USAGE" -gt 80 ]; then
    print_warning "Memory usage: ${MEMORY_USAGE}% (WARNING)"
    log_message "WARNING: Memory usage: ${MEMORY_USAGE}%"
else
    print_success "Memory usage: ${MEMORY_USAGE}% (OK)"
    log_message "Memory usage: ${MEMORY_USAGE}%"
fi

# Disk usage
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 90 ]; then
    print_error "Disk usage: ${DISK_USAGE}% (HIGH)"
    log_message "ERROR: Disk usage: ${DISK_USAGE}% (HIGH)"
    OVERALL_STATUS="UNHEALTHY"
elif [ "$DISK_USAGE" -gt 80 ]; then
    print_warning "Disk usage: ${DISK_USAGE}% (WARNING)"
    log_message "WARNING: Disk usage: ${DISK_USAGE}%"
else
    print_success "Disk usage: ${DISK_USAGE}% (OK)"
    log_message "Disk usage: ${DISK_USAGE}%"
fi

# Container stats
print_status "Container resource usage:"
get_container_stats

# Overall status
echo
if [ "$OVERALL_STATUS" = "HEALTHY" ]; then
    print_success "🎉 Overall Status: HEALTHY"
    log_message "Overall Status: HEALTHY"
    exit 0
else
    print_error "❌ Overall Status: UNHEALTHY"
    log_message "Overall Status: UNHEALTHY"
    
    # Optional: Send alert (uncomment and configure)
    # curl -X POST "https://hooks.slack.com/your-webhook-url" \
    #      -H 'Content-type: application/json' \
    #      --data '{"text":"AppGrid Backend is UNHEALTHY! Check server immediately."}'
    
    exit 1
fi