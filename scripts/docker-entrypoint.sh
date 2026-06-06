#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running database migrations..."
  cd backend && npx node-pg-migrate up -m src/db/migrations --envPath "${ENV_FILE:-.env}" 2>/dev/null \
    || npx node-pg-migrate up -m src/db/migrations
  cd ..
fi

if [ "${SEED_ADMINS:-false}" = "true" ]; then
  echo "Seeding admin accounts (if missing)..."
  cd backend && npx tsx src/db/seed/admin.seed.ts || true
  cd ..
fi

exec "$@"
