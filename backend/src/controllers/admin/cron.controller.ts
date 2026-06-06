/**
 * Admin cron job handler: list scheduled background jobs.
 */
import type { NextFunction, Response } from "express";
import { db } from "../../db/index.js";
import { ForbiddenError } from "../../utils/errors.js";

export async function listJobs(req: any, res: Response, next: NextFunction) {
  if (req.admin.role !== "super_admin") {
    return next(new ForbiddenError("forbidden"));
  }
  try {
    const result = await db.query(
      "SELECT * FROM cron_jobs ORDER BY job_name ASC",
    );
    res.json({ jobs: result.rows });
  } catch (err) {
    next(err);
  }
}
