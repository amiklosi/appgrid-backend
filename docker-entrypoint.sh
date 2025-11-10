#!/bin/sh
set -e

echo "Syncing database schema..."
npx prisma db push --accept-data-loss

echo "Seeding database (skips if already seeded)..."
npm run db:seed

echo "Starting application..."
exec "$@"
