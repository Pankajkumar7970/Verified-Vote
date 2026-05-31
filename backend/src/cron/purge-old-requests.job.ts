import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import { SYSTEM_AUDIT_ACTOR_ID } from '../constants/system.js';

async function execute() {
  try {
    await db.withTransaction(async (client) => {
      const retentionMonthsStr = process.env.VOTING_REQUEST_RETENTION_MONTHS;
      const retentionMonths = retentionMonthsStr ? parseInt(retentionMonthsStr, 10) : 6;
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - (isNaN(retentionMonths) ? 6 : retentionMonths));

      // First, delete request events for old requests
      const eventsRes = await client.query(`
        DELETE FROM request_events
        WHERE request_id IN (
          SELECT id FROM voting_requests
          WHERE created_at < $1
        )
      `, [cutoffDate.toISOString()]);

      // Then delete old voting requests
      const requestsRes = await client.query(`
        DELETE FROM voting_requests
        WHERE created_at < $1
      `, [cutoffDate.toISOString()]);

      if (requestsRes.rowCount || eventsRes.rowCount) {
        logger.info({ 
          action: 'cron_purge_old_requests', 
          requestsDeleted: requestsRes.rowCount,
          eventsDeleted: eventsRes.rowCount
        });
        
        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, metadata)
           VALUES ('system', $1, 'old_requests_purged', 'voting_request', $2)`,
          [
            SYSTEM_AUDIT_ACTOR_ID,
            JSON.stringify({ 
              requestsDeleted: requestsRes.rowCount,
              eventsDeleted: eventsRes.rowCount
            })
          ]
        );
      }
    });
  } catch (err: any) {
    logger.error({ action: 'cron_purge_old_requests_failed', error: err.message });
  }
}

export function startPurgeOldRequestsJob() {
  setInterval(() => {
    void runWithLock('purge_old_requests', execute).catch((err: unknown) => {
      logger.error({
        action: 'purge_old_requests_job_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }, 24 * 60 * 60 * 1000); // Daily
}