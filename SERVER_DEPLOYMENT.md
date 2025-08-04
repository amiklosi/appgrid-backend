# Server Deployment Guide - Docker Compose

Complete guide for deploying AppGrid Backend on a server using Docker Compose.

## 📋 Prerequisites

### Server Requirements
- **OS:** Ubuntu 20.04+ / CentOS 8+ / Debian 11+
- **RAM:** Minimum 2GB (4GB+ recommended)
- **Storage:** 20GB+ available
- **Network:** Public IP with ports 80, 443, 3000, 8080 accessible

### Required Software
- Docker & Docker Compose
- Git
- SSL certificate (recommended)
- Domain name (optional but recommended)

## 🚀 Quick Deployment

### Step 1: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Git
sudo apt install git -y

# Logout and login to apply Docker group
exit
```

### Step 2: Clone and Deploy

**Option A: Use Pre-built Docker Image (Recommended)**
```bash
# Clone repository
git clone https://github.com/amiklosi/appgrid-backend.git
cd appgrid-backend

# Copy and configure environment
cp .env.production .env
nano .env  # Edit with your values

# Deploy with production compose (uses pre-built image)
./scripts/deploy.sh
```

**Option B: Build Your Own Image**
```bash
# Clone repository
git clone https://github.com/amiklosi/appgrid-backend.git
cd appgrid-backend

# Build and push Docker image
./scripts/build-image.sh --push

# Copy and configure environment
cp .env.production .env
nano .env

# Deploy with production compose
./scripts/deploy.sh
```

## 📁 Directory Structure

Recommended server directory structure:
```
/opt/appgrid/
├── appgrid-backend/          # Git repository
├── data/
│   ├── postgres/             # Database data
│   ├── backups/              # Database backups
│   └── logs/                 # Application logs
├── ssl/                      # SSL certificates
└── nginx/                    # Reverse proxy config
```

## 🐳 Docker Image Management

### Building the Image

```bash
# Build locally (auto-detects architecture)
./scripts/build-image.sh

# Build and push to GitHub Container Registry
./scripts/build-image.sh --push

# Build with custom tag
./scripts/build-image.sh --tag v1.0 --push
```

**🔧 Architecture Compatibility**

The build script automatically handles architecture differences:

- **On Apple Silicon (M1/M2/M3):** Builds multi-platform images (AMD64 + ARM64)
- **On Intel/AMD machines:** Builds AMD64 images
- **For servers:** Always includes AMD64 support

This prevents the `exec format error` when deploying Mac-built images to Linux servers.

### GitHub Container Registry Setup

To push images to GitHub Container Registry:

```bash
# Create GitHub Personal Access Token with packages:write scope
# https://github.com/settings/tokens

# Login to GitHub Container Registry
export GITHUB_TOKEN=your_token_here
echo $GITHUB_TOKEN | docker login ghcr.io -u amiklosi --password-stdin

# Build and push
./scripts/build-image.sh --push
```

### Using Pre-built Image

The production docker-compose file uses:
```yaml
image: ghcr.io/amiklosi/appgrid-backend:latest
```

This means you don't need to build locally - just pull and run!

## 🔧 Detailed Setup

### Step 1: Prepare Server Environment

```bash
# Create application directory
sudo mkdir -p /opt/appgrid
sudo chown $USER:$USER /opt/appgrid
cd /opt/appgrid

# Create data directories
mkdir -p data/{postgres,backups,logs}
mkdir -p ssl nginx

# Set proper permissions
chmod 700 data/postgres
chmod 755 data/{backups,logs}
```

### Step 2: Clone Repository

```bash
git clone https://github.com/amiklosi/appgrid-backend.git
cd appgrid-backend
```

### Step 3: Configure Environment

```bash
# Copy production environment template
cp .env.production .env

# Edit configuration
nano .env
```

**Required environment variables:**
```bash
# Strong database password
POSTGRES_PASSWORD=your_very_secure_database_password_here

# RevenueCat webhook token from dashboard
REVENUECAT_AUTH_TOKEN=your_revenuecat_webhook_auth_token

# Optional: Custom port (default: 3000)
# PORT=3000

# Optional: Custom database URL (if using external DB)
# DATABASE_URL=postgresql://appgrid_user:password@host:5432/appgrid_db
```

### Step 4: Deploy Application

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Deploy (will build and start services)
./scripts/deploy.sh
```

## 🔧 Production Configuration

### Option A: Simple Direct Access

If you want to access the app directly on port 3000:

```yaml
# Use docker-compose.prod.yml as-is
# Access: http://your-server-ip:3000
```

### Option B: Nginx Reverse Proxy (Recommended)

For production with SSL and custom domain:

1. **Install Nginx:**
```bash
sudo apt install nginx -y
```

2. **Create Nginx config:**
```bash
sudo nano /etc/nginx/sites-available/appgrid
```

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL Configuration
    ssl_certificate /opt/appgrid/ssl/cert.pem;
    ssl_certificate_key /opt/appgrid/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Main application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Database admin (optional, secure it!)
    location /admin/ {
        auth_basic "Database Admin";
        auth_basic_user_file /opt/appgrid/.htpasswd;
        proxy_pass http://localhost:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. **Enable site:**
```bash
sudo ln -s /etc/nginx/sites-available/appgrid /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL Certificate Setup

**Option 1: Let's Encrypt (Free)**
```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

**Option 2: Custom Certificate**
```bash
# Copy your certificates to /opt/appgrid/ssl/
sudo cp your-cert.pem /opt/appgrid/ssl/cert.pem
sudo cp your-key.pem /opt/appgrid/ssl/key.pem
sudo chmod 600 /opt/appgrid/ssl/*.pem
```

## 🛠️ Management Scripts

The deployment includes several management scripts:

### Deploy/Update
```bash
./scripts/deploy.sh          # Initial deployment
./scripts/update.sh          # Update from Git and restart
```

### Maintenance
```bash
./scripts/backup.sh          # Backup database
./scripts/restore.sh backup.sql  # Restore database
./scripts/logs.sh            # View logs
./scripts/status.sh          # Check status
```

### Monitoring
```bash
./scripts/health-check.sh    # Check application health
./scripts/cleanup.sh         # Clean old Docker images/containers
```

## 📊 Monitoring & Maintenance

### Health Monitoring

Set up automated health checks:

```bash
# Add to crontab
crontab -e

# Check health every 5 minutes
*/5 * * * * /opt/appgrid/appgrid-backend/scripts/health-check.sh

# Daily backup at 2 AM
0 2 * * * /opt/appgrid/appgrid-backend/scripts/backup.sh

# Weekly cleanup at 3 AM Sunday
0 3 * * 0 /opt/appgrid/appgrid-backend/scripts/cleanup.sh
```

### Log Management

```bash
# View live logs
docker-compose -f docker-compose.prod.yml logs -f

# View specific service logs
docker-compose -f docker-compose.prod.yml logs -f app

# Log rotation (add to logrotate)
sudo nano /etc/logrotate.d/appgrid
```

### Database Maintenance

```bash
# Create backup
./scripts/backup.sh

# View database size
docker-compose -f docker-compose.prod.yml exec db psql -U appgrid_user -d appgrid_db -c "SELECT pg_size_pretty(pg_database_size('appgrid_db'));"

# Optimize database
docker-compose -f docker-compose.prod.yml exec db psql -U appgrid_user -d appgrid_db -c "VACUUM ANALYZE;"
```

## 🔥 Firewall Configuration

```bash
# Install UFW
sudo apt install ufw -y

# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH access
sudo ufw allow ssh

# HTTP/HTTPS
sudo ufw allow 80
sudo ufw allow 443

# Application (if not using reverse proxy)
sudo ufw allow 3000

# Database admin (secure this!)
sudo ufw allow from YOUR_IP_ADDRESS to any port 8080

# Enable firewall
sudo ufw enable
```

## 🚨 Troubleshooting

### Common Issues

**1. Port already in use:**
```bash
sudo netstat -tulpn | grep :3000
sudo systemctl stop apache2  # If Apache is running
```

**2. Database connection failed:**
```bash
docker-compose -f docker-compose.prod.yml logs db
# Check POSTGRES_PASSWORD in .env
```

**3. Permission denied:**
```bash
sudo chown -R $USER:$USER /opt/appgrid
chmod +x scripts/*.sh
```

**4. SSL certificate issues:**
```bash
sudo certbot renew --dry-run
sudo nginx -t
```

### Recovery Commands

```bash
# Restart all services
docker-compose -f docker-compose.prod.yml restart

# Rebuild app container
docker-compose -f docker-compose.prod.yml up --build -d app

# Reset database (WARNING: DATA LOSS)
docker-compose -f docker-compose.prod.yml down -v
docker-compose -f docker-compose.prod.yml up -d
```

## 📈 Scaling Considerations

### Horizontal Scaling
- Use external PostgreSQL service (AWS RDS, DigitalOcean Managed DB)
- Load balancer with multiple app instances
- Redis for session storage

### Vertical Scaling
- Increase server resources
- Optimize PostgreSQL settings
- Enable database connection pooling

### Example External Database

```bash
# .env for external database
DATABASE_URL=postgresql://username:password@your-db-host:5432/appgrid_db

# Remove db service from docker-compose.prod.yml
# Keep only app and adminer services
```

## 🔄 Updates & Maintenance

### Regular Updates
```bash
# Weekly update routine
cd /opt/appgrid/appgrid-backend
./scripts/backup.sh          # Backup first
git pull origin main         # Get latest code
./scripts/update.sh          # Deploy updates
./scripts/health-check.sh    # Verify deployment
```

### Security Updates
```bash
# System updates
sudo apt update && sudo apt upgrade -y

# Docker updates
sudo apt update docker-ce docker-ce-cli containerd.io

# Certificate renewal
sudo certbot renew
```

---

🚀 **Your AppGrid Backend is now production-ready on your server!**

**Access Points:**
- **API:** `https://your-domain.com` or `http://your-server:3000`
- **Webhook:** `https://your-domain.com/webhook/revenuecat`
- **Database Admin:** `https://your-domain.com/admin/` or `http://your-server:8080`
- **Health Check:** `https://your-domain.com/health`