import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';

export function requireValidSession(...expectedStates: string[]) {
  return async (req: Request | any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized', request_id: req.requestId });
    }

    const token = authHeader.split(' ')[1];
    let decoded: { session_id?: string };
    try {
      decoded = jwt.verify(token, config.sessionJwtSecret) as { session_id?: string };
    } catch {
      return res.status(401).json({ error: 'invalid_token', request_id: req.requestId });
    }

    const sessionId = decoded.session_id;
    if (!sessionId) {
      return res.status(401).json({ error: 'invalid_token_payload', request_id: req.requestId });
    }

    try {
      const session = await db.query('SELECT * FROM voting_sessions WHERE id = $1', [sessionId]);
      const s = session.rows[0];

      if (!s) return res.status(401).json({ error: 'session_not_found', request_id: req.requestId });
      if (s.is_revoked) return res.status(401).json({ error: 'session_revoked', request_id: req.requestId });
      if (new Date(s.expires_at) < new Date()) {
        return res.status(401).json({ error: 'session_expired', request_id: req.requestId });
      }
      if (expectedStates.length > 0 && !expectedStates.includes(s.state)) {
        return res.status(409).json({
          error: 'invalid_state',
          current_state: s.state,
          request_id: req.requestId,
        });
      }

      req.votingSession = s;
      next();
    } catch (err: unknown) {
      logger.error({
        request_id: req.requestId,
        action: 'requireValidSession',
        error: err instanceof Error ? err.message : 'unknown',
      });
      res.status(500).json({ error: 'internal_error', request_id: req.requestId });
    }
  };
}
