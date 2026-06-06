/**
 * Voting session routes: ref-code flow, OTP verification, and face match.
 */
import { Router } from "express";
import { requireValidSession } from "../middleware/session.middleware.js";
import {
  sessionRefLimiter,
  otpVerifyLimiter,
} from "../middleware/rate-limit.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { z } from "zod";
import * as sessionController from "../controllers/session.controller.js";

const statusSchema = z.object({
  query: z.object({
    ref_code: z.string().min(1, "missing_ref_code"),
  }),
});

const resolveSchema = z.object({
  body: z.object({
    ref_code: z.string().min(1, "missing_ref_code"),
  }),
});

const verifyOtpSchema = z.object({
  body: z.object({
    ref_code: z.string().min(1, "missing_fields"),
    nonce: z.string().min(1, "missing_fields"),
    otp: z.string().min(1, "missing_fields"),
  }),
});

const faceVerifySchema = z.object({
  body: z.object({
    selfie_b64: z.string().min(1, "missing_selfie"),
  }),
});

const router = Router();

router.get(
  "/status",
  sessionRefLimiter,
  validate(statusSchema),
  sessionController.getStatus,
);
router.post(
  "/resolve",
  sessionRefLimiter,
  validate(resolveSchema),
  sessionController.resolveSession,
);
router.post(
  "/verify-otp",
  otpVerifyLimiter,
  validate(verifyOtpSchema),
  sessionController.verifyOtp,
);
router.post(
  "/face-verify",
  requireValidSession("otp_verified", "face_pending"),
  validate(faceVerifySchema),
  sessionController.faceVerify,
);

export default router;
