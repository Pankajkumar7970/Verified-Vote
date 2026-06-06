/**
 * Admin verification analytics handler: score distribution by election.
 */
import type { NextFunction, Response } from "express";
import { db } from "../../db/index.js";

export async function getDistribution(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await db.query(
      `SELECT vl.verification_type,
              round(avg(vl.face_score)::numeric, 3) as avg_face_score,
              round(avg(vl.liveness_score)::numeric, 3) as avg_liveness_score,
              count(*)::int as total,
              sum(case when vl.overall_passed then 1 else 0 end)::int as passed
       FROM verification_logs vl
       JOIN voting_requests r ON vl.request_id = r.id
       WHERE r.election_id = $1
       GROUP BY vl.verification_type`,
      [req.params.electionId],
    );
    res.json({ distribution: result.rows });
  } catch (err) {
    next(err);
  }
}
