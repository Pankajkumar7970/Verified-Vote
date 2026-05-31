import { Request, Response, NextFunction } from 'express';

interface IpRecord {
  attempts: number;
  blockedUntil: Date | null;
}

const ipAttempts = new Map<string, IpRecord>();

const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function ipBlockerMiddleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const record = ipAttempts.get(ip);

  if (record && record.blockedUntil && record.blockedUntil > new Date()) {
    return res.status(429).json({
      error: 'ip_blocked',
      message: 'Too many failed attempts from this IP. Please try again in 15 minutes.',
    });
  }

  next();
}

export function recordFailedAttempt(ip: string) {
  const record = ipAttempts.get(ip) || { attempts: 0, blockedUntil: null };
  record.attempts += 1;
  if (record.attempts >= MAX_ATTEMPTS) {
    record.blockedUntil = new Date(Date.now() + BLOCK_DURATION_MS);
  }
  ipAttempts.set(ip, record);
}

export function clearFailedAttempts(ip: string) {
  ipAttempts.delete(ip);
}
