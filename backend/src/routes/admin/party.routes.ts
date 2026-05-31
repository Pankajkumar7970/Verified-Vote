import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.middleware.js';
import sanitizeHtml from 'sanitize-html';
import { logger } from '../../utils/logger.js';
import { ForbiddenError, ConflictError } from '../../utils/errors.js';
import { validate } from '../../middleware/validate.middleware.js';
import { z } from 'zod';

const createPartySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'name_required').max(100, 'name_too_long'),
    abbreviation: z.string().max(20, 'abbreviation_too_long').optional(),
  }),
});

const deletePartySchema = z.object({
  params: z.object({
    id: z.string().uuid("invalid_party_id"),
  }),
});

const router = Router();

const requireSuperAdmin = (req: any, res: any, next: any) => {
  if (req.admin.role !== 'super_admin') {
    return next(new ForbiddenError('forbidden'));
  }
  next();
};

router.get('/', requireAdmin, async (req: any, res, next) => {
  try {
    const parties = await db.query('SELECT * FROM parties WHERE is_active = true ORDER BY name ASC');
    res.json({ parties: parties.rows });
  } catch (err: any) {
    next(err);
  }
});

router.post('/', requireAdmin, requireSuperAdmin, validate(createPartySchema), async (req: any, res, next) => {
  const { name, abbreviation } = req.body;
  const safeName = sanitizeHtml(name, { allowedTags: [], allowedAttributes: {} });
  const safeAbbr = abbreviation ? sanitizeHtml(abbreviation, { allowedTags: [], allowedAttributes: {} }) : null;

  try {
    const party = await db.withTransaction(async (client) => {
      try {
        const result = await client.query(
          `INSERT INTO parties (name, abbreviation, created_by) VALUES ($1, $2, $3) RETURNING *`,
          [safeName, safeAbbr, req.admin.id]
        );

        await client.query(
          `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
          ['admin', req.admin.id, 'party_created', 'party', result.rows[0].id]
        );

        return result.rows[0];
      } catch (err: any) {
        if (err.code === '23505') {
          throw new ConflictError('party_exists');
        }
        throw err;
      }
    });

    res.json({ party });
  } catch (err: any) {
    logger.error({ request_id: req.requestId, action: 'party_create_failed', error: err.message });
    next(err);
  }
});

router.delete('/:id', requireAdmin, requireSuperAdmin, validate(deletePartySchema), async (req: any, res, next) => {
    try {
        await db.withTransaction(async (client) => {
            const usage = await client.query(
              'SELECT count(*)::int as c FROM candidates WHERE party_id = $1',
              [req.params.id]
            );
            if (usage.rows[0].c > 0) {
              throw new ConflictError('party_has_candidates');
            }

            await client.query('DELETE FROM parties WHERE id = $1', [req.params.id]);

            await client.query(
                `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
                ['admin', req.admin.id, 'party_deactivated', 'party', req.params.id]
              );
        });
        res.json({ success: true });
    } catch (err: any) {
        next(err);
    }
});

export default router;
