import { readerViewEnabled, runWithFlags } from '../../config';
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
