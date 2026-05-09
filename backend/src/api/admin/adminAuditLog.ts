import { adminQuery } from '../../db/pool';
import { logger } from '../../utils/logger';

export async function writeAdminAction(
  adminUserId: string,
  targetUserId: string | null,
  action: string,
  reason: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await adminQuery(
      `INSERT INTO admin_actions_log (admin_user_id, target_user_id, action, reason, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [adminUserId, targetUserId, action, reason, JSON.stringify(metadata)]
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      logger.warn('admin_actions_log table not found — migration not applied');
      return;
    }
    throw err;
  }
}
