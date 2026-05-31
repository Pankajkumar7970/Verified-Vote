import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.middleware.js';
import { ForbiddenError } from '../../utils/errors.js';

const router = Router();

router.get('/', requireAdmin, async (req: any, res, next) => {
  if (req.admin.role !== 'super_admin') {
    return next(new ForbiddenError('forbidden'));
  }
  try {
    const result = await db.query('SELECT * FROM cron_jobs ORDER BY job_name ASC');
    res.json({ jobs: result.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
