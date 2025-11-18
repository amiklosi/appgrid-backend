# Project Notes for Claude

## Development Server
- The dev server is already running on port 3000
- DO NOT start additional dev server instances
- User manages the dev server themselves

## Database Operations

### Database Reset
To clear and reset the database with seed data:
```bash
npm run db:reset
```

This command:
1. Removes the SQLite database file (`prisma/dev.db`)
2. Recreates the database with the Prisma schema
3. Seeds the database with test data (3 users, 5 licenses)

### Database Seeding
After the database is reset, it contains:
- **3 test users**: test@example.com, demo@appgrid.com, premium@example.com
- **5 test licenses**: Various configurations (Basic, Standard, Premium, Trial, Expired)

## RevenueCat Migration

### How to Perform a Migration
To migrate a RevenueCat user to the license system:

```bash
curl -X POST http://localhost:3000/api/revenuecat/migrate \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "userId": "$RCAnonymousID:xxxxx"}'
```

### Migration Behavior
- Checks if the RevenueCat user has already been migrated
- Validates eligibility (lifetime or annual subscriptions only)
- Creates a new user if the email doesn't exist
- Generates a license key with 5 device activations
- Sends an email to the user with their license key
- Stores the migration record to prevent duplicates

### Required Environment Variables
- `REVENUECAT_API_KEY`: RevenueCat API key
- `REVENUECAT_PROJECT_ID`: RevenueCat project ID
- `MAILGUN_API_KEY`: Mailgun API key for sending emails
- `MAILGUN_DOMAIN`: Mailgun domain for sending emails

## Important Notes
- If you reset the database, any old dev server instances will still have the old database cached in memory
- Kill all dev server processes after a database reset to avoid stale data issues

## Adding New Environment Variables

When adding a new environment variable to the project, it must be added to **ALL** of the following locations:

### 1. Local Development
- **`.env`**: Add the variable for local development

### 2. Docker Compose Files
- **`docker-compose.staging.yml`**: Add to the `app.environment` section
- **`docker-compose.prod.yml`**: Add to the `app.environment` section

Format:
```yaml
- VARIABLE_NAME=${VARIABLE_NAME}
```

### 3. Portainer Deployment Script
- **`scripts/deploy-portainer.sh`**: Add in THREE places:
  1. **Validation section** (around line 82-90): Add check to ensure variable is set
     ```bash
     if [ -z "$VARIABLE_NAME" ]; then
         print_error "VARIABLE_NAME not set in .env"
         exit 1
     fi
     ```
  2. **Stack creation** (around line 135): Add to the `env` array
     ```json
     {"name": "VARIABLE_NAME", "value": "${VARIABLE_NAME}"}
     ```
  3. **Stack update** (around line 163): Add to the `env` array
     ```json
     {"name": "VARIABLE_NAME", "value": "${VARIABLE_NAME}"}
     ```

### 4. GitHub Actions Workflow
- **`.github/workflows/deploy-portainer.yml`**: Add in THREE places:
  1. **Workflow env section** (around line 62): Add to the `env` block
     ```yaml
     VARIABLE_NAME: ${{ secrets.VARIABLE_NAME }}
     ```
  2. **Stack creation** (around line 93): Add to the `env` array
     ```json
     {"name": "VARIABLE_NAME", "value": "${VARIABLE_NAME}"}
     ```
  3. **Stack update** (around line 113): Add to the `env` array
     ```json
     {"name": "VARIABLE_NAME", "value": "${VARIABLE_NAME}"}
     ```

### 5. GitHub Secrets
- Go to repository **Settings → Secrets and variables → Actions**
- Add the variable as a **repository secret** for the appropriate environment (staging/production)

### Example Checklist
When adding `NEW_VAR`, ensure it's added to:
- [ ] `.env`
- [ ] `docker-compose.staging.yml`
- [ ] `docker-compose.prod.yml`
- [ ] `scripts/deploy-portainer.sh` (validation + create + update)
- [ ] `.github/workflows/deploy-portainer.yml` (env + create + update)
- [ ] GitHub repository secrets
