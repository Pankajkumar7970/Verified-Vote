import "./global.d.ts";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from 'url';

import { requestIdMiddleware } from "./backend/src/middleware/request-id.middleware.js";
import adminAuthRoutes from "./backend/src/routes/admin/auth.routes.js";
import adminReviewRoutes from "./backend/src/routes/admin/request-review.routes.js";
import adminPartyRoutes from "./backend/src/routes/admin/party.routes.js";
import adminElectionRoutes from "./backend/src/routes/admin/election.routes.js";
import adminAuditRoutes from "./backend/src/routes/admin/audit.routes.js";
import voterAuthRoutes from "./backend/src/routes/auth.routes.js";
import voterActionRoutes from "./backend/src/routes/voter.routes.js";
import sessionRoutes from "./backend/src/routes/session.routes.js";
import voteRoutes from "./backend/src/routes/vote.routes.js";
import publicRoutes from "./backend/src/routes/public.routes.js";
import { startRetrySmsJob } from "./backend/src/cron/retry-sms.job.js";
import { startDeletePIIJob } from "./backend/src/cron/delete-pii.job.js";
import { startExpireSessionsJob } from "./backend/src/cron/expire-sessions.job.js";
import { startPurgeOTPsJob } from "./backend/src/cron/purge-otps.job.js";
import { startPurgeAuditLogsJob } from "./backend/src/cron/purge-audit-logs.job.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(requestIdMiddleware);
  
  // Internal Administration API
  app.use('/api/admin/auth', adminAuthRoutes);
  app.use('/api/admin/requests', adminReviewRoutes);
  app.use('/api/admin/parties', adminPartyRoutes);
  app.use('/api/admin/elections', adminElectionRoutes);
  app.use('/api/admin/audit', adminAuditRoutes);

  // Voter API
  app.use('/api/auth', voterAuthRoutes);
  app.use('/api/voter', voterActionRoutes);
  app.use('/api/session', sessionRoutes);
  app.use('/api/vote', voteRoutes);
  app.use('/api/public', publicRoutes);

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: true, sms: true, ai_service: true });
  });

  app.get("/api/ready", (req, res) => {
    // Basic readiness check placeholder
    res.status(200).json({ ready: true });
  });

  app.get("/api/live", (req, res) => {
    res.status(200).json({ alive: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // production static serving
    const distPath = path.join(__dirname, "dist");
    const clientPath = path.join(distPath, "client"); // vite build puts output here by default? Actually just dist
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Start Cron Jobs
    startRetrySmsJob();
    startDeletePIIJob();
    startExpireSessionsJob();
    startPurgeOTPsJob();
    startPurgeAuditLogsJob();
  });
}

startServer();
