import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';

async function execute() {
  if (process.env.ENABLE_AUDIT_LOG_PURGE !== 'true') {
    return;
  }
  try {
    await db.withTransaction(async (client) => {
      const res = await client.query(`
        DELETE FROM audit_logs
        WHERE created_at < now() - INTERVAL '1 year'
      `);
      
      if (res.rowCount && res.rowCount > 0) {
        logger.info({ action: 'cron_purge_audit_logs', count: res.rowCount });
      }
    });
  } catch (err: any) {
    logger.error({ action: 'cron_purge_audit_logs_failed', error: err.message });
  }
}

export function startPurgeAuditLogsJob() {
  setInterval(() => {
    runWithLock('purge_audit_logs', execute);
  }, 24 * 60 * 60 * 1000); // Daily
}
