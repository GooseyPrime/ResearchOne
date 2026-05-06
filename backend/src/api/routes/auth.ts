import { Router } from 'express';
import { query } from '../../db/pool';
import { requireAuth } from '../../middleware/clerkAuth';

const router = Router();

router.use(requireAuth);

// POST /api/auth/sync - idempotent local users-table sync for signed-in Clerk users.
router.post('/sync', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const email = (req.auth?.payload?.email as string | undefined) ?? null;

    await query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         updated_at = NOW()`,
      [userId, email]
    );

    res.json({ ok: true, userId });
  } catch (err) {
    next(err);
  }
});

export default router;
