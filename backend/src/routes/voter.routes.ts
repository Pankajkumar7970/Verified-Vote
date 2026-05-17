import { Router } from 'express';
import { db } from '../db/index.js';
import { requireVoter } from '../middleware/voter-auth.middleware.js';
import { logger } from '../utils/logger.js';
import { MinIOService } from '../services/minio.service.js';
import { FaceVerifyService } from '../services/face-verify.service.js';
import { encryptValue } from '../utils/crypto.js';
import sanitizeHtml from 'sanitize-html';
import multer from 'multer';

const router = Router();
const upload = multer({ 
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('invalid_file_type'));
    }
  }
});

router.get('/elections', requireVoter, async (req: any, res) => {
  const { constituency, state } = req.voter;
  try {
    const elections = await db.query(
      `SELECT id, name, election_date, request_deadline, status FROM elections 
       WHERE constituency = $1 AND state = $2 AND status IN ('active', 'voting')
       ORDER BY election_date ASC`,
      [constituency, state]
    );
    res.json({ elections: elections.rows });
  } catch (err: any) {
    logger.error({ request_id: req.requestId, action: 'fetch_elections', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/requests/submit', requireVoter, upload.single('doc'), async (req: any, res) => {
  const voterId = req.voter.id;
  const { election_id, reason_category, reason_detail, doc_type, selfie_b64 } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'missing_document' });
  if (!selfie_b64) return res.status(400).json({ error: 'missing_selfie' });

  const safeReasonDetail = reason_detail ? sanitizeHtml(reason_detail, { allowedTags: [], allowedAttributes: {} }) : null;

  try {
    // 1. Verify Election constituency matches
    const electionRes = await db.query('SELECT constituency, state, status, request_deadline FROM elections WHERE id = $1', [election_id]);
    const election = electionRes.rows[0];
    if (!election) return res.status(404).json({ error: 'election_not_found' });
    if (election.constituency !== req.voter.constituency || election.state !== req.voter.state) {
      return res.status(403).json({ error: 'wrong_constituency', message: 'This election is not available for your constituency.' });
    }
    if (new Date() > new Date(election.request_deadline)) {
       return res.status(403).json({ error: 'deadline_passed', message: 'The request deadline for this election has passed.' });
    }

    // 2. MinIO Upload
    const { key: docKey, hash: docHash } = await MinIOService.uploadDocument(file.buffer, file.mimetype);

    // 3. Extract Face Embedding
    const embedding = await FaceVerifyService.getEmbedding(selfie_b64);
    const embeddingEnc = await encryptValue(JSON.stringify(embedding));

    // For Request Phase, we also call verifyFace just to get a baseline score (liveness, etc)
    const verification = await FaceVerifyService.verifyFace(null, selfie_b64);

    // 4. Insert Request
    const client = await db.getClient();
    let requestId;
    try {
      await client.query('BEGIN');
      try {
        const requestRes = await client.query(
          `INSERT INTO voting_requests 
            (voter_id, election_id, reason_category, reason_detail, doc_type, doc_minio_key, doc_hash, request_selfie_embedding_enc, face_score_at_request, liveness_score_at_request)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [voterId, election_id, reason_category, safeReasonDetail, doc_type, docKey, docHash, embeddingEnc, verification.face_score, verification.liveness_score]
        );
        requestId = requestRes.rows[0].id;
      } catch (err: any) {
        if (err.code === '23505' && err.constraint === 'unique_active_request_idx') {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({ error: 'duplicate_request', message: 'You already have an active request for this election.' });
        }
        throw err;
      }

      // Insert Request Event
      await client.query(
        `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
         VALUES ($1, 'none', 'pending', $2, 'voter', 'Initial request submission')`,
        [requestId, voterId]
      );

      // Queue SMS Notification 1
      await client.query(`INSERT INTO notifications (voter_id, type) VALUES ($1, 'request_submitted')`, [voterId]);
      
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
    logger.info({ action: 'request_submitted', request_id: req.requestId, entity_id: requestId });
    res.json({ success: true, request_id: requestId });

  } catch (err: any) {
    logger.error({ request_id: req.requestId, action: 'request_submit_failed', error: err.message });
    res.status(err.message === 'invalid_file_type' ? 400 : 500).json({ error: err.message });
  }
});

router.get('/requests', requireVoter, async (req: any, res) => {
  try {
    const requests = await db.query(
      `SELECT r.id, r.election_id, r.reason_category, r.status, r.created_at, e.name as election_name
       FROM voting_requests r
       JOIN elections e ON r.election_id = e.id
       WHERE r.voter_id = $1 ORDER BY r.created_at DESC`,
      [req.voter.id]
    );
    res.json({ requests: requests.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/notifications', requireVoter, async (req: any, res) => {
  try {
    const notifs = await db.query(
      `SELECT id, type, message, is_read, created_at 
       FROM notifications 
       WHERE voter_id = $1 
       ORDER BY created_at DESC LIMIT 50`,
      [req.voter.id]
    );
    if (notifs.rows.length > 0) {
      await db.query(`UPDATE notifications SET is_read = true WHERE voter_id = $1`, [req.voter.id]);
    }
    res.json({ notifications: notifs.rows });
  } catch(err: any) {
    logger.error({ action: 'fetch_notifications_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/requests/:id/withdraw', requireVoter, async (req: any, res) => {
  const { id } = req.params;
  const voterId = req.voter.id;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const reqInfo = await client.query('SELECT status, doc_minio_key FROM voting_requests WHERE id = $1 AND voter_id = $2 FOR UPDATE', [id, voterId]);
    if (reqInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'not_found' });
    }

    if (['withdrawn', 'rejected', 'appeal_resolved', 'final_approved'].includes(reqInfo.rows[0].status)) {
       await client.query('ROLLBACK');
       client.release();
       return res.status(400).json({ error: 'invalid_status' });
    }

    await client.query(
      `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
       VALUES ($1, $2, 'withdrawn', $3, 'voter', 'Voter withdrew request')`,
      [id, reqInfo.rows[0].status, voterId]
    );

    await client.query(
      `UPDATE voting_requests 
       SET status = 'withdrawn', withdrawn_at = now(), request_selfie_embedding_enc = null
       WHERE id = $1`, 
    [id]);

    // Cleanup MinIO doc if exists
    if (reqInfo.rows[0].doc_minio_key) {
      logger.info({ action: 'delete_minio_doc', key: reqInfo.rows[0].doc_minio_key });
      await client.query('UPDATE voting_requests SET doc_minio_key = null WHERE id = $1', [id]);
    }

    await client.query('COMMIT');
    client.release();
    res.json({ success: true });
  } catch (err: any) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/requests/:id/appeal', requireVoter, upload.single('doc'), async (req: any, res) => {
  const { id } = req.params;
  const voterId = req.voter.id;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'missing_document' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const reqInfo = await client.query('SELECT status FROM voting_requests WHERE id = $1 AND voter_id = $2 FOR UPDATE', [id, voterId]);
    if (reqInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'not_found' });
    }

    if (reqInfo.rows[0].status !== 'rejected') {
       await client.query('ROLLBACK');
       client.release();
       return res.status(400).json({ error: 'invalid_status', message: 'Only rejected requests can be appealed.' });
    }

    const { key: docKey } = await MinIOService.uploadDocument(file.buffer, file.mimetype);

    await client.query(
      `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
       VALUES ($1, 'rejected', 'appealed', $2, 'voter', 'Voter submitted appeal')`,
      [id, voterId]
    );

    await client.query(
      `UPDATE voting_requests 
       SET status = 'appealed', appeal_doc_minio_key = $1, appeal_submitted_at = now()
       WHERE id = $2`, 
    [docKey, id]);

    await client.query(`INSERT INTO notifications (voter_id, type) VALUES ($1, 'appeal_submitted')`, [voterId]);

    await client.query('COMMIT');
    client.release();
    res.json({ success: true });
  } catch (err: any) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
