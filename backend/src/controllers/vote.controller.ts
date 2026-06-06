/**
 * Voting session handlers: list candidates and cast a vote.
 */
import type { NextFunction, Response } from "express";
import { db } from "../db/index.js";
import { generateReceiptToken } from "../utils/receipt-token.js";
import { queueNotification } from "../services/sms/notification-queue.js";
import {
  ValidationError,
  ForbiddenError,
  ConflictError,
} from "../utils/errors.js";

export async function getCandidates(
  req: any,
  res: Response,
  next: NextFunction,
) {
  const session = req.votingSession;

  try {
    const electionRes = await db.query(
      `SELECT election_id FROM voting_requests WHERE id = $1`,
      [session.request_id],
    );
    const electionId = electionRes.rows[0].election_id;

    const candidates = await db.query(
      `SELECT c.id, c.name, p.name as party_name, p.abbreviation as party_abbrev
       FROM candidates c
       JOIN parties p ON c.party_id = p.id
       WHERE c.election_id = $1
       ORDER BY c.name ASC`,
      [electionId],
    );
    res.json({ candidates: candidates.rows });
  } catch (err: unknown) {
    next(err);
  }
}

export async function castVote(req: any, res: Response, next: NextFunction) {
  const session = req.votingSession;
  const { candidate_id } = req.body;

  try {
    const electionRes = await db.query(
      `SELECT r.election_id, r.voter_id, e.status as election_status
       FROM voting_requests r
       JOIN elections e ON e.id = r.election_id
       WHERE r.id = $1`,
      [session.request_id],
    );
    if (!electionRes.rows[0]) {
      return next(new ValidationError("missing_request"));
    }
    const electionId = electionRes.rows[0].election_id;
    const voterId = electionRes.rows[0].voter_id;
    if (electionRes.rows[0].election_status !== "voting") {
      return next(new ForbiddenError("election_not_voting"));
    }

    const receiptDisplay = await db.withTransaction(async (client) => {
      const sessionUpdate = await client.query(
        `SELECT id, state FROM voting_sessions
           WHERE id = $1 AND is_revoked = false AND expires_at > now() FOR UPDATE`,
        [session.id],
      );
      const locked = sessionUpdate.rows[0];
      if (!locked) {
        throw new ConflictError("invalid_session_state");
      }
      if (locked.state === "vote_cast") {
        throw new ConflictError("vote_already_cast");
      }
      if (locked.state !== "face_verified") {
        throw new ConflictError("invalid_session_state");
      }

      const candidateCheck = await client.query(
        `SELECT id FROM candidates WHERE id = $1 AND election_id = $2`,
        [candidate_id, electionId],
      );
      if (candidateCheck.rows.length === 0) {
        throw new ValidationError("invalid_candidate_for_election");
      }

      const { display, storedHash } = generateReceiptToken();

      await client.query(
        `INSERT INTO votes (election_id, candidate_id, receipt_token, cast_at)
           VALUES ($1, $2, $3, date_trunc('minute', now()))`,
        [electionId, candidate_id, storedHash],
      );

      await client.query(
        `UPDATE voting_sessions SET state = 'vote_cast', vote_cast_at = now() WHERE id = $1`,
        [session.id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata, request_id_header)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          "voter",
          voterId,
          "vote_cast",
          "election",
          electionId,
          null,
          req.requestId,
        ],
      );

      await queueNotification(
        voterId,
        "vote_cast_success",
        { receiptToken: display },
        client,
      );

      return display;
    });

    res.json({ success: true, receipt_token: receiptDisplay });
  } catch (err: unknown) {
    next(err);
  }
}
