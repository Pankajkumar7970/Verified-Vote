import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'mysecretjwtkey';

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized', request_id: req.requestId });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    if (!decoded.admin_id || !decoded.role) {
      throw new Error('invalid_token');
    }
    req.admin = { id: decoded.admin_id, role: decoded.role };
    next();
  } catch (err: any) {
    logger.warn({ action: 'admin_auth_failed', error: err.message, request_id: req.requestId });
    res.status(401).json({ error: 'invalid_token', request_id: req.requestId });
  }
};
