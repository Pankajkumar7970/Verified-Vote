/**
 * Admin authentication handler: username/password login and JWT issuance.
 */
import type { NextFunction, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../db/index.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";
import { AuthError } from "../../utils/errors.js";
import {
  recordFailedAttempt,
  clearFailedAttempts,
} from "../../middleware/ip-blocker.middleware.js";

export async function login(req: any, res: Response, next: NextFunction) {
  const { username, password } = req.body;
  const ip = req.ip || "unknown";
  try {
    const result = await db.query(
      "SELECT * FROM admins WHERE username = $1 AND is_active = true",
      [username],
    );
    const admin = result.rows[0];

    if (!admin) {
      recordFailedAttempt(ip);
      return next(new AuthError("invalid_credentials"));
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      recordFailedAttempt(ip);
      return next(new AuthError("invalid_credentials"));
    }

    const token = jwt.sign(
      { admin_id: admin.id, role: admin.role },
      config.adminJwtSecret,
      { expiresIn: "8h" },
    );

    await db.withTransaction(async (client) => {
      await client.query(
        "UPDATE admins SET last_login_at = now() WHERE id = $1",
        [admin.id],
      );

      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, ip_address, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          "admin",
          admin.id,
          "admin_login",
          "admin",
          req.ip,
          req.requestId,
        ],
      );
    });

    clearFailedAttempts(ip);
    res.json({ token, role: admin.role, username: admin.username });
  } catch (err: any) {
    logger.error({ error: err.message, request_id: req.requestId });
    recordFailedAttempt(ip);
    next(err);
  }
}
