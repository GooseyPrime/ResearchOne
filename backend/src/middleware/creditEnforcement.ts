/**
 * Credit enforcement middleware for research runs.
 *
 * Computes run cost based on tier + addons, validates addon eligibility,
 * and places a wallet hold before orchestrator work begins.
 */

import type { Request, Response, NextFunction } from 'express';
import { getUserTier } from '../services/tier/tierService';
import { TIER_RULES, type TierName } from '../config/tierRules';
import { placeHold } from '../services/billing/walletReservations';
import { logger } from '../utils/logger';

export type { CreditChargeContext } from '../services/reasoning/researchOrchestrator';

const BASE_COST_CENTS: Record<string, number> = {
  GENERAL_EPISTEMIC_RESEARCH: 400,
  INVESTIGATIVE_SYNTHESIS: 600,
  NOVEL_APPLICATION_DISCOVERY: 800,
  PATENT_GAP_ANALYSIS: 1000,
  ANOMALY_CORRELATION: 800,
};

const ADDON_COSTS: Record<string, { costCents: number; requiredFeature: keyof import('../config/tierRules').TierRule }> = {
  living_reports: { costCents: 200, requiredFeature: 'livingReportsIncluded' },
  adversarial_twin: { costCents: 500, requiredFeature: 'adversarialTwinIncluded' },
  provenance_ledger: { costCents: 300, requiredFeature: 'provenanceLedgerIncluded' },
  parallel_search: { costCents: 100, requiredFeature: 'parallelSearch' },
  parallel_extract: { costCents: 100, requiredFeature: 'parallelExtract' },
  smart_citations: { costCents: 50, requiredFeature: 'smartCitations' },
};

/**
 * Computes the total cost of a research run based on the objective and addons.
 * Validates addon eligibility against the user's tier.
 */
export function computeRunCost(
  tier: TierName,
  objective: string | null | undefined,
  addons?: string[]
): { costCents: number; errors: Array<{ addon: string; status: number; message: string }> } {
  const rules = TIER_RULES[tier] ?? TIER_RULES.free_demo;
  let costCents = BASE_COST_CENTS[objective ?? 'GENERAL_EPISTEMIC_RESEARCH'] ?? 400;
  const errors: Array<{ addon: string; status: number; message: string }> = [];

  if (addons && addons.length > 0) {
    for (const addon of addons) {
      const addonSpec = ADDON_COSTS[addon];
      if (!addonSpec) {
        errors.push({ addon, status: 400, message: `Unknown addon: "${addon}"` });
        continue;
      }
      const featureValue = rules[addonSpec.requiredFeature];
      if (!featureValue) {
        errors.push({ addon, status: 403, message: `Addon "${addon}" is not available on the "${tier}" tier` });
        continue;
      }
      costCents += addonSpec.costCents;
    }
  }

  return { costCents, errors };
}

/**
 * Middleware that enforces credit availability before research runs.
 *
 * Must be placed AFTER requireTier and BEFORE the run-creation handler.
 * Sets req.creditChargeContext which is passed to the orchestrator.
 *
 * For subscription users within their monthly cap: type='subscription'
 * For wallet users (or subscription users past their cap): type='wallet', places a hold
 * For BYOK users: type='byok', no charge
 */
export function requireCreditsForRun(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const body = req.body as {
    researchObjective?: string;
    addons?: string[];
  };

  (async () => {
    try {
      const userTier = await getUserTier(userId);
      const rules = TIER_RULES[userTier.tier] ?? TIER_RULES.free_demo;

      if (userTier.tier === 'byok' || userTier.tier === 'admin' || userTier.tier === 'sovereign') {
        (req as unknown as Record<string, unknown>).creditChargeContext = {
          type: 'byok',
          costCents: 0,
        };
        next();
        return;
      }

      const { costCents, errors } = computeRunCost(
        userTier.tier,
        body.researchObjective,
        body.addons
      );

      if (errors.length > 0) {
        const firstError = errors[0];
        res.status(firstError.status).json({ error: firstError.message, errors });
        return;
      }

      const withinMonthlyCap = rules.monthlyReportCap !== null &&
        userTier.current_period_reports_used < rules.monthlyReportCap;

      if (withinMonthlyCap) {
        (req as unknown as Record<string, unknown>).creditChargeContext = {
          type: 'subscription',
          costCents: 0,
          subscriptionQuotaToDecrement: 1,
          userId,
        };
        next();
        return;
      }

      if (!rules.walletFallbackEnabled && rules.monthlyReportCap !== null) {
        res.status(403).json({
          error: 'Monthly report cap reached and wallet fallback is not enabled for this tier',
          upgrade_path: '/pricing',
        });
        return;
      }

      const runId = (req as unknown as Record<string, unknown>).pendingRunId as string | undefined;
      if (!runId) {
        res.status(500).json({ error: 'Internal error: pendingRunId not set' });
        return;
      }

      const holdResult = await placeHold(userId, runId, costCents);
      if (!holdResult.success) {
        res.status(402).json({
          error: 'Insufficient wallet balance',
          available_balance_cents: holdResult.availableBalanceCents,
          required_cents: costCents,
          checkout_path: '/app/billing',
        });
        return;
      }

      (req as unknown as Record<string, unknown>).creditChargeContext = {
        type: 'wallet',
        costCents,
        holdId: holdResult.holdId,
        userId,
      };
      next();
    } catch (err) {
      logger.error('credit_enforcement_error', { userId, error: err instanceof Error ? err.message : 'Unknown' });
      next(err);
    }
  })();
}
