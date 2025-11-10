# Docker Compose Setup Guide

This project uses different Docker Compose configurations for different environments.

## Overview

| File | Environment | Database | Use Case |
|------|-------------|----------|----------|
| `docker-compose.yml` | Local | PostgreSQL | Test with PostgreSQL locally before deploying |
| `docker-compose.staging.yml` | Staging | PostgreSQL | Test in production-like environment |
| `docker-compose.prod.yml` | Production | PostgreSQL | Production deployment |

## Local Development

### Option 1: SQLite (No Docker) ⚡ Recommended for development

```bash
yarn install
yarn prisma:migrate:dev
yarn dev
```

**Best for:**
- Fast iteration
- Initial development
- No Docker overhead

### Option 2: PostgreSQL with Docker 🐳 For testing before deployment

```bash
# Start PostgreSQL and app with hot reload
docker-compose up

# Or just the database
docker-compose up db

# Then run app locally against Docker PostgreSQL
yarn dev
```

**Best for:**
- Testing PostgreSQL-specific features
- Validating migrations
- Pre-deployment testing

Access:
- App: `http://localhost:3000`
- Database: `localhost:5432`
- Adminer: `http://localhost:8080`

## Staging Deployment

Uses `docker-compose.staging.yml`

```bash
# Deploy to staging
docker-compose -f docker-compose.staging.yml up -d

# View logs
docker-compose -f docker-compose.staging.yml logs -f

# Stop staging
docker-compose -f docker-compose.staging.yml down
```

Access:
- App: `https://appgrid-staging.zekalogic.com`
- Health: `https://appgrid-staging.zekalogic.com/health`

**Environment:**
- Virtual Host: `appgrid-staging.zekalogic.com`
- SSL: Automatic via Let's Encrypt
- Image: Pulled from GHCR

## Production Deployment

Uses `docker-compose.prod.yml`

```bash
# Deploy to production
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop production
docker-compose -f docker-compose.prod.yml down
```

Access:
- App: `https://appgrid.zekalogic.com`
- Health: `https://appgrid.zekalogic.com/health`

**Environment:**
- Virtual Host: `appgrid.zekalogic.com`
- SSL: Automatic via Let's Encrypt
- Image: Pulled from GHCR

## Database Configuration

### Local (docker-compose.yml)

```yaml
environment:
  - DATABASE_URL=postgresql://appgrid_user:appgrid_password@db:5432/appgrid_db
```

Credentials are hardcoded for local development convenience.

### Staging/Production (docker-compose.staging/prod.yml)

```yaml
environment:
  - DATABASE_URL=postgresql://appgrid_user:${POSTGRES_PASSWORD}@db:5432/appgrid_db
```

Password comes from environment variable `POSTGRES_PASSWORD`.

Set it before deploying:
```bash
export POSTGRES_PASSWORD=your_secure_password
docker-compose -f docker-compose.prod.yml up -d
```

Or use `.env` file (not committed to git):
```bash
POSTGRES_PASSWORD=your_secure_password
```

## Switching Between Environments

### From SQLite to Local PostgreSQL

1. Change Prisma schema:
   ```prisma
   datasource db {
     provider = "postgresql"  // was "sqlite"
   }
   ```

2. Update `.env`:
   ```bash
   DATABASE_URL="postgresql://appgrid_user:appgrid_password@localhost:5432/appgrid_db"
   ```

3. Start PostgreSQL:
   ```bash
   docker-compose up db
   ```

4. Recreate migrations:
   ```bash
   rm -rf prisma/migrations
   yarn prisma:migrate:dev --name init
   ```

### From Local PostgreSQL back to SQLite

1. Change Prisma schema:
   ```prisma
   datasource db {
     provider = "sqlite"  // was "postgresql"
   }
   ```

2. Update `.env`:
   ```bash
   DATABASE_URL="file:./dev.db"
   ```

3. Recreate migrations:
   ```bash
   rm -rf prisma/migrations
   yarn prisma:migrate:dev --name init
   ```

## Common Commands

```bash
# Build images
docker-compose build

# Start services in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Stop and remove volumes (deletes data!)
docker-compose down -v

# Restart a specific service
docker-compose restart app

# Execute command in container
docker-compose exec app yarn prisma studio

# View running containers
docker-compose ps
```

## Troubleshooting

### Port already in use

```bash
# Check what's using the port
lsof -i :3000

# Kill the process or change the port in docker-compose.yml
ports:
  - "3001:3000"
```

### Database connection refused

```bash
# Check if database is healthy
docker-compose ps

# View database logs
docker-compose logs db

# Restart database
docker-compose restart db
```

### Migrations not applied

```bash
# Exec into container
docker-compose exec app sh

# Run migrations manually
npx prisma migrate deploy
```

### Fresh start

```bash
# Stop everything and remove volumes
docker-compose down -v

# Rebuild and start
docker-compose up --build
```

## Best Practices

1. **Use SQLite for development** - Faster iteration
2. **Test with PostgreSQL** before deploying - Catch DB-specific issues
3. **Use staging** for final testing - Production-like environment
4. **Never commit** `.env` with real passwords
5. **Always backup** production database before major changes
6. **Use volumes** for data persistence in production

## Production Deployment via Portainer

Instead of running docker-compose directly, use the deployment scripts:

```bash
# Deploy to staging
PORTAINER_STACK_NAME=appgrid-backend-staging ./scripts/deploy-portainer.sh

# Deploy to production
PORTAINER_STACK_NAME=appgrid-backend-prod ./scripts/deploy-portainer.sh
```

See [GITHUB_ACTIONS_DEPLOYMENT.md](./GITHUB_ACTIONS_DEPLOYMENT.md) for automated deployments.
