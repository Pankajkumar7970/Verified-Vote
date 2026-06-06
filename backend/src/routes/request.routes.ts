/**
 * Voting request routes: submit, draft, withdraw, and appeal endpoints.
 */
import { Router } from "express";
import multer from "multer";
import { requireVoter } from "../middleware/voter-auth.middleware.js";
import { requestSubmitLimiter } from "../middleware/rate-limit.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { MAX_SELFIE_B64_LENGTH } from "../constants/verification.js";
import { z } from "zod";
import * as requestController from "../controllers/request.controller.js";

const submitRequestSchema = z.object({
  election_id: z.string().uuid("invalid_election_id"),
  reason_category: z.string().min(1, "reason_category_required"),
  reason_detail: z.string().optional(),
  doc_type: z.string().min(1, "doc_type_required"),
  selfie_b64: z
    .string()
    .min(1, "missing_selfie")
    .max(MAX_SELFIE_B64_LENGTH, "invalid_selfie"),
});

const saveDraftSchema = z.object({
  election_id: z.string().uuid("invalid_election_id"),
  reason_category: z.string().optional(),
  reason_detail: z.string().optional(),
  doc_type: z.string().optional(),
  selfie_b64: z
    .string()
    .max(MAX_SELFIE_B64_LENGTH, "invalid_selfie")
    .optional(),
});

const saveDraftValidationSchema = z.object({
  body: saveDraftSchema,
});

const submitDraftValidationSchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_draft_id"),
  }),
  body: z.object({
    election_id: z.string().uuid("invalid_election_id"),
    reason_category: z.string().min(1, "reason_category_required"),
    reason_detail: z.string().optional(),
    doc_type: z.string().min(1, "doc_type_required"),
    selfie_b64: z
      .string()
      .max(MAX_SELFIE_B64_LENGTH, "invalid_selfie")
      .optional(),
  }),
});

const submitRequestValidationSchema = z.object({
  body: submitRequestSchema,
});

const uploadRequest = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const docTypes = ["image/jpeg", "image/png", "application/pdf"];
    const photoTypes = ["image/jpeg", "image/png"];
    if (file.fieldname === "doc" && docTypes.includes(file.mimetype))
      cb(null, true);
    else if (
      file.fieldname === "voter_id_photo" &&
      photoTypes.includes(file.mimetype)
    )
      cb(null, true);
    else cb(new Error("invalid_file_type"));
  },
}).fields([
  { name: "doc", maxCount: 1 },
  { name: "voter_id_photo", maxCount: 1 },
]);

const router = Router();

router.post(
  "/requests/submit",
  requireVoter,
  requestSubmitLimiter,
  uploadRequest,
  validate(submitRequestValidationSchema),
  requestController.submitRequest,
);
router.post(
  "/requests/draft",
  requireVoter,
  uploadRequest,
  validate(saveDraftValidationSchema),
  requestController.saveDraft,
);
router.get(
  "/requests/draft/:electionId",
  requireVoter,
  requestController.getDraft,
);
router.post(
  "/requests/:id/withdraw",
  requireVoter,
  requestController.withdrawRequest,
);
router.post(
  "/requests/:id/appeal",
  requireVoter,
  uploadRequest,
  requestController.appealRequest,
);
router.post(
  "/requests/:id/submit-draft",
  requireVoter,
  requestSubmitLimiter,
  uploadRequest,
  validate(submitDraftValidationSchema),
  requestController.submitDraft,
);

export default router;
