import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { query, queryOne } from '../../db/pool';
import { writeAuditLog } from '../../services/ingestion/auditLogger';

const router = Router();

router.use(requireAuth);

router.get('/consent', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    try {
      const row = await queryOne<{ pipeline_b_consent: boolean }>(
        'SELECT pipeline_b_consent FROM user_ingestion_consent WHERE user_id = $1',
        [userId]
      );
      res.json({ consent: row?.pipeline_b_consent ?? true });
    } catch (err: unknown) {
      const pgCode = (err as { code?: string })?.code;
      if (pgCode === '42P01') {
        res.json({ consent: true });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.post('/consent', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const consent = Boolean(req.body?.pipeline_b_consent);

    await query(
      `INSERT INTO user_ingestion_consent (user_id, pipeline_b_consent, consent_updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         pipeline_b_consent = EXCLUDED.pipeline_b_consent,
         consent_updated_at = NOW()`,
      [userId, consent]
    );

    await writeAuditLog('system', userId, 'consent_changed', { consent });

    res.json({ consent });
  } catch (err) {
    next(err);
  }
});

export default router;
