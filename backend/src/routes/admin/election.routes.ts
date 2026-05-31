import { Router } from "express";
import { db } from "../../db/index.js";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import sanitizeHtml from "sanitize-html";
import { logger } from "../../utils/logger.js";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { generateRefCode } from "../../utils/ref-code.js";
import { insertVotingSessionWithBaseline } from "../../utils/baseline-selfie.js";
import { queueNotification } from "../../services/sms/notification-queue.js";
import {
  ForbiddenError,
  ValidationError,
  AuthError,
  NotFoundError,
} from "../../utils/errors.js";
import { validateStatusTransition } from "../../utils/state-machine.js";
import { validate } from "../../middleware/validate.middleware.js";
import { z } from "zod";

const createElectionSchema = z.object({
  body: z.object({
    name: z.string().min(1, "name_required").max(100, "name_too_long"),
    constituency: z
      .string()
      .min(1, "constituency_required")
      .max(100, "constituency_too_long"),
    state: z.string().min(1, "state_required").max(100, "state_too_long"),
    election_date: z.string().datetime({ message: "invalid_date" }),
    request_deadline: z.string().datetime({ message: "invalid_date" }),
  }),
});

const updateElectionSettingsSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_election_id"),
  }),
  body: z.object({
    face_match_threshold: z.number().min(0).max(1).optional(),
    liveness_threshold: z.number().min(0).max(1).optional(),
    session_window_minutes: z.number().min(1).max(60).optional(),
    withdrawal_deadline_hours: z.number().min(0).max(168).optional(),
    max_otp_attempts: z.number().min(1).max(10).optional(),
  }),
});

const getElectionSettingsSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_election_id"),
  }),
});

const duplicateElectionSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_election_id"),
  }),
});

const activateElectionSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_election_id"),
  }),
  body: z.object({
    password: z.string().min(1, "password_required"),
  }),
});

const startVotingSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_election_id"),
  }),
  body: z.object({
    password: z.string().min(1, "password_required"),
  }),
});

const getElectionResultsSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_election_id"),
  }),
});

const publishResultsSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_election_id"),
  }),
  body: z.object({
    password: z.string().min(1, "password_required"),
  }),
});

const router = Router();

const requireSuperAdmin = (req: any, res: any, next: any) => {
  if (req.admin.role !== "super_admin") {
    return next(new ForbiddenError("forbidden"));
  }
  next();
};

router.get("/", requireAdmin, async (req: any, res, next) => {
  try {
    const elections = await db.query(
      "SELECT * FROM elections ORDER BY created_at DESC",
    );
    res.json({ elections: elections.rows });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/duplicate",
  requireAdmin,
  requireSuperAdmin,
  validate(duplicateElectionSchema),
  async (req: any, res, next) => {
    const { id } = req.params;

    try {
      const election = await db.withTransaction(async (client) => {
        const existingRes = await client.query(
          "SELECT * FROM elections WHERE id = $1",
          [id],
        );
        if (existingRes.rows.length === 0) {
          throw new NotFoundError("election_not_found");
        }

        const existing = existingRes.rows[0];
        const newName = `${existing.name} (Copy)`;

        // Create new election
        const result = await client.query(
          `INSERT INTO elections (name, constituency, state, election_date, request_deadline, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6) RETURNING *`,
          [
            newName,
            existing.constituency,
            existing.state,
            existing.election_date,
            existing.request_deadline,
            req.admin.id,
          ],
        );
        const newElectionId = result.rows[0].id;

        // Create election settings for new election (copying all parameters including withdrawal deadline and max otp attempts)
        const existingSettingsRes = await client.query(
          `SELECT * FROM election_settings WHERE election_id = $1`,
          [id],
        );

        if (existingSettingsRes.rows.length > 0) {
          const s = existingSettingsRes.rows[0];
          await client.query(
            `INSERT INTO election_settings (election_id, face_match_threshold, liveness_threshold, session_window_minutes, withdrawal_deadline_hours, max_otp_attempts)
           VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              newElectionId,
              s.face_match_threshold,
              s.liveness_threshold,
              s.session_window_minutes,
              s.withdrawal_deadline_hours,
              s.max_otp_attempts,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO election_settings (election_id) VALUES ($1)`,
            [newElectionId],
          );
        }

        // Copy candidates with their party associations
        const candidatesRes = await client.query(
          `SELECT * FROM candidates WHERE election_id = $1`,
          [id],
        );

        for (const candidate of candidatesRes.rows) {
          await client.query(
            `INSERT INTO candidates (election_id, party_id, name, display_order)
           VALUES ($1, $2, $3, $4)`,
            [
              newElectionId,
              candidate.party_id,
              candidate.name,
              candidate.display_order,
            ],
          );
        }

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "admin",
            req.admin.id,
            "election_duplicated",
            "election",
            newElectionId,
            req.requestId,
          ],
        );

        return result.rows[0];
      });

      res.json({ election });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: "election_duplicate_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

router.post(
  "/",
  requireAdmin,
  requireSuperAdmin,
  validate(createElectionSchema),
  async (req: any, res, next) => {
    const { name, constituency, state, election_date, request_deadline } =
      req.body;
    const safeName = sanitizeHtml(name, {
      allowedTags: [],
      allowedAttributes: {},
    });

    try {
      const election = await db.withTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO elections (name, constituency, state, election_date, request_deadline, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6) RETURNING *`,
          [
            safeName,
            constituency,
            state,
            election_date,
            request_deadline,
            req.admin.id,
          ],
        );
        const electionId = result.rows[0].id;

        await client.query(
          `INSERT INTO election_settings (election_id) VALUES ($1)`,
          [electionId],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "admin",
            req.admin.id,
            "election_created",
            "election",
            electionId,
            req.requestId,
          ],
        );
        return result.rows[0];
      });
      res.json({ election });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: "election_create_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

/** Open request window: draft → active */
router.post(
  "/:id/activate",
  requireAdmin,
  requireSuperAdmin,
  validate(activateElectionSchema),
  async (req: any, res, next) => {
    const { id } = req.params;
    const { password } = req.body;

    try {
      await db.withTransaction(async (client) => {
        const adminRes = await client.query(
          "SELECT password_hash FROM admins WHERE id = $1",
          [req.admin.id],
        );
        const valid = await bcrypt.compare(
          password,
          adminRes.rows[0].password_hash,
        );
        if (!valid) {
          throw new AuthError("invalid_password");
        }

        const electionRes = await client.query(
          "SELECT status FROM elections WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (electionRes.rows.length === 0) {
          throw new ValidationError("invalid_status");
        }
        try {
          validateStatusTransition(
            "election",
            electionRes.rows[0].status,
            "active",
            "super_admin",
            id,
          );
        } catch (err) {
          throw new ValidationError("invalid_status");
        }

        await client.query(
          `UPDATE elections SET status = 'active', activated_by = $1, updated_at = now() WHERE id = $2`,
          [req.admin.id, id],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "admin",
            req.admin.id,
            "election_activated",
            "election",
            id,
            req.requestId,
          ],
        );
      });
      res.json({ success: true, status: "active" });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: "election_activate_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

/** Start voting: active → voting; issue ref codes + SMS */
router.post(
  "/:id/start-voting",
  requireAdmin,
  requireSuperAdmin,
  validate(startVotingSchema),
  async (req: any, res, next) => {
    const { id } = req.params;
    const { password } = req.body;

    try {
      const sessionsCreated = await db.withTransaction(async (client) => {
        const adminRes = await client.query(
          "SELECT password_hash FROM admins WHERE id = $1",
          [req.admin.id],
        );
        if (!(await bcrypt.compare(password, adminRes.rows[0].password_hash))) {
          throw new AuthError("invalid_password");
        }

        const electionRes = await client.query(
          "SELECT status FROM elections WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (electionRes.rows.length === 0) {
          throw new ValidationError("invalid_status");
        }
        try {
          validateStatusTransition(
            "election",
            electionRes.rows[0].status,
            "voting",
            "super_admin",
            id,
          );
        } catch (err) {
          throw new ValidationError("invalid_status");
        }

        const settingsRes = await client.query(
          `SELECT session_window_minutes FROM election_settings WHERE election_id = $1`,
          [id],
        );
        const windowMinutes = settingsRes.rows[0]?.session_window_minutes ?? 15;

        await client.query(
          `UPDATE elections SET status = 'voting', updated_at = now() WHERE id = $1`,
          [id],
        );

        // Optimized query: Query only approved requests that lack any voting sessions in one single LEFT JOIN call
        const approvedRequests = await client.query(
          `SELECT r.id, r.voter_id FROM voting_requests r
           LEFT JOIN voting_sessions s ON s.request_id = r.id
           WHERE r.election_id = $1 AND r.status = 'final_approved' AND s.id IS NULL`,
          [id],
        );

        let created = 0;
        for (const reqRow of approvedRequests.rows) {
          const refCode = generateRefCode(12);
          const expiresAt = new Date(Date.now() + windowMinutes * 60 * 1000);

          const inserted = await insertVotingSessionWithBaseline(
            client,
            reqRow.id,
            refCode,
            expiresAt,
          );
          if (!inserted) {
            logger.warn({
              request_id: req.requestId,
              action: "voting_session_skipped_no_baseline",
              voting_request_id: reqRow.id,
            });
            continue;
          }

          await queueNotification(
            reqRow.voter_id,
            "voting_link_issued",
            { refCode },
            client,
          );
          created++;
        }

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            "admin",
            req.admin.id,
            "voting_started",
            "election",
            id,
            JSON.stringify({ sessionsCreated: created }),
            req.requestId,
          ],
        );

        return created;
      });

      res.json({ success: true, sessions_created: sessionsCreated });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: "start_voting_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

router.get(
  "/:id/settings",
  requireAdmin,
  requireSuperAdmin,
  validate(getElectionSettingsSchema),
  async (req: any, res, next) => {
    try {
      const result = await db.query(
        `SELECT face_match_threshold, liveness_threshold, session_window_minutes, withdrawal_deadline_hours, max_otp_attempts
       FROM election_settings WHERE election_id = $1`,
        [req.params.id],
      );
      if (result.rows.length === 0) {
        return res.json({
          settings: {
            face_match_threshold: 0.6,
            liveness_threshold: 0.4,
            session_window_minutes: 15,
            withdrawal_deadline_hours: 48,
            max_otp_attempts: 3,
          },
        });
      }
      res.json({ settings: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/:id/settings",
  requireAdmin,
  requireSuperAdmin,
  validate(updateElectionSettingsSchema),
  async (req: any, res, next) => {
    const { 
      face_match_threshold, 
      liveness_threshold, 
      session_window_minutes,
      withdrawal_deadline_hours,
      max_otp_attempts
    } = req.body;
    try {
      const settings = await db.withTransaction(async (client) => {
        const electionRes = await client.query(
          "SELECT status FROM elections WHERE id = $1 FOR UPDATE",
          [req.params.id],
        );
        const election = electionRes.rows[0];
        if (!election) {
          throw new NotFoundError("election_not_found");
        }
        if (election.status !== "draft") {
          throw new ValidationError(
            "invalid_status", 
            "Election settings can only be updated when the election is in draft status"
          );
        }

        const result = await client.query(
          `INSERT INTO election_settings (election_id, face_match_threshold, liveness_threshold, session_window_minutes, withdrawal_deadline_hours, max_otp_attempts)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (election_id) DO UPDATE SET
           face_match_threshold = COALESCE($2, election_settings.face_match_threshold),
           liveness_threshold = COALESCE($3, election_settings.liveness_threshold),
           session_window_minutes = COALESCE($4, election_settings.session_window_minutes),
           withdrawal_deadline_hours = COALESCE($5, election_settings.withdrawal_deadline_hours),
           max_otp_attempts = COALESCE($6, election_settings.max_otp_attempts)
         RETURNING *`,
          [
            req.params.id,
            face_match_threshold ?? 0.6,
            liveness_threshold ?? 0.4,
            session_window_minutes ?? 15,
            withdrawal_deadline_hours ?? 48,
            max_otp_attempts ?? 3,
          ],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            "admin",
            req.admin.id,
            "election_settings_updated",
            "election",
            req.params.id,
            JSON.stringify({
              face_match_threshold,
              liveness_threshold,
              session_window_minutes,
              withdrawal_deadline_hours,
              max_otp_attempts,
            }),
            req.requestId,
          ],
        );

        return result.rows[0];
      });
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/:id/results", requireAdmin, validate(getElectionResultsSchema), async (req: any, res, next) => {
  const { id } = req.params;
  try {
    const electionRes = await db.query(
      "SELECT status, results_snapshot FROM elections WHERE id = $1",
      [id],
    );
    if (electionRes.rows.length === 0)
      return next(new NotFoundError("not_found"));

    const election = electionRes.rows[0];
    if (
      election.status !== "results_published" &&
      req.admin.role !== "super_admin"
    ) {
      return next(new ForbiddenError("results_not_published"));
    }

    if (election.status === "results_published") {
      return res.json({ results: election.results_snapshot });
    }

    const tallyRes = await db.query(
      `SELECT c.id, c.name, p.name as party_name, count(v.id)::int as vote_count
       FROM candidates c
       LEFT JOIN parties p ON c.party_id = p.id
       LEFT JOIN votes v ON c.id = v.candidate_id
       WHERE c.election_id = $1
       GROUP BY c.id, c.name, p.name`,
      [id],
    );
    res.json({ results: { tally: tallyRes.rows } });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/:id/publish-results",
  requireAdmin,
  requireSuperAdmin,
  validate(publishResultsSchema),
  async (req: any, res, next) => {
    const { id } = req.params;
    const { password } = req.body;

    try {
      await db.withTransaction(async (client) => {
        const adminRes = await client.query(
          "SELECT password_hash FROM admins WHERE id = $1",
          [req.admin.id],
        );
        if (!(await bcrypt.compare(password, adminRes.rows[0].password_hash))) {
          throw new AuthError("invalid_password");
        }

        const electionRes = await client.query(
          "SELECT status FROM elections WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (electionRes.rows.length === 0) {
          throw new ValidationError("invalid_status");
        }
        try {
          validateStatusTransition(
            "election",
            electionRes.rows[0].status,
            "results_published",
            "super_admin",
            id,
          );
        } catch (err) {
          throw new ValidationError("invalid_status");
        }

        const tallyRes = await client.query(
          `SELECT c.id, c.name, p.name as party_name, count(v.id)::int as vote_count
         FROM candidates c
         LEFT JOIN parties p ON c.party_id = p.id
         LEFT JOIN votes v ON c.id = v.candidate_id
         WHERE c.election_id = $1
         GROUP BY c.id, c.name, p.name`,
          [id],
        );

        const snapshot = {
          tally: tallyRes.rows,
          published_at: new Date().toISOString(),
        };
        const snapshotString = JSON.stringify(snapshot);
        const hash = crypto
          .createHash("sha256")
          .update(snapshotString)
          .digest("hex");

        await client.query(
          `UPDATE elections
         SET status = 'results_published', results_snapshot = $1, results_hash = $2,
             results_published_at = now(), updated_at = now()
         WHERE id = $3`,
          [snapshotString, hash, id],
        );

        await client.query(
          `UPDATE voting_sessions s SET state = 'expired', updated_at = now()
         FROM voting_requests r
         WHERE s.request_id = r.id AND r.election_id = $1
           AND s.state NOT IN ('vote_cast', 'expired')`,
          [id],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            "admin",
            req.admin.id,
            "results_published",
            "election",
            id,
            JSON.stringify({ results_hash: hash }),
            req.requestId,
          ],
        );
      });

      res.json({ success: true });
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: "election_publish_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      next(err);
    }
  },
);

export default router;
