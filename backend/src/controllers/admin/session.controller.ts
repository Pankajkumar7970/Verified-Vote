/**
 * Admin voting session handlers: list, revoke, and manual face approval.
 */
import type { NextFunction, Response } from "express";
import { db } from "../../db/index.js";
import sanitizeHtml from "sanitize-html";
import { logger } from "../../utils/logger.js";
import { NotFoundError } from "../../utils/errors.js";
import { MinIOService } from "../../services/minio.service.js";
import { decryptDocKey } from "../../utils/crypto.js";

export async function listSessions(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(
      1,
      Math.min(200, parseInt(req.query.limit as string) || 20),
    );
    const offset = (page - 1) * limit;

    const countResult = await db.query(
      `SELECT COUNT(*) AS total
       FROM voting_sessions s
       JOIN voting_requests r ON s.request_id = r.id
       JOIN elections e ON r.election_id = e.id
       WHERE s.state IN ('link_opened', 'otp_verified', 'face_pending', 'face_verified')
         AND s.is_revoked = false`,
    );
    const total = parseInt(countResult.rows[0].total);

    let result;
    try {
      result = await db.query(
        `SELECT s.id, s.state, s.ref_code, s.expires_at, s.is_revoked, s.face_score, s.liveness_score,
                s.face_pending_reason, e.name as election_name,
                r.request_selfie_minio_key, s.voting_selfie_minio_key
         FROM voting_sessions s
         JOIN voting_requests r ON s.request_id = r.id
         JOIN elections e ON r.election_id = e.id
         WHERE s.state IN ('link_opened', 'otp_verified', 'face_pending', 'face_verified')
           AND s.is_revoked = false
         ORDER BY s.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
    } catch (err) {
      result = await db.query(
        `SELECT s.id, s.state, s.ref_code, s.expires_at, s.is_revoked, s.face_score, s.liveness_score,
                s.face_pending_reason, e.name as election_name,
                r.request_selfie_minio_key
         FROM voting_sessions s
         JOIN voting_requests r ON s.request_id = r.id
         JOIN elections e ON r.election_id = e.id
         WHERE s.state IN ('link_opened', 'otp_verified', 'face_pending', 'face_verified')
           AND s.is_revoked = false
         ORDER BY s.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
    }

    const sessions = await Promise.all(
      result.rows.map(async (session) => {
        const { request_selfie_minio_key, voting_selfie_minio_key, ...rest } =
          session;
        let baseline_selfie_url: string | null = null;
        let voting_selfie_url: string | null = null;

        if (request_selfie_minio_key) {
          try {
            const key = await decryptDocKey(request_selfie_minio_key);
            baseline_selfie_url = await MinIOService.getSignedUrl(key);
          } catch {
            // If decryption or URL generation fails, leave as null
          }
        }

        if (voting_selfie_minio_key) {
          try {
            const key = await decryptDocKey(voting_selfie_minio_key);
            voting_selfie_url = await MinIOService.getSignedUrl(key);
          } catch {
            // If decryption or URL generation fails, leave as null
          }
        }

        return {
          ...rest,
          baseline_selfie_url,
          voting_selfie_url,
        };
      }),
    );

    res.json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function revokeSession(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const { reason } = req.body;
  const safeReason = reason
    ? sanitizeHtml(reason, { allowedTags: [], allowedAttributes: {} })
    : null;

  try {
    await db.withTransaction(async (client) => {
      await client.query(
        `UPDATE voting_sessions
         SET is_revoked = true, revoked_at = now(), revoked_by = $1, face_pending_reason = coalesce(face_pending_reason, $2)
         WHERE id = $3`,
        [req.admin.id, safeReason || "admin_revoked", req.params.id],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          "admin",
          req.admin.id,
          "session_revoked",
          "voting_session",
          req.params.id,
          JSON.stringify({ reason: safeReason }),
          req.requestId,
        ],
      );
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function approveFace(req: any, res: Response, next: NextFunction) {
  const { note } = req.body;
  const safeNote = sanitizeHtml(note, {
    allowedTags: [],
    allowedAttributes: {},
  });

  try {
    await db.withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE voting_sessions
         SET state = 'face_verified', face_verified_at = now(), face_pending_reason = null
         WHERE id = $1 AND state = 'face_pending' AND is_revoked = false AND expires_at > now()
         RETURNING id`,
        [req.params.id],
      );
      if (result.rows.length === 0) {
        throw new NotFoundError("session_not_found");
      }

      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          "admin",
          req.admin.id,
          "face_pending_approved",
          "voting_session",
          req.params.id,
          JSON.stringify({ note: safeNote }),
          req.requestId,
        ],
      );
    });
    res.json({ success: true, state: "face_verified" });
  } catch (err: unknown) {
    logger.error({
      request_id: req.requestId,
      action: "approve_face_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
    next(err);
  }
}
