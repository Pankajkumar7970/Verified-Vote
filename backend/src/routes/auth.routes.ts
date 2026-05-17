import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/index.js';
import { VoterVerificationService } from '../services/voter-verify/mock.adapter.js';
import { otpService } from '../services/otp.service.js';
import { SMSService } from '../services/sms/textbee.adapter.js';
import { logger } from '../utils/logger.js';
import jwt from 'jsonwebtoken';

const router = Router();

const voterVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  handler: (req, res) => {
    logger.warn({ action: 'verify_voter_rate_limit', ip: req.ip, request_id: req.requestId });
    res.status(429).json({ error: 'too_many_requests' });
  }
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  handler: (req, res) => {
    res.status(429).json({ error: 'too_many_requests' });
  }
});

router.post('/verify-voter', voterVerifyLimiter, async (req, res) => {
  const { voter_id } = req.body;
  if (!/^[A-Z]{3}[A-Z0-9]{7}$/i.test(voter_id)) {
    return res.status(400).json({ error: 'invalid_voter_id' });
  }

  try {
    const voter = await VoterVerificationService.verifyVoter(voter_id);
    if (!voter) {
      // Simulate not found generically
      return res.status(404).json({ error: 'voter_not_found' });
    }

    // Hash Voter ID
    const { createHash } = await import('crypto');
    const voterIdHash = createHash('sha256').update(voter.voter_id.toUpperCase()).digest('hex');

    // Upsert Voter and their encrypted fields using pgcrypto helper
    const { encryptValue } = await import('../utils/crypto.js');
    const voterIdEnc = await encryptValue(voter.voter_id.toUpperCase());
    const nameEnc = await encryptValue(voter.name);
    const phoneEnc = await encryptValue(voter.phone);

    const client = await db.getClient();
    let dbVoterId;
    let sessionNonce;
    let otp;
    
    try {
      await client.query('BEGIN');
      const upsertRes = await client.query(
        `INSERT INTO voters (voter_id_hash, voter_id_enc, name_enc, phone_enc, constituency, state)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (voter_id_hash) DO UPDATE SET 
         name_enc = $3, phone_enc = $4, constituency = $5, state = $6
         RETURNING id`,
        [voterIdHash, voterIdEnc, nameEnc, phoneEnc, voter.constituency, voter.state]
      );

      dbVoterId = upsertRes.rows[0].id;
      sessionNonce = otpService.generateExchangeNonce();
      otp = otpService.generateOTP();
      const otpHash = await otpService.hashOTP(otp);

      // Invalidate old auth requests
      await client.query('UPDATE otps SET invalidated_at = now() WHERE voter_id = $1 AND invalidated_at IS NULL', [dbVoterId]);
      
      // Create OTP row
      // Max 3 attempts, 10 min expiry
      await client.query(
        `INSERT INTO otps (voter_id, otp_hash, session_nonce, expires_at)
         VALUES ($1, $2, $3, now() + interval '10 minutes')`,
         [dbVoterId, otpHash, sessionNonce]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Fire SMS
    await SMSService.send(voter.phone, `Your VerifiedVote authentication OTP is ${otp}. Valid for 10 minutes.`);

    logger.info({ action: 'otp_sent', request_id: req.requestId });
    res.json({ session_nonce: sessionNonce });
  } catch(err: any) {
    logger.error({ request_id: req.requestId, action: 'verify_voter_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/verify-otp', otpLimiter, async (req, res) => {
  const { otp, session_nonce } = req.body;
  if (!otp || !session_nonce) return res.status(400).json({ error: 'missing_fields' });

  try {
    const result = await db.query(`
      SELECT o.id, o.otp_hash, o.voter_id, o.expires_at, o.invalidated_at, o.attempt_count, v.constituency, v.state 
      FROM otps o
      JOIN voters v ON o.voter_id = v.id
      WHERE o.session_nonce = $1
    `, [session_nonce]);

    const otpRecord = result.rows[0];
    if (!otpRecord) return res.status(401).json({ error: 'invalid_session' });
    if (otpRecord.invalidated_at) return res.status(401).json({ error: 'otp_invalidated' });
    if (new Date() > otpRecord.expires_at) return res.status(401).json({ error: 'otp_expired' });
    
    if (otpRecord.attempt_count >= 3) {
      return res.status(401).json({ error: 'max_attempts_reached' });
    }

    const isValid = await otpService.verifyOTP(otp, otpRecord.otp_hash);
    if (!isValid) {
      await db.query('UPDATE otps SET attempt_count = attempt_count + 1 WHERE id = $1', [otpRecord.id]);
      return res.status(401).json({ error: 'invalid_otp' });
    }

    // Success
    await db.query('UPDATE otps SET invalidated_at = now() WHERE id = $1', [otpRecord.id]);

    const token = jwt.sign(
      { voter_id: otpRecord.voter_id, constituency: otpRecord.constituency, state: otpRecord.state },
      process.env.JWT_SECRET || 'mysecretjwtkey',
      { expiresIn: '24h' }
    );

    res.json({ token });

  } catch(err: any) {
    logger.error({ request_id: req.requestId, action: 'verify_otp_failed', error: err.message });
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
