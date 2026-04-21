/**
 * AUDIT (epistemic): Persists JSON snapshots only — no LLM summarization. If LLM state summaries are added,
 * use withPreamble plus CHECKPOINT_SUMMARY_SUPPLEMENT from constants/prompts.ts.
 */

import { query } from '../../db/pool';

export async function saveRunCheckpoint(args: {
  runId: string;
  stage: string;
  checkpointKey: string;
  snapshot: Record<string, unknown>;
}): Promise<void> {
  const { runId, stage, checkpointKey, snapshot } = args;
  await query(
    `INSERT INTO research_run_checkpoints (run_id, stage, checkpoint_key, snapshot)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (run_id, checkpoint_key)
     DO UPDATE SET stage = EXCLUDED.stage, snapshot = EXCLUDED.snapshot, created_at = NOW()`,
    [runId, stage, checkpointKey, JSON.stringify(snapshot)]
  );
}

export async function getLatestRunCheckpoint(runId: string): Promise<{
  stage: string;
  checkpoint_key: string;
  snapshot: Record<string, unknown>;
} | null> {
  const rows = await query<{
    stage: string;
    checkpoint_key: string;
    snapshot: Record<string, unknown>;
  }>(
    `SELECT stage, checkpoint_key, snapshot
     FROM research_run_checkpoints
     WHERE run_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [runId]
  );
  return rows[0] ?? null;
}
