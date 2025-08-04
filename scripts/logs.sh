#!/bin/bash

# AppGrid Backend Logs Viewer Script
# Easy access to application logs

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
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

# Function to show usage
show_usage() {
    echo "Usage: $0 [service] [options]"
    echo ""
    echo "Services:"
    echo "  all      - All services (default)"
    echo "  app      - Application container"
    echo "  db       - Database container"
    echo "  adminer  - Database admin container"
    echo ""
    echo "Options:"
    echo "  -f, --follow    Follow log output (live)"
    echo "  -t, --tail N    Show last N lines (default: 50)"
    echo "  -h, --help      Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                 # Show last 50 lines of all services"
    echo "  $0 app -f          # Follow app logs live"
    echo "  $0 db -t 100       # Show last 100 lines of database logs"
}

# Default values
SERVICE="all"
FOLLOW=""
TAIL="50"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        app|db|adminer|all)
            SERVICE="$1"
            shift
            ;;
        -f|--follow)
            FOLLOW="-f"
            TAIL=""
            shift
            ;;
        -t|--tail)
            TAIL="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Check if docker-compose file exists
if [ ! -f "docker-compose.prod.yml" ]; then
    echo "Error: docker-compose.prod.yml not found"
    echo "Make sure you're running this from the project root directory"
    exit 1
fi

# Build docker-compose command
COMPOSE_CMD="docker-compose -f docker-compose.prod.yml logs"

if [ -n "$FOLLOW" ]; then
    COMPOSE_CMD="$COMPOSE_CMD $FOLLOW"
fi

if [ -n "$TAIL" ]; then
    COMPOSE_CMD="$COMPOSE_CMD --tail=$TAIL"
fi

if [ "$SERVICE" != "all" ]; then
    COMPOSE_CMD="$COMPOSE_CMD $SERVICE"
fi

# Show what we're doing
if [ "$SERVICE" = "all" ]; then
    SERVICE_MSG="all services"
else
    SERVICE_MSG="$SERVICE service"
fi

if [ -n "$FOLLOW" ]; then
    print_status "Following logs for $SERVICE_MSG (Press Ctrl+C to stop)..."
else
    print_status "Showing last $TAIL lines for $SERVICE_MSG..."
fi

echo "----------------------------------------"

# Execute the command
eval $COMPOSE_CMD