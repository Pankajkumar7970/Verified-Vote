/**
 * Voter authentication handlers: verify voter ID, resend OTP, and verify OTP to issue JWT.
 */
import type { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db/index.js";
import { VoterVerificationService } from "../services/voter-verify/index.js";
import { otpService } from "../services/otp.service.js";
import { logger } from "../utils/logger.js";
import { config } from "../utils/config.js";
import { queueNotification } from "../services/sms/notification-queue.js";
import { scheduleOtpDispatch } from "../services/sms/dispatch-notification.js";
import { ValidationError, AuthError } from "../utils/errors.js";
import {
  recordFailedAttempt,
  clearFailedAttempts,
} from "../middleware/ip-blocker.middleware.js";

export async function verifyVoter(req: any, res: Response, next: NextFunction) {
  const { voter_id, mobile_number } = req.body;

  try {
    const voter = await VoterVerificationService.verifyVoter(voter_id);
    if (!voter) {
      throw new ValidationError("verification_failed");
    }

    const { createHash } = await import("crypto");
    const voterIdHash = createHash("sha256")
      .update(voter.voter_id.toUpperCase())
      .digest("hex");
    const { encryptValue } = await import("../utils/crypto.js");
    const voterIdEnc = await encryptValue(voter.voter_id.toUpperCase());
    const nameEnc = await encryptValue(voter.name);
    const phoneEnc = await encryptValue(mobile_number);

    const { sessionNonce, notificationId } = await db.withTransaction(
      async (client) => {
        const upsertRes = await client.query(
          `INSERT INTO voters (voter_id_hash, voter_id_enc, name_enc, phone_enc, constituency, state)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (voter_id_hash) DO UPDATE SET
         name_enc = $3, phone_enc = $4, constituency = $5, state = $6
         RETURNING id`,
          [
            voterIdHash,
            voterIdEnc,
            nameEnc,
            phoneEnc,
            voter.constituency,
            voter.state,
          ],
        );

        const dbVoterId = upsertRes.rows[0].id;
        const nonce = otpService.generateExchangeNonce();
        const otp = otpService.generateOTP();
        const otpHash = await otpService.hashOTP(otp);

        await client.query(
          `UPDATE otps SET invalidated_at = now() WHERE voter_id = $1 AND invalidated_at IS NULL`,
          [dbVoterId],
        );

        await client.query(
          `INSERT INTO otps (voter_id, otp_hash, session_nonce, expires_at)
         VALUES ($1, $2, $3, now() + interval '10 minutes')`,
          [dbVoterId, otpHash, nonce],
        );

        const queuedId = await queueNotification(
          dbVoterId,
          "auth_otp",
          { otp },
          client,
        );
        return { sessionNonce: nonce, notificationId: queuedId };
      },
    );

    scheduleOtpDispatch(notificationId, "auth_otp");

    logger.info({
      action: "otp_queued",
      request_id: req.requestId,
      otp_hint: config.isProd ? undefined : "see_sms_queue",
    });
    res.json({ session_nonce: sessionNonce });
  } catch (err: unknown) {
    next(err);
  }
}

export async function resendOtp(req: any, res: Response, next: NextFunction) {
  const { session_nonce } = req.body;

  try {
    const otpRes = await db.query(
      `SELECT voter_id FROM otps WHERE session_nonce = $1 AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [session_nonce],
    );
    if (otpRes.rows.length === 0) {
      throw new ValidationError("invalid_session");
    }

    const voterId = otpRes.rows[0].voter_id;
    const otp = otpService.generateOTP();
    const otpHash = await otpService.hashOTP(otp);

    await db.query(
      `UPDATE otps SET invalidated_at = now() WHERE voter_id = $1 AND invalidated_at IS NULL`,
      [voterId],
    );
    await db.query(
      `INSERT INTO otps (voter_id, otp_hash, session_nonce, expires_at)
       VALUES ($1, $2, $3, now() + interval '10 minutes')`,
      [voterId, otpHash, session_nonce],
    );
    const notificationId = await queueNotification(voterId, "auth_otp", {
      otp,
    });
    scheduleOtpDispatch(notificationId, "auth_otp");

    res.json({ success: true, session_nonce });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req: any, res: Response, next: NextFunction) {
  const { otp, session_nonce } = req.body;
  const ip = req.ip || "unknown";

  try {
    const result = await db.query(
      `SELECT o.id, o.otp_hash, o.voter_id, o.expires_at, o.invalidated_at, o.attempt_count, v.constituency, v.state
       FROM otps o
       JOIN voters v ON o.voter_id = v.id
       WHERE o.session_nonce = $1`,
      [session_nonce],
    );

    const otpRecord = result.rows[0];
    if (!otpRecord) {
      recordFailedAttempt(ip);
      throw new AuthError("invalid_session");
    }
    if (otpRecord.invalidated_at) {
      recordFailedAttempt(ip);
      throw new AuthError("otp_invalidated");
    }
    if (new Date() > otpRecord.expires_at) {
      recordFailedAttempt(ip);
      throw new AuthError("otp_expired");
    }
    if (otpRecord.attempt_count >= 3) {
      recordFailedAttempt(ip);
      throw new AuthError("max_attempts_reached");
    }

    const isValid = await otpService.verifyOTP(otp, otpRecord.otp_hash);
    if (!isValid) {
      await db.query(
        "UPDATE otps SET attempt_count = attempt_count + 1 WHERE id = $1",
        [otpRecord.id],
      );
      recordFailedAttempt(ip);
      throw new AuthError("invalid_otp");
    }

    await db.query("UPDATE otps SET invalidated_at = now() WHERE id = $1", [
      otpRecord.id,
    ]);

    const token = jwt.sign(
      {
        voter_id: otpRecord.voter_id,
        constituency: otpRecord.constituency,
        state: otpRecord.state,
      },
      config.voterJwtSecret,
      { expiresIn: "24h" },
    );

    clearFailedAttempts(ip);
    res.json({ token });
  } catch (err: unknown) {
    next(err);
  }
}
