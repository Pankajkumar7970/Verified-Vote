/**
 * Admin verification routes: face/liveness score analytics per election.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import * as verificationController from "../../controllers/admin/verification.controller.js";

const router = Router();

router.get(
  "/:electionId/distribution",
  requireAdmin,
  verificationController.getDistribution,
);

export default router;
