import { Router } from 'express';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { requireValidSession } from '../middleware/session.middleware.js';
import crypto from 'crypto';

const router = Router();

router.get('/candidates', requireValidSession('face_verified'), async (req: any, res) => {
  const session = req.votingSession;
  
  try {
    const electionRes = await db.query(
      `SELECT election_id FROM voting_requests WHERE id = $1`, 
      [session.request_id]
    );
    const electionId = electionRes.rows[0].election_id;
    
    const candidates = await db.query(
      `SELECT c.id, c.name, p.name as party_name, p.abbreviation as party_abbrev
       FROM candidates c
       JOIN parties p ON c.party_id = p.id
       WHERE c.election_id = $1
       ORDER BY c.display_order ASC`,
      [electionId]
    );
    res.json({ candidates: candidates.rows });
  } catch(err: any) {
    logger.error({ request_id: req.requestId, action: 'fetch_candidates', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/cast', requireValidSession('face_verified'), async (req: any, res) => {
  const session = req.votingSession;
  const { candidate_id } = req.body;
  if (!candidate_id) return res.status(400).json({ error: 'missing_candidate' });

  try {
    const electionRes = await db.query(`SELECT election_id, voter_id FROM voting_requests WHERE id = $1`, [session.request_id]);
    const electionId = electionRes.rows[0].election_id;
    const voterId = electionRes.rows[0].voter_id;

    // Rule 9: Vote submission is always a single atomic transaction
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      const sessionUpdate = await client.query(
        `SELECT id FROM voting_sessions
         WHERE id = $1 AND state = 'face_verified' AND is_revoked = false AND expires_at > now() FOR UPDATE`,
         [session.id]
      );
      if (!sessionUpdate.rows[0]) {
         await client.query('ROLLBACK');
         client.release();
         return res.status(409).json({ error: 'invalid_session_state' });
      }

      // Verify the candidate actually belongs to this election
      const candidateCheck = await client.query(
        `SELECT id FROM candidates WHERE id = $1 AND election_id = $2`,
        [candidate_id, electionId]
      );
      if (candidateCheck.rows.length === 0) {
         await client.query('ROLLBACK');
         client.release();
         return res.status(400).json({ error: 'invalid_candidate_for_election' });
      }

      const receiptStr = crypto.randomBytes(16).toString('hex');
      const receiptToken = crypto.createHash('sha256').update(receiptStr).digest('hex');
      
      // Invariant 1 + 17: No PII/request_id in votes, cast_at to nearest minute
      await client.query(
        `INSERT INTO votes (election_id, candidate_id, receipt_token, cast_at)
         VALUES ($1, $2, $3, date_trunc('minute', now()))`,
        [electionId, candidate_id, receiptToken]
      );

      await client.query(`UPDATE voting_sessions SET state = 'vote_cast', vote_cast_at = now() WHERE id = $1`, [session.id]);
      
      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        ['system', session.id, 'vote_cast', 'voting_session', JSON.stringify({ election_id: electionId })]
      );

      // Queue confirmation SMS
      await client.query(`INSERT INTO notifications (voter_id, type) VALUES ($1, 'vote_cast_success')`, [voterId]);
      
      await client.query('COMMIT');
      client.release();
      res.json({ success: true, receipt_token: receiptToken });
    } catch(err) {
      await client.query('ROLLBACK');
      client.release();
      throw err;
    }
  } catch(err: any) {
    logger.error({ request_id: req.requestId, action: 'vote_cast_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
