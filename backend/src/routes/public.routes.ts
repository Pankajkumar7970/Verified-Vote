/**
 * Public routes: election results and receipt verification (no auth).
 */
import { Router } from "express";
import * as publicController from "../controllers/public.controller.js";

const router = Router();

router.get("/elections/:id/results", publicController.getElectionResults);
router.get("/verify-receipt/:token", publicController.verifyReceipt);

export default router;
