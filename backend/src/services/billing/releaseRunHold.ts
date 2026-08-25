import { query } from '../../db/pool';
import { logger } from '../../utils/logger';
import { releaseHold } from './walletReservations';
import { researchQueue } from '../../queue/queues';
import type { ResearchJobData } from '../reasoning/researchOrchestratorTypes';

/**
 * Give a cancelled run's money back.
 *
 * A run that costs wallet money places a hold before it starts. If the run
 * finishes, the orchestrator consumes or releases it. If the user cancels, the
 * hold is nobody's job — the money sits in `reserved_cents` until the hold
 * ages out after thirty minutes and the hourly reaper notices, and in the
 * meantime the user may not have the balance to start the run they cancelled
 * the first one in favour of.
 *
 * That was survivable while nothing in the product could cancel a run. WO-AH
 * puts a Cancel button on the run workspace, so it isn't any more
 * (Codex P1, PR #229).
 *
 * The context lives in two different places depending on how far the run got:
 * a queued run carries it on its BullMQ job, and a run parked at the plan gate
 * carries it in `resume_job_payload`. This looks in both, because a caller
 * that has to know which one applies will eventually check the wrong one.
 *
 * Keyed on the presence of a hold, NOT on `type === 'wallet'`: a subscription
 * run that bought a paid add-on also places a hold for the surcharge, and
 * releasing only wallet-type contexts would strand exactly those.
 */
export async function releaseHoldForCancelledRun(runId: string): Promise<void> {
  const context = await loadCreditContext(runId);
  if (!context?.holdId || !context.userId) return;

  try {
    await releaseHold(context.holdId, context.userId);
    logger.info('cancelled_run_hold_released', { runId, holdId: context.holdId });
  } catch (err) {
    // Cancellation must still succeed. The reaper is the backstop; this is the
    // fast path, and a failure here is worth seeing in the logs.
    logger.warn('cancelled_run_hold_release_failed', {
      runId,
      holdId: context.holdId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

type CreditContext = { holdId?: string; userId?: string };

async function loadCreditContext(runId: string): Promise<CreditContext | null> {
  const fromJob = await creditContextFromQueueJob(runId);
  if (fromJob?.holdId) return fromJob;
  return creditContextFromResumePayload(runId);
}

async function creditContextFromQueueJob(runId: string): Promise<CreditContext | null> {
  try {
    const job = await researchQueue.getJob(runId);
    const data = job?.data as ResearchJobData | undefined;
    return data?.creditChargeContext ?? null;
  } catch (err) {
    logger.warn('cancelled_run_hold_job_read_failed', { runId, err: String(err) });
    return null;
  }
}

async function creditContextFromResumePayload(runId: string): Promise<CreditContext | null> {
  try {
    const rows = await query<{ resume_job_payload: unknown }>(
      `SELECT resume_job_payload FROM research_runs WHERE id = $1`,
      [runId]
    );
    const payload = rows[0]?.resume_job_payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return (payload as ResearchJobData).creditChargeContext ?? null;
  } catch (err) {
    // Pre-migration databases may not have the column. A cancel must not fail
    // because the refund path could not read.
    logger.warn('cancelled_run_hold_payload_read_failed', { runId, err: String(err) });
    return null;
  }
}
