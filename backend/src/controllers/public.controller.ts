/**
 * Public API handlers: published election results and receipt verification.
 */
import type { NextFunction, Response } from "express";
import crypto from "crypto";
import { db } from "../db/index.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../utils/errors.js";

export async function getElectionResults(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const { id } = req.params;
  try {
    const electionRes = await db.query(
      `SELECT id, name, constituency, state, status, results_snapshot, results_published_at
       FROM elections WHERE id = $1`,
      [id],
    );

    if (electionRes.rows.length === 0) {
      return next(new NotFoundError("not_found"));
    }

    const election = electionRes.rows[0];
    if (
      election.status !== "results_published" ||
      !election.results_snapshot
    ) {
      return next(new ForbiddenError("results_not_published"));
    }

    res.json({ election });
  } catch (err: unknown) {
    next(err);
  }
}

export async function verifyReceipt(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const raw = req.params.token?.trim();
  if (!raw) return next(new ValidationError("token_missing"));

  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");

  try {
    const voteRes = await db.query(
      `SELECT v.cast_at, e.name as election_name
       FROM votes v
       JOIN elections e ON v.election_id = e.id
       WHERE v.receipt_token = $1`,
      [tokenHash],
    );

    if (voteRes.rows.length === 0) {
      return next(new NotFoundError("receipt_not_found"));
    }

    const vote = voteRes.rows[0];
    res.json({
      success: true,
      data: {
        election_name: vote.election_name,
        cast_at: vote.cast_at,
      },
    });
  } catch (err: unknown) {
    next(err);
  }
}
