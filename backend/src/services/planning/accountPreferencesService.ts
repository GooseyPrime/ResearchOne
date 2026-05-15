/**
 * Wave 5.4 — account_preferences reads/writes (RLS via application_role).
 */
import { query, queryOne } from '../../db/pool';

/** Matches Wave 5.4 UI: auto-confirm cannot be enabled until this many clean confirms. */
export const PLAN_AUTO_CONFIRM_MIN_STREAK_TO_ENABLE = 5;

export interface AccountPlanPreferences {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;
  confirmedStreak: number;
}

export async function getAccountPlanPreferences(userId: string): Promise<AccountPlanPreferences> {
  try {
    const row = await queryOne<{
      auto_confirm_enabled: boolean;
      auto_confirm_threshold: string;
      confirmed_streak: number;
    }>(
      `SELECT auto_confirm_enabled, auto_confirm_threshold::text, confirmed_streak
         FROM account_preferences
        WHERE user_id = $1`,
      [userId]
    );
    if (!row) {
      return {
        autoConfirmEnabled: false,
        autoConfirmThreshold: 0.85,
        confirmedStreak: 0,
      };
    }
    return {
      autoConfirmEnabled: row.auto_confirm_enabled,
      autoConfirmThreshold: Number(row.auto_confirm_threshold) || 0.85,
      confirmedStreak: row.confirmed_streak ?? 0,
    };
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') {
      return { autoConfirmEnabled: false, autoConfirmThreshold: 0.85, confirmedStreak: 0 };
    }
    throw e;
  }
}

export async function upsertAccountPlanPreferences(
  userId: string,
  patch: { autoConfirmEnabled?: boolean; autoConfirmThreshold?: number }
): Promise<AccountPlanPreferences> {
  const cur = await getAccountPlanPreferences(userId);
  const enabled = patch.autoConfirmEnabled ?? cur.autoConfirmEnabled;
  const threshold =
    typeof patch.autoConfirmThreshold === 'number' && Number.isFinite(patch.autoConfirmThreshold)
      ? Math.min(0.95, Math.max(0.7, patch.autoConfirmThreshold))
      : cur.autoConfirmThreshold;

  if (enabled && cur.confirmedStreak < PLAN_AUTO_CONFIRM_MIN_STREAK_TO_ENABLE) {
    throw Object.assign(
      new Error(
        `Auto-confirm cannot be enabled until ${PLAN_AUTO_CONFIRM_MIN_STREAK_TO_ENABLE} consecutive clean plan confirmations.`,
      ),
      { statusCode: 400 }
    );
  }

  await query(
    `INSERT INTO account_preferences (user_id, auto_confirm_enabled, auto_confirm_threshold, confirmed_streak)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       auto_confirm_enabled = EXCLUDED.auto_confirm_enabled,
       auto_confirm_threshold = EXCLUDED.auto_confirm_threshold,
       updated_at = NOW()`,
    [userId, enabled, threshold, cur.confirmedStreak]
  );
  return getAccountPlanPreferences(userId);
}

export async function resetPlanConfirmationStreak(userId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO account_preferences (user_id, confirmed_streak)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO UPDATE SET confirmed_streak = 0, updated_at = NOW()`,
      [userId]
    );
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return;
    throw e;
  }
}

/** Increment streak when user confirms a plan that had zero refinements (Wave 5.4). */
export async function bumpPlanConfirmationStreakIfCleanConfirm(userId: string): Promise<void> {
  try {
    await query(
      `INSERT INTO account_preferences (user_id, confirmed_streak)
       VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET
         confirmed_streak = account_preferences.confirmed_streak + 1,
         updated_at = NOW()`,
      [userId]
    );
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return;
    throw e;
  }
}

/** Fraction (0–1) of confirmed plans in the last 30 days whose intent_confidence met `threshold`. */
export async function estimateAutoConfirmHitRate(
  userId: string,
  threshold: number
): Promise<{ sampleSize: number; hitRate: number | null }> {
  try {
    const row = await queryOne<{ n: string; hits: string }>(
      `SELECT COUNT(*)::text AS n,
              COUNT(*) FILTER (
                WHERE rp.intent_confidence IS NOT NULL AND rp.intent_confidence >= $2::numeric
              )::text AS hits
         FROM research_plans rp
         JOIN research_runs rr ON rr.id = rp.run_id
        WHERE rr.user_id = $1
          AND rp.status = 'confirmed'
          AND rp.confirmed_at IS NOT NULL
          AND rp.confirmed_at > NOW() - INTERVAL '30 days'`,
      [userId, threshold]
    );
    const n = row?.n ? Number(row.n) : 0;
    const hits = row?.hits ? Number(row.hits) : 0;
    if (!n) return { sampleSize: 0, hitRate: null };
    return { sampleSize: n, hitRate: hits / n };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '42P01' || code === '42703') {
      return { sampleSize: 0, hitRate: null };
    }
    throw e;
  }
}
