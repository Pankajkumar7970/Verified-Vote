/**
 * Admin document routes: signed preview stream for stored uploads.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import * as docController from "../../controllers/admin/doc.controller.js";

const router = Router();

router.get("/doc-preview", requireAdmin, docController.docPreview);

export default router;
