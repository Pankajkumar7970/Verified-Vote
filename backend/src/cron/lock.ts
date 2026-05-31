import { db } from '../db/index';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

function deterministicInt(str: string): number {
  const hash = crypto.createHash('sha256').update(str).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

export async function runWithLock(jobName: string, fn: () => Promise<void>) {
  const lockId = deterministicInt(jobName);
  let client: Awaited<ReturnType<typeof db.getClient>> | null = null;

  try {
    client = await db.getClient();
    const onClientError = (err: Error) => {
      logger.warn({
        action: 'pg_cron_client_error',
        job_name: jobName,
        error: err.message,
      });
    };
    client.on('error', onClientError);

    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) as locked', [lockId]);
    
    if (!rows[0].locked) {
      await updateCronStatus(jobName, 'skipped');
      return;
    }
    
    try {
      await fn();
      await updateCronStatus(jobName, 'success');
    } catch (err: any) {
      await updateCronStatus(jobName, 'failed', err?.message || 'unknown_error');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
  } catch (err: unknown) {
    logger.error({
      action: 'cron_lock_failed',
      job_name: jobName,
      error: err instanceof Error ? err.message : 'unknown',
    });
    try {
      await updateCronStatus(
        jobName,
        'failed',
        err instanceof Error ? err.message : 'unknown',
      );
    } catch {
      // no-op: cron status table may be unreachable when DB is down
    }
  } finally {
    if (client) {
      client.removeAllListeners('error');
      client.release();
    }
  }
}

async function updateCronStatus(jobName: string, status: string, error?: string) {
  await db.query(
    `INSERT INTO cron_jobs (job_name, last_run_at, last_status, last_error, updated_at)
     VALUES ($1, now(), $2, $3, now())
     ON CONFLICT (job_name) DO UPDATE 
     SET last_run_at = now(), last_status = $2, last_error = $3, updated_at = now()`,
    [jobName, status, error || null]
  );
}
