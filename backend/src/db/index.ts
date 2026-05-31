import { Pool, type PoolClient } from 'pg';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();

const FATAL_PG_CODES = new Set(['25P03', '57P01', '08006', '08003', '08001']);

export function isDbConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && FATAL_PG_CODES.has(e.code)) return true;
  const msg = (e.message || '').toLowerCase();
  return (
    msg.includes('timeout exceeded when trying to connect') ||
    msg.includes('connection terminated') ||
    msg.includes('connection terminated unexpectedly') ||
    msg.includes('idle-in-transaction timeout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused')
  );
}

function attachClientErrorGuard(client: PoolClient): () => void {
  const onError = (err: Error) => {
    logger.warn({
      action: 'pg_client_error',
      error: err.message,
      code: (err as NodeJS.ErrnoException & { code?: string }).code,
    });
  };
  client.on('error', onError);
  return () => client.removeListener('error', onError);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon cold start can exceed 10s when crons and API compete for connections
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 30000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 20000),
  max: Number(process.env.DB_POOL_MAX || 10),
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
  logger.warn({
    action: 'pg_pool_idle_client_error',
    error: err.message,
    code: (err as NodeJS.ErrnoException & { code?: string }).code,
  });
});

export const db = {
  query: async (text: string, params?: unknown[]) => {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (isDbConnectionError(err)) {
        logger.warn({
          action: 'db_query_connection_error',
          error: err instanceof Error ? err.message : 'unknown',
        });
      }
      throw err;
    }
  },
  getClient: () => pool.connect(),
  withTransaction: async <T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    const detach = attachClientErrorGuard(client);
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      broken = isDbConnectionError(err);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        broken = true;
        logger.warn({
          action: 'pg_rollback_failed',
          error:
            rollbackErr instanceof Error ? rollbackErr.message : 'unknown',
        });
      }
      throw err;
    } finally {
      detach();
      client.release(broken);
    }
  },
};

export const dbPool = pool;
