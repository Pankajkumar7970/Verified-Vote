#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running database migrations..."
  npx node-pg-migrate up --envPath "${ENV_FILE:-.env}" 2>/dev/null \
    || npx node-pg-migrate up
fi

if [ "${SEED_ADMINS:-false}" = "true" ]; then
  echo "Seeding admin accounts (if missing)..."
  npx tsx backend/src/db/seed/admin.seed.ts || true
fi

exec "$@"
