/**
 * Admin voting session routes: monitor, revoke, and approve face-pending sessions.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { ForbiddenError } from "../../utils/errors.js";
import { z } from "zod";
import { validate } from "../../middleware/validate.middleware.js";
import * as sessionController from "../../controllers/admin/session.controller.js";

const revokeSessionSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_session_id"),
  }),
  body: z.object({
    reason: z.string().optional(),
  }),
});

const approveFaceSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_session_id"),
  }),
  body: z.object({
    note: z.string().min(1, "note_required"),
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
  "/",
  requireAdmin,
  requireSuperAdmin,
  sessionController.listSessions,
);
router.post(
  "/:id/revoke",
  requireAdmin,
  requireSuperAdmin,
  validate(revokeSessionSchema),
  sessionController.revokeSession,
);
router.post(
  "/:id/approve-face",
  requireAdmin,
  validate(approveFaceSchema),
  sessionController.approveFace,
);

export default router;
