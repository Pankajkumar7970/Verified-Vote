import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { config } from '../utils/config.js';

export async function verifyTurnstile(req: Request, res: Response, next: NextFunction) {
  if (!config.turnstileSecret) return next();

  const token = req.body.turnstile_token || req.headers['cf-turnstile-response'];
  if (!token) {
    return res.status(400).json({ error: 'turnstile_required', request_id: req.requestId });
  }

  try {
    const params = new URLSearchParams();
    params.append('secret', config.turnstileSecret);
    params.append('response', String(token));
    const result = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', params);
    if (!result.data?.success) {
      return res.status(403).json({ error: 'turnstile_failed', request_id: req.requestId });
    }
    next();
  } catch {
    return res.status(503).json({ error: 'turnstile_unavailable', request_id: req.requestId });
  }
}
