import dotenv from 'dotenv';
dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

function requireEnv(name: string, devFallback?: string): string {
  const value = process.env[name] || (!isProd ? devFallback : undefined);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  isProd,
  voterJwtSecret: requireEnv('VOTER_JWT_SECRET', process.env.JWT_SECRET || 'dev-only-voter-secret-change-me'),
  adminJwtSecret: requireEnv('ADMIN_JWT_SECRET', process.env.JWT_SECRET || 'dev-only-admin-secret-change-me'),
  sessionJwtSecret: requireEnv('SESSION_JWT_SECRET', process.env.JWT_SECRET || 'dev-only-session-secret-change-me'),
  pgcryptoKey: requireEnv('PGCRYPTO_KEY', 'dev-only-pgcrypto-key'),
  frontendUrl: process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3000',
  appUrl: process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
  aiServiceUrl: process.env.AI_SERVICE_URL?.replace(/\/$/, '') || '',
  aiTimeoutMs: Number(process.env.AI_SERVICE_TIMEOUT_MS || 10000),
  turnstileSecret: requireEnv('TURNSTILE_SECRET_KEY', 'dev-only-turnstile-secret'),
  voterVerifyMode: process.env.VOTER_VERIFY_MODE || 'mock',
};
