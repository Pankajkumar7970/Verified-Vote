import { db } from '../db/index';
import crypto from 'crypto';

function deterministicInt(str: string): number {
  const hash = crypto.createHash('sha256').update(str).digest('hex');
  return parseInt(hash.substring(0, 8), 16);
}

export async function runWithLock(jobName: string, fn: () => Promise<void>) {
  const lockId = deterministicInt(jobName);
  const { rows } = await db.query('SELECT pg_try_advisory_lock($1) as locked', [lockId]);
  
  if (!rows[0].locked) {
    await updateCronStatus(jobName, 'skipped');
    return;
  }
  
  try {
    await fn();
    await updateCronStatus(jobName, 'success');
  } catch (err: any) {
    await updateCronStatus(jobName, 'failed', err.message);
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [lockId]);
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
