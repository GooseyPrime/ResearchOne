/**
 * AI provider health check (RJ-024). Administrators only.
 *
 * Mounted at `/api/admin/providers`, so the one route here is
 * `POST /api/admin/providers/health`. It sends one very small request to each
 * provider that has a key, with its first model, and says which answered.
 *
 * POST, because every call is a real request on the server's own provider
 * accounts: it runs only when an administrator asks for it, never by itself.
 */
import { Router } from 'express';
import { requireAdmin } from '../../middleware/clerkAuth';
import { checkProviderHealth } from '../../services/openrouter/providerHealth';
import { logger } from '../../utils/logger';

const router = Router();

router.use(requireAdmin);

router.post('/health', async (req, res, next) => {
  try {
    const providers = await checkProviderHealth();
    logger.info('Admin provider health check', {
      requestedBy: req.adminAuth?.userId ?? `admin_token:${req.adminAuth?.method ?? 'unknown'}`,
      results: providers.map((entry) => ({ provider: entry.provider, model: entry.model, ok: entry.ok, status: entry.status })),
    });
    res.json({ checkedAt: new Date().toISOString(), providers });
  } catch (err) {
    next(err);
  }
});

export default router;
