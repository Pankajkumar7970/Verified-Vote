import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { config } from '../../utils/config.js';
import { AuthError, BaseError } from '../../utils/errors.js';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware.js';
import { ipBlockerMiddleware, recordFailedAttempt, clearFailedAttempts } from '../../middleware/ip-blocker.middleware.js';

const adminLoginSchema = z.object({
  body: z.object({
    username: z.string().min(1, 'username_required'),
    password: z.string().min(1, 'password_required'),
  })
});

const router = Router();

const isTest = process.env.NODE_ENV === 'test';

const adminLoginLimiter = isTest ? (req: any, res: any, next: any) => next() : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res, next) => {
    logger.warn({ action: 'admin_login_rate_limit', ip: req.ip });
    next(new BaseError('too_many_requests', 429));
  }
});

router.post('/login', ipBlockerMiddleware, adminLoginLimiter, validate(adminLoginSchema), async (req: any, res, next) => {
  const { username, password } = req.body;
  const ip = req.ip || 'unknown';
  try {
    const result = await db.query('SELECT * FROM admins WHERE username = $1 AND is_active = true', [username]);
    const admin = result.rows[0];

    if (!admin) {
       recordFailedAttempt(ip);
       return next(new AuthError('invalid_credentials'));
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
       recordFailedAttempt(ip);
       return next(new AuthError('invalid_credentials'));
    }

    const token = jwt.sign(
      { admin_id: admin.id, role: admin.role },
      config.adminJwtSecret,
      { expiresIn: '8h' }
    );

    await db.withTransaction(async (client) => {
      await client.query('UPDATE admins SET last_login_at = now() WHERE id = $1', [admin.id]);
      
      await client.query(
        `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, ip_address, request_id_header)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['admin', admin.id, 'admin_login', 'admin', req.ip, req.requestId]
      );
    });

    clearFailedAttempts(ip);
    res.json({ token, role: admin.role, username: admin.username });
  } catch (err: any) {
    logger.error({ error: err.message, request_id: req.requestId });
    recordFailedAttempt(ip);
    next(err);
  }
});

export default router;
