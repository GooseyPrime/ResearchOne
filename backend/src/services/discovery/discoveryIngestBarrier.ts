import { query } from '../../db/pool';
import { sleep } from '../../utils/sleep';

const POLL_INTERVAL_MS = 3_000;

/**
 * Ingestion job states from which a job can never become queryable.
 *
 * Polling these until the deadline is pure dead time: the run sat at the
 * barrier for the full timeout waiting on work that had already stopped.
 * Dropping them is a correctness fix, not a tuning choice.
 */
const TERMINAL_UNREADY_STATUSES = new Set(['failed', 'cancelled', 'skipped', 'dead']);

/**
 * Fraction of tracked jobs that must be queryable before the barrier releases.
 *
 * The barrier was all-or-nothing: one slow or stuck source held the entire run
 * until the timeout, and then it proceeded anyway with a `timeout` status.
 * Waiting the full timeout to do the thing you were going to do regardless is
 * the worst of both.
 *
 * This is a PROPORTION rather than a latency, deliberately. A latency threshold
 * would be a guess — there is no run data to tune one against. "Enough sources
 * to work with" is answerable without that data, and the stragglers keep
 * ingesting in the background where later retrieval picks them up.
 */
export const DEFAULT_SUFFICIENT_READY_RATIO = 0.8;

/** Below this many jobs a proportion is meaningless — wait for all of them. */
export const MIN_JOBS_FOR_PARTIAL_RELEASE = 5;

export interface DiscoveryIngestSourceRef {
  ingestionJobId?: string;
  ingested: boolean;
}

export interface DiscoveryIngestReadinessResult {
  /**
   * `sufficient` means enough sources were queryable to proceed while a
   * minority were still ingesting — a healthy outcome, distinct from `timeout`,
   * which means the deadline expired with work still outstanding.
   */
  status: 'ready' | 'sufficient' | 'timeout' | 'no_sources_ingested';
  readyCount: number;
  pendingCount: number;
  totalTracked: number;
  pendingJobIds: string[];
  /** Jobs that reached a terminal state without becoming queryable. */
  failedCount: number;
  /** Wall-clock spent at the barrier — the input any future tuning needs. */
  waitedMs: number;
}

export async function waitForDiscoveryIngestReadiness(args: {
  sources: DiscoveryIngestSourceRef[];
  timeoutMs: number;
  onStatus?: (result: DiscoveryIngestReadinessResult) => void | Promise<void>;
  /** Emitted on every poll, so a multi-minute wait is visible in the trace. */
  onProgress?: (result: DiscoveryIngestReadinessResult) => void | Promise<void>;
  sufficientReadyRatio?: number;
}): Promise<DiscoveryIngestReadinessResult> {
  const startedAt = Date.now();
  const jobIds = args.sources
    .filter((source) => source.ingested && source.ingestionJobId)
    .map((source) => source.ingestionJobId!)
    .filter(Boolean);

  if (jobIds.length === 0) {
    const result: DiscoveryIngestReadinessResult = {
      status: 'no_sources_ingested',
      readyCount: 0,
      pendingCount: 0,
      totalTracked: 0,
      pendingJobIds: [],
      failedCount: 0,
      waitedMs: 0,
    };
    await args.onStatus?.(result);
    return result;
  }

  const ratio = args.sufficientReadyRatio ?? DEFAULT_SUFFICIENT_READY_RATIO;
  const sufficientCount =
    jobIds.length >= MIN_JOBS_FOR_PARTIAL_RELEASE
      ? Math.max(1, Math.ceil(jobIds.length * ratio))
      : jobIds.length;

  const deadline = Date.now() + Math.max(0, args.timeoutMs);
  const pending = new Set(jobIds);
  const failed = new Set<string>();

  do {
    const rows = await query<{
      id: string;
      status: string;
      source_id: string | null;
      chunk_count: number;
      embedding_count: number;
    }>(
      `SELECT
         ij.id,
         ij.status,
         ij.source_id,
         COUNT(DISTINCT c.id)::int AS chunk_count,
         COUNT(DISTINCT e.id)::int AS embedding_count
       FROM ingestion_jobs ij
       LEFT JOIN chunks c ON c.source_id = ij.source_id
       LEFT JOIN embeddings e ON e.chunk_id = c.id
       WHERE ij.id = ANY($1::uuid[])
       GROUP BY ij.id, ij.status, ij.source_id`,
      [Array.from(pending)]
    );

    for (const row of rows) {
      // Embeddings must have caught up with chunks: a source whose chunks exist
      // but are not yet embedded returns nothing from retrieval.
      const ready =
        row.status === 'completed'
        && Boolean(row.source_id)
        && row.chunk_count > 0
        && row.embedding_count >= row.chunk_count;
      if (ready) {
        pending.delete(row.id);
        continue;
      }
      if (TERMINAL_UNREADY_STATUSES.has(row.status)) {
        pending.delete(row.id);
        failed.add(row.id);
      }
    }

    const readyCount = jobIds.length - pending.size - failed.size;

    if (pending.size === 0) {
      // Everything resolved: either queryable, or terminally not. Nothing left
      // to wait for either way.
      const result: DiscoveryIngestReadinessResult = {
        status: readyCount > 0 ? 'ready' : 'no_sources_ingested',
        readyCount,
        pendingCount: 0,
        totalTracked: jobIds.length,
        pendingJobIds: [],
        failedCount: failed.size,
        waitedMs: Date.now() - startedAt,
      };
      await args.onStatus?.(result);
      return result;
    }

    if (readyCount >= sufficientCount) {
      const result: DiscoveryIngestReadinessResult = {
        status: 'sufficient',
        readyCount,
        pendingCount: pending.size,
        totalTracked: jobIds.length,
        pendingJobIds: Array.from(pending),
        failedCount: failed.size,
        waitedMs: Date.now() - startedAt,
      };
      await args.onStatus?.(result);
      return result;
    }

    if (Date.now() >= deadline) break;

    // Report each poll. A silent multi-minute wait is indistinguishable from a
    // hang, and this is the only place the timing data that would let anyone
    // tune this barrier can come from.
    await args.onProgress?.({
      status: 'timeout',
      readyCount,
      pendingCount: pending.size,
      totalTracked: jobIds.length,
      pendingJobIds: Array.from(pending),
      failedCount: failed.size,
      waitedMs: Date.now() - startedAt,
    });

    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() <= deadline);

  const result: DiscoveryIngestReadinessResult = {
    status: 'timeout',
    readyCount: jobIds.length - pending.size - failed.size,
    pendingCount: pending.size,
    totalTracked: jobIds.length,
    pendingJobIds: Array.from(pending),
    failedCount: failed.size,
    waitedMs: Date.now() - startedAt,
  };
  await args.onStatus?.(result);
  return result;
}
