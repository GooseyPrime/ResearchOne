import { Router } from 'express';

const router = Router();

router.get('/', async (_req, res) => {
  res.json({ status: 'ok', service: 'ResearchOne API', timestamp: new Date().toISOString() });
});

router.get('/ready', async (_req, res) => {
  res.json({ ready: true });
});

export default router;
