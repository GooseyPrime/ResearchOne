import { readerViewEnabled, runWithFlags } from '../../config';
import { query } from '../../db/pool';
import { loadRunFlags } from './runFlagStore';

/**
 * Whether a report is in the reader view: the switch as recorded for the run
 * that wrote it, else the process setting. A sample written with the switch on
 * for that run alone is read, and revised, the same way. Never throws.
 */
export async function readerViewForRun(runId: unknown): Promise<boolean> {
  if (typeof runId !== 'string' || !runId) return readerViewEnabled();
  try {
    return runWithFlags(await loadRunFlags(runId), () => readerViewEnabled());
  } catch {
    return readerViewEnabled();
  }
}

/**
 * Slice 6. Whether a report names its sources by where they were read ("government
 * page", "news article"): whether the run that wrote it had authority tiers on,
 * as that run recorded when it wrote the report. A report written before the
 * record existed, or without the switch, is worded as before. Changing the switch
 * later does not change how an existing report reads. Never throws.
 */
export async function authorityWordsForRun(runId: unknown): Promise<boolean> {
  if (typeof runId !== 'string' || !runId) return false;
  try {
    const rows = await query<{ authority_tiers: string | null }>(`SELECT corpus_after->>'authorityTiers' AS authority_tiers FROM research_runs WHERE id = $1`, [runId]);
    return rows[0]?.authority_tiers === 'true';
  } catch {
    return false;
  }
}
