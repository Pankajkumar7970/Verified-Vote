import { Router } from 'express';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { otpService } from '../services/otp.service.js';
import jwt from 'jsonwebtoken';
import { decryptValue } from '../utils/crypto.js';
import { requireValidSession } from '../middleware/session.middleware.js';
import { FaceVerifyService } from '../services/face-verify.service.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'mysecretjwtkey';

router.post('/resolve', async (req: any, res) => {
  const { ref_code } = req.body;
  if (!ref_code) return res.status(400).json({ error: 'missing_ref_code' });

  try {
    const sessionRes = await db.query(
      `SELECT s.id, s.state, s.expires_at, s.is_revoked, v.id as voter_id, v.phone_enc 
       FROM voting_sessions s
       JOIN voting_requests r ON s.request_id = r.id
       JOIN voters v ON r.voter_id = v.id
       WHERE s.ref_code = $1`,
      [ref_code]
    );

    const session = sessionRes.rows[0];
    if (!session) return res.status(404).json({ error: 'invalid_ref_code' });
    if (session.is_revoked) return res.status(401).json({ error: 'session_revoked' });
    if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'session_expired' });

    // Send OTP
    const otp = otpService.generateOTP();
    const otpHash = await otpService.hashOTP(otp);
    const nonce = otpService.generateExchangeNonce();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await db.query(
      `INSERT INTO otps (voter_id, otp_hash, session_nonce, expires_at) VALUES ($1, $2, $3, $4)`,
      [session.voter_id, otpHash, nonce, otpExpires]
    );

    const phoneStr = await decryptValue(session.phone_enc);
    const msg = `VerifiedVote OTP: ${otp}. Do not share this code.`;
    
    // Abstract SMS Service (use notification queue)
    const notifRes = await db.query(
      `INSERT INTO notifications (voter_id, type, channel, status) VALUES ($1, 'voting_otp', 'sms', 'pending') RETURNING id`,
      [session.voter_id]
    );
    // Ideally the cron/SMS service picks this up
    logger.info({ action: 'otp_queued', notification_id: notifRes.rows[0].id, otp_hint: process.env.NODE_ENV !== 'production' ? otp : '***' });

    await db.query(`UPDATE voting_sessions SET ref_code_used = true, ref_code_used_at = now() WHERE id = $1`, [session.id]);

    const maskedPhone = phoneStr.slice(0, 2) + '******' + phoneStr.slice(-2);
    res.json({ success: true, phone_mask: maskedPhone, nonce });
  } catch(err: any) {
    logger.error({ request_id: req.requestId, action: 'session_resolve_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/verify-otp', async (req: any, res) => {
  const { ref_code, nonce, otp } = req.body;
  if (!ref_code || !nonce || !otp) return res.status(400).json({ error: 'missing_fields' });

  try {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const sessionRes = await client.query(
        `SELECT s.id, s.state, s.expires_at, s.is_revoked, v.id as voter_id
         FROM voting_sessions s
         JOIN voting_requests r ON s.request_id = r.id
         JOIN voters v ON r.voter_id = v.id
         WHERE s.ref_code = $1 FOR UPDATE`,
        [ref_code]
      );

      const session = sessionRes.rows[0];
      if (!session) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(404).json({ error: 'invalid_ref_code' });
      }
      
      if (session.is_revoked) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(401).json({ error: 'session_revoked' });
      }

      const otpRes = await client.query(
        `SELECT * FROM otps WHERE voter_id = $1 AND session_nonce = $2 AND invalidated_at IS NULL AND expires_at > now() FOR UPDATE`,
        [session.voter_id, nonce]
      );
      const otpRecord = otpRes.rows[0];
      if (!otpRecord) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(401).json({ error: 'invalid_otp' });
      }

      if (otpRecord.attempt_count >= 3) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(401).json({ error: 'max_attempts_reached' });
      }

      const isValid = await otpService.verifyOTP(otp, otpRecord.otp_hash);
      if (!isValid) {
        await client.query(`UPDATE otps SET attempt_count = attempt_count + 1 WHERE id = $1`, [otpRecord.id]);
        await client.query('COMMIT');
        client.release();
        return res.status(401).json({ error: 'invalid_otp' });
      }

      await client.query(`UPDATE otps SET invalidated_at = now() WHERE id = $1`, [otpRecord.id]);
      await client.query(`UPDATE voting_sessions SET state = 'otp_verified', otp_verified_at = now() WHERE id = $1`, [session.id]);
      await client.query('COMMIT');
      client.release();

      const token = jwt.sign({ session_id: session.id }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ success: true, token });
    } catch(e) {
      await client.query('ROLLBACK');
      client.release();
      throw e;
    }
  } catch(err: any) {
    logger.error({ request_id: req.requestId, action: 'session_verify_otp_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/face-verify', requireValidSession('otp_verified'), async (req: any, res) => {
  const { selfie_b64 } = req.body;
  if (!selfie_b64) return res.status(400).json({ error: 'missing_selfie' });

  const session = req.votingSession;
  
  try {
    const reqRes = await db.query(`SELECT request_selfie_embedding_enc FROM voting_requests WHERE id = $1`, [session.request_id]);
    if (!reqRes.rows[0] || !reqRes.rows[0].request_selfie_embedding_enc) {
      return res.status(400).json({ error: 'missing_baseline_selfie' });
    }
    
    // In actual implementation FaceVerifyService would decrypt and compare.
    const verification = await FaceVerifyService.verifyFace(reqRes.rows[0].request_selfie_embedding_enc, selfie_b64);
    
    // Settings can be fetched via election if needed. Fixed thresholds here for simplicity.
    const facePassed = verification.face_score > 0.6;
    const livenessPassed = verification.liveness_score > 0.4;
    
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      
      if (facePassed && livenessPassed) {
        await client.query(
          `UPDATE voting_sessions SET state = 'face_verified', face_verified_at = now(), face_score = $1, liveness_score = $2 WHERE id = $3`,
          [verification.face_score, verification.liveness_score, session.id]
        );
        await client.query('COMMIT');
        res.json({ success: true, state: 'face_verified' });
      } else {
        await client.query(
          `UPDATE voting_sessions SET state = 'face_pending', face_score = $1, liveness_score = $2, face_pending_reason = $3 WHERE id = $4`,
          [verification.face_score, verification.liveness_score, 'Scores below threshold', session.id]
        );
        await client.query('COMMIT');
        res.json({ success: false, state: 'face_pending', message: 'Face verification failed, sent for human review.' });
      }
    } catch(err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    
  } catch(err: any) {
    logger.error({ request_id: req.requestId, action: 'face_verify_failed', error: err.message });
    // Invariant 3: Failure -> face_pending
    await db.query(`UPDATE voting_sessions SET state = 'face_pending', face_pending_reason = $1 WHERE id = $2`, ['ai_service_unavailable', session.id]);
    res.status(503).json({ error: 'ai_service_unavailable', state: 'face_pending' });
  }
});

export default router;
