/**
 * Credit enforcement middleware for research runs.
 *
 * Computes run cost based on tier + addons, validates addon eligibility,
 * and places a wallet hold before orchestrator work begins.
 */

import type { Request, Response, NextFunction } from 'express';
import { getUserTier } from '../services/tier/tierService';
import { TIER_RULES, type TierName, type TierRule } from '../config/tierRules';
import { placeHold } from '../services/billing/walletReservations';
import { logger } from '../utils/logger';
import type { CreditChargeContext } from '../services/reasoning/researchOrchestrator';

export type { CreditChargeContext };

const BASE_COST_CENTS: Record<string, number> = {
  GENERAL_EPISTEMIC_RESEARCH: 400,
  INVESTIGATIVE_SYNTHESIS: 600,
  NOVEL_APPLICATION_DISCOVERY: 800,
  PATENT_GAP_ANALYSIS: 1000,
  ANOMALY_CORRELATION: 800,
};

type AddonCostSpec = {
  costCents: number;
  /** Tier must have this flag true to purchase the add-on (403 otherwise). */
  eligibilityFeature: keyof TierRule;
  /** When set, surcharge is waived if this tier *Included flag is true. */
  waiveWhenIncluded?: keyof TierRule;
};

const ADDON_COSTS: Record<string, AddonCostSpec> = {
  living_reports: {
    costCents: 200,
    eligibilityFeature: 'livingReportsIncluded',
    waiveWhenIncluded: 'livingReportsIncluded',
  },
  adversarial_twin: {
    costCents: 500,
    /** Purchasable per-run add-on on Pro+ (wallet surcharge); not tied to provenance ledger tier flag. */
    eligibilityFeature: 'deepResearchAccess',
    waiveWhenIncluded: 'adversarialTwinIncluded',
  },
  provenance_ledger: {
    costCents: 300,
    eligibilityFeature: 'provenanceLedgerIncluded',
    waiveWhenIncluded: 'provenanceLedgerIncluded',
  },
  parallel_search: {
    costCents: 100,
    eligibilityFeature: 'parallelSearch',
  },
  parallel_extract: {
    costCents: 100,
    eligibilityFeature: 'parallelExtract',
  },
  smart_citations: {
    costCents: 50,
    eligibilityFeature: 'smartCitations',
  },
};

export type ComputeRunCostResult = {
  /** Base report cost (objective tier). */
  baseCostCents: number;
  /** Wallet surcharges for add-ons not included in the tier. */
  addonSurchargeCents: number;
  /** base + surcharges — amount to place on wallet hold when not on subscription quota. */
  costCents: number;
  errors: Array<{ addon: string; status: number; message: string }>;
};

/**
 * Computes run pricing: base objective cost plus per-addon wallet surcharges.
 * Eligibility uses tier capability flags; *Included* flags waive surcharges.
 *
 * Subscription-quota runs still charge addonSurchargeCents via a separate wallet
 * hold while the base report is covered by monthly cap (see research route).
 */
export function computeRunCost(
  tier: TierName,
  objective: string | null | undefined,
  addons?: string[]
): ComputeRunCostResult {
  const rules = TIER_RULES[tier] ?? TIER_RULES.free_demo;
  const baseCostCents = BASE_COST_CENTS[objective ?? 'GENERAL_EPISTEMIC_RESEARCH'] ?? 400;
  let addonSurchargeCents = 0;
  const errors: Array<{ addon: string; status: number; message: string }> = [];

  if (addons && addons.length > 0) {
    for (const addon of addons) {
      const addonSpec = ADDON_COSTS[addon];
      if (!addonSpec) {
        errors.push({ addon, status: 400, message: `Unknown addon: "${addon}"` });
        continue;
      }
      const eligible = Boolean(rules[addonSpec.eligibilityFeature]);
      if (!eligible) {
        errors.push({
          addon,
          status: 403,
          message: `Addon "${addon}" is not available on the "${tier}" tier`,
        });
        continue;
      }
      const waived =
        addonSpec.waiveWhenIncluded != null && Boolean(rules[addonSpec.waiveWhenIncluded]);
      if (!waived) {
        addonSurchargeCents += addonSpec.costCents;
      }
    }
  }

  return {
    baseCostCents,
    addonSurchargeCents,
    costCents: baseCostCents + addonSurchargeCents,
    errors,
  };
}

export type CreditChargeBuildResult =
  | { ok: true; context: CreditChargeContext }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Places wallet holds and returns orchestrator credit context for POST /api/research.
 * Subscription quota covers base report cost; addon surcharges still wallet-held when > 0.
 */
export async function buildCreditChargeContextForRun(params: {
  userId: string;
  runId: string;
  entitlementTier: TierName;
  researchObjective: string | null | undefined;
  addons: string[];
  currentPeriodReportsUsed: number;
}): Promise<CreditChargeBuildResult> {
  const { userId, runId, entitlementTier, researchObjective, addons, currentPeriodReportsUsed } =
    params;
  const rules = TIER_RULES[entitlementTier] ?? TIER_RULES.free_demo;

  if (entitlementTier === 'byok' || entitlementTier === 'admin' || entitlementTier === 'sovereign') {
    return {
      ok: true,
      context: { type: 'byok', costCents: 0, addonSurchargeCents: 0, userId },
    };
  }

  const { costCents, addonSurchargeCents, errors } = computeRunCost(
    entitlementTier,
    researchObjective,
    addons
  );

  if (errors.length > 0) {
    const first = errors[0];
    return { ok: false, status: first.status, body: { error: first.message, errors } };
  }

  const withinMonthlyCap =
    rules.monthlyReportCap !== null && currentPeriodReportsUsed < rules.monthlyReportCap;

  const isLifetimeCapOnly =
    rules.lifetimeReportCap !== null && rules.monthlyReportCap === null && !rules.walletFallbackEnabled;

  if (withinMonthlyCap) {
    if (addonSurchargeCents > 0) {
      const holdResult = await placeHold(userId, runId, addonSurchargeCents);
      if (!holdResult.success) {
        return {
          ok: false,
          status: 402,
          body: {
            error: 'Insufficient wallet balance for run add-ons',
            available_balance_cents: holdResult.availableBalanceCents,
            required_cents: addonSurchargeCents,
            checkout_path: '/app/billing',
          },
        };
      }
      return {
        ok: true,
        context: {
          type: 'subscription',
          costCents: 0,
          addonSurchargeCents,
          holdId: holdResult.holdId,
          subscriptionQuotaToDecrement: 1,
          userId,
        },
      };
    }
    return {
      ok: true,
      context: {
        type: 'subscription',
        costCents: 0,
        addonSurchargeCents: 0,
        subscriptionQuotaToDecrement: 1,
        userId,
      },
    };
  }

  if (isLifetimeCapOnly) {
    return {
      ok: true,
      context: {
        type: 'subscription',
        costCents: 0,
        addonSurchargeCents: 0,
        subscriptionQuotaToDecrement: 1,
        userId,
      },
    };
  }

  if (rules.walletFallbackEnabled || rules.monthlyReportCap === null) {
    const holdResult = await placeHold(userId, runId, costCents);
    if (!holdResult.success) {
      return {
        ok: false,
        status: 402,
        body: {
          error: 'Insufficient wallet balance',
          available_balance_cents: holdResult.availableBalanceCents,
          required_cents: costCents,
          checkout_path: '/app/billing',
        },
      };
    }
    return {
      ok: true,
      context: {
        type: 'wallet',
        costCents,
        addonSurchargeCents,
        holdId: holdResult.holdId,
        userId,
      },
    };
  }

  return {
    ok: true,
    context: { type: 'none', costCents: 0, addonSurchargeCents: 0, userId },
  };
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
          addonSurchargeCents: 0,
        };
        next();
        return;
      }

      const { costCents, addonSurchargeCents, errors } = computeRunCost(
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
        if (addonSurchargeCents > 0) {
          const runId = (req as unknown as Record<string, unknown>).pendingRunId as string | undefined;
          if (!runId) {
            res.status(500).json({ error: 'Internal error: pendingRunId not set' });
            return;
          }
          const holdResult = await placeHold(userId, runId, addonSurchargeCents);
          if (!holdResult.success) {
            res.status(402).json({
              error: 'Insufficient wallet balance for run add-ons',
              available_balance_cents: holdResult.availableBalanceCents,
              required_cents: addonSurchargeCents,
              checkout_path: '/app/billing',
            });
            return;
          }
          (req as unknown as Record<string, unknown>).creditChargeContext = {
            type: 'subscription',
            costCents: 0,
            addonSurchargeCents,
            holdId: holdResult.holdId,
            subscriptionQuotaToDecrement: 1,
            userId,
          };
        } else {
          (req as unknown as Record<string, unknown>).creditChargeContext = {
            type: 'subscription',
            costCents: 0,
            addonSurchargeCents: 0,
            subscriptionQuotaToDecrement: 1,
            userId,
          };
        }
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
        addonSurchargeCents,
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
