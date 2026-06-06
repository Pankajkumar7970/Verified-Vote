/**
 * Admin audit routes: log listing and CSV export (super_admin only).
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import * as auditController from "../../controllers/admin/audit.controller.js";

const router = Router();

router.get("/export", requireAdmin, auditController.exportAuditLogs);
router.get("/", requireAdmin, auditController.listAuditLogs);

export default router;
