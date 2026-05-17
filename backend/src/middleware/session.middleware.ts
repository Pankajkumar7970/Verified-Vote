import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mysecretjwtkey';

export function requireValidSession(expectedState?: string) {
  return async (req: Request | any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch(err) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    const sessionId = decoded.session_id;
    if (!sessionId) {
      return res.status(401).json({ error: 'invalid_token_payload' });
    }

    try {
      const session = await db.query('SELECT * FROM voting_sessions WHERE id = $1', [sessionId]);
      const s = session.rows[0];
      
      if (!s) return res.status(401).json({ error: 'session_not_found' });
      if (s.is_revoked) return res.status(401).json({ error: 'session_revoked' });
      if (new Date(s.expires_at) < new Date()) return res.status(401).json({ error: 'session_expired' });
      if (expectedState && s.state !== expectedState) return res.status(409).json({ error: 'invalid_state' });
      
      req.votingSession = s;
      next();
    } catch(err: any) {
      logger.error({ request_id: req.requestId, action: 'requireValidSession', error: err.message });
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
