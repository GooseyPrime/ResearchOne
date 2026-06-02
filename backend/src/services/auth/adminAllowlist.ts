import { config } from '../../config';

/** Clerk user id in ADMIN_USER_IDS (same allowlist as /auth/me and requireAdmin). */
export function isAllowlistedAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return config.admin.userIds.includes(userId);
}
