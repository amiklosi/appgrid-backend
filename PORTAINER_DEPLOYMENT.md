# Portainer Stack Deployment Guide

This guide walks you through deploying the AppGrid Backend as a Portainer stack.

## Prerequisites

- Portainer instance running
- Access to your Portainer dashboard
- Docker image built and pushed to a registry (or use GitHub Packages)

## Option 1: Deploy from GitHub Repository

### Step 1: Build and Push Docker Image

First, build and push your Docker image to GitHub Container Registry:

```bash
# Build the image
docker build -t ghcr.io/amiklosi/appgrid-backend:latest .

# Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u amiklosi --password-stdin

# Push the image
docker push ghcr.io/amiklosi/appgrid-backend:latest
```

### Step 2: Create Stack in Portainer

1. **Login to Portainer** and navigate to your environment
2. **Go to Stacks** → **Add Stack**
3. **Name your stack:** `appgrid-backend`
4. **Choose method:** "Git Repository"
5. **Configure Git Repository:**
   - **Repository URL:** `https://github.com/amiklosi/appgrid-backend`
   - **Compose path:** `docker-compose.prod.yml`
   - **Branch:** `main`

### Step 3: Configure Environment Variables

In the "Environment variables" section, add:

```
POSTGRES_PASSWORD=your_secure_database_password
REVENUECAT_AUTH_TOKEN=your_revenuecat_webhook_token
```

### Step 4: Deploy

Click **Deploy the stack**

## Option 2: Deploy with Web Editor

### Step 1: Copy Docker Compose Content

1. **Go to Stacks** → **Add Stack**
2. **Name:** `appgrid-backend`
3. **Choose:** "Web editor"
4. **Paste the following docker-compose content:**

```yaml
version: '3.8'

services:
  app:
    image: ghcr.io/amiklosi/appgrid-backend:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgresql://appgrid_user:${POSTGRES_PASSWORD}@db:5432/appgrid_db
      - REVENUECAT_AUTH_TOKEN=${REVENUECAT_AUTH_TOKEN}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - appgrid-network
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=appgrid_db
      - POSTGRES_USER=appgrid_user
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - appgrid-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appgrid_user -d appgrid_db"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  adminer:
    image: adminer:4-standalone
    ports:
      - "8080:8080"
    environment:
      - ADMINER_DEFAULT_SERVER=db
      - ADMINER_DESIGN=nette
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - appgrid-network

volumes:
  postgres_data:
    driver: local

networks:
  appgrid-network:
    driver: bridge
```

### Step 2: Configure Environment Variables

Add these environment variables:
```
POSTGRES_PASSWORD=your_secure_database_password
REVENUECAT_AUTH_TOKEN=your_revenuecat_webhook_token
```

### Step 3: Deploy

Click **Deploy the stack**

## Option 3: Deploy with Custom Build

If you want to build the image within Portainer:

### Step 1: Modify Docker Compose

Replace the `image` line in the app service with:

```yaml
app:
  build: 
    context: https://github.com/amiklosi/appgrid-backend.git
    dockerfile: Dockerfile
  # ... rest of configuration
```

## Post-Deployment

### Verify Deployment

1. **Check Stack Status:** All services should show as "running"
2. **Test Health Check:** Visit `http://your-server:3000/health`
3. **Test Database:** Visit `http://your-server:8080` (Adminer)
4. **Check Logs:** Review container logs for any errors

### Access Points

- **API Endpoint:** `http://your-server:3000`
- **Webhook URL:** `http://your-server:3000/webhook/revenuecat`
- **Database Browser:** `http://your-server:8080`
- **Health Check:** `http://your-server:3000/health`

### Database Connection (Adminer)

- **System:** PostgreSQL
- **Server:** db
- **Username:** appgrid_user
- **Password:** [your POSTGRES_PASSWORD]
- **Database:** appgrid_db

## Security Considerations

1. **Use strong passwords** for POSTGRES_PASSWORD
2. **Secure your RevenueCat webhook token**
3. **Consider using Docker secrets** for sensitive data
4. **Limit port exposure** if not needed externally
5. **Enable HTTPS** with a reverse proxy (Traefik, Nginx)

## Troubleshooting

### Common Issues

1. **Image not found:** Ensure the Docker image is public or you're authenticated
2. **Database connection failed:** Check POSTGRES_PASSWORD environment variable
3. **Health check failing:** Wait for the app to fully start (40s start period)
4. **Port conflicts:** Ensure ports 3000, 5432, 8080 are available

### Useful Commands

```bash
# Check stack logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart a service
docker-compose -f docker-compose.prod.yml restart app

# Check service health
docker-compose -f docker-compose.prod.yml ps
```

## Updates

To update the stack:

1. **Git Repository method:** Push changes to GitHub, then click "Update" in Portainer
2. **Web Editor method:** Edit the compose file and redeploy
3. **New image:** Build and push new image, then restart the stack

## Monitoring

Consider adding monitoring services:
- Prometheus + Grafana for metrics
- Uptime monitoring for webhook endpoint
- Database monitoring for PostgreSQL

---

🚀 **Your AppGrid Backend should now be running in production via Portainer!**