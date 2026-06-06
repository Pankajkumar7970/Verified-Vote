/**
 * Admin party routes: political party management.
 */
import { Router } from "express";
import { requireAdmin } from "../../middleware/auth.middleware.js";
import { ForbiddenError } from "../../utils/errors.js";
import { validate } from "../../middleware/validate.middleware.js";
import { z } from "zod";
import * as partyController from "../../controllers/admin/party.controller.js";

const createPartySchema = z.object({
  body: z.object({
    name: z.string().min(1, "name_required").max(100, "name_too_long"),
    abbreviation: z.string().max(20, "abbreviation_too_long").optional(),
  }),
});

const deletePartySchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_party_id"),
  }),
});

const router = Router();

const requireSuperAdmin = (req: any, res: any, next: any) => {
  if (req.admin.role !== "super_admin") {
    return next(new ForbiddenError("forbidden"));
  }
  next();
};

router.get("/", requireAdmin, partyController.listParties);
router.post(
  "/",
  requireAdmin,
  requireSuperAdmin,
  validate(createPartySchema),
  partyController.createParty,
);
router.delete(
  "/:id",
  requireAdmin,
  requireSuperAdmin,
  validate(deletePartySchema),
  partyController.deleteParty,
);

export default router;
