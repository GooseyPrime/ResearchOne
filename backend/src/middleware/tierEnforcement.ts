import type { Request, Response, NextFunction } from 'express';
import { checkTierAccess } from '../services/tier/tierService';
import { getWalletSummary } from '../services/billing/walletService';
import { TIER_RULES } from '../config/tierRules';
import { getUserTier } from '../services/tier/tierService';
import { logger } from '../utils/logger';
import { getUserSubscription } from '../services/billing/subscriptionService';
import { resolveEffectiveEntitlementTier } from '../services/billing/entitlementTier';
import { tierHasCorpusAccess, tierNameFromUnknown } from '../config/tierRules';

interface TierCheckOptions {
  objective?: string | null;
  requiresExportFormat?: string | null;
}

/**
 * Middleware factory that enforces tier-based access control.
 *
 * Usage:
 *   router.post('/', requireTier((req) => ({ objective: req.body.researchObjective })), handler);
 *   router.get('/export', requireTier((req) => ({ requiresExportFormat: req.query.format })), handler);
 */
export function requireTier(
  getOptions: (req: Request) => TierCheckOptions
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const options = getOptions(req);

      if (options.requiresExportFormat && typeof options.requiresExportFormat === 'string') {
        const format = options.requiresExportFormat;
        const [userTier, subscription] = await Promise.all([getUserTier(userId), getUserSubscription(userId)]);
        const entitlementTier = resolveEffectiveEntitlementTier(subscription, userTier.tier);
        const rules = TIER_RULES[entitlementTier] ?? TIER_RULES.free_demo;

        if (!(rules.exportFormats as readonly string[]).includes(format)) {
          res.status(403).json({
            error: `Export format "${format}" is not available on the "${entitlementTier}" tier`,
            upgrade_path: '/pricing',
          });
          return;
        }
      }

      if (options.objective !== undefined) {
        let walletBalanceCents = 0;
        try {
          const wallet = await getWalletSummary(userId);
          walletBalanceCents = wallet.balanceCents;
        } catch {
          // wallet service may not be available yet
        }

        const subscription = await getUserSubscription(userId);
        const check = await checkTierAccess(userId, options.objective, walletBalanceCents, false, subscription);
        if (!check.allowed) {
          const status = check.httpStatus ?? 403;
          const body: Record<string, unknown> = { error: check.reason };
          if (check.upgradePath) body.upgrade_path = check.upgradePath;
          if (check.checkoutPath) body.checkout_path = check.checkoutPath;
          res.status(status).json(body);
          return;
        }
      }

      next();
    } catch (err) {
      logger.error('tier_enforcement_error', { error: err instanceof Error ? err.message : 'Unknown' });
      next(err);
    }
  };
}

/**
 * Requires a paid tier with `corpusAccess` (private Ingest workspace).
 * Research supplemental URL ingest is intentionally not gated here.
 */
export function requirePrivateCorpus(): (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const [userTier, subscription] = await Promise.all([getUserTier(userId), getUserSubscription(userId)]);
      const entitlementTier = tierNameFromUnknown(
        resolveEffectiveEntitlementTier(subscription, userTier.tier),
        'free_demo'
      );

      if (!tierHasCorpusAccess(entitlementTier)) {
        res.status(403).json({
          error:
            'Private corpus ingest requires a Pro, Team, BYOK, or Sovereign subscription. Upgrade to maintain a separate corpus from the shared ResearchOne library.',
          upgrade_path: '/pricing',
        });
        return;
      }

      next();
    } catch (err) {
      logger.error('private_corpus_enforcement_error', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
      next(err);
    }
  };
}
