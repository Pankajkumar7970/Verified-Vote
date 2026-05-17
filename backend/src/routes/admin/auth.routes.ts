import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/index.js';
import { logger } from '../../utils/logger.js';

const router = Router();

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  handler: (req, res) => {
    logger.warn({ action: 'admin_login_rate_limit', ip: req.ip });
    res.status(429).json({ error: 'too_many_requests' });
  }
});

router.post('/login', adminLoginLimiter, async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query('SELECT * FROM admins WHERE username = $1 AND is_active = true', [username]);
    const admin = result.rows[0];

    if (!admin) {
       return res.status(401).json({ error: 'invalid_credentials' });
    }

    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
       return res.status(401).json({ error: 'invalid_credentials' });
    }

    const secret: any = process.env.JWT_SECRET || 'mysecretjwtkey';
    const token = jwt.sign(
      { admin_id: admin.id, role: admin.role },
      secret,
      { expiresIn: '8h' }
    );

    await db.query('UPDATE admins SET last_login_at = now() WHERE id = $1', [admin.id]);

    await db.query(
      `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, ip_address, request_id_header)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['admin', admin.id, 'admin_login', 'admin', req.ip, req.requestId]
    );

    res.json({ token, role: admin.role, username: admin.username });
  } catch (err: any) {
    logger.error({ error: err.message, request_id: req.requestId });
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
