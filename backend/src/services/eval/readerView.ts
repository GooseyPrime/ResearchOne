import { readerViewEnabled, runWithFlags, switchEnabled } from '../../config';
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
 * page", "news article"): the authority switch as recorded for the run that
 * wrote it, else the process setting. Never throws.
 */
export async function authorityWordsForRun(runId: unknown): Promise<boolean> {
  const processSetting = (): boolean => switchEnabled('AUTHORITY_TIERS_ENABLED');
  if (typeof runId !== 'string' || !runId) return processSetting();
  try {
    return runWithFlags(await loadRunFlags(runId), processSetting);
  } catch {
    return processSetting();
  }
}
