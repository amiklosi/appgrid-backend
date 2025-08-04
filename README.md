# RevenueCat Webhook Server with PostgreSQL

A TypeScript/Express server for processing RevenueCat webhooks with PostgreSQL database integration, web-based database browser, and comprehensive logging.

## Quick Start with Docker 🐳

**Easiest way to get started:**

1. Clone and navigate to the project:
   ```bash
   cd appgrid-backend
   ```

2. Set your RevenueCat auth token:
   ```bash
   echo "REVENUECAT_AUTH_TOKEN=your_token_here" >> .env
   ```

3. Start everything with Docker:
   ```bash
   docker-compose up --build
   ```

This starts:
- **Node.js app** on `http://localhost:3000`
- **PostgreSQL** database on port 5432
- **Adminer** database browser on `http://localhost:8080`

## Manual Setup (Development)

1. Install dependencies:
   ```bash
   yarn install
   ```

2. Create environment file:
   ```bash
   cp .env.example .env
   ```

3. Configure your webhook authorization token in `.env`:
   ```
   REVENUECAT_AUTH_TOKEN=your_auth_token_from_revenuecat_dashboard
   DATABASE_URL=postgresql://appgrid_user:appgrid_password@localhost:5432/appgrid_db
   ```

4. Start PostgreSQL (Docker):
   ```bash
   docker-compose up db adminer
   ```

5. Start the development server:
   ```bash
   yarn dev
   ```

## Available Services

### Webhook Server
- **URL:** `http://localhost:3000`
- **Webhook endpoint:** `POST /webhook/revenuecat`
- **Health check:** `GET /health`

## Database Browser

Access **Adminer** (simple database browser) at `http://localhost:8080`:

**Connection details:**
- **System:** PostgreSQL
- **Server:** db
- **Username:** appgrid_user
- **Password:** appgrid_password
- **Database:** appgrid_db

Much simpler than pgAdmin - just one login screen, clean interface! 🎉

## Testing

### Test with curl (without signature verification):
```bash
yarn test:webhook
```

### Test with ngrok for external webhooks:

1. Install ngrok: `npm install -g ngrok`
2. Start your server: `yarn dev`
3. In another terminal: `ngrok http 3000`
4. Use the ngrok URL in your RevenueCat webhook configuration: `https://your-ngrok-url.ngrok.io/webhook/revenuecat`

## Features

- ✅ **Full Docker setup** with PostgreSQL + Adminer
- ✅ **TypeScript** with proper RevenueCat webhook types
- ✅ **PostgreSQL integration** - saves all webhook data
- ✅ **Simple database browser** (Adminer)
- ✅ **Authorization header verification**
- ✅ **Comprehensive data tracking** (users, purchases, subscriptions)
- ✅ **Detailed logging** of webhook events
- ✅ **Error handling** and validation
- ✅ **Health check** endpoint
- ✅ **Development-friendly** with hot reload

## Database Structure

The system automatically creates and manages these tables:
- **`users`** - App users from RevenueCat
- **`products`** - Available products/subscriptions
- **`purchases`** - All purchase events and transactions
- **`subscriptions`** - Current subscription states
- **`webhook_events`** - Audit log of webhook processing

## Webhook Event Types

The server handles all RevenueCat event types:
- `INITIAL_PURCHASE`
- `RENEWAL`
- `CANCELLATION`
- `UNCANCELLATION`
- `NON_RENEWING_PURCHASE`
- `EXPIRATION`
- `BILLING_ISSUE`
- `PRODUCT_CHANGE`

## Configuration

Environment variables:
- `PORT` - Server port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection string
- `REVENUECAT_AUTH_TOKEN` - Authorization token from RevenueCat dashboard (optional for testing)

## Security

- Authorization header verification
- Token-based authentication
- Raw body parsing for proper webhook handling
- Input validation and error handling
- Database transactions for data integrity

## Production Deployment

### Portainer Stack Deployment

Deploy to production using Portainer:

1. **See full guide:** [PORTAINER_DEPLOYMENT.md](./PORTAINER_DEPLOYMENT.md)
2. **Quick setup:** Use `docker-compose.prod.yml` in Portainer
3. **Environment variables:** Set `POSTGRES_PASSWORD` and `REVENUECAT_AUTH_TOKEN`

### Docker Commands (Development)

```bash
# Start everything
docker-compose up --build

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop everything
docker-compose down

# Stop and remove volumes (clears database)
docker-compose down -v

# Rebuild only the app
docker-compose up --build app
```

### Production Commands

```bash
# Production build
docker build -t ghcr.io/amiklosi/appgrid-backend:latest .

# Production deployment
docker-compose -f docker-compose.prod.yml up -d
```