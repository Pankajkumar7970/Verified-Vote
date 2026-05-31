import { Router } from "express";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { otpService } from "../services/otp.service.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { decryptValue, encryptDocKey } from "../utils/crypto.js";
import { requireValidSession } from "../middleware/session.middleware.js";
import {
  AiServiceUnavailableError,
  AiServiceValidationError,
  FaceVerifyService,
} from "../services/face-verify.service.js";
import {
  getElectionSettings,
  logVerification,
} from "../services/verification-log.service.js";
import { queueNotification } from "../services/sms/notification-queue.js";
import { MinIOService } from "../services/minio.service.js";

import { config } from "../utils/config.js";
import {
  ensureSessionBaselineSnapshot,
  resolveVotingBaseline,
  verifyAgainstBaseline,
} from "../utils/baseline-selfie.js";
import {
  sessionRefLimiter,
  otpVerifyLimiter,
} from "../middleware/rate-limit.middleware.js";
import {
  ValidationError,
  NotFoundError,
  AuthError,
  ConflictError,
} from "../utils/errors.js";
import { validate } from "../middleware/validate.middleware.js";
import { z } from "zod";

const statusSchema = z.object({
  query: z.object({
    ref_code: z.string().min(1, "missing_ref_code"),
  }),
});

const resolveSchema = z.object({
  body: z.object({
    ref_code: z.string().min(1, "missing_ref_code"),
  }),
});

const verifyOtpSchema = z.object({
  body: z.object({
    ref_code: z.string().min(1, "missing_fields"),
    nonce: z.string().min(1, "missing_fields"),
    otp: z.string().min(1, "missing_fields"),
  }),
});

const faceVerifySchema = z.object({
  body: z.object({
    selfie_b64: z.string().min(1, "missing_selfie"),
  }),
});

const router = Router();

function signSessionToken(sessionId: string): string {
  return jwt.sign({ session_id: sessionId }, config.sessionJwtSecret, {
    expiresIn: "15m",
  });
}

function maskPhoneFromEnc(phoneEnc: Buffer): Promise<string> {
  return decryptValue(phoneEnc).then(
    (phoneStr) => phoneStr.slice(0, 2) + "******" + phoneStr.slice(-2),
  );
}

router.get(
  "/status",
  sessionRefLimiter,
  validate(statusSchema),
  async (req: any, res, next) => {
    const { ref_code } = req.query;

    try {
      const sessionRes = await db.query(
        `SELECT s.id, s.request_id, s.state, s.ref_code_used, s.expires_at, s.is_revoked
       FROM voting_sessions s WHERE s.ref_code = $1`,
        [ref_code],
      );
      const session = sessionRes.rows[0];
      if (!session) return next(new NotFoundError("invalid_ref_code"));
      if (session.is_revoked) return next(new AuthError("session_revoked"));
      if (new Date(session.expires_at) < new Date()) {
        return next(new AuthError("session_expired"));
      }

      const canResume = [
        "otp_verified",
        "face_verified",
        "face_pending",
      ].includes(session.state);
      const payload: Record<string, unknown> = {
        state: session.state,
        ref_code_used: session.ref_code_used,
        can_resume: canResume,
      };
      if (canResume) {
        payload.session_token = signSessionToken(session.id);
      }
      await ensureSessionBaselineSnapshot(session.id, session.request_id);
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/resolve",
  sessionRefLimiter,
  validate(resolveSchema),
  async (req: any, res, next) => {
    const { ref_code } = req.body;

    try {
      const sessionData = await db.withTransaction(async (client) => {
        const sessionRes = await client.query(
          `SELECT s.id, s.request_id, s.state, s.expires_at, s.is_revoked, s.ref_code_used, v.id as voter_id, v.phone_enc
         FROM voting_sessions s
         JOIN voting_requests r ON s.request_id = r.id
         JOIN voters v ON r.voter_id = v.id
         WHERE s.ref_code = $1 FOR UPDATE OF s`,
          [ref_code],
        );

        const session = sessionRes.rows[0];
        if (!session) {
          throw new NotFoundError("invalid_ref_code");
        }
        if (session.is_revoked) {
          throw new AuthError("session_revoked");
        }
        if (new Date(session.expires_at) < new Date()) {
          throw new AuthError("session_expired");
        }
        if (session.ref_code_used && session.state === "vote_cast") {
          throw new ConflictError("link_already_used");
        }

        if (
          ["face_verified", "otp_verified", "face_pending"].includes(
            session.state,
          )
        ) {
          return {
            resume: true,
            sessionId: session.id,
            requestId: session.request_id,
            state: session.state,
          };
        }

        const exchangeNonce = otpService.generateExchangeNonce();
        const otp = otpService.generateOTP();
        const otpHash = await otpService.hashOTP(otp);

        await client.query(
          `UPDATE otps SET invalidated_at = now() WHERE voter_id = $1 AND invalidated_at IS NULL`,
          [session.voter_id],
        );

        await client.query(
          `INSERT INTO otps (voter_id, otp_hash, session_nonce, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')`,
          [session.voter_id, otpHash, exchangeNonce],
        );

        await client.query(
          `UPDATE voting_sessions
         SET ref_code_used = true, ref_code_used_at = now(), exchange_nonce = $1,
             exchange_nonce_used = false, state = 'link_opened', updated_at = now()
         WHERE id = $2`,
          [exchangeNonce, session.id],
        );

        await queueNotification(
          session.voter_id,
          "voting_otp",
          { otp },
          client,
        );

        logger.info({
          request_id: req.requestId,
          action: "session_resolved",
          otp_hint: config.isProd ? undefined : otp,
        });

        return {
          resume: false,
          sessionId: session.id,
          requestId: session.request_id,
          phoneEnc: session.phone_enc,
          nonce: exchangeNonce,
          state: "link_opened",
        };
      });

      await ensureSessionBaselineSnapshot(
        sessionData.sessionId,
        sessionData.requestId,
      );

      if (sessionData.resume) {
        return res.json({
          success: true,
          state: sessionData.state,
          resume: true,
          session_token: signSessionToken(sessionData.sessionId),
        });
      }

      const maskedPhone = await maskPhoneFromEnc(sessionData.phoneEnc);

      res.json({
        success: true,
        phone_mask: maskedPhone,
        nonce: sessionData.nonce,
        state: sessionData.state,
      });
    } catch (err: unknown) {
      next(err);
    }
  },
);

router.post(
  "/verify-otp",
  otpVerifyLimiter,
  validate(verifyOtpSchema),
  async (req: any, res, next) => {
    const { ref_code, nonce, otp } = req.body;

    try {
      const token = await db.withTransaction(async (client) => {
        // Lock the session row first on its own — no joins, no nullable sides.
        const sessionRes = await client.query(
          `SELECT s.id, s.state, s.expires_at, s.is_revoked, s.exchange_nonce, s.request_id
           FROM voting_sessions s
           WHERE s.ref_code = $1
           FOR UPDATE`,
          [ref_code],
        );

        const session = sessionRes.rows[0];
        if (!session) throw new NotFoundError("invalid_ref_code");
        if (session.is_revoked) throw new AuthError("session_revoked");
        if (new Date(session.expires_at) < new Date())
          throw new AuthError("session_expired");
        if (session.exchange_nonce !== nonce)
          throw new AuthError("invalid_nonce");
        if (session.state !== "link_opened") {
          if (
            ["otp_verified", "face_verified", "face_pending"].includes(
              session.state,
            )
          ) {
            throw new ConflictError("otp_already_verified");
          }
          throw new AuthError("invalid_session_state");
        }

        // FIX: The original query was:
        //   SELECT o.*, r.election_id FROM otps o
        //   JOIN voting_requests r ON r.voter_id = o.voter_id
        //   JOIN voting_sessions s ON s.request_id = r.id
        //   WHERE s.id = $1 ... FOR UPDATE OF o, s
        //
        // This fails with "FOR UPDATE cannot be applied to the nullable side
        // of an outer join" because PostgreSQL sees the multi-table join and
        // cannot safely lock all sides. The session row is already locked
        // above, so we only need to lock the otp row here. We also get
        // election_id directly from the already-locked session's request_id
        // instead of joining back through voting_sessions again.
        const otpRes = await client.query(
          `SELECT o.id, o.otp_hash, o.attempt_count, r.election_id
           FROM otps o
           JOIN voting_requests r ON r.voter_id = o.voter_id
           WHERE r.id = $1
             AND o.session_nonce = $2
             AND o.invalidated_at IS NULL
             AND o.expires_at > now()
           FOR UPDATE OF o`,
          [session.request_id, nonce],
        );

        const otpRecord = otpRes.rows[0];
        if (!otpRecord) throw new AuthError("invalid_otp");

        // Get max attempts from election settings separately — never join
        // election_settings with FOR UPDATE as it has no matching lock target.
        const settingsRes = await client.query(
          `SELECT max_otp_attempts FROM election_settings WHERE election_id = $1`,
          [otpRecord.election_id],
        );
        const maxAttempts = settingsRes.rows[0]?.max_otp_attempts ?? 3;
        if (otpRecord.attempt_count >= maxAttempts) {
          throw new AuthError("max_attempts_reached");
        }

        const isValid = await otpService.verifyOTP(otp, otpRecord.otp_hash);
        if (!isValid) {
          await client.query(
            `UPDATE otps SET attempt_count = attempt_count + 1 WHERE id = $1`,
            [otpRecord.id],
          );
          throw new AuthError("invalid_otp");
        }

        await client.query(
          `UPDATE otps SET invalidated_at = now() WHERE id = $1`,
          [otpRecord.id],
        );
        await client.query(
          `UPDATE voting_sessions
           SET state = 'otp_verified', otp_verified_at = now(), exchange_nonce_used = true, updated_at = now()
           WHERE id = $1`,
          [session.id],
        );

        const sessionToken = signSessionToken(session.id);
        const tokenHash = crypto
          .createHash("sha256")
          .update(sessionToken)
          .digest("hex");
        await client.query(
          `UPDATE voting_sessions SET token_hash = $1 WHERE id = $2`,
          [tokenHash, session.id],
        );

        return sessionToken;
      });

      res.json({ success: true, token, state: "otp_verified" });
    } catch (err: unknown) {
      next(err);
    }
  },
);

router.post(
  "/face-verify",
  requireValidSession("otp_verified", "face_pending"),
  validate(faceVerifySchema),
  async (req: any, res, next) => {
    const { selfie_b64 } = req.body;

    const session = req.votingSession;

    try {
      const selfieBuffer = Buffer.from(selfie_b64, "base64");
      const selfieKey = `voting-sessions/${session.id}/selfie.jpg`;
      await MinIOService.putDocument(selfieKey, selfieBuffer, "image/jpeg");
      const encryptedSelfieKey = await encryptDocKey(selfieKey);

      const reqRes = await db.query(
        `SELECT election_id FROM voting_requests WHERE id = $1`,
        [session.request_id],
      );
      const voteReq = reqRes.rows[0];
      if (!voteReq) {
        return next(new ValidationError("missing_request"));
      }

      const settings = await getElectionSettings(voteReq.election_id);
      const baseline = await resolveVotingBaseline(
        session.id,
        session.request_id,
      );
      const verification = await verifyAgainstBaseline(
        baseline,
        selfie_b64,
        req.requestId,
      );
      if (!verification) {
        return next(new ValidationError("missing_baseline_selfie"));
      }

      const facePassed =
        verification.face_score >= settings.face_match_threshold;
      const livenessPassed =
        verification.liveness_score >= settings.liveness_threshold;
      const overallPassed = facePassed && livenessPassed;

      await db.withTransaction(async (client) => {
        await logVerification(
          {
            requestId: session.request_id,
            sessionId: session.id,
            verificationType: "voting_time",
            faceScore: verification.face_score,
            livenessScore: verification.liveness_score,
            faceThreshold: settings.face_match_threshold,
            livenessThreshold: settings.liveness_threshold,
            facePassed,
            livenessPassed,
            overallPassed,
            modelUsed: verification.model,
            durationMs: verification.duration_ms,
          },
          client,
        );

        if (overallPassed) {
          try {
            await client.query(
              `UPDATE voting_sessions
               SET state = 'face_verified', face_verified_at = now(),
                   face_score = $1, liveness_score = $2, voting_selfie_minio_key = $3
               WHERE id = $4`,
              [
                verification.face_score,
                verification.liveness_score,
                encryptedSelfieKey,
                session.id,
              ],
            );
          } catch {
            // If column doesn't exist, update without it
            await client.query(
              `UPDATE voting_sessions
               SET state = 'face_verified', face_verified_at = now(),
                   face_score = $1, liveness_score = $2
               WHERE id = $3`,
              [
                verification.face_score,
                verification.liveness_score,
                session.id,
              ],
            );
          }
        } else {
          try {
            await client.query(
              `UPDATE voting_sessions
               SET state = 'face_pending', face_score = $1, liveness_score = $2,
                   face_pending_reason = $3, voting_selfie_minio_key = $4
               WHERE id = $5`,
              [
                verification.face_score,
                verification.liveness_score,
                "Scores below threshold",
                encryptedSelfieKey,
                session.id,
              ],
            );
          } catch {
            // If column doesn't exist, update without it
            await client.query(
              `UPDATE voting_sessions
               SET state = 'face_pending', face_score = $1, liveness_score = $2,
                   face_pending_reason = $3
               WHERE id = $4`,
              [
                verification.face_score,
                verification.liveness_score,
                "Scores below threshold",
                session.id,
              ],
            );
          }
        }
      });

      if (overallPassed) {
        res.json({
          success: true,
          state: "face_verified",
          session_id: session.id,
        });
      } else {
        res.json({
          success: false,
          state: "face_pending",
          session_id: session.id,
          message: "Face verification failed, sent for human review.",
        });
      }
    } catch (err: unknown) {
      if (err instanceof AiServiceValidationError) {
        return next(new ValidationError("invalid_selfie"));
      }
      if (err instanceof AiServiceUnavailableError) {
        await db.query(
          `UPDATE voting_sessions
           SET state = 'face_pending', face_pending_reason = $1
           WHERE id = $2`,
          ["ai_service_unavailable", session.id],
        );
        return res.status(503).json({
          error: "ai_service_unavailable",
          state: "face_pending",
          session_id: session.id,
          request_id: req.requestId,
        });
      }
      logger.error({
        request_id: req.requestId,
        action: "face_verify_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      await db.query(
        `UPDATE voting_sessions
         SET state = 'face_pending', face_pending_reason = $1
         WHERE id = $2`,
        ["unexpected_error", session.id],
      );
      res.status(503).json({
        error: "ai_service_unavailable",
        state: "face_pending",
        session_id: session.id,
        request_id: req.requestId,
      });
    }
  },
);

export default router;
