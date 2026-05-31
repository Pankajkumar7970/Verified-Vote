import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.middleware.js';
import { MinIOService } from '../../services/minio.service.js';
import crypto from 'crypto';
import { config } from '../../utils/config.js';
import { ValidationError, AuthError, NotFoundError } from '../../utils/errors.js';

const router = Router();

const UUID_KEY_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Sniffing function removed as we now rely on stat metadata from the stream

/** Serves stored documents when MinIO is not configured (mock mode). */
router.get('/doc-preview', requireAdmin, async (req: any, res, next) => {
  const key = typeof req.query.key === 'string' ? req.query.key.trim() : '';
  const expires = typeof req.query.expires === 'string' ? parseInt(req.query.expires, 10) : 0;
  const sig = typeof req.query.sig === 'string' ? req.query.sig : '';

  if (!key || !UUID_KEY_RE.test(key) || !expires || !sig) {
    return next(new ValidationError('invalid_key_or_signature'));
  }

  if (Date.now() > expires) {
    return next(new AuthError('expired_link'));
  }

  const hmac = crypto.createHmac('sha256', config.adminJwtSecret);
  hmac.update(`${key}:${expires}`);
  const expectedSig = hmac.digest('hex');

  if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return next(new AuthError('invalid_signature'));
  }

  try {
    const { stream, mimeType } = await MinIOService.getDocumentStream(key);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    stream.pipe(res);
  } catch (err) {
    next(new NotFoundError('not_found'));
  }
});

export default router;
