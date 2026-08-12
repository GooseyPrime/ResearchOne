import { query } from '../../db/pool';
import { sleep } from '../../utils/sleep';

const POLL_INTERVAL_MS = 3_000;

export interface DiscoveryIngestSourceRef {
  ingestionJobId?: string;
  ingested: boolean;
}

export interface DiscoveryIngestReadinessResult {
  status: 'ready' | 'timeout' | 'no_sources_ingested';
  readyCount: number;
  pendingCount: number;
  totalTracked: number;
  pendingJobIds: string[];
}

export async function waitForDiscoveryIngestReadiness(args: {
  sources: DiscoveryIngestSourceRef[];
  timeoutMs: number;
  onStatus?: (result: DiscoveryIngestReadinessResult) => void | Promise<void>;
}): Promise<DiscoveryIngestReadinessResult> {
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
    };
    await args.onStatus?.(result);
    return result;
  }

  const deadline = Date.now() + Math.max(0, args.timeoutMs);
  const pending = new Set(jobIds);

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
      const ready =
        row.status === 'completed'
        && Boolean(row.source_id)
        && row.chunk_count > 0
        && row.embedding_count >= row.chunk_count;
      if (ready) {
        pending.delete(row.id);
      }
    }

    if (pending.size === 0) {
      const result: DiscoveryIngestReadinessResult = {
        status: 'ready',
        readyCount: jobIds.length,
        pendingCount: 0,
        totalTracked: jobIds.length,
        pendingJobIds: [],
      };
      await args.onStatus?.(result);
      return result;
    }

    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() <= deadline);

  const result: DiscoveryIngestReadinessResult = {
    status: 'timeout',
    readyCount: jobIds.length - pending.size,
    pendingCount: pending.size,
    totalTracked: jobIds.length,
    pendingJobIds: Array.from(pending),
  };
  await args.onStatus?.(result);
  return result;
}
