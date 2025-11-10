# GitHub Actions Auto-Deployment to Portainer

This guide explains how to set up automatic deployment from GitHub to your Portainer CE instance.

## Overview

The deployment workflow automatically:
1. Builds a Docker image from your code
2. Pushes it to GitHub Container Registry (GHCR)
3. Creates or updates a Portainer stack with the latest image
4. Triggers on every push to the `main` branch

## Prerequisites

- Portainer CE instance running and accessible
- GitHub repository with this code
- Docker image registry access (GHCR is used by default)
- nginx-proxy with Let's Encrypt companion running on your server (for SSL)
- DNS records pointing to your server:
  - `appgrid-staging.zekalogic.com` → your server IP (production)
  - `appgrid-dev.zekalogic.com` → your server IP (development)

## Setup Instructions

### 1. Get Portainer Access Token

1. Log in to your Portainer web interface
2. Go to **User settings** (click your username in top right)
3. Scroll down to **Access tokens**
4. Click **+ Add access token**
5. Give it a name (e.g., "GitHub Actions")
6. Copy the token immediately (you won't be able to see it again!)

### 2. Configure GitHub Secrets

Go to your GitHub repository settings:

1. Navigate to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add the following secrets:

| Secret Name | Description | Example |
|------------|-------------|---------|
| `PORTAINER_URL` | Your Portainer instance URL (no trailing slash) | `https://portainer.yourdomain.com` or `http://your-server-ip:9000` |
| `PORTAINER_ACCESS_TOKEN` | The access token from step 1 | `ptr_xxxxxxxxxxxxxxxxxx` |
| `PORTAINER_STACK_NAME` | Name for your stack in Portainer | `appgrid-backend` |
| `POSTGRES_PASSWORD` | Database password for production | `your_secure_password` |

### 3. Enable GitHub Container Registry

The workflow pushes Docker images to GitHub Container Registry (GHCR). This is automatically enabled, but you need to ensure:

1. The `GITHUB_TOKEN` has package write permissions (enabled by default)
2. Your repository allows packages (Settings → General → Features → Packages)

### 4. Verify Workflow File

The workflow is located at `.github/workflows/deploy-portainer.yml`. It should already be configured correctly.

### 5. Test the Deployment

1. Make a commit and push to the `main` branch:
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```

2. Go to your repository on GitHub
3. Click on the **Actions** tab
4. You should see the "Deploy to Portainer" workflow running
5. Click on it to view the deployment progress

### 6. Monitor Deployment

Once the workflow completes:

1. Go to your Portainer web interface
2. Navigate to **Stacks**
3. You should see your stack (e.g., "appgrid-backend") running
4. Click on it to view the services

## Manual Deployment

You can also trigger deployment manually:

### Option 1: From GitHub UI

1. Go to **Actions** tab in your repository
2. Select "Deploy to Portainer" workflow
3. Click **Run workflow**
4. Select the branch and click **Run workflow**

### Option 2: Using the Script

For local manual deployment to Portainer:

1. Create a `.env` file with:
   ```bash
   PORTAINER_URL=https://portainer.yourdomain.com
   PORTAINER_ACCESS_TOKEN=ptr_xxxxxxxxxxxxxxxxxx
   PORTAINER_STACK_NAME=appgrid-backend
   POSTGRES_PASSWORD=your_secure_password
   ```

2. Run the deployment script:
   ```bash
   ./scripts/deploy-portainer.sh
   ```

## Troubleshooting

### Deployment Fails with "Unauthorized"

- Verify your `PORTAINER_ACCESS_TOKEN` is correct
- Check if the token has expired (create a new one)
- Ensure the token has sufficient permissions

### Stack Creation Fails

- Check if a stack with the same name already exists
- Verify the `PORTAINER_URL` is correct and accessible from GitHub
- Check Portainer logs for more details

### Docker Image Pull Fails

- Ensure your Portainer instance can access GitHub Container Registry
- Verify the image was built and pushed successfully (check GitHub Actions logs)
- Make the image public or configure Portainer with GHCR credentials

### Services Don't Start

- Check the stack logs in Portainer
- Verify environment variables are set correctly
- Check if required ports are available

## Workflow Details

### Trigger Events

- **Push to main**: Automatic deployment
- **Manual trigger**: Via GitHub Actions UI

### Build Process

1. Checks out code
2. Sets up Docker Buildx for multi-platform builds
3. Logs in to GitHub Container Registry
4. Builds and pushes Docker image with tags:
   - `latest` - always points to the latest main build
   - `main-<commit-sha>` - specific commit reference

### Deployment Process

1. Gets Portainer endpoint ID
2. Checks if stack exists
3. Creates new stack or updates existing one
4. Pulls latest image
5. Waits for services to stabilize
6. Verifies deployment

## Security Best Practices

1. **Never commit secrets** to the repository
2. Use **strong passwords** for database and API keys
3. **Rotate access tokens** periodically
4. Use **HTTPS** for Portainer in production
5. **Limit token permissions** to only what's needed
6. Consider using **private container registries** for production

## Customization

### Change Deployment Trigger

Edit `.github/workflows/deploy-portainer.yml`:

```yaml
# Deploy only on releases
on:
  release:
    types: [published]

# Deploy on specific branches
on:
  push:
    branches:
      - main
      - production
```

### Add More Environment Variables

Add to the GitHub secrets and update the workflow:

```yaml
- name: Deploy to Portainer
  env:
    # ... existing env vars ...
    NEW_VAR: ${{ secrets.NEW_VAR }}
  run: |
    # Add to the env array in the curl command
    {"name": "NEW_VAR", "value": "${NEW_VAR}"}
```

## SSL Configuration

The application is configured to work with nginx-proxy and Let's Encrypt for automatic SSL certificates.

### Virtual Host Setup

The following environment variables are configured in `docker-compose.prod.yml`:

- `VIRTUAL_HOST=appgrid-staging.zekalogic.com` - Domain name for nginx-proxy
- `VIRTUAL_PORT=3000` - Internal port for nginx-proxy to route to
- `LETSENCRYPT_HOST=appgrid-staging.zekalogic.com` - Domain for Let's Encrypt certificate

### Requirements

1. **nginx-proxy network**: The app connects to the external `nginx-proxy` network
2. **DNS configured**: Ensure DNS A record points `appgrid-staging.zekalogic.com` to your server IP
3. **Port 80/443 open**: Let's Encrypt needs these ports for certificate validation

### Changing the Domain

To use a different domain, edit `docker-compose.prod.yml`:

```yaml
environment:
  - VIRTUAL_HOST=your-domain.com
  - VIRTUAL_PORT=3000
  - LETSENCRYPT_HOST=your-domain.com
```

Then commit and push to trigger redeployment.

## Access Points After Deployment

Once deployed, your services will be available at:

### Production (via SSL)
- **API**: `https://appgrid-staging.zekalogic.com`
- **Health Check**: `https://appgrid-staging.zekalogic.com/health`

### Development (via SSL)
- **API**: `https://appgrid-dev.zekalogic.com`
- **Health Check**: `https://appgrid-dev.zekalogic.com/health`

### Direct Access (without nginx-proxy)
- **API**: `http://your-server:3000`
- **Database Admin (Adminer)**: `http://your-server:8080`

**Note**: The main app is accessible via HTTPS through nginx-proxy. Adminer is only accessible directly on port 8080.

## Next Steps

1. ✅ ~~Set up a custom domain with reverse proxy~~ (Already configured)
2. ✅ ~~Configure SSL/TLS certificates~~ (Let's Encrypt configured)
3. Set up database backups
4. Configure monitoring and alerts
5. Implement log aggregation
6. Consider restricting Adminer access or disabling in production

## Support

For issues with:
- **GitHub Actions**: Check the Actions tab logs
- **Portainer**: Check Portainer logs and documentation
- **Application**: Check container logs in Portainer
