/**
 * Admin geo routes: states and constituencies for election setup.
 */
import { Router } from "express";
import { requireAdmin } from "../middleware/auth.middleware.js";
import * as geoController from "../controllers/geo.controller.js";

const router = Router();

router.get("/states", requireAdmin, geoController.getStates);
router.get("/constituencies", requireAdmin, geoController.getConstituencies);

export default router;
