import { query } from '../../db/pool';
import { logger } from '../../utils/logger';
import { ensureUserTierRow } from '../tier/tierService';

/**
 * Ensures local `users` and `user_tiers` rows exist before Stripe checkout or entitlement writes.
 */
export async function ensureUserAndTierRow(userId: string, email?: string | null): Promise<void> {
  try {
    await query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         updated_at = NOW()`,
      [userId, email ?? null]
    );
    await ensureUserTierRow(userId);
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      logger.warn('ensureUserAndTierRow skipped — schema not ready', { userId });
      return;
    }
    throw err;
  }
}
