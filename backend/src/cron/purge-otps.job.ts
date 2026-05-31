import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';

async function execute() {
  try {
    await db.withTransaction(async (client) => {
      const res = await client.query(`
        DELETE FROM otps
        WHERE expires_at < now() - INTERVAL '1 day' OR invalidated_at < now() - INTERVAL '1 day'
      `);
      
      if (res.rowCount && res.rowCount > 0) {
        logger.info({ action: 'cron_purge_otps', count: res.rowCount });
        // NOTE: Purging old OTPs usually doesn't require an audit log for security unless strict compliance requires it
      }
    });
  } catch (err: any) {
    logger.error({ action: 'cron_purge_otps_failed', error: err.message });
  }
}

export function startPurgeOTPsJob() {
  setInterval(() => {
    void runWithLock('purge_otps', execute).catch((err: unknown) => {
      logger.error({
        action: 'purge_otps_job_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }, 6 * 60 * 60 * 1000); // Every 6 hours
}
