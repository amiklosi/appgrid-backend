#!/bin/bash

# AppGrid Backend Docker Image Build Script
# Builds and optionally pushes Docker image to GitHub Container Registry

set -e

echo "🐳 Building AppGrid Backend Docker Image..."

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

# Configuration
REGISTRY="ghcr.io"
USERNAME="amiklosi"
IMAGE_NAME="appgrid-backend"
FULL_IMAGE_NAME="${REGISTRY}/${USERNAME}/${IMAGE_NAME}"

# Parse arguments
PUSH=false
TAG="latest"

while [[ $# -gt 0 ]]; do
    case $1 in
        --push)
            PUSH=true
            shift
            ;;
        --tag)
            TAG="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--push] [--tag TAG]"
            echo ""
            echo "Options:"
            echo "  --push       Push image to registry after building"
            echo "  --tag TAG    Tag for the image (default: latest)"
            echo "  -h, --help   Show this help"
            echo ""
            echo "Examples:"
            echo "  $0                    # Build image locally"
            echo "  $0 --push            # Build and push to registry"
            echo "  $0 --tag v1.0 --push # Build and push with specific tag"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not in PATH"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "Dockerfile" ]; then
    print_error "Dockerfile not found. Make sure you're in the project root directory."
    exit 1
fi

# Build the image
print_status "Building Docker image..."
print_status "Image: ${FULL_IMAGE_NAME}:${TAG}"

# Build with BuildKit for better performance
export DOCKER_BUILDKIT=1

docker build \
    --tag "${FULL_IMAGE_NAME}:${TAG}" \
    --tag "${FULL_IMAGE_NAME}:latest" \
    --label "org.opencontainers.image.source=https://github.com/${USERNAME}/${IMAGE_NAME}" \
    --label "org.opencontainers.image.description=AppGrid Backend - RevenueCat webhook server" \
    --label "org.opencontainers.image.created=$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
    .

print_success "Docker image built successfully!"

# Show image info
print_status "Image information:"
docker images "${FULL_IMAGE_NAME}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"

# Push if requested
if [ "$PUSH" = true ]; then
    print_status "Preparing to push image to registry..."
    
    # Check if user is logged in to registry
    if ! docker info | grep -q "Registry:"; then
        print_warning "You may need to login to the registry first:"
        print_warning "echo \$GITHUB_TOKEN | docker login ${REGISTRY} -u ${USERNAME} --password-stdin"
        echo -n "Do you want to continue with push? (y/n): "
        read -r CONFIRM
        if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
            print_status "Push cancelled"
            exit 0
        fi
    fi
    
    print_status "Pushing image to registry..."
    
    # Push both tags
    docker push "${FULL_IMAGE_NAME}:${TAG}"
    if [ "$TAG" != "latest" ]; then
        docker push "${FULL_IMAGE_NAME}:latest"
    fi
    
    print_success "Image pushed successfully!"
    print_status "Image available at: ${FULL_IMAGE_NAME}:${TAG}"
else
    print_status "Image built locally. To push to registry, run:"
    print_status "$0 --push"
fi

echo
print_success "🎉 Build completed successfully!"
echo
print_status "Next steps:"
echo "  • Test locally: docker run --rm -p 3000:3000 ${FULL_IMAGE_NAME}:${TAG}"
echo "  • Push to registry: $0 --push"
echo "  • Use in docker-compose.prod.yml: image: ${FULL_IMAGE_NAME}:${TAG}"