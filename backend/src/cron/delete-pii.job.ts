import { db } from '../db/index.js';
import { runWithLock } from './lock.js';
import { logger } from '../utils/logger.js';
import { SYSTEM_AUDIT_ACTOR_ID } from '../constants/system.js';
import { MinIOService } from '../services/minio.service.js';
import { decryptDocKey } from '../utils/crypto.js';

async function execute() {
  try {
    await db.withTransaction(async (client) => {
      // Step 1: Retrieve affected voters whose PII needs to be purged
      const affectedVoters = await client.query(`
        SELECT id, voter_id_hash
        FROM voters v
        WHERE (phone_enc IS NOT NULL OR voter_id_enc IS NOT NULL OR name_enc IS NOT NULL)
          AND (
            (v.data_expires_at IS NOT NULL AND v.data_expires_at < now())
            OR EXISTS (
              SELECT 1 FROM voting_requests r
              JOIN elections e ON e.id = r.election_id
              WHERE r.voter_id = v.id
                AND e.status = 'results_published'
                AND e.results_published_at < now() - INTERVAL '30 days'
            )
          )
      `);

      const voterIds = affectedVoters.rows.map((row: any) => row.id);

      // Get all requests and sessions that need cleanup based on either published election status or expired voter data
      const requestsRes = await client.query(`
        SELECT r.id, r.request_selfie_minio_key, r.voter_id_photo_minio_key, r.appeal_doc_minio_key
        FROM voting_requests r
        JOIN elections e ON r.election_id = e.id
        JOIN voters v ON r.voter_id = v.id
        WHERE ((e.status = 'results_published' AND e.results_published_at < now() - INTERVAL '30 days')
           OR (v.data_expires_at IS NOT NULL AND v.data_expires_at < now()))
          AND (r.request_selfie_minio_key IS NOT NULL 
               OR r.voter_id_photo_minio_key IS NOT NULL 
               OR r.appeal_doc_minio_key IS NOT NULL)
      `);

      let sessionsRes = { rows: [] };
      try {
        sessionsRes = await client.query(`
          SELECT s.id, s.voting_selfie_minio_key
          FROM voting_sessions s
          JOIN voting_requests r ON s.request_id = r.id
          JOIN elections e ON r.election_id = e.id
          JOIN voters v ON r.voter_id = v.id
          WHERE ((e.status = 'results_published' AND e.results_published_at < now() - INTERVAL '30 days')
             OR (v.data_expires_at IS NOT NULL AND v.data_expires_at < now()))
            AND s.voting_selfie_minio_key IS NOT NULL
        `);
      } catch {}

      // Step 2: Delete files from MinIO
      let deletedFilesCount = 0;

      for (const req of requestsRes.rows) {
        if (req.request_selfie_minio_key) {
          try {
            const key = await decryptDocKey(req.request_selfie_minio_key);
            await MinIOService.deleteDocument(key);
            deletedFilesCount++;
          } catch {}
        }
        if (req.voter_id_photo_minio_key) {
          try {
            const key = await decryptDocKey(req.voter_id_photo_minio_key);
            await MinIOService.deleteDocument(key);
            deletedFilesCount++;
          } catch {}
        }
        if (req.appeal_doc_minio_key) {
          try {
            const key = await decryptDocKey(req.appeal_doc_minio_key);
            await MinIOService.deleteDocument(key);
            deletedFilesCount++;
          } catch {}
        }
      }

      for (const sess of sessionsRes.rows) {
        if (sess.voting_selfie_minio_key) {
          try {
            const key = await decryptDocKey(sess.voting_selfie_minio_key);
            await MinIOService.deleteDocument(key);
            deletedFilesCount++;
          } catch {}
        }
      }

      // Step 3: Update DB to remove encrypted keys and embeddings
      const emb = await client.query(`
        UPDATE voting_requests r
        SET request_selfie_embedding_enc = null,
            request_selfie_minio_key = null,
            voter_id_photo_minio_key = null,
            appeal_doc_minio_key = null
        FROM elections e
        JOIN voters v ON r.voter_id = v.id
        WHERE r.election_id = e.id
          AND ((e.status = 'results_published' AND e.results_published_at < now() - INTERVAL '30 days')
               OR (v.data_expires_at IS NOT NULL AND v.data_expires_at < now()))
          AND (r.request_selfie_embedding_enc IS NOT NULL
               OR r.request_selfie_minio_key IS NOT NULL
               OR r.voter_id_photo_minio_key IS NOT NULL
               OR r.appeal_doc_minio_key IS NOT NULL)
      `);

      let sessUpdate = { rowCount: 0 };
      try {
        sessUpdate = await client.query(`
          UPDATE voting_sessions s
          SET voting_selfie_minio_key = null
          FROM voting_requests r
          JOIN elections e ON r.election_id = e.id
          JOIN voters v ON r.voter_id = v.id
          WHERE s.request_id = r.id
            AND ((e.status = 'results_published' AND e.results_published_at < now() - INTERVAL '30 days')
                 OR (v.data_expires_at IS NOT NULL AND v.data_expires_at < now()))
            AND s.voting_selfie_minio_key IS NOT NULL
        `);
      } catch {}

      let votersDeletedCount = 0;
      if (voterIds.length > 0) {
        const votersRes = await client.query(`
          UPDATE voters
          SET phone_enc = null, voter_id_enc = null, name_enc = null
          WHERE id = ANY($1)
        `, [voterIds]);
        votersDeletedCount = votersRes.rowCount || 0;
      }

      if (votersDeletedCount > 0 || deletedFilesCount > 0 || emb.rowCount || sessUpdate.rowCount) {
        logger.info({ 
          action: 'cron_delete_pii', 
          embeddings: emb.rowCount, 
          voters_purged_count: votersDeletedCount,
          voters_purged_details: affectedVoters.rows,
          files: deletedFilesCount,
          sessions: sessUpdate.rowCount
        });

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, metadata)
           VALUES ('system', $1, 'pii_deleted', 'voter', $2)`,
          [
            SYSTEM_AUDIT_ACTOR_ID, 
            JSON.stringify({ 
              embeddings: emb.rowCount, 
              voters_purged_count: votersDeletedCount,
              voters: affectedVoters.rows,
              files: deletedFilesCount,
              sessions: sessUpdate.rowCount
            })
          ]
        );
      }
    });
  } catch (err: any) {
    logger.error({ action: 'cron_delete_pii_failed', error: err.message });
    throw err;
  }
}

export function startDeletePIIJob() {
  setInterval(() => {
    void runWithLock('delete_pii', execute).catch((err: unknown) => {
      logger.error({
        action: 'delete_pii_job_failed',
        error: err instanceof Error ? err.message : 'unknown',
      });
    });
  }, 24 * 60 * 60 * 1000);
}
