/**
 * Admin party handlers: list, create, and delete political parties.
 */
import type { NextFunction, Response } from "express";
import { db } from "../../db/index.js";
import sanitizeHtml from "sanitize-html";
import { logger } from "../../utils/logger.js";
import { ConflictError } from "../../utils/errors.js";

export async function listParties(req: any, res: Response, next: NextFunction) {
  try {
    const parties = await db.query(
      "SELECT * FROM parties WHERE is_active = true ORDER BY name ASC",
    );
    res.json({ parties: parties.rows });
  } catch (err: any) {
    next(err);
  }
}

export async function createParty(req: any, res: Response, next: NextFunction) {
  const { name, abbreviation } = req.body;
  const safeName = sanitizeHtml(name, {
    allowedTags: [],
    allowedAttributes: {},
  });
  const safeAbbr = abbreviation
    ? sanitizeHtml(abbreviation, { allowedTags: [], allowedAttributes: {} })
    : null;

  try {
    const party = await db.withTransaction(async (client) => {
      try {
        const result = await client.query(
          `INSERT INTO parties (name, abbreviation, created_by) VALUES ($1, $2, $3) RETURNING *`,
          [safeName, safeAbbr, req.admin.id],
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
          [
            "admin",
            req.admin.id,
            "party_created",
            "party",
            result.rows[0].id,
          ],
        );

        return result.rows[0];
      } catch (err: any) {
        if (err.code === "23505") {
          throw new ConflictError("party_exists");
        }
        throw err;
      }
    });

    res.json({ party });
  } catch (err: any) {
    logger.error({
      request_id: req.requestId,
      action: "party_create_failed",
      error: err.message,
    });
    next(err);
  }
}

export async function deleteParty(req: any, res: Response, next: NextFunction) {
  try {
    await db.withTransaction(async (client) => {
      const usage = await client.query(
        "SELECT count(*)::int as c FROM candidates WHERE party_id = $1",
        [req.params.id],
      );
      if (usage.rows[0].c > 0) {
        throw new ConflictError("party_has_candidates");
      }

      await client.query("DELETE FROM parties WHERE id = $1", [req.params.id]);

      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
        [
          "admin",
          req.admin.id,
          "party_deactivated",
          "party",
          req.params.id,
        ],
      );
    });
    res.json({ success: true });
  } catch (err: any) {
    next(err);
  }
}
