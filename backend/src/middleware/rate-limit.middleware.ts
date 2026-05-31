import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

export const requestSubmitLimiter = isTest ? (req: any, res: any, next: any) => next() : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

/** Limit ref-code probing on voting link endpoints. */
export const sessionRefLimiter = isTest ? (req: any, res: any, next: any) => next() : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', request_id: undefined },
});

export const otpVerifyLimiter = isTest ? (req: any, res: any, next: any) => next() : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', request_id: undefined },
});

export const draftSaveLimiter = isTest ? (req: any, res: any, next: any) => next() : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', request_id: undefined },
});

/** Rate limit admin API endpoints. */
export const adminLimiter = isTest ? (req: any, res: any, next: any) => next() : rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', request_id: undefined },
});

