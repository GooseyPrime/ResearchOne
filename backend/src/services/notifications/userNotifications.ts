/**
 * In-app user notifications (WO-F: payment_failed and other billing events).
 *
 * Backed by `user_notifications` (migration 027). All writes are tolerant of
 * the migration not having applied yet (Postgres 42P01 / 42703) per
 * .cursor/rules/13-deploy-skew-and-schema.mdc — payment failure flagging
 * still happens via `stripe_webhook_events.payload.needs_notification` for
 * audit purposes; the user-facing notification is best-effort.
 */
import { adminQuery } from '../../db/pool';
import { logger } from '../../utils/logger';

export type UserNotificationKind = 'payment_failed' | 'subscription_canceled' | 'system';

export interface UserNotificationRow {
  id: string;
  user_id: string;
  kind: UserNotificationKind;
  title: string;
  body: string | null;
  cta_path: string | null;
  read_at: string | null;
  created_at: string;
}

function isMissingObjectError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '42P01' || code === '42703';
}

/**
 * Insert a notification for a user. Best-effort: if the table doesn't exist
 * yet (deploy skew), warns and returns null instead of throwing.
 */
export async function createUserNotification(args: {
  userId: string;
  kind: UserNotificationKind;
  title: string;
  body?: string | null;
  ctaPath?: string | null;
}): Promise<{ id: string } | null> {
  try {
    const rows = await adminQuery<{ id: string }>(
      `INSERT INTO user_notifications (user_id, kind, title, body, cta_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [args.userId, args.kind, args.title, args.body ?? null, args.ctaPath ?? null]
    );
    return rows[0] ?? null;
  } catch (err) {
    if (isMissingObjectError(err)) {
      logger.warn('user_notifications_table_missing', {
        userId: args.userId,
        kind: args.kind,
      });
      return null;
    }
    throw err;
  }
}

/**
 * List a user's recent notifications (last 30 days, capped at 50).
 * Returns empty array if the table is missing (deploy skew).
 */
export async function listUserNotifications(userId: string): Promise<UserNotificationRow[]> {
  try {
    return await adminQuery<UserNotificationRow>(
      `SELECT id, user_id, kind, title, body, cta_path, read_at, created_at
       FROM user_notifications
       WHERE user_id = $1
         AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );
  } catch (err) {
    if (isMissingObjectError(err)) return [];
    throw err;
  }
}

export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  try {
    const rows = await adminQuery<{ id: string }>(
      `UPDATE user_notifications SET read_at = NOW()
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL
       RETURNING id`,
      [id, userId]
    );
    return rows.length > 0;
  } catch (err) {
    if (isMissingObjectError(err)) return false;
    throw err;
  }
}

/**
 * Resolve a Stripe subscription_id to a user_id via user_subscriptions.
 * Returns null if no row matches.
 */
export async function resolveUserIdFromStripeSubscription(stripeSubscriptionId: string): Promise<string | null> {
  try {
    const rows = await adminQuery<{ user_id: string }>(
      `SELECT user_id FROM user_subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
      [stripeSubscriptionId]
    );
    return rows[0]?.user_id ?? null;
  } catch {
    return null;
  }
}
