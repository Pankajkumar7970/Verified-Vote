import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.middleware.js';
import { ForbiddenError } from '../../utils/errors.js';

const router = Router();

router.get('/export', requireAdmin, async (req: any, res, next) => {
  if (req.admin.role !== 'super_admin') {
    return next(new ForbiddenError('forbidden'));
  }
  try {
    const logsRes = await db.query(
      `SELECT created_at, action, actor_type, actor_id, entity_type, entity_id, ip_address, metadata, request_id_header
       FROM audit_logs ORDER BY created_at DESC LIMIT 5000`
    );
    const header = 'timestamp,action,actor_type,actor_id,entity_type,entity_id,ip,metadata,request_id\n';
    const rows = logsRes.rows
      .map((l: Record<string, unknown>) => {
        const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        return [
          esc(l.created_at),
          esc(l.action),
          esc(l.actor_type),
          esc(l.actor_id),
          esc(l.entity_type),
          esc(l.entity_id),
          esc(l.ip_address),
          esc(typeof l.metadata === 'object' ? JSON.stringify(l.metadata) : l.metadata),
          esc(l.request_id_header),
        ].join(',');
      })
      .join('\n');
    const body = header + rows;
    const checksum = crypto.createHash('sha256').update(body).digest('hex');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${checksum.slice(0, 8)}.csv"`);
    res.setHeader('X-Audit-Checksum', checksum);
    res.send(body);
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAdmin, async (req: any, res, next) => {
  if (req.admin.role !== 'super_admin') {
     return next(new ForbiddenError('forbidden'));
  }
  
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    const { actor_type, action, entity_type, ip_address, start_date, end_date, search } = req.query;

    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (actor_type) {
      whereClauses.push(`actor_type = $${paramIndex++}`);
      params.push(actor_type);
    }
    if (action) {
      whereClauses.push(`action = $${paramIndex++}`);
      params.push(action);
    }
    if (entity_type) {
      whereClauses.push(`entity_type = $${paramIndex++}`);
      params.push(entity_type);
    }
    if (ip_address) {
      whereClauses.push(`ip_address = $${paramIndex++}`);
      params.push(ip_address);
    }
    if (start_date) {
      whereClauses.push(`created_at >= $${paramIndex++}`);
      params.push(start_date);
    }
    if (end_date) {
      whereClauses.push(`created_at <= $${paramIndex++}`);
      params.push(end_date);
    }
    if (search) {
      whereClauses.push(`(
        actor_id::text LIKE $${paramIndex} OR 
        entity_id::text LIKE $${paramIndex} OR 
        request_id_header LIKE $${paramIndex} OR 
        action LIKE $${paramIndex}
      )`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs ${whereClause}`,
      params
    );
    const total = countResult.rows[0].total;

    const listParams = [...params];
    const limitIndex = paramIndex++;
    const offsetIndex = paramIndex++;
    listParams.push(limit, offset);

    const logsRes = await db.query(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      listParams
    );

    res.json({
      logs: logsRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
