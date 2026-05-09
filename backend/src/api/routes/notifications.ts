import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import {
  listUserNotifications,
  markNotificationRead,
} from '../../services/notifications/userNotifications';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const notifications = await listUserNotifications(userId);
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const id = req.params.id;
    const ok = await markNotificationRead(userId, id);
    res.json({ ok });
  } catch (err) {
    next(err);
  }
});

export default router;
