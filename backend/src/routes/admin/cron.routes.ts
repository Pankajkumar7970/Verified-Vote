/**
 * Admin cron routes: view background job status (super_admin only).
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import * as cronController from "../../controllers/admin/cron.controller.js";

const router = Router();

router.get("/", requireAdmin, cronController.listJobs);

export default router;
