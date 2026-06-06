/**
 * Voting request handlers: submit, draft, withdraw, and appeal flows.
 */
import type { NextFunction, Response } from "express";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { MinIOService } from "../services/minio.service.js";
import { encryptDocKey, decryptDocKey, encryptValue } from "../utils/crypto.js";
import { queueNotification } from "../services/sms/notification-queue.js";
import { validateStatusTransition } from "../utils/state-machine.js";
import sanitizeHtml from "sanitize-html";
import {
  FaceVerifyService,
  AiServiceUnavailableError,
} from "../services/face-verify.service.js";
import { DEFAULT_LIVENESS_THRESHOLD } from "../constants/verification.js";
import {
  ValidationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BaseError,
} from "../utils/errors.js";

export function parseSelfieBase64(selfieB64: string): Buffer {
  const raw = selfieB64.includes(",") ? selfieB64.split(",", 2)[1]! : selfieB64;
  return Buffer.from(raw, "base64");
}

/** Match voter roll to election rows regardless of casing/extra spaces in admin UI. */
export function sameRegion(a: string, b: string, c: string, d: string): boolean {
  return (
    a.trim().toLowerCase() === c.trim().toLowerCase() &&
    b.trim().toLowerCase() === d.trim().toLowerCase()
  );
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown";
}

export async function submitRequest(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const voterId = req.voter.id;
  const {
    election_id,
    reason_category,
    reason_detail,
    doc_type,
    selfie_b64,
  } = req.body;

  const files = req.files as {
    doc?: Express.Multer.File[];
    voter_id_photo?: Express.Multer.File[];
  };
  const docFile = files?.doc?.[0];
  const voterIdPhoto = files?.voter_id_photo?.[0];

  if (!docFile) {
    return next(new ValidationError("missing_document"));
  }
  if (!voterIdPhoto) {
    return next(new ValidationError("missing_voter_id_photo"));
  }

  const safeReasonDetail = reason_detail
    ? sanitizeHtml(reason_detail, { allowedTags: [], allowedAttributes: {} })
    : null;

  let docKey = "";
  let voterPhotoKey = "";
  let selfieKey = "";
  let selfieBuf: Buffer;
  try {
    selfieBuf = parseSelfieBase64(selfie_b64);
    if (selfieBuf.length < 1000) {
      return next(new ValidationError("invalid_selfie"));
    }
  } catch {
    return next(new ValidationError("invalid_selfie"));
  }

  try {
    const electionRes = await db.query(
      "SELECT constituency, state, status, request_deadline FROM elections WHERE id = $1",
      [election_id],
    );
    const election = electionRes.rows[0];
    if (!election) {
      return next(new NotFoundError("election_not_found"));
    }
    if (election.status !== "active") {
      return next(new ForbiddenError("election_not_accepting_requests"));
    }
    if (
      !sameRegion(
        req.voter.constituency,
        req.voter.state,
        election.constituency,
        election.state,
      )
    ) {
      return next(new ForbiddenError("wrong_constituency"));
    }
    if (new Date() > new Date(election.request_deadline)) {
      return next(new ForbiddenError("deadline_passed"));
    }

    const docUpload = await MinIOService.uploadDocument(
      docFile.buffer,
      docFile.mimetype,
    );
    const voterPhotoUpload = await MinIOService.uploadDocument(
      voterIdPhoto.buffer,
      voterIdPhoto.mimetype,
    );
    docKey = docUpload.key;
    voterPhotoKey = voterPhotoUpload.key;

    const docKeyEnc = await encryptDocKey(docKey);
    const voterPhotoKeyEnc = await encryptDocKey(voterPhotoKey);

    let embedResult;
    try {
      embedResult = await FaceVerifyService.getEmbedding(
        selfie_b64,
        req.requestId,
      );
    } catch (err) {
      await MinIOService.deleteDocument(docKey);
      await MinIOService.deleteDocument(voterPhotoKey);
      throw err;
    }

    const livenessScore = embedResult.liveness_score;
    if (livenessScore < DEFAULT_LIVENESS_THRESHOLD) {
      await MinIOService.deleteDocument(docKey);
      await MinIOService.deleteDocument(voterPhotoKey);
      return next(new ValidationError("liveness_failed"));
    }

    const blinkFramesRaw = req.body?.blink_frames;
    if (blinkFramesRaw) {
      try {
        const blinkFrames: string[] = JSON.parse(blinkFramesRaw);
        if (Array.isArray(blinkFrames) && blinkFrames.length >= 2) {
          const blinkResult = await FaceVerifyService.checkBlink(
            blinkFrames,
            req.requestId,
          );
          if (!blinkResult.blink_detected) {
            if (livenessScore < DEFAULT_LIVENESS_THRESHOLD + 0.1) {
              await MinIOService.deleteDocument(docKey);
              await MinIOService.deleteDocument(voterPhotoKey);
              return next(new ValidationError("liveness_failed"));
            }
            logger.warn({
              action: "blink_check_failed_but_accepted",
              request_id: req.requestId,
              liveness_score: livenessScore,
              threshold: DEFAULT_LIVENESS_THRESHOLD,
            });
          }
        }
      } catch {
        // Malformed blink_frames — ignore and continue (upload path fallback)
      }
    }

    const selfieUpload = await MinIOService.uploadDocument(
      selfieBuf,
      "image/jpeg",
    );
    selfieKey = selfieUpload.key;
    const selfieKeyEnc = await encryptDocKey(selfieKey);
    const embeddingEnc = await encryptValue(
      JSON.stringify(embedResult.embedding),
    );

    let requestId: string;
    let oldDocKeyEnc: string | null = null;
    let oldVoterPhotoKeyEnc: string | null = null;
    let oldSelfieKeyEnc: string | null = null;

    try {
      await db.withTransaction(async (client) => {
        const existingDraft = await client.query(
          "SELECT id, doc_minio_key, voter_id_photo_minio_key, request_selfie_minio_key FROM voting_requests WHERE voter_id = $1 AND election_id = $2 AND status = 'draft' FOR UPDATE",
          [voterId, election_id],
        );
        if (existingDraft.rows.length > 0) {
          const draft = existingDraft.rows[0];
          oldDocKeyEnc = draft.doc_minio_key;
          oldVoterPhotoKeyEnc = draft.voter_id_photo_minio_key;
          oldSelfieKeyEnc = draft.request_selfie_minio_key;

          await client.query("DELETE FROM voting_requests WHERE id = $1", [
            draft.id,
          ]);
        }

        try {
          const requestRes = await client.query(
            `INSERT INTO voting_requests
              (voter_id, election_id, reason_category, reason_detail, doc_type, doc_minio_key, doc_hash,
               voter_id_photo_minio_key, request_selfie_minio_key, request_selfie_embedding_enc, liveness_score_at_request)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
            [
              voterId,
              election_id,
              reason_category,
              safeReasonDetail,
              doc_type,
              docKeyEnc,
              docUpload.hash,
              voterPhotoKeyEnc,
              selfieKeyEnc,
              embeddingEnc,
              livenessScore,
            ],
          );
          requestId = requestRes.rows[0].id;
        } catch (err: any) {
          if (
            err.code === "23505" &&
            err.constraint === "unique_active_request_idx"
          ) {
            await MinIOService.deleteDocument(docKey);
            await MinIOService.deleteDocument(voterPhotoKey);
            if (selfieKey) await MinIOService.deleteDocument(selfieKey);
            throw new ConflictError("duplicate_request");
          }
          throw err;
        }

        await client.query(
          `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
           VALUES ($1, 'none', 'pending', $2, 'voter', 'Initial request submission')`,
          [requestId, voterId],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
             VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "voter",
            voterId,
            "request_submitted",
            "voting_request",
            requestId,
            req.requestId,
          ],
        );

        await queueNotification(voterId, "request_submitted", {}, client);
      });
    } catch (err) {
      if (!(err instanceof ConflictError)) {
        await MinIOService.deleteDocument(docKey);
        await MinIOService.deleteDocument(voterPhotoKey);
        if (selfieKey) await MinIOService.deleteDocument(selfieKey);
      }
      throw err;
    }

    for (const encKey of [
      oldDocKeyEnc,
      oldVoterPhotoKeyEnc,
      oldSelfieKeyEnc,
    ]) {
      if (encKey) {
        try {
          const k = await decryptDocKey(encKey);
          await MinIOService.deleteDocument(k);
        } catch (err) {
          logger.warn({
            action: "submit_draft_cleanup_failed",
            key: encKey,
            error: extractErrorMessage(err),
          });
        }
      }
    }

    logger.info({
      action: "request_submitted",
      request_id: req.requestId,
      entity_id: requestId,
    });
    res.json({ success: true, request_id: requestId });
  } catch (err: unknown) {
    const message = extractErrorMessage(err);
    logger.error({
      request_id: req.requestId,
      action: "request_submit_failed",
      error: message,
    });

    if (message === "invalid_file_type") {
      return next(new ValidationError("invalid_file_type"));
    }
    if (err instanceof AiServiceUnavailableError) {
      return next(new BaseError("ai_service_unavailable", 503));
    }
    next(err);
  }
}

export async function withdrawRequest(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const { id } = req.params;
  const voterId = req.voter.id;
  try {
    await db.withTransaction(async (client) => {
      const reqInfo = await client.query(
        `SELECT r.status, r.doc_minio_key, r.voter_id_photo_minio_key, r.request_selfie_minio_key,
                  e.election_date, r.election_id
           FROM voting_requests r
           JOIN elections e ON r.election_id = e.id
           WHERE r.id = $1 AND r.voter_id = $2 FOR UPDATE OF r`,
        [id, voterId],
      );
      if (reqInfo.rows.length === 0) {
        throw new NotFoundError("not_found");
      }

      const request = reqInfo.rows[0];

      const settingsRes = await client.query(
        `SELECT withdrawal_deadline_hours FROM election_settings WHERE election_id = $1`,
        [request.election_id],
      );
      const withdrawal_deadline_hours =
        settingsRes.rows[0]?.withdrawal_deadline_hours ?? 24;

      logger.info({
        action: "withdrawal_validation",
        request_status: request.status,
        request_id: id,
        election_date_raw: request.election_date,
        withdrawal_deadline_hours_raw: withdrawal_deadline_hours,
      });

      if (request.status !== "draft") {
        const electionDate = new Date(request.election_date);
        const deadlineHours = Number(withdrawal_deadline_hours);
        const withdrawalDeadline = new Date(
          electionDate.getTime() - deadlineHours * 60 * 60 * 1000,
        );

        logger.info({
          action: "withdrawal_deadline_check",
          request_id: id,
          election_date: electionDate.toISOString(),
          deadline_hours: deadlineHours,
          withdrawal_deadline: withdrawalDeadline.toISOString(),
          current_time: new Date().toISOString(),
          is_past_deadline: new Date() > withdrawalDeadline,
        });

        if (new Date() > withdrawalDeadline) {
          throw new ValidationError("withdrawal_deadline_passed");
        }
      }

      logger.info({
        action: "validating_status_transition",
        request_id: id,
        current_status: request.status,
        target_status: "withdrawn",
        actor_role: "voter",
      });

      try {
        validateStatusTransition(
          "voting_request",
          request.status,
          "withdrawn",
          "voter",
          id,
        );
      } catch (err) {
        logger.warn({
          action: "invalid_status_transition",
          request_id: id,
          current_status: request.status,
          target_status: "withdrawn",
          actor_role: "voter",
          error: extractErrorMessage(err),
        });
        throw new ValidationError("invalid_status");
      }

      await client.query(
        `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
          VALUES ($1, $2, 'withdrawn', $3, 'voter', 'Voter withdrew request')`,
        [id, request.status, voterId],
      );

      for (const stored of [
        request.doc_minio_key,
        request.voter_id_photo_minio_key,
        request.request_selfie_minio_key,
      ]) {
        if (stored) {
          try {
            const decrypted = await decryptDocKey(stored);
            await MinIOService.deleteDocument(decrypted);
          } catch (err) {
            logger.warn({
              action: "withdraw_minio_delete_failed",
              key: stored,
              error: extractErrorMessage(err),
            });
          }
        }
      }

      await client.query(
        `UPDATE voting_requests
          SET status = 'withdrawn', withdrawn_at = now(),
              request_selfie_embedding_enc = null, doc_minio_key = null,
              voter_id_photo_minio_key = null, request_selfie_minio_key = null
          WHERE id = $1`,
        [id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
          VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          "voter",
          voterId,
          "request_withdrawn",
          "voting_request",
          id,
          req.requestId,
        ],
      );
    });
    res.json({ success: true });
  } catch (err: unknown) {
    next(err);
  }
}

export async function appealRequest(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const { id } = req.params;
  const voterId = req.voter.id;
  const files = req.files as {
    doc?: Express.Multer.File[];
  };
  const file = files?.doc?.[0];
  if (!file) {
    return next(new ValidationError("missing_document"));
  }

  try {
    await db.withTransaction(async (client) => {
      const reqInfo = await client.query(
        "SELECT status FROM voting_requests WHERE id = $1 AND voter_id = $2 FOR UPDATE",
        [id, voterId],
      );
      if (reqInfo.rows.length === 0) {
        throw new NotFoundError("not_found");
      }
      try {
        validateStatusTransition(
          "voting_request",
          reqInfo.rows[0].status,
          "appealed",
          "voter",
          id,
        );
      } catch (err) {
        throw new ValidationError("invalid_status");
      }

      const { key: docKey } = await MinIOService.uploadDocument(
        file.buffer,
        file.mimetype,
      );
      const appealKeyEnc = await encryptDocKey(docKey);

      await client.query(
        `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
         VALUES ($1, 'rejected', 'appealed', $2, 'voter', 'Voter submitted appeal')`,
        [id, voterId],
      );

      await client.query(
        `UPDATE voting_requests
         SET status = 'appealed', appeal_doc_minio_key = $1, appeal_submitted_at = now()
         WHERE id = $2`,
        [appealKeyEnc, id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
           VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          "voter",
          voterId,
          "request_appealed",
          "voting_request",
          id,
          req.requestId,
        ],
      );

      await queueNotification(voterId, "appeal_submitted", {}, client);
    });
    res.json({ success: true });
  } catch (err: unknown) {
    next(err);
  }
}

export async function saveDraft(req: any, res: Response, next: NextFunction) {
  const voterId = req.voter.id;
  const {
    election_id,
    reason_category,
    reason_detail,
    doc_type,
    selfie_b64,
  } = req.body;

  const files = req.files as {
    doc?: Express.Multer.File[];
    voter_id_photo?: Express.Multer.File[];
  };
  const docFile = files?.doc?.[0];
  const voterIdPhoto = files?.voter_id_photo?.[0];

  const safeReasonDetail = reason_detail
    ? sanitizeHtml(reason_detail, { allowedTags: [], allowedAttributes: {} })
    : null;

  try {
    const electionRes = await db.query(
      "SELECT constituency, state, status, request_deadline FROM elections WHERE id = $1",
      [election_id],
    );
    const election = electionRes.rows[0];
    if (!election) {
      return next(new NotFoundError("election_not_found"));
    }
    if (election.status !== "active") {
      return next(new ForbiddenError("election_not_accepting_requests"));
    }
    if (
      !sameRegion(
        req.voter.constituency,
        req.voter.state,
        election.constituency,
        election.state,
      )
    ) {
      return next(new ForbiddenError("wrong_constituency"));
    }
    if (new Date() > new Date(election.request_deadline)) {
      return next(new ForbiddenError("deadline_passed"));
    }

    let docKeyEnc: string | null = null;
    let docHash: string | null = null;
    if (docFile) {
      const docUpload = await MinIOService.uploadDocument(
        docFile.buffer,
        docFile.mimetype,
      );
      docKeyEnc = await encryptDocKey(docUpload.key);
      docHash = docUpload.hash;
    }

    let voterPhotoKeyEnc: string | null = null;
    if (voterIdPhoto) {
      const voterPhotoUpload = await MinIOService.uploadDocument(
        voterIdPhoto.buffer,
        voterIdPhoto.mimetype,
      );
      voterPhotoKeyEnc = await encryptDocKey(voterPhotoUpload.key);
    }

    let selfieKeyEnc: string | null = null;
    let embeddingEnc: Buffer | null = null;
    let livenessScore: number | null = null;
    if (selfie_b64) {
      try {
        const selfieBuf = parseSelfieBase64(selfie_b64);
        const embedResult = await FaceVerifyService.getEmbedding(
          selfie_b64,
          req.requestId,
        );
        const selfieUpload = await MinIOService.uploadDocument(
          selfieBuf,
          "image/jpeg",
        );
        selfieKeyEnc = await encryptDocKey(selfieUpload.key);
        embeddingEnc = await encryptValue(
          JSON.stringify(embedResult.embedding),
        );
        livenessScore = embedResult.liveness_score;
      } catch {
        // If embedding fails, still save other draft fields
      }
    }

    let draftId: string;
    const toDeleteKeys: string[] = [];
    await db.withTransaction(async (client) => {
      const existingDraft = await client.query(
        "SELECT id, doc_minio_key, voter_id_photo_minio_key, request_selfie_minio_key FROM voting_requests WHERE voter_id = $1 AND election_id = $2 AND status = 'draft' FOR UPDATE",
        [voterId, election_id],
      );

      if (existingDraft.rows.length > 0) {
        const existing = existingDraft.rows[0];
        draftId = existing.id;
        const updateFields: string[] = [];
        const updateParams: unknown[] = [];
        let paramIndex = 1;

        if (docKeyEnc && existing.doc_minio_key) {
          toDeleteKeys.push(existing.doc_minio_key);
        }
        if (voterPhotoKeyEnc && existing.voter_id_photo_minio_key) {
          toDeleteKeys.push(existing.voter_id_photo_minio_key);
        }
        if (selfieKeyEnc && existing.request_selfie_minio_key) {
          toDeleteKeys.push(existing.request_selfie_minio_key);
        }

        if (reason_category) {
          updateFields.push(`reason_category = $${paramIndex++}`);
          updateParams.push(reason_category);
        }
        if (safeReasonDetail !== undefined) {
          updateFields.push(`reason_detail = $${paramIndex++}`);
          updateParams.push(safeReasonDetail);
        }
        if (doc_type) {
          updateFields.push(`doc_type = $${paramIndex++}`);
          updateParams.push(doc_type);
        }
        if (docKeyEnc) {
          updateFields.push(`doc_minio_key = $${paramIndex++}`);
          updateParams.push(docKeyEnc);
        }
        if (docHash) {
          updateFields.push(`doc_hash = $${paramIndex++}`);
          updateParams.push(docHash);
        }
        if (voterPhotoKeyEnc) {
          updateFields.push(`voter_id_photo_minio_key = $${paramIndex++}`);
          updateParams.push(voterPhotoKeyEnc);
        }
        if (selfieKeyEnc) {
          updateFields.push(`request_selfie_minio_key = $${paramIndex++}`);
          updateParams.push(selfieKeyEnc);
        }
        if (embeddingEnc) {
          updateFields.push(
            `request_selfie_embedding_enc = $${paramIndex++}`,
          );
          updateParams.push(embeddingEnc);
        }
        if (livenessScore !== null) {
          updateFields.push(`liveness_score_at_request = $${paramIndex++}`);
          updateParams.push(livenessScore);
        }
        updateFields.push(`updated_at = now()`);
        updateParams.push(draftId);

        await client.query(
          `UPDATE voting_requests SET ${updateFields.join(", ")} WHERE id = $${paramIndex}`,
          updateParams,
        );
      } else {
        const draftRes = await client.query(
          `INSERT INTO voting_requests
              (voter_id, election_id, reason_category, reason_detail, doc_type, doc_minio_key, doc_hash,
               voter_id_photo_minio_key, request_selfie_minio_key, request_selfie_embedding_enc, liveness_score_at_request, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft') RETURNING id`,
          [
            voterId,
            election_id,
            reason_category || null,
            safeReasonDetail,
            doc_type || null,
            docKeyEnc,
            docHash,
            voterPhotoKeyEnc,
            selfieKeyEnc,
            embeddingEnc,
            livenessScore,
          ],
        );
        draftId = draftRes.rows[0].id;

        await client.query(
          `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
           VALUES ($1, 'none', 'draft', $2, 'voter', 'Draft created')`,
          [draftId, voterId],
        );
      }
    });

    for (const encKey of toDeleteKeys) {
      try {
        const k = await decryptDocKey(encKey);
        await MinIOService.deleteDocument(k);
      } catch (err) {
        logger.warn({
          action: "draft_old_file_delete_failed",
          key: encKey,
          error: extractErrorMessage(err),
        });
      }
    }

    logger.info({
      action: "draft_saved",
      request_id: req.requestId,
      entity_id: draftId,
    });
    res.json({ success: true, request_id: draftId });
  } catch (err: unknown) {
    const message = extractErrorMessage(err);
    logger.error({
      request_id: req.requestId,
      action: "draft_save_failed",
      error: message,
    });
    next(err);
  }
}

export async function getDraft(req: any, res: Response, next: NextFunction) {
  const voterId = req.voter.id;
  const { electionId } = req.params;

  try {
    const draftRes = await db.query(
      `SELECT id, election_id, reason_category, reason_detail, doc_type, status, created_at, updated_at,
         (doc_minio_key IS NOT NULL) as has_doc,
         (voter_id_photo_minio_key IS NOT NULL) as has_voter_id_photo,
         (request_selfie_minio_key IS NOT NULL) as has_selfie
       FROM voting_requests
       WHERE voter_id = $1 AND election_id = $2 AND status = 'draft'`,
      [voterId, electionId],
    );

    if (draftRes.rows.length === 0) {
      return res.json({ draft: null });
    }

    res.json({ draft: draftRes.rows[0] });
  } catch (err: unknown) {
    logger.error({
      request_id: req.requestId,
      action: "fetch_draft_failed",
      error: extractErrorMessage(err),
    });
    next(err);
  }
}

export async function submitDraft(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const { id } = req.params;
  const voterId = req.voter.id;
  const {
    election_id,
    reason_category,
    reason_detail,
    doc_type,
    selfie_b64,
  } = req.body;

  const files = req.files as {
    doc?: Express.Multer.File[];
    voter_id_photo?: Express.Multer.File[];
  };
  const docFile = files?.doc?.[0];
  const voterIdPhoto = files?.voter_id_photo?.[0];

  const safeReasonDetail = reason_detail
    ? sanitizeHtml(reason_detail, { allowedTags: [], allowedAttributes: {} })
    : null;

  let selfieBuf: Buffer | null = null;
  if (selfie_b64) {
    try {
      selfieBuf = parseSelfieBase64(selfie_b64);
      if (selfieBuf.length < 1000) {
        return next(new ValidationError("invalid_selfie"));
      }
    } catch {
      return next(new ValidationError("invalid_selfie"));
    }
  }

  try {
    const electionRes = await db.query(
      "SELECT constituency, state, status, request_deadline FROM elections WHERE id = $1",
      [election_id],
    );
    const election = electionRes.rows[0];
    if (!election) {
      return next(new NotFoundError("election_not_found"));
    }
    if (election.status !== "active") {
      return next(new ForbiddenError("election_not_accepting_requests"));
    }
    if (
      !sameRegion(
        req.voter.constituency,
        req.voter.state,
        election.constituency,
        election.state,
      )
    ) {
      return next(new ForbiddenError("wrong_constituency"));
    }
    if (new Date() > new Date(election.request_deadline)) {
      return next(new ForbiddenError("deadline_passed"));
    }

    let requestId: string;
    let oldDocKeyEnc: string | null = null;
    let oldVoterPhotoKeyEnc: string | null = null;
    let oldSelfieKeyEnc: string | null = null;

    let docKey: string | null = null;
    let voterPhotoKey: string | null = null;
    let selfieKey: string | null = null;

    try {
      await db.withTransaction(async (client) => {
        const draftRes = await client.query(
          `SELECT id, status, doc_minio_key, doc_hash, voter_id_photo_minio_key, request_selfie_minio_key, request_selfie_embedding_enc, liveness_score_at_request 
             FROM voting_requests WHERE id = $1 AND voter_id = $2 FOR UPDATE`,
          [id, voterId],
        );

        if (draftRes.rows.length === 0) {
          throw new NotFoundError("draft_not_found");
        }

        const draft = draftRes.rows[0];
        if (draft.status !== "draft") {
          throw new ForbiddenError("not_a_draft");
        }

        if (!docFile && !draft.doc_minio_key) {
          throw new ValidationError("missing_document");
        }
        if (!voterIdPhoto && !draft.voter_id_photo_minio_key) {
          throw new ValidationError("missing_voter_id_photo");
        }
        if (!selfie_b64 && !draft.request_selfie_minio_key) {
          throw new ValidationError("missing_selfie");
        }

        requestId = draft.id;

        validateStatusTransition(
          "voting_request",
          "draft",
          "pending",
          "voter",
          requestId,
        );

        let docKeyEnc = draft.doc_minio_key;
        let docHash = draft.doc_hash;
        if (docFile) {
          const docUpload = await MinIOService.uploadDocument(
            docFile.buffer,
            docFile.mimetype,
          );
          docKey = docUpload.key;
          docKeyEnc = await encryptDocKey(docKey);
          docHash = docUpload.hash;
          oldDocKeyEnc = draft.doc_minio_key;
        }

        let voterPhotoKeyEnc = draft.voter_id_photo_minio_key;
        if (voterIdPhoto) {
          const voterPhotoUpload = await MinIOService.uploadDocument(
            voterIdPhoto.buffer,
            voterIdPhoto.mimetype,
          );
          voterPhotoKey = voterPhotoUpload.key;
          voterPhotoKeyEnc = await encryptDocKey(voterPhotoKey);
          oldVoterPhotoKeyEnc = draft.voter_id_photo_minio_key;
        }

        let selfieKeyEnc = draft.request_selfie_minio_key;
        let embeddingEnc = draft.request_selfie_embedding_enc;
        let livenessScore = draft.liveness_score_at_request;

        if (selfie_b64 && selfieBuf) {
          let embedResult;
          try {
            embedResult = await FaceVerifyService.getEmbedding(
              selfie_b64,
              req.requestId,
            );
          } catch (err) {
            if (docKey) await MinIOService.deleteDocument(docKey);
            if (voterPhotoKey)
              await MinIOService.deleteDocument(voterPhotoKey);
            throw err;
          }

          livenessScore = embedResult.liveness_score;
          if (livenessScore < DEFAULT_LIVENESS_THRESHOLD) {
            if (docKey) await MinIOService.deleteDocument(docKey);
            if (voterPhotoKey)
              await MinIOService.deleteDocument(voterPhotoKey);
            throw new ValidationError("liveness_failed");
          }

          const blinkFramesRaw = req.body?.blink_frames;
          if (blinkFramesRaw) {
            try {
              const blinkFrames: string[] = JSON.parse(blinkFramesRaw);
              if (Array.isArray(blinkFrames) && blinkFrames.length >= 2) {
                const blinkResult = await FaceVerifyService.checkBlink(
                  blinkFrames,
                  req.requestId,
                );
                if (!blinkResult.blink_detected) {
                  if (livenessScore < DEFAULT_LIVENESS_THRESHOLD + 0.1) {
                    if (docKey) await MinIOService.deleteDocument(docKey);
                    if (voterPhotoKey)
                      await MinIOService.deleteDocument(voterPhotoKey);
                    throw new ValidationError("liveness_failed");
                  }
                }
              }
            } catch (err) {
              if (err instanceof AiServiceUnavailableError) throw err;
            }
          }

          const selfieUpload = await MinIOService.uploadDocument(
            selfieBuf,
            "image/jpeg",
          );
          selfieKey = selfieUpload.key;
          selfieKeyEnc = await encryptDocKey(selfieKey);
          embeddingEnc = await encryptValue(
            JSON.stringify(embedResult.embedding),
          );
          oldSelfieKeyEnc = draft.request_selfie_minio_key;
        }

        await client.query(
          `UPDATE voting_requests
             SET status = 'pending',
                 reason_category = $1,
                 reason_detail = $2,
                 doc_type = $3,
                 doc_minio_key = $4,
                 doc_hash = $5,
                 voter_id_photo_minio_key = $6,
                 request_selfie_minio_key = $7,
                 request_selfie_embedding_enc = $8,
                 liveness_score_at_request = $9,
                 updated_at = now()
             WHERE id = $10`,
          [
            reason_category,
            safeReasonDetail,
            doc_type,
            docKeyEnc,
            docHash,
            voterPhotoKeyEnc,
            selfieKeyEnc,
            embeddingEnc,
            livenessScore,
            requestId,
          ],
        );

        await client.query(
          `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason)
             VALUES ($1, 'draft', 'pending', $2, 'voter', 'Draft submitted as request')`,
          [requestId, voterId],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
             VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "voter",
            voterId,
            "request_submitted",
            "voting_request",
            requestId,
            req.requestId,
          ],
        );

        await queueNotification(voterId, "request_submitted", {}, client);
      });
    } catch (err) {
      if (docKey) await MinIOService.deleteDocument(docKey).catch(() => {});
      if (voterPhotoKey)
        await MinIOService.deleteDocument(voterPhotoKey).catch(() => {});
      if (selfieKey)
        await MinIOService.deleteDocument(selfieKey).catch(() => {});
      throw err;
    }

    for (const encKey of [
      oldDocKeyEnc,
      oldVoterPhotoKeyEnc,
      oldSelfieKeyEnc,
    ]) {
      if (encKey) {
        try {
          const k = await decryptDocKey(encKey);
          await MinIOService.deleteDocument(k);
        } catch (err) {
          logger.warn({
            action: "submit_draft_cleanup_failed",
            key: encKey,
            error: extractErrorMessage(err),
          });
        }
      }
    }

    logger.info({
      action: "draft_submitted",
      request_id: req.requestId,
      entity_id: requestId,
    });
    res.json({ success: true, request_id: requestId });
  } catch (err: unknown) {
    const message = extractErrorMessage(err);
    logger.error({
      request_id: req.requestId,
      action: "draft_submit_failed",
      error: message,
    });

    if (message === "invalid_file_type") {
      return next(new ValidationError("invalid_file_type"));
    }
    if (err instanceof AiServiceUnavailableError) {
      return next(new BaseError("ai_service_unavailable", 503));
    }
    next(err);
  }
}
