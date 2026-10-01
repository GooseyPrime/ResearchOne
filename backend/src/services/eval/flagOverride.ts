import { isAllowlistedAdminUserId } from '../auth/adminAllowlist';

export interface HarnessFlagOverride {
  flags: Record<string, boolean>;
}

/** Non-admins get nothing, even if the request carries an override. */
export function acceptedFlagOverride(
  userId: string | null | undefined,
  body: unknown
): Record<string, boolean> | null {
  if (!isAllowlistedAdminUserId(userId)) return null;
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { flagOverrides?: unknown }).flagOverrides;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') flags[key] = value;
  }
  return Object.keys(flags).length > 0 ? flags : null;
}
