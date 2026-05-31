import { Router } from "express";
import { db } from "../../db/index.js";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import sanitizeHtml from "sanitize-html";
import { logger } from "../../utils/logger.js";
import { MinIOService } from "../../services/minio.service.js";
import { decryptDocKey } from "../../utils/crypto.js";
import { queueNotification } from "../../services/sms/notification-queue.js";
import { validateStatusTransition } from "../../utils/state-machine.js";
import { hasBaseline } from "../../utils/baseline-selfie.js";
import {
  ForbiddenError,
  ValidationError,
  NotFoundError,
} from "../../utils/errors.js";
import { validate } from "../../middleware/validate.middleware.js";
import { z } from "zod";

const updateStatusSchema = z.object({
  body: z.object({
    status: z.string().min(1, "status_required"),
    reason: z.string().optional(),
    note: z.string().optional(),
    appeal_outcome: z.string().optional(),
  }),
});

const router = Router();

async function resolveDocUrl(
  storedKey: string | null,
): Promise<string | undefined> {
  if (!storedKey) return undefined;
  try {
    const key = await decryptDocKey(storedKey);
    return MinIOService.getSignedUrl(key);
  } catch {
    return MinIOService.getSignedUrl(storedKey);
  }
}

async function deleteStoredDoc(storedKey: string | null) {
  if (!storedKey) return;
  try {
    const key = await decryptDocKey(storedKey);
    await MinIOService.deleteDocument(key);
  } catch {
    await MinIOService.deleteDocument(storedKey);
  }
}

const getRequestsQuerySchema = z.object({
  query: z.object({
    election_id: z.string().uuid("invalid_election_id").optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

const previewKindSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_request_id"),
    kind: z.enum(["supporting_doc", "voter_id", "selfie", "appeal_doc"]),
  }),
});

const PREVIEW_COLUMN: Record<
  "supporting_doc" | "voter_id" | "selfie" | "appeal_doc",
  string
> = {
  supporting_doc: "doc_minio_key",
  voter_id: "voter_id_photo_minio_key",
  selfie: "request_selfie_minio_key",
  appeal_doc: "appeal_doc_minio_key",
};

const APPEAL_STATUSES = ["appealed", "appeal_under_review", "appeal_resolved"];

router.get(
  "/",
  requireAdmin,
  validate(getRequestsQuerySchema),
  async (req: any, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.max(
        1,
        Math.min(100, parseInt(req.query.limit as string) || 20),
      );
      const offset = (page - 1) * limit;

      const electionId = req.query.election_id as string | undefined;
      const isReviewer = req.admin!.role === "reviewer";
      let whereClause = "WHERE r.status != 'draft'";
      const params: unknown[] = [];
      if (isReviewer) {
        whereClause += ` AND r.status NOT IN ('appealed', 'appeal_under_review', 'appeal_resolved')`;
      }
      if (electionId) {
        whereClause += ` AND r.election_id = $${params.length + 1}`;
        params.push(electionId);
      }

      // Get pagination total count
      const countResult = await db.query(
        `
      SELECT COUNT(*)::int AS total FROM voting_requests r JOIN elections e ON r.election_id = e.id ${whereClause}
    `,
        params,
      );
      const total = countResult.rows[0].total;

      // Get total stats for all requests matching the filter
      const statsResult = await db.query(
        `
      SELECT r.status, COUNT(*)::int AS count
      FROM voting_requests r
      JOIN elections e ON r.election_id = e.id
      ${whereClause}
      GROUP BY r.status
    `,
        params,
      );
      const stats: Record<string, number> = {};
      statsResult.rows.forEach((row: any) => {
        stats[row.status] = parseInt(row.count);
      });

      let listParams = [...params];
      const limitIndex = listParams.length + 1;
      const offsetIndex = listParams.length + 2;
      listParams.push(limit, offset);

      const result = await db.query(
        `
      SELECT r.id, r.voter_id, r.election_id, r.reason_category, r.reason_detail, r.doc_type,
             r.doc_minio_key, r.voter_id_photo_minio_key, r.request_selfie_minio_key,
             r.appeal_doc_minio_key, r.request_selfie_embedding_enc IS NOT NULL AS has_selfie_embedding,
             r.liveness_score_at_request,
             r.status, r.created_at, e.name as election_name
      FROM voting_requests r
      JOIN elections e ON r.election_id = e.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `,
        listParams,
      );

      const enriched = await Promise.all(
        result.rows.map(async (row) => {
          const doc_url = await resolveDocUrl(row.doc_minio_key);
          const voter_id_photo_url = await resolveDocUrl(
            row.voter_id_photo_minio_key,
          );
          const request_selfie_url = await resolveDocUrl(
            row.request_selfie_minio_key,
          );
          const appeal_doc_url = await resolveDocUrl(row.appeal_doc_minio_key);
          const {
            doc_minio_key: _d,
            voter_id_photo_minio_key: _v,
            request_selfie_minio_key: _s,
            appeal_doc_minio_key: _a,
            ...safe
          } = row;

          const showAppealDoc =
            req.admin!.role === "super_admin" &&
            APPEAL_STATUSES.includes(row.status);

          return {
            ...safe,
            status: row.status,
            doc_url,
            voter_id_photo_url,
            request_selfie_url,
            appeal_doc_url: showAppealDoc ? appeal_doc_url : undefined,
            has_selfie_embedding: row.has_selfie_embedding,
            can_preview: {
              supporting_doc: !!row.doc_minio_key,
              voter_id: !!row.voter_id_photo_minio_key,
              selfie: !!row.request_selfie_minio_key,
              appeal_doc: showAppealDoc && !!row.appeal_doc_minio_key,
            },
            face_score_at_request: row.liveness_score_at_request,
          };
        }),
      );

      res.json({
        requests: enriched,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        stats,
      });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

router.get(
  "/:id/preview/:kind",
  requireAdmin,
  validate(previewKindSchema),
  async (req: any, res, next) => {
    const { id, kind } = req.params;
    const column = PREVIEW_COLUMN[kind as keyof typeof PREVIEW_COLUMN];

    if (req.admin!.role === "reviewer" && kind === "appeal_doc") {
      return next(new ForbiddenError("forbidden"));
    }

    try {
      const result = await db.query(
        `SELECT status, doc_minio_key, voter_id_photo_minio_key, request_selfie_minio_key, appeal_doc_minio_key
         FROM voting_requests WHERE id = $1`,
        [id],
      );
      if (result.rows.length === 0) {
        return next(new NotFoundError("not_found"));
      }
      const row = result.rows[0];
      if (
        req.admin!.role === "reviewer" &&
        APPEAL_STATUSES.includes(row.status)
      ) {
        return next(new ForbiddenError("forbidden"));
      }
      if (kind === "appeal_doc" && !APPEAL_STATUSES.includes(row.status)) {
        return next(new NotFoundError("document_not_available"));
      }

      const storedKey = row[column];
      if (!storedKey) {
        return next(new NotFoundError("document_not_available"));
      }

      const objectKey = await decryptDocKey(storedKey);
      const { stream, mimeType } =
        await MinIOService.getDocumentStream(objectKey);
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Cache-Control", "private, max-age=120");
      res.setHeader("X-Content-Type-Options", "nosniff");
      stream.pipe(res);
    } catch (err: unknown) {
      next(err);
    }
  },
);

router.post(
  "/:id/status",
  requireAdmin,
  validate(updateStatusSchema),
  async (req: any, res, next) => {
    const { id } = req.params;
    const { status, reason, note, appeal_outcome } = req.body;
    const adminId = req.admin!.id;
    const adminRole = req.admin!.role;

    const safeNote = note
      ? sanitizeHtml(note, { allowedTags: [], allowedAttributes: {} })
      : null;
    const safeReason = reason
      ? sanitizeHtml(reason, { allowedTags: [], allowedAttributes: {} })
      : null;

    try {
      const updatedRequest = await db.withTransaction(async (client) => {
        const requestRes = await client.query(
          "SELECT * FROM voting_requests WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (requestRes.rows.length === 0) {
          throw new NotFoundError("not_found");
        }
        const voteReq = requestRes.rows[0];
        const oldStatus = voteReq.status;

        let targetStatus = status;
        const normalizedRole =
          adminRole === "superadmin" ? "super_admin" : adminRole;

        if (targetStatus === "approve") {
          targetStatus =
            normalizedRole === "reviewer"
              ? "reviewer_approved"
              : "superadmin_approved";
        }

        if (
          normalizedRole === "reviewer" &&
          APPEAL_STATUSES.includes(oldStatus)
        ) {
          throw new ForbiddenError("role_insufficient_for_transition");
        }

        try {
          validateStatusTransition(
            "voting_request",
            oldStatus,
            targetStatus,
            normalizedRole,
            id,
          );
        } catch {
          throw new ForbiddenError("role_insufficient_for_transition");
        }

        if (
          [
            "reviewer_approved",
            "superadmin_approved",
            "rejected",
            "appeal_resolved",
          ].includes(targetStatus)
        ) {
          if (!safeNote && targetStatus !== "rejected") {
            throw new ValidationError("note_required");
          }
          if (targetStatus === "rejected" && !safeReason) {
            throw new ValidationError("reason_required");
          }
        }

        let newStatus = targetStatus;
        if (newStatus === "superadmin_approved") newStatus = "final_approved";

        if (newStatus === "appeal_resolved") {
          if (appeal_outcome === "approved") newStatus = "superadmin_approved";
          else newStatus = "rejected";
        }

        if (newStatus === "superadmin_approved") newStatus = "final_approved";

        await client.query(
          `INSERT INTO request_events (request_id, old_status, new_status, actor_id, actor_type, reason, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            oldStatus,
            newStatus,
            adminId,
            "admin",
            safeReason,
            JSON.stringify({ note: safeNote }),
          ],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "admin",
            adminId,
            `request_${newStatus}`,
            "voting_request",
            id,
            req.requestId,
          ],
        );

        let updateQuery = `UPDATE voting_requests SET status = $1, updated_at = now()`;
        const params: unknown[] = [newStatus, id];
        let paramIdx = 3;

        if (adminRole === "reviewer" && newStatus !== "under_review") {
          updateQuery += `, reviewed_by_reviewer = $${paramIdx}, reviewer_note = $${paramIdx + 1}`;
          params.push(adminId, safeNote);
          paramIdx += 2;
        } else if (adminRole === "super_admin") {
          updateQuery += `, reviewed_by_superadmin = $${paramIdx}, superadmin_note = $${paramIdx + 1}`;
          params.push(adminId, safeNote);
          paramIdx += 2;
        }

        if (newStatus === "final_approved") {
          if (
            !hasBaseline(
              voteReq.request_selfie_embedding_enc,
              voteReq.request_selfie_minio_key,
            )
          ) {
            throw new ValidationError("missing_baseline_selfie");
          }
          updateQuery += `, scheduled_at = now()`;
        }

        updateQuery += ` WHERE id = $2 RETURNING *`;
        const updated = await client.query(updateQuery, params);

        if (newStatus === "final_approved") {
          await queueNotification(
            voteReq.voter_id,
            "request_approved",
            {},
            client,
          );
        } else if (newStatus === "rejected") {
          await queueNotification(
            voteReq.voter_id,
            "request_rejected",
            {},
            client,
          );
        } else if (
          oldStatus === "appeal_under_review" ||
          targetStatus === "appeal_resolved"
        ) {
          await queueNotification(
            voteReq.voter_id,
            "appeal_resolved",
            {},
            client,
          );
        }

        if (newStatus === "final_approved") {
          // Supporting docs only — keep selfie embedding/keys for voting-time face match.
          await deleteStoredDoc(voteReq.doc_minio_key);
          await deleteStoredDoc(voteReq.voter_id_photo_minio_key);
          await deleteStoredDoc(voteReq.appeal_doc_minio_key);
          await client.query(
            `UPDATE voting_requests SET doc_minio_key = null, voter_id_photo_minio_key = null,
             appeal_doc_minio_key = null WHERE id = $1`,
            [id],
          );
        } else if (newStatus === "rejected") {
          await deleteStoredDoc(voteReq.doc_minio_key);
          await deleteStoredDoc(voteReq.voter_id_photo_minio_key);
          await deleteStoredDoc(voteReq.request_selfie_minio_key);
          await deleteStoredDoc(voteReq.appeal_doc_minio_key);
          await client.query(
            `UPDATE voting_requests SET doc_minio_key = null, voter_id_photo_minio_key = null,
             request_selfie_minio_key = null, appeal_doc_minio_key = null,
             request_selfie_embedding_enc = null WHERE id = $1`,
            [id],
          );
        }

        return updated.rows[0];
      });

      res.json({ request: updatedRequest });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: "updateRequestStatus",
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

export default router;
