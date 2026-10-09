import { query } from '../../db/pool';

/*
 * Every report is shown in the reader view. There was a per-run switch for it
 * (`readerViewForRun`); it was removed on 8 Oct 2026 with the switch itself.
 */

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
