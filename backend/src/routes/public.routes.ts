import { Router } from 'express';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Public Election Results view
router.get('/elections/:id/results', async (req: any, res) => {
  const { id } = req.params;
  try {
    const electionRes = await db.query(
      `SELECT id, name, constituency, state, status, results_snapshot, results_published_at
       FROM elections WHERE id = $1`,
      [id]
    );

    if (electionRes.rows.length === 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const election = electionRes.rows[0];

    // Only allow viewing if results are officially published
    if (election.status !== 'completed' || !election.results_snapshot) {
      return res.status(403).json({ error: 'results_not_published' });
    }

    res.json({ election });
  } catch (err: any) {
    logger.error({ action: 'public_results_fetch_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

// Receipt Token Verification
router.get('/verify-receipt/:token', async (req: any, res) => {
  const { token } = req.params;
  
  if (!token) {
     return res.status(400).json({ error: 'token_missing' });
  }

  try {
    const voteRes = await db.query(
      `SELECT v.cast_at, e.name as election_name 
       FROM votes v
       JOIN elections e ON v.election_id = e.id
       WHERE v.receipt_token = $1`,
      [token]
    );

    if (voteRes.rows.length === 0) {
      // Don't leak if the token doesn't exist to prevent enumeration, just say not found
      return res.status(404).json({ error: 'receipt_not_found', message: 'No valid vote found for this receipt.' });
    }

    const vote = voteRes.rows[0];
    res.json({
      success: true,
      data: {
        election_name: vote.election_name,
        cast_at: vote.cast_at
        // Notice we do NOT expose candidate_id or any PII
      }
    });
  } catch (err: any) {
    logger.error({ action: 'verify_receipt_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
