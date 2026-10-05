import { queryOne } from '../../db/pool';
import { logger } from '../../utils/logger';

/**
 * Switches an admin recorded for this one run. Read once, before the job starts,
 * so the whole run sees one consistent set. No record, or a database that does
 * not have the table yet, means the process settings apply unchanged.
 */
export async function loadRunFlags(runId: string): Promise<Record<string, boolean> | null> {
  try {
    const row = await queryOne<{ flags: unknown }>(`SELECT flags FROM eval_run_overrides WHERE run_id = $1`, [runId]);
    const raw = row?.flags;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const flags: Record<string, boolean> = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'boolean') flags[name] = value;
    }
    return Object.keys(flags).length > 0 ? flags : null;
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') {
      logger.debug(`[${runId}] No per-run switch table yet; using process settings`);
      return null;
    }
    throw err;
  }
}
