import { Router } from "express";
import { db } from "../../db/index.js";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import sanitizeHtml from "sanitize-html";
import { logger } from "../../utils/logger.js";
import {
  ForbiddenError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../utils/errors.js";
import { z } from "zod";
import { validate } from "../../middleware/validate.middleware.js";

const getCandidatesSchema = z.object({
  params: z.object({
    electionId: z.string().uuid("invalid_election_id"),
  }),
});

const createCandidateSchema = z.object({
  params: z.object({
    electionId: z.string().uuid("invalid_election_id"),
  }),
  body: z.object({
    name: z.string().min(1, "name_required"),
    party_id: z.string().uuid("invalid_party_id"),
  }),
});

const deleteCandidateSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_candidate_id"),
  }),
});

const router = Router();

const requireSuperAdmin = (req: any, res: any, next: any) => {
  if (req.admin.role !== "super_admin") {
    return next(new ForbiddenError("forbidden"));
  }
  next();
};

router.get(
  "/:electionId/candidates",
  requireAdmin,
  validate(getCandidatesSchema),
  async (req: any, res, next) => {
    try {
      const result = await db.query(
        `SELECT c.id, c.name, c.display_order, c.party_id, p.name as party_name, p.abbreviation
       FROM candidates c
       JOIN parties p ON c.party_id = p.id
       WHERE c.election_id = $1
       ORDER BY c.name ASC`,
        [req.params.electionId],
      );
      res.json({ candidates: result.rows });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:electionId/candidates",
  requireAdmin,
  requireSuperAdmin,
  validate(createCandidateSchema),
  async (req: any, res, next) => {
    const { name, party_id } = req.body;
    const safeName = sanitizeHtml(name, {
      allowedTags: [],
      allowedAttributes: {},
    });

    try {
      const candidate = await db.withTransaction(async (client) => {
        const electionRes = await client.query(
          "SELECT status FROM elections WHERE id = $1",
          [req.params.electionId],
        );
        if (electionRes.rows.length === 0)
          throw new NotFoundError("election_not_found");
        const electionStatus = electionRes.rows[0].status;
        if (["voting", "results_published"].includes(electionStatus)) {
          throw new ValidationError("invalid_election_status");
        }

        const result = await client.query(
          `INSERT INTO candidates (election_id, party_id, name, display_order)
         VALUES ($1, $2, $3, 0) RETURNING *`,
          [req.params.electionId, party_id, safeName],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "admin",
            req.admin.id,
            "candidate_created",
            "candidate",
            result.rows[0].id,
            req.requestId,
          ],
        );

        return result.rows[0];
      });

      res.json({ candidate });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: "candidate_create_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

router.delete(
  "/candidates/:id",
  requireAdmin,
  requireSuperAdmin,
  validate(deleteCandidateSchema),
  async (req: any, res, next) => {
    try {
      await db.withTransaction(async (client) => {
        const candidateRes = await client.query(
          "SELECT election_id FROM candidates WHERE id = $1",
          [req.params.id],
        );
        if (candidateRes.rows.length === 0)
          throw new NotFoundError("candidate_not_found");
        const electionRes = await client.query(
          "SELECT status FROM elections WHERE id = $1",
          [candidateRes.rows[0].election_id],
        );
        const electionStatus = electionRes.rows[0].status;
        if (["voting", "results_published"].includes(electionStatus)) {
          throw new ValidationError("invalid_election_status");
        }

        const votes = await client.query(
          "SELECT id FROM votes WHERE candidate_id = $1 LIMIT 1",
          [req.params.id],
        );
        if (votes.rows.length > 0) {
          throw new ConflictError("candidate_has_votes");
        }
        await client.query("DELETE FROM candidates WHERE id = $1", [
          req.params.id,
        ]);

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "admin",
            req.admin.id,
            "candidate_deleted",
            "candidate",
            req.params.id,
            req.requestId,
          ],
        );
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
