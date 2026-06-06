/**
 * Admin candidate routes: CRUD for election ballot candidates.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { ForbiddenError } from "../../utils/errors.js";
import { z } from "zod";
import { validate } from "../../middleware/validate.middleware.js";
import * as candidateController from "../../controllers/admin/candidate.controller.js";

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
  candidateController.getCandidates,
);
router.post(
  "/:electionId/candidates",
  requireAdmin,
  requireSuperAdmin,
  validate(createCandidateSchema),
  candidateController.createCandidate,
);
router.delete(
  "/candidates/:id",
  requireAdmin,
  requireSuperAdmin,
  validate(deleteCandidateSchema),
  candidateController.deleteCandidate,
);

export default router;
