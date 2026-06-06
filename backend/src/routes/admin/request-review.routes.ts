/**
 * Admin request review routes: list, document preview, and status updates.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { z } from "zod";
import * as requestReviewController from "../../controllers/admin/request-review.controller.js";

const updateStatusSchema = z.object({
  body: z.object({
    status: z.string().min(1, "status_required"),
    reason: z.string().optional(),
    note: z.string().optional(),
    appeal_outcome: z.string().optional(),
  }),
});

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

const router = Router();

router.get(
  "/",
  requireAdmin,
  validate(getRequestsQuerySchema),
  requestReviewController.listRequests,
);
router.get(
  "/:id/preview/:kind",
  requireAdmin,
  validate(previewKindSchema),
  requestReviewController.previewDocument,
);
router.post(
  "/:id/status",
  requireAdmin,
  validate(updateStatusSchema),
  requestReviewController.updateStatus,
);

export default router;
