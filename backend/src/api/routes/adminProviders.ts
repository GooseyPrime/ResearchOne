/**
 * AI provider health check (RJ-024, RJ-025). Administrators only.
 *
 * Mounted at `/api/admin/providers`, so the one route here is
 * `POST /api/admin/providers/health`. It sends one very small request to each
 * provider that has a key and serves a role's model, and says which answered.
 * It also returns, for every role, how many providers serve the model the
 * role chose (`roles`), and the providers that have a key but serve no role's
 * model (`providersServingNoRoleModel`).
 *
 * POST, because every call is a real request on the server's own provider
 * accounts: it runs only when an administrator asks for it, never by itself.
 */
import { Router } from 'express';
import { requireAdmin } from '../../middleware/clerkAuth';
import {
  checkProviderHealth,
  providersServingNoRoleModel,
  roleProviderCoverage,
} from '../../services/openrouter/providerHealth';
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
    const roles = roleProviderCoverage();
    res.json({
      checkedAt: new Date().toISOString(),
      providers,
      providersServingNoRoleModel: providersServingNoRoleModel(),
      roles,
      singleProviderRoles: roles.filter((entry) => entry.singleProvider).map((entry) => entry.role),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
