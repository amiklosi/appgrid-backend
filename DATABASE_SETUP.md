# Database Setup Guide

This project uses different databases for different environments:
- **Development**: SQLite (simple, no Docker required)
- **Production**: PostgreSQL (robust, scalable)

## Development with SQLite

SQLite is perfect for initial development - it's just a file, no setup required!

### Setup

1. The `.env` file should have:
   ```bash
   DATABASE_URL="file:./dev.db"
   ```

2. Run migrations:
   ```bash
   yarn prisma:migrate:dev
   ```

3. Start developing:
   ```bash
   yarn dev
   ```

4. Open Prisma Studio to view/edit data:
   ```bash
   yarn prisma:studio
   ```

### Benefits

- ✅ No Docker needed
- ✅ Instant startup
- ✅ Easy to reset (just delete `dev.db`)
- ✅ Perfect for prototyping

### Resetting the Database

```bash
rm dev.db
yarn prisma:migrate:dev
```

## Production with PostgreSQL

Production uses PostgreSQL for better performance and features.

### Local PostgreSQL with Docker

If you want to test with PostgreSQL locally:

1. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"  // Change from "sqlite"
     url      = env("DATABASE_URL")
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

4. Run migrations:
   ```bash
   yarn prisma:migrate:dev
   ```

### Production Deployment

The Docker image **automatically** switches to PostgreSQL:

1. The `Dockerfile` changes the provider from `sqlite` to `postgresql`
2. On container start, `docker-entrypoint.sh` runs migrations
3. The app connects to PostgreSQL via `DATABASE_URL` env var

Environment variable in production:
```bash
DATABASE_URL="postgresql://appgrid_user:password@db:5432/appgrid_db"
```

## Prisma Commands

```bash
# Generate Prisma Client (after schema changes)
yarn prisma:generate

# Create a migration
yarn prisma:migrate:dev --name add_feature

# Apply migrations in production
yarn prisma:migrate

# Open Prisma Studio (database GUI)
yarn prisma:studio

# Reset database (development only!)
yarn prisma migrate reset
```

## Schema Changes

When you modify `prisma/schema.prisma`:

1. Create a migration:
   ```bash
   yarn prisma:migrate:dev --name your_change_name
   ```

2. Prisma will:
   - Generate SQL migration files
   - Apply them to your database
   - Regenerate Prisma Client

3. Commit both:
   - `prisma/schema.prisma`
   - `prisma/migrations/` folder

## Migrations in Production

Migrations run automatically on deployment:

1. Docker builds the image with PostgreSQL schema
2. Container starts and runs `docker-entrypoint.sh`
3. Script executes `prisma migrate deploy`
4. All pending migrations apply
5. App starts

## Switching Between SQLite and PostgreSQL

### SQLite → PostgreSQL

1. Change provider in `schema.prisma`:
   ```prisma
   provider = "postgresql"
   ```

2. Update `DATABASE_URL` in `.env`

3. Delete migrations:
   ```bash
   rm -rf prisma/migrations
   ```

4. Create new migrations:
   ```bash
   yarn prisma:migrate:dev --name init
   ```

### PostgreSQL → SQLite

1. Change provider in `schema.prisma`:
   ```prisma
   provider = "sqlite"
   ```

2. Update `DATABASE_URL` in `.env`:
   ```bash
   DATABASE_URL="file:./dev.db"
   ```

3. Delete migrations:
   ```bash
   rm -rf prisma/migrations
   ```

4. Create new migrations:
   ```bash
   yarn prisma:migrate:dev --name init
   ```

## Troubleshooting

### "Can't reach database server"

**SQLite**: Make sure `DATABASE_URL="file:./dev.db"` (with quotes)

**PostgreSQL**: Check Docker is running:
```bash
docker-compose ps
```

### "Prisma Client not generated"

```bash
yarn prisma:generate
```

### "Migration failed"

Reset and try again (development only):
```bash
yarn prisma migrate reset
```

### Schema and database out of sync

```bash
yarn prisma:migrate:dev
```

## Best Practices

1. **Use SQLite in development** for fast iteration
2. **Test with PostgreSQL** before production deployment
3. **Always commit migrations** to version control
4. **Never run `migrate reset`** in production
5. **Backup production database** before major migrations

## Data Seeding (Optional)

Create `prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Create test user
  const user = await prisma.user.create({
    data: {
      email: 'test@example.com',
      name: 'Test User',
    },
  });

  // Create test product
  const product = await prisma.product.create({
    data: {
      name: 'Pro License',
      productCode: 'PRO-2024',
    },
  });

  console.log({ user, product });
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
```

Add to `package.json`:
```json
"prisma": {
  "seed": "ts-node prisma/seed.ts"
}
```

Run seed:
```bash
yarn prisma db seed
```
