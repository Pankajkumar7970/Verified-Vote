import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import { SYSTEM_AUDIT_ACTOR_ID } from '../constants/system.js';

async function execute() {
  try {
    await db.withTransaction(async (client) => {
      // First delete settings for the draft elections to satisfy foreign key constraint
      await client.query(`
        DELETE FROM election_settings
        WHERE election_id IN (
          SELECT id FROM elections
          WHERE status = 'draft' AND election_date < CURRENT_DATE
        )
      `);

      // Delete candidates for the draft elections (if any)
      await client.query(`
        DELETE FROM candidates
        WHERE election_id IN (
          SELECT id FROM elections
          WHERE status = 'draft' AND election_date < CURRENT_DATE
        )
      `);

      // Delete the draft elections
      const res = await client.query(`
        DELETE FROM elections
        WHERE status = 'draft' AND election_date < CURRENT_DATE
      `);

      if (res.rowCount && res.rowCount > 0) {
        logger.info({ action: 'cron_cleanup_draft_elections', count: res.rowCount });
        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, metadata)
           VALUES ('system', $1, 'draft_elections_cleaned', 'election', $2)`,
          [SYSTEM_AUDIT_ACTOR_ID, JSON.stringify({ count: res.rowCount })]
        );
      }
    });
  } catch (err) {
    throw err;
  }
}

export function startCleanupDraftElectionsJob() {
  setInterval(() => {
    void runWithLock('cleanup_draft_elections', execute).catch((err: unknown) => {
      logger.error({
        action: 'cleanup_draft_elections_job_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }, 60 * 60 * 1000); // Run every hour
}
