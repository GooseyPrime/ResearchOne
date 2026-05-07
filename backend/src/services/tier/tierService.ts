import { query, queryOne } from '../../db/pool';
import { TIER_RULES, type TierName, isTierName } from '../../config/tierRules';
import { logger } from '../../utils/logger';

export interface UserTierRow {
  user_id: string;
  tier: TierName;
  org_id: string | null;
  current_period_reports_used: number;
  current_period_deep_reports_used: number;
  lifetime_reports_used: number;
  current_period_resets_at: string | null;
  updated_at: string;
}

const DEFAULT_TIER: TierName = 'free_demo';

/**
 * Fetches the user's tier row. Tolerates the migration not having applied yet
 * (Postgres 42703 = column does not exist) by returning a safe default.
 */
export async function getUserTier(userId: string): Promise<UserTierRow> {
  try {
    const row = await queryOne<UserTierRow>(
      `SELECT user_id, tier, org_id, current_period_reports_used,
              current_period_deep_reports_used, lifetime_reports_used,
              current_period_resets_at, updated_at
       FROM user_tiers WHERE user_id = $1`,
      [userId]
    );

    if (row) {
      if (!isTierName(row.tier)) {
        row.tier = DEFAULT_TIER;
      }
      return row;
    }
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      logger.warn('user_tiers table/column not found — migration not applied yet', { userId });
    } else {
      throw err;
    }
  }

  return {
    user_id: userId,
    tier: DEFAULT_TIER,
    org_id: null,
    current_period_reports_used: 0,
    current_period_deep_reports_used: 0,
    lifetime_reports_used: 0,
    current_period_resets_at: null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Upserts the user's tier. Called by webhooks (Clerk user.created, Stripe subscription).
 */
export async function setUserTier(userId: string, tier: TierName, orgId?: string | null): Promise<void> {
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  periodEnd.setDate(1);
  periodEnd.setHours(0, 0, 0, 0);

  try {
    await query(
      `INSERT INTO user_tiers (user_id, tier, org_id, current_period_resets_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         tier = EXCLUDED.tier,
         org_id = COALESCE(EXCLUDED.org_id, user_tiers.org_id),
         current_period_resets_at = COALESCE(user_tiers.current_period_resets_at, EXCLUDED.current_period_resets_at),
         updated_at = NOW()`,
      [userId, tier, orgId ?? null, periodEnd.toISOString()]
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      logger.warn('user_tiers table not found — migration not applied yet', { userId, tier });
      return;
    }
    throw err;
  }
}

/**
 * Ensures a user_tiers row exists for a newly created user.
 */
export async function ensureUserTierRow(userId: string): Promise<void> {
  await setUserTier(userId, DEFAULT_TIER);
}

/**
 * Increments report usage counters. Called after a research run completes.
 */
export async function incrementReportCount(userId: string, isDeep: boolean): Promise<void> {
  try {
    if (isDeep) {
      await query(
        `UPDATE user_tiers
         SET current_period_reports_used = current_period_reports_used + 1,
             current_period_deep_reports_used = current_period_deep_reports_used + 1,
             lifetime_reports_used = lifetime_reports_used + 1,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );
    } else {
      await query(
        `UPDATE user_tiers
         SET current_period_reports_used = current_period_reports_used + 1,
             lifetime_reports_used = lifetime_reports_used + 1,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );
    }
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      logger.warn('user_tiers table not found — cannot increment report count', { userId });
      return;
    }
    throw err;
  }
}

/**
 * Resets monthly counters for all users whose current_period_resets_at has passed.
 * Sets next reset to one month from the reset date, not from "now", to avoid drift.
 */
export async function resetMonthlyCounters(): Promise<number> {
  try {
    const result = await query(
      `UPDATE user_tiers
       SET current_period_reports_used = 0,
           current_period_deep_reports_used = 0,
           current_period_resets_at = current_period_resets_at + INTERVAL '1 month',
           updated_at = NOW()
       WHERE current_period_resets_at IS NOT NULL
         AND current_period_resets_at <= NOW()
       RETURNING user_id`,
      []
    );
    return result.length;
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      logger.warn('user_tiers table not found — cannot reset monthly counters');
      return 0;
    }
    throw err;
  }
}

export interface TierCheckResult {
  allowed: boolean;
  reason?: string;
  httpStatus?: number;
  upgradePath?: string;
  checkoutPath?: string;
}

/**
 * Checks whether a user can start a research run with the given objective.
 * Returns { allowed: true } or { allowed: false, reason, httpStatus }.
 */
export async function checkTierAccess(
  userId: string,
  objective?: string | null,
  walletBalanceCents?: number
): Promise<TierCheckResult> {
  const userTier = await getUserTier(userId);
  const rules = TIER_RULES[userTier.tier] ?? TIER_RULES.free_demo;

  if (objective) {
    const allowed = (rules.allowedObjectives as readonly string[]).includes(objective);
    if (!allowed) {
      return {
        allowed: false,
        reason: `Tier "${userTier.tier}" does not have access to objective "${objective}"`,
        httpStatus: 403,
        upgradePath: '/pricing',
      };
    }
  }

  if (rules.lifetimeReportCap !== null && userTier.lifetime_reports_used >= rules.lifetimeReportCap) {
    return {
      allowed: false,
      reason: `Lifetime report cap reached (${rules.lifetimeReportCap})`,
      httpStatus: 403,
      upgradePath: '/pricing',
    };
  }

  if (rules.monthlyReportCap !== null && userTier.current_period_reports_used >= rules.monthlyReportCap) {
    if (rules.walletFallbackEnabled && walletBalanceCents !== undefined && walletBalanceCents > 0) {
      return { allowed: true };
    }
    if (rules.walletFallbackEnabled) {
      return {
        allowed: false,
        reason: `Monthly report cap reached (${rules.monthlyReportCap}) and wallet balance is $0`,
        httpStatus: 402,
        checkoutPath: '/app/billing',
      };
    }
    return {
      allowed: false,
      reason: `Monthly report cap reached (${rules.monthlyReportCap})`,
      httpStatus: 403,
      upgradePath: '/pricing',
    };
  }

  return { allowed: true };
}
