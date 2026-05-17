import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.middleware.js';
import sanitizeHtml from 'sanitize-html';
import { logger } from '../../utils/logger.js';

const router = Router();

// Only Super Admins can manage parties
const requireSuperAdmin = (req: any, res: any, next: any) => {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
};

router.get('/', requireAdmin, async (req, res) => {
  try {
    const parties = await db.query('SELECT * FROM parties WHERE is_active = true ORDER BY name ASC');
    res.json({ parties: parties.rows });
  } catch (err: any) {
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/', requireAdmin, requireSuperAdmin, async (req: any, res) => {
  const { name, abbreviation } = req.body;
  const safeName = sanitizeHtml(name, { allowedTags: [], allowedAttributes: {} });
  const safeAbbr = abbreviation ? sanitizeHtml(abbreviation, { allowedTags: [], allowedAttributes: {} }) : null;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO parties (name, abbreviation, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [safeName, safeAbbr, req.admin.id]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
      ['admin', req.admin.id, 'party_created', 'party', result.rows[0].id]
    );
    await client.query('COMMIT');
    client.release();

    res.json({ party: result.rows[0] });
  } catch (err: any) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    logger.error({ request_id: req.requestId, action: 'party_create_failed', error: err.message });
     // Handle unique violation
    if (err.code === '23505') {
       return res.status(409).json({ error: 'party_exists' });
    }
    res.status(500).json({ error: 'internal_error' });
  }
});

router.delete('/:id', requireAdmin, requireSuperAdmin, async (req: any, res) => {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        
        // Soft delete
        await client.query('UPDATE parties SET is_active = false, updated_at = now() WHERE id = $1', [req.params.id]);

        await client.query(
            `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4, $5)`,
            ['admin', req.admin.id, 'party_deactivated', 'party', req.params.id]
          );

        await client.query('COMMIT');
        client.release();
        res.json({ success: true });
    } catch (err: any) {
        if (client) {
            await client.query('ROLLBACK');
            client.release();
        }
        res.status(500).json({ error: 'internal_error' });
    }
});

export default router;
