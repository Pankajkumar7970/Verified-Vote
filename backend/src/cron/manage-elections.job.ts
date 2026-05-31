import { db } from "../db/index.js";
import { runWithLock } from "./lock.js";
import { logger } from "../utils/logger.js";
import { SYSTEM_AUDIT_ACTOR_ID } from "../constants/system.js";
import { generateRefCode } from "../utils/ref-code.js";
import { insertVotingSessionWithBaseline } from "../utils/baseline-selfie.js";
import { queueNotification } from "../services/sms/notification-queue.js";
import crypto from "crypto";

async function startVotingForElections() {
  try {
    const now = new Date();

    await db.withTransaction(async (client) => {
      const electionRes = await client.query(
        `SELECT id, status FROM elections
         WHERE status = 'active'
           AND election_date::date <= $1
         FOR UPDATE`,
        [now.toISOString().split("T")[0]],
      );

      for (const election of electionRes.rows) {
        if (election.status !== "active") continue;

        // First update status to voting
        await client.query(
          `UPDATE elections SET status = 'voting', updated_at = now() WHERE id = $1`,
          [election.id],
        );

        // Get session window minutes
        const settingsRes = await client.query(
          `SELECT session_window_minutes FROM election_settings WHERE election_id = $1`,
          [election.id],
        );
        const windowMinutes = settingsRes.rows[0]?.session_window_minutes ?? 15;

        // Get final approved requests
        const approvedRequests = await client.query(
          `SELECT r.id, r.voter_id FROM voting_requests r
           WHERE r.election_id = $1 AND r.status = 'final_approved'`,
          [election.id],
        );

        let created = 0;
        for (const reqRow of approvedRequests.rows) {
          const existing = await client.query(
            `SELECT id FROM voting_sessions WHERE request_id = $1`,
            [reqRow.id],
          );
          if (existing.rows.length > 0) continue;

          const refCode = generateRefCode(12);
          const expiresAt = new Date(Date.now() + windowMinutes * 60 * 1000);

          const inserted = await insertVotingSessionWithBaseline(
            client,
            reqRow.id,
            refCode,
            expiresAt,
          );
          if (!inserted) {
            logger.warn({
              action: "voting_session_skipped_no_baseline",
              voting_request_id: reqRow.id,
            });
            continue;
          }

          await queueNotification(
            reqRow.voter_id,
            "voting_link_issued",
            { refCode },
            client,
          );
          created++;
        }

        // Log audit entry
        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "system",
            SYSTEM_AUDIT_ACTOR_ID,
            "voting_started",
            "election",
            election.id,
            JSON.stringify({ sessionsCreated: created }),
          ],
        );

        logger.info({
          action: "cron_start_voting",
          electionId: election.id,
          sessionsCreated: created,
        });
      }
    });
  } catch (err: unknown) {
    logger.error({
      action: "cron_start_voting_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

async function completeElections() {
  try {
    const now = new Date();

    await db.withTransaction(async (client) => {
      const electionRes = await client.query(
        `SELECT id, status FROM elections
         WHERE status = 'voting'
           AND election_date::date < $1
         FOR UPDATE`,
        [now.toISOString().split("T")[0]],
      );

      for (const election of electionRes.rows) {
        if (election.status !== "voting") continue;

        // Get vote tally
        const tallyRes = await client.query(
          `SELECT c.id, c.name, p.name as party_name, count(v.id)::int as vote_count
           FROM candidates c
           LEFT JOIN parties p ON c.party_id = p.id
           LEFT JOIN votes v ON c.id = v.candidate_id
           WHERE c.election_id = $1
           GROUP BY c.id, c.name, p.name`,
          [election.id],
        );

        // Create results snapshot
        const snapshot = {
          tally: tallyRes.rows,
          published_at: new Date().toISOString(),
        };
        const snapshotString = JSON.stringify(snapshot);
        const hash = crypto
          .createHash("sha256")
          .update(snapshotString)
          .digest("hex");

        // Update election status to results published
        await client.query(
          `UPDATE elections
           SET status = 'results_published', results_snapshot = $1, results_hash = $2,
               results_published_at = now(), updated_at = now()
           WHERE id = $3`,
          [snapshotString, hash, election.id],
        );

        // Expire any active sessions
        await client.query(
          `UPDATE voting_sessions s SET state = 'expired', updated_at = now()
           FROM voting_requests r
           WHERE s.request_id = r.id AND r.election_id = $1
             AND s.state NOT IN ('vote_cast', 'expired')`,
          [election.id],
        );

        // Log audit entry
        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            "system",
            SYSTEM_AUDIT_ACTOR_ID,
            "results_published",
            "election",
            election.id,
            JSON.stringify({ results_hash: hash }),
          ],
        );

        logger.info({
          action: "cron_complete_election",
          electionId: election.id,
        });
      }
    });
  } catch (err: unknown) {
    logger.error({
      action: "cron_complete_election_failed",
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

export function startElectionLifecycleJobs() {
  // Run start voting check every hour
  setInterval(
    () => {
      void runWithLock("election_start_voting", startVotingForElections).catch(
        (err: unknown) => {
          logger.error({
            action: "election_start_voting_job_failed",
            error: err instanceof Error ? err.message : "unknown",
          });
        },
      );
    },
    60 * 60 * 1000,
  );

  // Run complete election check every hour
  setInterval(
    () => {
      void runWithLock("election_complete", completeElections).catch(
        (err: unknown) => {
          logger.error({
            action: "election_complete_job_failed",
            error: err instanceof Error ? err.message : "unknown",
          });
        },
      );
    },
    60 * 60 * 1000,
  );
}
