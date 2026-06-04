import "./global.d.ts";
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import { z } from "zod";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

import { requestIdMiddleware } from "./backend/src/middleware/request-id.middleware.js";
import { adminLimiter } from "./backend/src/middleware/rate-limit.middleware.js";
import adminAuthRoutes from "./backend/src/routes/admin/auth.routes.js";
import adminReviewRoutes from "./backend/src/routes/admin/request-review.routes.js";
import adminPartyRoutes from "./backend/src/routes/admin/party.routes.js";
import adminElectionRoutes from "./backend/src/routes/admin/election.routes.js";
import adminCandidateRoutes from "./backend/src/routes/admin/candidate.routes.js";
import adminSessionRoutes from "./backend/src/routes/admin/session.routes.js";
import adminCronRoutes from "./backend/src/routes/admin/cron.routes.js";
import adminVerificationRoutes from "./backend/src/routes/admin/verification.routes.js";
import adminAuditRoutes from "./backend/src/routes/admin/audit.routes.js";
import adminDocRoutes from "./backend/src/routes/admin/doc.routes.js";
import geoRoutes from "./backend/src/routes/geo.routes.js";
import voterAuthRoutes from "./backend/src/routes/auth.routes.js";
import voterActionRoutes from "./backend/src/routes/voter.routes.js";
import sessionRoutes from "./backend/src/routes/session.routes.js";
import voteRoutes from "./backend/src/routes/vote.routes.js";
import publicRoutes from "./backend/src/routes/public.routes.js";
import { startRetrySmsJob } from "./backend/src/cron/retry-sms.job.js";
import { startSendSmsJob } from "./backend/src/cron/send-sms.job.js";
import { startDeletePIIJob } from "./backend/src/cron/delete-pii.job.js";
import { startExpireSessionsJob } from "./backend/src/cron/expire-sessions.job.js";
import { startCleanupDraftElectionsJob } from "./backend/src/cron/cleanup-draft-elections.job.js";
import { startElectionLifecycleJobs } from "./backend/src/cron/manage-elections.job.js";
import { startPurgeOldRequestsJob } from "./backend/src/cron/purge-old-requests.job.js";
import { errorHandler } from "./backend/src/middleware/error.middleware.js";
import { startPurgeOTPsJob } from "./backend/src/cron/purge-otps.job.js";
import { startPurgeAuditLogsJob } from "./backend/src/cron/purge-audit-logs.job.js";
import { FaceVerifyService } from "./backend/src/services/face-verify.service.js";
import { db, dbPool } from "./backend/src/db/index.js";
import { MinIOService } from "./backend/src/services/minio.service.js";
import { logger } from "./backend/src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment Variable Validation
const EnvSchema = z.object({
  PORT: z.string().default("3000"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  VOTER_JWT_SECRET: z.string().min(32),
  ADMIN_JWT_SECRET: z.string().min(32),
  SESSION_JWT_SECRET: z.string().min(32),
  PGCRYPTO_KEY: z.string().min(16),
  SUPER_ADMIN_USERNAME: z.string(),
  SUPER_ADMIN_PASSWORD: z.string(),
  MINIO_ENDPOINT: z.string().optional(),
  MINIO_PORT: z.string().default("9000"),
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET_NAME: z.string().default("verifiedvote-docs"),
  AI_SERVICE_URL: z.string().url().optional(),
  AI_TIMEOUT_MS: z.string().default("10000"),
  AI_SERVICE_TIMEOUT_MS: z.string().optional(),
  TEXTBEE_API_KEY: z.string().optional(),
  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

let validatedEnv: z.infer<typeof EnvSchema>;
try {
  validatedEnv = EnvSchema.parse(process.env);
} catch (err) {
  console.error("❌ Invalid environment variables:", err);
  process.exit(1);
}

async function startServer() {
  const app = express();
  const PORT = Number(validatedEnv.PORT);

  // Security Hardening
  app.use(
    helmet({
      contentSecurityPolicy:
        validatedEnv.NODE_ENV === "production" ? undefined : false,
    }),
  );

  const corsOptions = {
    origin:
      validatedEnv.NODE_ENV === "production" ? validatedEnv.FRONTEND_URL : "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };
  app.use(cors(corsOptions));

  // Compression
  app.use(compression());

  app.use(express.json({ limit: "12mb" }));
  app.use(requestIdMiddleware);

  // Apply rate limiter to all admin routes
  app.use("/api/admin", adminLimiter);

  app.use("/api/admin/auth", adminAuthRoutes);
  app.use("/api/admin/requests", adminReviewRoutes);
  app.use("/api/admin/parties", adminPartyRoutes);
  app.use("/api/admin/elections", adminElectionRoutes);
  app.use("/api/admin/elections", adminCandidateRoutes); // handles /:electionId/candidates and /candidates/:id
  app.use("/api/admin/sessions", adminSessionRoutes);
  app.use("/api/admin/cron", adminCronRoutes);
  app.use("/api/admin/verification", adminVerificationRoutes);
  app.use("/api/admin/audit", adminAuditRoutes);
  app.use("/api/admin/docs", adminDocRoutes); // handles /doc-preview
  app.use("/api/admin/geo", geoRoutes);

  app.use("/api/auth", voterAuthRoutes);
  app.use("/api/voter", voterActionRoutes);
  app.use("/api/session", sessionRoutes);
  app.use("/api/vote", voteRoutes);
  app.use("/api/public", publicRoutes);

  // Global Error Handler for API routes
  app.use("/api", errorHandler);

  async function checkDb(): Promise<boolean> {
    try {
      await db.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async function checkSms(): Promise<boolean> {
    if (!process.env.TEXTBEE_API_KEY)
      return process.env.NODE_ENV !== "production";
    return true;
  }

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  let cronJobsStarted = false;

  async function waitForDbThenStartCrons() {
    const maxAttempts = Number(process.env.DB_STARTUP_MAX_ATTEMPTS || 0); // 0 = retry forever
    const intervalMs = Number(process.env.DB_STARTUP_RETRY_MS || 10000);
    let attempts = 0;

    while (!cronJobsStarted) {
      attempts += 1;
      const dbOk = await checkDb();
      if (dbOk) {
        cronJobsStarted = true;
        startSendSmsJob();
        startRetrySmsJob();
        startDeletePIIJob();
        startExpireSessionsJob();
        startPurgeOTPsJob();
        startCleanupDraftElectionsJob();
        startElectionLifecycleJobs();
        startPurgeOldRequestsJob();
        startPurgeAuditLogsJob();
        logger.info({ action: "cron_jobs_started", attempts });
        return;
      }

      logger.warn({
        action: "db_unavailable_startup_retry",
        attempts,
        next_retry_ms: intervalMs,
      });

      if (maxAttempts > 0 && attempts >= maxAttempts) {
        logger.error({
          action: "db_unavailable_cron_not_started",
          attempts,
          message: "Reached DB startup retry limit; cron jobs remain disabled.",
        });
        return;
      }
      await sleep(intervalMs);
    }
  }

  app.get("/api/health", async (req, res) => {
    const [dbOk, aiOk, smsOk, minioHealth] = await Promise.all([
      checkDb(),
      FaceVerifyService.checkHealth(),
      checkSms(),
      MinIOService.checkHealth(),
    ]);

    // Get DB pool stats
    const dbStats = {
      total: dbPool.totalCount,
      idle: dbPool.idleCount,
      waiting: dbPool.waitingCount,
    };

    // Get SMS queue stats
    let smsQueueStats = { pending: 0, failed: 0, sent: 0 };
    try {
      const queueResult = await db.query(`
        SELECT status, COUNT(*) AS count 
        FROM notifications 
        WHERE channel = 'sms' 
        GROUP BY status
      `);
      queueResult.rows.forEach((row: any) => {
        if (row.status === "pending") smsQueueStats.pending = Number(row.count);
        if (row.status === "failed") smsQueueStats.failed = Number(row.count);
        if (row.status === "sent") smsQueueStats.sent = Number(row.count);
      });
    } catch (err) {
      logger.warn({ action: "health_sms_queue_failed", error: err });
    }

    res.json({
      status: dbOk && aiOk ? "ok" : "degraded",
      db: {
        healthy: dbOk,
        stats: dbStats,
      },
      sms: {
        healthy: smsOk,
        queue: smsQueueStats,
      },
      ai_service: aiOk,
      minio: minioHealth,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/ready", async (req, res) => {
    const [dbOk, aiOk] = await Promise.all([
      checkDb(),
      FaceVerifyService.checkHealth(),
    ]);
    const ready = dbOk && (!process.env.AI_SERVICE_URL || aiOk);
    res.status(ready ? 200 : 503).json({ ready, db: dbOk, ai_service: aiOk });
  });

  app.get("/api/live", (_req, res) => {
    res.status(200).json({ alive: true });
  });

  app.get("/api/startup-status", async (_req, res) => {
    const dbOk = await checkDb();
    res.json({
      db: dbOk,
      cron_jobs_started: cronJobsStarted,
      ready: dbOk && cronJobsStarted,
      timestamp: new Date().toISOString(),
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    void waitForDbThenStartCrons();
  });
}

startServer();
