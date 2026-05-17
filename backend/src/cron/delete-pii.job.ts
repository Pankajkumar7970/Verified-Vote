import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';

async function execute() {
  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      const res = await client.query(`
        UPDATE voting_requests
        SET request_selfie_embedding_enc = null
        WHERE created_at < now() - INTERVAL '30 days'
          AND request_selfie_embedding_enc IS NOT NULL
      `);
      
      if (res.rowCount && res.rowCount > 0) {
        logger.info({ action: 'cron_delete_pii', count: res.rowCount });
        await client.query(`
          INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, metadata)
          VALUES ('system', 'system', 'pii_deleted', 'voting_request', $1)
        `, [JSON.stringify({ count: res.rowCount })]);
      }
      
      await client.query('COMMIT');
    } catch(err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error({ action: 'cron_delete_pii_failed', error: err.message });
  }
}

export function startDeletePIIJob() {
  setInterval(() => {
    runWithLock('delete_pii', execute);
  }, 24 * 60 * 60 * 1000); // Daily
}
