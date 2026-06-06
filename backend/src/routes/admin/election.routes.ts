/**
 * Admin election routes: CRUD, lifecycle transitions, settings, and results.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { ForbiddenError } from "../../utils/errors.js";
import { validate } from "../../middleware/validate.middleware.js";
import { z } from "zod";
import * as electionController from "../../controllers/admin/election.controller.js";

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

router.get("/", requireAdmin, electionController.listElections);
router.post(
  "/:id/duplicate",
  requireAdmin,
  requireSuperAdmin,
  validate(duplicateElectionSchema),
  electionController.duplicateElection,
);
router.post(
  "/",
  requireAdmin,
  requireSuperAdmin,
  validate(createElectionSchema),
  electionController.createElection,
);
router.post(
  "/:id/activate",
  requireAdmin,
  requireSuperAdmin,
  validate(activateElectionSchema),
  electionController.activateElection,
);
router.post(
  "/:id/start-voting",
  requireAdmin,
  requireSuperAdmin,
  validate(startVotingSchema),
  electionController.startVoting,
);
router.get(
  "/:id/settings",
  requireAdmin,
  requireSuperAdmin,
  validate(getElectionSettingsSchema),
  electionController.getElectionSettings,
);
router.patch(
  "/:id/settings",
  requireAdmin,
  requireSuperAdmin,
  validate(updateElectionSettingsSchema),
  electionController.updateElectionSettings,
);
router.get(
  "/:id/results",
  requireAdmin,
  validate(getElectionResultsSchema),
  electionController.getElectionResults,
);
router.post(
  "/:id/publish-results",
  requireAdmin,
  requireSuperAdmin,
  validate(publishResultsSchema),
  electionController.publishResults,
);

export default router;
