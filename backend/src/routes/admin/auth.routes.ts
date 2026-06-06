/**
 * Admin auth routes: login with rate limiting and IP blocking.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../../utils/logger.js";
import { BaseError } from "../../utils/errors.js";
import { z } from "zod";
import { validate } from "../../middleware/validate.middleware.js";
import {
  ipBlockerMiddleware,
} from "../../middleware/ip-blocker.middleware.js";
import * as authController from "../../controllers/admin/auth.controller.js";

const adminLoginSchema = z.object({
  body: z.object({
    username: z.string().min(1, "username_required"),
    password: z.string().min(1, "password_required"),
  }),
});

const router = Router();
const isTest = process.env.NODE_ENV === "test";

const adminLoginLimiter = isTest
  ? (req: any, res: any, next: any) => next()
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      handler: (req, res, next) => {
        logger.warn({ action: "admin_login_rate_limit", ip: req.ip });
        next(new BaseError("too_many_requests", 429));
      },
    });

router.post(
  "/login",
  ipBlockerMiddleware,
  adminLoginLimiter,
  validate(adminLoginSchema),
  authController.login,
);

export default router;
