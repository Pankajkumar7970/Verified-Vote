/**
 * Voter portal routes: elections list, requests list, and notifications.
 */
import { Router } from "express";
import { requireVoter } from "../middleware/voter-auth.middleware.js";
import * as voterController from "../controllers/voter.controller.js";

const router = Router();

router.get("/elections", requireVoter, voterController.getElections);
router.get("/requests", requireVoter, voterController.getRequests);
router.get("/notifications", requireVoter, voterController.getNotifications);

export default router;
