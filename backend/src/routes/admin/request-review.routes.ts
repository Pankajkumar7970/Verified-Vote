import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.middleware.js';
import sanitizeHtml from 'sanitize-html';
import { logger } from '../../utils/logger.js';
import { MinIOService } from '../../services/minio.service.js';

const router = Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.id, r.voter_id, r.election_id, r.reason_category, r.reason_detail, r.doc_type, 
             r.doc_minio_key, r.appeal_doc_minio_key, coalesce(r.face_score_at_request, 0) as face_score_at_request, 
             r.status, r.created_at, e.name as election_name
      FROM voting_requests r
      JOIN elections e ON r.election_id = e.id
      ORDER BY r.created_at DESC LIMIT 100
    `);

    // Enhance response with temporary Signed URLs for MinIO docs
    const enriched = await Promise.all(result.rows.map(async (row) => {
      const enhancedRow = { ...row };
      if (row.doc_minio_key) {
         enhancedRow.doc_url = await MinIOService.getSignedUrl(row.doc_minio_key);
      }
      if (row.appeal_doc_minio_key) {
         enhancedRow.appeal_doc_url = await MinIOService.getSignedUrl(row.appeal_doc_minio_key);
      }
      // Remove raw keys before sending to FE
      delete enhancedRow.doc_minio_key;
      delete enhancedRow.appeal_doc_minio_key;
      return enhancedRow;
    }));

    res.json({ requests: enriched });
  } catch (err: any) {
    logger.error({ request_id: req.requestId, error: err.message });
    res.status(500).json({ error: 'internal_error', request_id: req.requestId });
  }
});

router.post('/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, reason, note } = req.body;
  const adminId = req.admin!.id;
  const adminRole = req.admin!.role;

  const safeNote = note ? sanitizeHtml(note, { allowedTags: [], allowedAttributes: {} }) : null;
  const safeReason = reason ? sanitizeHtml(reason, { allowedTags: [], allowedAttributes: {} }) : null;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const requestRes = await client.query('SELECT * FROM voting_requests WHERE id = $1 FOR UPDATE', [id]);
    if (requestRes.rows.length === 0) throw new Error('not_found');
    const voteReq = requestRes.rows[0];

    const oldStatus = voteReq.status;

    // Rule 38 Transition Logic
    let allowed = false;
    if (adminRole === 'reviewer') {
      if (oldStatus === 'pending' && status === 'under_review') allowed = true;
      if (oldStatus === 'under_review' && status === 'reviewer_approved') allowed = true;
      if (oldStatus === 'under_review' && status === 'rejected') allowed = true;
      if (oldStatus === 'appealed' && status === 'under_review') allowed = true; // Reviewer can pick up appeals
    } else if (adminRole === 'super_admin') {
      if (oldStatus === 'reviewer_approved' && status === 'superadmin_approved') allowed = true;
      if (oldStatus === 'reviewer_approved' && status === 'rejected') allowed = true;
      if (oldStatus === 'under_review' && status === 'rejected') allowed = true;
      if (oldStatus === 'appealed' && status === 'appeal_resolved') allowed = true; // Super admins can forcibly resolve appeals
    }

    if (!allowed) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({ error: 'role_insufficient_for_transition', request_id: req.requestId });
    }

    let newStatus = status;
    if (newStatus === 'superadmin_approved') {
      newStatus = 'final_approved'; // System sets final_approved automatically
    }

    // Rule 13: Insert request_events BEFORE updating voting_requests.status
    await client.query(
      `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, oldStatus, newStatus, adminId, 'admin', safeReason, JSON.stringify({ note: safeNote })]
    );

    // Audit Log for Review Actions
    if (newStatus === 'rejected' || newStatus === 'reviewer_approved' || newStatus === 'superadmin_approved' || newStatus === 'final_approved' || newStatus === 'appeal_resolved') {
       let actionStr = `request_${newStatus}`;
       await client.query(`INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
         ['admin', adminId, actionStr, 'voting_request', id]);
    }

    // Update Request Target
    let updateQuery = `UPDATE voting_requests SET status = $1, updated_at = now()`;
    let params: any[] = [newStatus, id];
    let paramIdx = 3;

    if (adminRole === 'reviewer' && newStatus !== 'under_review') {
      updateQuery += `, reviewed_by_reviewer = $${paramIdx}, reviewer_note = $${paramIdx+1}`;
      params.push(adminId, safeNote);
    } else if (adminRole === 'super_admin') {
      updateQuery += `, reviewed_by_superadmin = $${paramIdx}, superadmin_note = $${paramIdx+1}`;
      params.push(adminId, safeNote);
    }

    updateQuery += ` WHERE id = $2 RETURNING *`;
    const updated = await client.query(updateQuery, params);

    // Notifications
    if (newStatus === 'final_approved') {
       await client.query(`INSERT INTO notifications (voter_id, type) VALUES ($1, 'request_approved')`, [voteReq.voter_id]);
    } else if (newStatus === 'rejected') {
       await client.query(`INSERT INTO notifications (voter_id, type) VALUES ($1, 'request_rejected')`, [voteReq.voter_id]);
    } else if (newStatus === 'appeal_resolved') {
       await client.query(`INSERT INTO notifications (voter_id, type) VALUES ($1, 'appeal_resolved')`, [voteReq.voter_id]);
    }

    // Rule 21 & Rule 4: Data deletion on terminal states
    if (['final_approved', 'rejected', 'appeal_resolved'].includes(newStatus)) {
      if (voteReq.doc_minio_key) {
         logger.info({ action: 'delete_minio_doc', key: voteReq.doc_minio_key });
         await client.query('UPDATE voting_requests SET doc_minio_key = null WHERE id = $1', [id]);
      }
      if (voteReq.appeal_doc_minio_key) {
         logger.info({ action: 'delete_minio_appeal', key: voteReq.appeal_doc_minio_key });
         await client.query('UPDATE voting_requests SET appeal_doc_minio_key = null WHERE id = $1', [id]);
      }
      if (newStatus === 'rejected') {
         await client.query('UPDATE voting_requests SET request_selfie_embedding_enc = null WHERE id = $1', [id]);
      }
    }

    await client.query('COMMIT');
    client.release();
    res.json({ request: updated.rows[0] });

  } catch(err: any) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    logger.error({ request_id: req.requestId, action: 'updateRequestStatus', error: err.message });
    res.status(err.message === 'not_found' ? 404 : 500).json({ error: err.message, request_id: req.requestId });
  }
});

export default router;
