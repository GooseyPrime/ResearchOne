import { query } from '../../db/pool';
import { isAllowlistedAdminUserId } from '../auth/adminAllowlist';
import { harnessFlagDefaults, isHarnessFlagName, type HarnessFlagName } from './harnessFlags';

export class UnknownFlagError extends Error {
  readonly unknown: string[];

  constructor(unknown: string[]) {
    super(`Unknown flag: ${unknown.join(', ')}`);
    this.unknown = unknown;
  }
}

/** Non-admins get nothing. Admins must name a known flag. */
export function acceptedFlagOverride(
  userId: string | null | undefined,
  body: unknown
): Record<string, boolean> | null {
  if (!isAllowlistedAdminUserId(userId)) return null;
  const raw = readOverride(body);
  if (!raw) return null;
  const unknown = Object.keys(raw).filter((key) => !isHarnessFlagName(key));
  if (unknown.length > 0) throw new UnknownFlagError(unknown);
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') flags[key] = value;
  }
  return Object.keys(flags).length > 0 ? flags : null;
}

export function readOverride(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { flagOverrides?: unknown }).flagOverrides;
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Config default, then the override recorded for this run. */
export function flagForRun(name: string, recorded: Record<string, boolean> | null): boolean {
  if (!isHarnessFlagName(name)) throw new UnknownFlagError([name]);
  const defaults = harnessFlagDefaults();
  if (recorded && typeof recorded[name] === 'boolean') return recorded[name];
  return defaults[name as HarnessFlagName];
}

export async function flagValueForRun(runId: string, name: string): Promise<boolean> {
  const rows = await query<{ flags: Record<string, boolean> }>(
    `SELECT flags FROM eval_run_overrides WHERE run_id = $1`,
    [runId]
  );
  return flagForRun(name, rows[0]?.flags ?? null);
}
