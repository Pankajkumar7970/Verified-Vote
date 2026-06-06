/**
 * Vote routes: candidate listing and ballot casting during a voting session.
 */
import { Router } from "express";
import { requireValidSession } from "../middleware/session.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { z } from "zod";
import * as voteController from "../controllers/vote.controller.js";

const castVoteSchema = z.object({
  body: z.object({
    candidate_id: z.string().uuid("missing_candidate"),
  }),
});

const router = Router();

router.get(
  "/candidates",
  requireValidSession("face_verified"),
  voteController.getCandidates,
);
router.post(
  "/cast",
  requireValidSession("face_verified"),
  validate(castVoteSchema),
  voteController.castVote,
);

export default router;
