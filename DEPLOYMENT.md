# Deployment Guide

## Quick Deployment

### Option 1: Automatic (GitHub Actions) ⭐ Recommended
```bash
git add .
git commit -m "Your changes"
git push origin main
```
GitHub Actions automatically builds and deploys to staging.

### Option 2: Manual Deployment
```bash
# 1. Build and push Docker image (AMD64 for server)
docker buildx build --platform linux/amd64 -t ghcr.io/amiklosi/appgrid-backend:latest --push .

# 2. Deploy to Portainer
bash scripts/deploy-portainer.sh
```

## Environment Setup

Ensure `.env` has:
```
PORTAINER_URL=https://portainer.zekalogic.com
PORTAINER_ACCESS_TOKEN=your_token_here
PORTAINER_STACK_NAME=appgrid-backend-staging
POSTGRES_PASSWORD=your_secure_password
```

## Verify Deployment

```bash
# Health check
curl https://appgrid-staging.zekalogic.com/health

# List licenses
curl https://appgrid-staging.zekalogic.com/api/licenses
```

## Important Notes

- **Architecture**: Always build with `--platform linux/amd64` on Mac
- **Data Persistence**: PostgreSQL data persists in Docker volume across redeploys
- **Automatic Seeding**: Database seeds automatically on first deploy only
- **Schema Sync**: Uses `prisma db push` (no migrations needed)

## Staging URL
**https://appgrid-staging.zekalogic.com**
