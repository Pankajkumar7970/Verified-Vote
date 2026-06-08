/**
 * Voter auth routes: OTP verification flow for voter login.
 * Binds middleware and validation to auth controller handlers.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../utils/logger.js";
import { verifyTurnstile } from "../middleware/turnstile.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { z } from "zod";
import {
  ipBlockerMiddleware,
} from "../middleware/ip-blocker.middleware.js";
import * as authController from "../controllers/auth.controller.js";

const verifyVoterSchema = z.object({
  body: z.object({
    voter_id: z.string().regex(/^[A-Z]{3}[A-Z0-9]{7}$/i, "invalid_voter_id"),
    mobile_number: z.string().regex(/^\+\d{10,15}$/, "invalid_mobile_number"),
  }),
});

const resendOtpSchema = z.object({
  body: z.object({
    session_nonce: z.string().min(1, "missing_session_nonce"),
  }),
});

const verifyOtpSchema = z.object({
  body: z.object({
    session_nonce: z.string().min(1, "missing_fields"),
    otp: z.string().min(1, "missing_fields"),
  }),
});

const router = Router();
const isTest = process.env.NODE_ENV === "test";

const voterVerifyLimiter = isTest
  ? (req: any, res: any, next: any) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      handler: (req, res) => {
        logger.warn({
          action: "verify_voter_rate_limit",
          ip: req.ip,
          request_id: req.requestId,
        });
        res
          .status(429)
          .json({ error: "too_many_requests", request_id: req.requestId });
      },
    });

const otpLimiter = isTest
  ? (req: any, res: any, next: any) => next()
  : rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 3,
      handler: (req, res) => {
        res
          .status(429)
          .json({ error: "too_many_requests", request_id: req.requestId });
      },
    });

router.post(
  "/verify-voter",
  voterVerifyLimiter,
  verifyTurnstile,
  validate(verifyVoterSchema),
  authController.verifyVoter,
);
router.post(
  "/resend-otp",
  otpLimiter,
  validate(resendOtpSchema),
  authController.resendOtp,
);
router.post(
  "/verify-otp",
  ipBlockerMiddleware,
  otpLimiter,
  validate(verifyOtpSchema),
  authController.verifyOtp,
);

export default router;
