import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import { SYSTEM_AUDIT_ACTOR_ID } from '../constants/system.js';

async function execute() {
  try {
    await db.withTransaction(async (client) => {
      const res = await client.query(`
        UPDATE voting_sessions
        SET state = 'expired', updated_at = now()
        WHERE expires_at < now() AND state NOT IN ('vote_cast', 'expired')
      `);

      if (res.rowCount && res.rowCount > 0) {
        logger.info({ action: 'cron_expire_sessions', count: res.rowCount });
        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, metadata)
           VALUES ('system', $1, 'sessions_expired', 'voting_session', $2)`,
          [SYSTEM_AUDIT_ACTOR_ID, JSON.stringify({ count: res.rowCount })]
        );
      }
    });
  } catch (err) {
    throw err;
  }
}

export function startExpireSessionsJob() {
  setInterval(() => {
    void runWithLock('expire_sessions', execute).catch((err: unknown) => {
      logger.error({
        action: 'expire_sessions_job_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }, 60 * 1000);
}
