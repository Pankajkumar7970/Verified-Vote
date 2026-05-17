import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';

async function execute() {
  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      const res = await client.query(`
        UPDATE voting_sessions
        SET is_revoked = true, revoked_at = now(), state = 'expired'
        WHERE expires_at < now() AND is_revoked = false AND state != 'vote_cast'
      `);
      
      if (res.rowCount && res.rowCount > 0) {
        logger.info({ action: 'cron_expire_sessions', count: res.rowCount });
        await client.query(`
          INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, metadata)
          VALUES ('system', 'system', 'sessions_expired', 'voting_session', $1)
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
    logger.error({ action: 'cron_expire_sessions_failed', error: err.message });
  }
}

export function startExpireSessionsJob() {
  setInterval(() => {
    runWithLock('expire_sessions', execute);
  }, 10 * 60 * 1000); // 10 minutes
}
