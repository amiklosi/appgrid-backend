#!/bin/bash

# Portainer Deployment Script
# This script manually deploys or updates the stack in Portainer

set -e  # Exit on any error

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

# Check required tools
if ! command -v curl &> /dev/null; then
    print_error "curl is not installed. Please install curl first."
    exit 1
fi

if ! command -v jq &> /dev/null; then
    print_error "jq is not installed. Please install jq first."
    exit 1
fi

# Load environment variables
if [ -f ".env" ]; then
    source .env
else
    print_error ".env file not found"
    exit 1
fi

# Validate required variables
if [ -z "$PORTAINER_URL" ]; then
    print_error "PORTAINER_URL not set in .env"
    exit 1
fi

if [ -z "$PORTAINER_ACCESS_TOKEN" ]; then
    print_error "PORTAINER_ACCESS_TOKEN not set in .env"
    exit 1
fi

if [ -z "$PORTAINER_STACK_NAME" ]; then
    PORTAINER_STACK_NAME="appgrid-backend"
    print_warning "PORTAINER_STACK_NAME not set, using default: ${PORTAINER_STACK_NAME}"
fi

if [ -z "$POSTGRES_PASSWORD" ]; then
    print_error "POSTGRES_PASSWORD not set in .env"
    exit 1
fi

if [ -z "$MAILGUN_API_KEY" ]; then
    print_error "MAILGUN_API_KEY not set in .env"
    exit 1
fi

if [ -z "$MAILGUN_DOMAIN" ]; then
    print_error "MAILGUN_DOMAIN not set in .env"
    exit 1
fi

if [ -z "$REVENUECAT_API_KEY" ]; then
    print_error "REVENUECAT_API_KEY not set in .env"
    exit 1
fi

if [ -z "$REVENUECAT_PROJECT_ID" ]; then
    print_error "REVENUECAT_PROJECT_ID not set in .env"
    exit 1
fi

print_status "🚀 Starting Portainer deployment..."
print_status "Portainer URL: ${PORTAINER_URL}"
print_status "Stack Name: ${PORTAINER_STACK_NAME}"

# Get Portainer endpoint ID
print_status "Getting Portainer endpoint..."
ENDPOINT_ID=$(curl -s -H "X-API-Key: ${PORTAINER_ACCESS_TOKEN}" \
    "${PORTAINER_URL}/api/endpoints" | jq -r '.[0].Id')

if [ -z "$ENDPOINT_ID" ] || [ "$ENDPOINT_ID" = "null" ]; then
    print_error "Failed to get Portainer endpoint"
    exit 1
fi

print_success "Using endpoint ID: ${ENDPOINT_ID}"

# Check if stack exists
print_status "Checking if stack exists..."
STACK_ID=$(curl -s -H "X-API-Key: ${PORTAINER_ACCESS_TOKEN}" \
    "${PORTAINER_URL}/api/stacks" | \
    jq -r ".[] | select(.Name==\"${PORTAINER_STACK_NAME}\") | .Id")

# Determine which compose file to use
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.staging.yml}"

if [ ! -f "$COMPOSE_FILE" ]; then
    print_error "$COMPOSE_FILE not found"
    exit 1
fi

print_status "Using compose file: $COMPOSE_FILE"
COMPOSE_CONTENT=$(cat "$COMPOSE_FILE")

if [ -z "$STACK_ID" ]; then
    print_status "Creating new stack: ${PORTAINER_STACK_NAME}"

    # Create new stack
    RESPONSE=$(curl -s -X POST "${PORTAINER_URL}/api/stacks/create/standalone/string?endpointId=${ENDPOINT_ID}" \
        -H "X-API-Key: ${PORTAINER_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        -d @- <<EOF
{
  "name": "${PORTAINER_STACK_NAME}",
  "stackFileContent": $(echo "$COMPOSE_CONTENT" | jq -Rs .),
  "env": [
    {"name": "POSTGRES_PASSWORD", "value": "${POSTGRES_PASSWORD}"},
    {"name": "MAILGUN_API_KEY", "value": "${MAILGUN_API_KEY}"},
    {"name": "MAILGUN_DOMAIN", "value": "${MAILGUN_DOMAIN}"},
    {"name": "REVENUECAT_API_KEY", "value": "${REVENUECAT_API_KEY}"},
    {"name": "REVENUECAT_PROJECT_ID", "value": "${REVENUECAT_PROJECT_ID}"}
  ]
}
EOF
    )

    if echo "$RESPONSE" | jq -e '.Id' > /dev/null 2>&1; then
        print_success "Stack created successfully"
        STACK_ID=$(echo "$RESPONSE" | jq -r '.Id')
    else
        print_error "Failed to create stack"
        echo "$RESPONSE" | jq .
        exit 1
    fi
else
    print_status "Updating existing stack: ${PORTAINER_STACK_NAME} (ID: ${STACK_ID})"

    # Update existing stack
    RESPONSE=$(curl -s -X PUT "${PORTAINER_URL}/api/stacks/${STACK_ID}?endpointId=${ENDPOINT_ID}" \
        -H "X-API-Key: ${PORTAINER_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        -d @- <<EOF
{
  "stackFileContent": $(echo "$COMPOSE_CONTENT" | jq -Rs .),
  "env": [
    {"name": "POSTGRES_PASSWORD", "value": "${POSTGRES_PASSWORD}"},
    {"name": "MAILGUN_API_KEY", "value": "${MAILGUN_API_KEY}"},
    {"name": "MAILGUN_DOMAIN", "value": "${MAILGUN_DOMAIN}"},
    {"name": "REVENUECAT_API_KEY", "value": "${REVENUECAT_API_KEY}"},
    {"name": "REVENUECAT_PROJECT_ID", "value": "${REVENUECAT_PROJECT_ID}"}
  ],
  "prune": false,
  "pullImage": true
}
EOF
    )

    if echo "$RESPONSE" | jq -e '.Id' > /dev/null 2>&1; then
        print_success "Stack updated successfully"
    else
        print_error "Failed to update stack"
        echo "$RESPONSE" | jq .
        exit 1
    fi
fi

# Wait for deployment
print_status "Waiting for deployment to complete..."
sleep 10

# Get stack status
print_status "Getting stack status..."
STACK_INFO=$(curl -s -H "X-API-Key: ${PORTAINER_ACCESS_TOKEN}" \
    "${PORTAINER_URL}/api/stacks/${STACK_ID}")

if [ -n "$STACK_INFO" ]; then
    print_success "✅ Deployment completed!"
    echo
    echo -e "${BLUE}Stack Information:${NC}"
    echo "$STACK_INFO" | jq '{Name, Status, Env, CreationDate, UpdateDate}'
else
    print_error "Failed to retrieve stack information"
    exit 1
fi

print_success "🎉 Portainer deployment successful!"
