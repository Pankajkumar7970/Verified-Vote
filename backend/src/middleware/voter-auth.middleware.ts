import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mysecretjwtkey';

export const requireVoter = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', request_id: req.requestId });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded.voter_id || !decoded.constituency || !decoded.state) {
      throw new Error('invalid_token');
    }
    // We attach the validated voter context
    (req as any).voter = { 
      id: decoded.voter_id, 
      constituency: decoded.constituency, 
      state: decoded.state 
    };
    next();
  } catch (err: any) {
    logger.warn({ action: 'voter_auth_failed', error: err.message, request_id: req.requestId });
    res.status(401).json({ error: 'invalid_token', request_id: req.requestId });
  }
};
