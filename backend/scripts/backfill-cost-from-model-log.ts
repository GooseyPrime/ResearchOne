/**
 * Backfill `agent_executions` from historical `research_runs.model_log`.
 *
 * Per Rule 25 invariant I-7: this script is one-shot and idempotent.
 * Re-running it after a partial run is safe — the ON CONFLICT clause
 * inside `emitCallTelemetry` (via the unique idempotency_key index)
 * skips already-inserted rows.
 *
 * Limitations (documented because the data is genuinely lossy):
 *
 *   1. `model_log` only stores durationMs per call. The real
 *      `started_at_ms` was not persisted at run-time. We approximate it
 *      by laying out calls sequentially **forward** from
 *      `research_runs.created_at`, advancing `started_at_ms` by each
 *      entry's `durationMs` (anchor = `created_at`; not `completed_at`).
 *      This is good enough for analytics but the per-row timestamps will
 *      not match wall-clock truth.
 *
 *   2. `model_log` does not record `call_purpose`. Phase resolution
 *      falls back to `rolePhaseFor(role)` only — contradiction
 *      extraction calls will surface as Reasoning instead of
 *      Contradiction Extraction. Live emit (post-PATCH-01) does
 *      capture this correctly.
 *
 *   3. `model_log` does not record `error_classification`. Fallback
 *      flag is preserved (`usedFallback` is in the JSONB), but the
 *      classification field is left NULL.
 *
 * Usage:
 *
 *   tsx backend/scripts/backfill-cost-from-model-log.ts --since=2026-01-01
 *   tsx backend/scripts/backfill-cost-from-model-log.ts --since=2026-01-01 --dry-run
 *   tsx backend/scripts/backfill-cost-from-model-log.ts --since=2026-01-01 --limit=100
 *
 * --since:    ISO date (default: '2026-01-01').
 * --dry-run:  print what would be inserted without writing.
 * --limit:    cap the number of runs processed (default: unlimited).
 */
import { createHash } from 'crypto';
import { initDb, adminQuery, getPool } from '../src/db/pool';
import { getModelPrice, computeCostUsd } from '../src/services/telemetry/pricingCatalog';
import { rolePhaseFor } from '../src/services/telemetry/costSidecar';
import { logger } from '../src/utils/logger';

interface ResearchRunRow {
  id: string;
  user_id: string | null;
  org_id: string | null;
  report_id: string | null;
  created_at: string;
  completed_at: string | null;
  model_log: ModelLogEntry[] | null;
}

interface ModelLogEntry {
  role: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  usedFallback?: boolean;
  primaryModel?: string;
}

function parseArgs(): { since: string; dryRun: boolean; limit: number | null } {
  const argv = process.argv.slice(2);
  let since = '2026-01-01';
  let dryRun = false;
  let limit: number | null = null;
  for (const arg of argv) {
    if (arg.startsWith('--since=')) since = arg.slice('--since='.length);
    else if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--limit=')) limit = parseInt(arg.slice('--limit='.length), 10);
  }
  return { since, dryRun, limit };
}

function computeIdempotencyKey(args: {
  runId: string;
  agentRole: string;
  callPurpose: string;
  startedAtMs: number;
  model: string;
  logIndex: number;
}): string {
  return createHash('sha256')
    .update(
      `${args.runId}|${args.agentRole}|${args.callPurpose}|${args.startedAtMs}|${args.model}|backfill:${args.logIndex}`
    )
    .digest('hex');
}

async function backfillRun(run: ResearchRunRow, dryRun: boolean): Promise<{
  inserted: number;
  skipped: number;
  errors: number;
}> {
  if (!run.model_log || !Array.isArray(run.model_log) || run.model_log.length === 0) {
    return { inserted: 0, skipped: 0, errors: 0 };
  }

  // Approximate per-call timing.
  // Anchor: completed_at if present, otherwise created_at.
  // Lay out calls forward from created_at using their durationMs.
  const anchorMs = new Date(run.created_at).getTime();
  let cumulativeOffset = 0;

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < run.model_log.length; i++) {
    const entry = run.model_log[i];
    try {
      const role = entry.role ?? 'unknown';
      const model = entry.model ?? '';
      const promptTokens = entry.promptTokens ?? 0;
      const completionTokens = entry.completionTokens ?? 0;
      const durationMs = entry.durationMs ?? 0;
      const usedFallback = entry.usedFallback ?? false;
      const primaryModel = entry.primaryModel ?? model;

      const startedAtMs = anchorMs + cumulativeOffset;
      cumulativeOffset += durationMs;

      const phase = rolePhaseFor(role);
      const price = await getModelPrice(model);
      const calculatedCost = computeCostUsd(promptTokens, completionTokens, price);
      const idempotencyKey = computeIdempotencyKey({
        runId: run.id,
        agentRole: role,
        callPurpose: 'default',
        startedAtMs,
        model,
        logIndex: i,
      });

      if (dryRun) {
        console.log(`  would insert: run=${run.id} role=${role} model=${model} tokens=${promptTokens + completionTokens} cost=$${calculatedCost.toFixed(6)}`);
        inserted++;
        continue;
      }

      const result = await adminQuery<{ inserted: boolean }>(
        `INSERT INTO agent_executions (
           run_id, report_id, user_id, org_id,
           agent_role, phase, call_purpose,
           model, used_fallback, primary_model, error_classification,
           input_tokens, output_tokens,
           duration_ms, started_at_ms, started_at,
           input_price_per_1m_usd, output_price_per_1m_usd, calculated_cost_usd,
           idempotency_key, metadata
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, 'default',
           $7, $8, $9, NULL,
           $10, $11,
           $12, $13, to_timestamp($13::double precision / 1000.0),
           $14, $15, $16,
           $17, '{"backfilled":true}'::jsonb
         )
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING (xmax = 0) AS inserted`,
        [
          run.id,
          run.report_id,
          run.user_id,
          run.org_id,
          role,
          phase,
          model,
          usedFallback,
          primaryModel,
          promptTokens,
          completionTokens,
          durationMs,
          startedAtMs,
          price.inputPricePer1mUsd,
          price.outputPricePer1mUsd,
          calculatedCost,
          idempotencyKey,
        ]
      );
      if (result.length === 0) {
        skipped++;
      } else {
        inserted++;
      }
    } catch (err) {
      errors++;
      logger.warn('backfill: row failed', { runId: run.id, err: err instanceof Error ? err.message : String(err) });
    }
  }

  return { inserted, skipped, errors };
}

async function main(): Promise<void> {
  const { since, dryRun, limit } = parseArgs();

  console.log(`Backfilling agent_executions from research_runs.model_log`);
  console.log(`  since:   ${since}`);
  console.log(`  dry-run: ${dryRun}`);
  console.log(`  limit:   ${limit ?? 'unlimited'}`);
  console.log('');

  await initDb();

  // Confirm migration 030 has been applied. If not, the writer would
  // 42P01 every row.
  const migrated = await adminQuery<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='agent_executions'
     ) AS exists`
  );
  if (!migrated[0]?.exists) {
    console.error('ERROR: agent_executions table does not exist. Apply migration 030 first.');
    process.exit(1);
  }

  let limitClause = '';
  if (limit !== null && limit > 0) limitClause = ` LIMIT ${limit}`;

  const runs = await adminQuery<ResearchRunRow>(
    `SELECT id, user_id, org_id, report_id, created_at, completed_at, model_log
       FROM research_runs
      WHERE created_at >= $1
        AND model_log IS NOT NULL
        AND jsonb_typeof(model_log) = 'array'
      ORDER BY created_at ASC${limitClause}`,
    [since]
  );

  console.log(`Found ${runs.length} runs with model_log data.\n`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let processed = 0;

  for (const run of runs) {
    processed++;
    const { inserted, skipped, errors } = await backfillRun(run, dryRun);
    totalInserted += inserted;
    totalSkipped += skipped;
    totalErrors += errors;
    if (processed % 50 === 0) {
      console.log(`  progress: ${processed}/${runs.length} runs — inserted=${totalInserted} skipped=${totalSkipped} errors=${totalErrors}`);
    }
  }

  console.log('');
  console.log(`Backfill complete:`);
  console.log(`  runs processed:    ${processed}`);
  console.log(`  rows inserted:     ${totalInserted}`);
  console.log(`  rows skipped (idempotent): ${totalSkipped}`);
  console.log(`  rows errored:      ${totalErrors}`);
  console.log('');
  console.log('Spot-check suggestion: pick 5 random runIds and compare');
  console.log('  SUM(calculated_cost_usd) WHERE run_id = X');
  console.log('against your intuition for that run + objective.');

  await getPool().end();
  process.exit(totalErrors > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
