/**
 * Voter portal handlers: elections, request history, and notifications.
 */
import type { NextFunction, Response } from "express";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";

const TERMINAL_REQUEST_STATUSES = [
  "final_approved",
  "withdrawn",
  "appeal_resolved",
] as const;

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown";
}

export async function getElections(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const { constituency, state } = req.voter;
  try {
    const elections = await db.query(
      `SELECT id, name, election_date, request_deadline, status FROM elections
       WHERE LOWER(TRIM(constituency)) = LOWER(TRIM($1::text))
         AND LOWER(TRIM(state)) = LOWER(TRIM($2::text))
         AND status = 'active'
         AND election_date >= CURRENT_DATE
       ORDER BY election_date ASC`,
      [constituency, state],
    );
    res.json({ elections: elections.rows });
  } catch (err: unknown) {
    logger.error({
      request_id: req.requestId,
      action: "fetch_elections",
      error: extractErrorMessage(err),
    });
    next(err);
  }
}

export async function getRequests(req: any, res: Response, next: NextFunction) {
  const scope = req.query.scope === "history" ? "history" : "active";
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(
      1,
      Math.min(
        100,
        parseInt(req.query.limit as string) || (scope === "active" ? 5 : 20),
      ),
    );
    const offset = (page - 1) * limit;

    let countQuery;
    let dataQuery;
    let params: unknown[] = [req.voter.id];

    if (scope === "history") {
      countQuery = `
        SELECT COUNT(*) AS total
        FROM voting_requests r
        JOIN elections e ON r.election_id = e.id
        WHERE r.voter_id = $1 AND r.status = ANY($2::text[])
      `;
      dataQuery = `
        SELECT r.id, r.election_id, r.reason_category, r.status, r.created_at, e.name as election_name,
         (SELECT reason FROM request_events WHERE request_id = r.id AND new_status = 'rejected' ORDER BY created_at DESC LIMIT 1) as rejection_reason
         FROM voting_requests r
         JOIN elections e ON r.election_id = e.id
         WHERE r.voter_id = $1 AND r.status = ANY($2::text[])
         ORDER BY r.created_at DESC
         LIMIT $3 OFFSET $4
      `;
      params.push(TERMINAL_REQUEST_STATUSES, limit, offset);
    } else {
      countQuery = `
        SELECT COUNT(*) AS total
        FROM voting_requests r
        JOIN elections e ON r.election_id = e.id
        WHERE r.voter_id = $1 AND NOT (r.status = ANY($2::text[]))
      `;
      dataQuery = `
        SELECT r.id, r.election_id, r.reason_category, r.status, r.created_at, e.name as election_name,
         (SELECT reason FROM request_events WHERE request_id = r.id AND new_status = 'rejected' ORDER BY created_at DESC LIMIT 1) as rejection_reason
         FROM voting_requests r
         JOIN elections e ON r.election_id = e.id
         WHERE r.voter_id = $1 AND NOT (r.status = ANY($2::text[]))
         ORDER BY r.created_at DESC
         LIMIT $3 OFFSET $4
      `;
      params.push(TERMINAL_REQUEST_STATUSES, limit, offset);
    }

    const countResult = await db.query(countQuery, params.slice(0, 2));
    const total = parseInt(countResult.rows[0].total);

    const requests = await db.query(dataQuery, params);

    res.json({
      requests: requests.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: unknown) {
    next(err);
  }
}

export async function getNotifications(
  req: any,
  res: Response,
  next: NextFunction,
) {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(
      1,
      Math.min(100, parseInt(req.query.limit as string) || 20),
    );
    const offset = (page - 1) * limit;

    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM notifications WHERE voter_id = $1`,
      [req.voter.id],
    );
    const total = parseInt(countResult.rows[0].total);

    const notifs = await db.query(
      `SELECT id, type, status, created_at, sent_at
       FROM notifications
       WHERE voter_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.voter.id, limit, offset],
    );
    res.json({
      notifications: notifs.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: unknown) {
    logger.error({
      action: "fetch_notifications_failed",
      error: extractErrorMessage(err),
    });
    next(err);
  }
}
