import { Router } from 'express';
import { db } from '../../db/index.js';
import { requireAdmin } from '../../middleware/auth.middleware.js';

const router = Router();

router.get('/', requireAdmin, async (req: any, res) => {
  if (req.admin.role !== 'super_admin') {
     return res.status(403).json({ error: 'forbidden' });
  }
  
  try {
    const logsRes = await db.query(
      `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500`
    );
    res.json({ logs: logsRes.rows });
  } catch (err) {
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
