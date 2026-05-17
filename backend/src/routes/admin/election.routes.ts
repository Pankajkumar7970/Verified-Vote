import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.middleware.js';
import sanitizeHtml from 'sanitize-html';
import { logger } from '../../utils/logger.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

const router = Router();

const requireSuperAdmin = (req: any, res: any, next: any) => {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
};

router.get('/', requireAdmin, async (req, res) => {
  try {
    const elections = await db.query('SELECT * FROM elections ORDER BY created_at DESC');
    res.json({ elections: elections.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/', requireAdmin, requireSuperAdmin, async (req: any, res) => {
  const { name, constituency, state, election_date, request_deadline } = req.body;
  const safeName = sanitizeHtml(name, { allowedTags: [], allowedAttributes: {} });
  
  try {
    const client = await db.getClient();
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO elections (name, constituency, state, election_date, request_deadline, status, created_by) 
       VALUES ($1, $2, $3, $4, $5, 'upcoming', $6) RETURNING *`,
      [safeName, constituency, state, election_date, request_deadline, req.admin.id]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      ['admin', req.admin.id, 'election_created', 'election', result.rows[0].id]
    );
    await client.query('COMMIT');
    client.release();

    res.json({ election: result.rows[0] });
  } catch (err: any) {
    logger.error({ request_id: req.requestId, action: 'election_create_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/:id/activate', requireAdmin, requireSuperAdmin, async (req: any, res) => {
  const { id } = req.params;
  
  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      // Check election
      const electionRes = await client.query('SELECT status FROM elections WHERE id = $1 FOR UPDATE', [id]);
      if (electionRes.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'not_found' });
      }
      
      if (electionRes.rows[0].status !== 'upcoming') {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'invalid_status' });
      }
      
      // Set to voting
      await client.query('UPDATE elections SET status = $1, activated_by = $2, updated_at = now() WHERE id = $3', ['voting', req.admin.id, id]);
      
      // Find final_approved requests
      const approvedRequests = await client.query(
        `SELECT r.id, r.voter_id 
         FROM voting_requests r 
         WHERE r.election_id = $1 AND r.status = 'final_approved'`, 
        [id]
      );

      let sessionsCreated = 0;
      
      for (const reqRow of approvedRequests.rows) {
         const refCode = crypto.randomBytes(6).toString('hex').toUpperCase(); // 12-char
         const expiresAt = new Date();
         expiresAt.setHours(expiresAt.getHours() + 48); // e.g. 48 hour window default
         
         await client.query(
           `INSERT INTO voting_sessions (request_id, ref_code, expires_at) VALUES ($1, $2, $3)`,
           [reqRow.id, refCode, expiresAt]
         );
         
         // Queue SMS Notification
         await client.query(`INSERT INTO notifications (voter_id, type) VALUES ($1, 'voting_link_issued')`, [reqRow.voter_id]);
         sessionsCreated++;
      }
      
      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
        ['admin', req.admin.id, 'election_activated', 'election', id, JSON.stringify({ sessionsCreated })]
      );

      await client.query('COMMIT');
      client.release();
      res.json({ success: true, sessions_created: sessionsCreated });
    } catch(err) {
      await client.query('ROLLBACK');
      client.release();
      console.error('Inner error during activation:', err);
      throw err;
    }
  } catch (err: any) {
    console.error('Outer error during activation:', err);
    logger.error({ request_id: req.requestId, action: 'election_activate_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/:id/results', requireAdmin, async (req: any, res) => {
  const { id } = req.params;
  try {
    const electionRes = await db.query('SELECT status, results_snapshot FROM elections WHERE id = $1', [id]);
    if (electionRes.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    
    const election = electionRes.rows[0];
    if (election.status !== 'completed' && req.admin.role !== 'super_admin') {
      return res.status(403).json({ error: 'results_not_published' });
    }
    
    if (election.status === 'completed') {
       return res.json({ results: election.results_snapshot });
    }

    // super_admin preview of current tally
    const tallyRes = await db.query(
      `SELECT c.id, c.name, p.name as party_name, count(v.id) as vote_count
       FROM candidates c
       LEFT JOIN parties p ON c.party_id = p.id
       LEFT JOIN votes v ON c.id = v.candidate_id 
       WHERE c.election_id = $1
       GROUP BY c.id, c.name, p.name`,
       [id]
    );
    res.json({ results: { tally: tallyRes.rows } });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/:id/publish-results', requireAdmin, requireSuperAdmin, async (req: any, res) => {
  const { id } = req.params;
  const { password } = req.body;
  
  if (!password) return res.status(400).json({ error: 'password_required' });

  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      const adminRes = await client.query('SELECT password_hash FROM admins WHERE id = $1', [req.admin.id]);
      const valid = await bcrypt.compare(password, adminRes.rows[0].password_hash);
      if (!valid) {
         await client.query('ROLLBACK');
         client.release();
         return res.status(401).json({ error: 'invalid_password' });
      }

      const electionRes = await client.query('SELECT status FROM elections WHERE id = $1 FOR UPDATE', [id]);
      if (electionRes.rows.length === 0 || electionRes.rows[0].status !== 'voting') {
         await client.query('ROLLBACK');
         client.release();
         return res.status(400).json({ error: 'invalid_status' });
      }

      const tallyRes = await client.query(
        `SELECT c.id, c.name, p.name as party_name, count(v.id) as vote_count
         FROM candidates c
         LEFT JOIN parties p ON c.party_id = p.id
         LEFT JOIN votes v ON c.id = v.candidate_id 
         WHERE c.election_id = $1
         GROUP BY c.id, c.name, p.name`,
         [id]
      );

      const snapshot = { tally: tallyRes.rows, published_at: new Date() };
      const snapshotString = JSON.stringify(snapshot);
      const hash = crypto.createHash('sha256').update(snapshotString).digest('hex');

      await client.query(
        `UPDATE elections 
         SET status = 'completed', results_snapshot = $1, results_hash = $2, results_published_at = now(), updated_at = now()
         WHERE id = $3`,
        [snapshotString, hash, id]
      );

      // Revoke any active sessions
      await client.query(
        `UPDATE voting_sessions s
         SET is_revoked = true, revoked_at = now(), revoked_by = $1
         FROM voting_requests r
         WHERE s.request_id = r.id AND r.election_id = $2 AND s.is_revoked = false`,
         [req.admin.id, id]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
        ['admin', req.admin.id, 'election_completed', 'election', id, JSON.stringify({ results_hash: hash })]
      );

      await client.query('COMMIT');
      client.release();
      res.json({ success: true });
    } catch(err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch (err: any) {
    logger.error({ request_id: req.requestId, action: 'election_publish_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
