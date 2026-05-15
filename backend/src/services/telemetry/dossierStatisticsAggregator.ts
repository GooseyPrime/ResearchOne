/**
 * Best-effort dossier_statistics upsert from existing telemetry (Wave 5.0).
 * Wave 5.2: optional orchestration snapshot (agents ran/skipped, stage timings).
 * Must never throw into the orchestrator completion path.
 */
import { query, queryOne } from '../../db/pool';
import { logger } from '../../utils/logger';

export interface DossierOrchestrationStatsInput {
  profileDisplayName: string;
  intentId: string;
  agentsRan: readonly string[];
  agentsSkipped: readonly string[];
  stageDurations: Record<string, number | string | null>;
  skepticAnnotationsCount?: number | null;
}

export async function aggregateAndPersistDossierStatistics(
  runId: string,
  orchestration?: DossierOrchestrationStatsInput,
): Promise<void> {
  try {
    const run = await queryOne<{
      id: string;
      created_at: Date;
      completed_at: Date | null;
      report_id: string | null;
    }>(`SELECT id, created_at, completed_at, report_id FROM research_runs WHERE id = $1::uuid`, [runId]);

    if (!run) {
      logger.warn('dossier-stats: run not found', { runId });
      return;
    }

    let totalDurationMs: number | null = null;
    if (run.completed_at && run.created_at) {
      totalDurationMs = Math.round(
        new Date(run.completed_at).getTime() - new Date(run.created_at).getTime(),
      );
    }

    let tokensInput: number | null = null;
    let tokensOutput: number | null = null;
    try {
      const tok = await queryOne<{ ti: string; to: string }>(
        `SELECT COALESCE(SUM(input_tokens), 0)::text AS ti, COALESCE(SUM(output_tokens), 0)::text AS to
         FROM agent_executions WHERE run_id = $1::uuid`,
        [runId],
      );
      if (tok) {
        const ti = Number(tok.ti);
        const to = Number(tok.to);
        tokensInput = ti > 0 ? ti : null;
        tokensOutput = to > 0 ? to : null;
      }
    } catch (e) {
      logger.debug('dossier-stats: agent_executions rollup skipped', { runId, err: String(e) });
    }

    let sourcesRetrieved: number | null = null;
    let sourcesCited: number | null = null;
    let contradictions: number | null = null;
    let citationDensity: number | null = null;

    if (run.report_id) {
      try {
        const rep = await queryOne<{
          source_count: string | null;
          chunk_count: string | null;
          contradiction_count: string | null;
        }>(
          `SELECT source_count::text, chunk_count::text, contradiction_count::text
           FROM reports WHERE id = $1::uuid`,
          [run.report_id],
        );
        if (rep) {
          sourcesRetrieved = rep.source_count != null ? Number(rep.source_count) : null;
          const chunks = rep.chunk_count != null ? Number(rep.chunk_count) : null;
          contradictions = rep.contradiction_count != null ? Number(rep.contradiction_count) : null;
          try {
            const cit = await queryOne<{ c: string }>(
              `SELECT COUNT(*)::text AS c FROM report_citations WHERE report_id = $1::uuid`,
              [run.report_id],
            );
            sourcesCited = cit?.c != null ? Number(cit.c) : null;
            if (sourcesCited != null && sourcesCited > 0 && chunks != null && chunks > 0) {
              citationDensity = Math.round((sourcesCited / chunks) * 1000) / 1000;
            }
          } catch {
            /* optional */
          }
        }
      } catch (e) {
        logger.debug('dossier-stats: report rollup skipped', { runId, err: String(e) });
      }
    }

    const refinementRounds = await queryOne<{ n: string | null }>(
      `SELECT refinement_rounds::text AS n FROM research_plans WHERE run_id = $1::uuid AND status IN ('legacy','confirmed') ORDER BY created_at DESC LIMIT 1`,
      [runId],
    );
    const refinementRoundsForUpsert =
      refinementRounds?.n != null && refinementRounds.n !== '' ? Number(refinementRounds.n) : null;

    const agentsRanJson = orchestration ? JSON.stringify([...orchestration.agentsRan]) : null;
    const agentsSkippedJson = orchestration ? JSON.stringify([...orchestration.agentsSkipped]) : null;
    const stageDurationsJson = orchestration ? JSON.stringify(orchestration.stageDurations) : null;
    const skepticAnnotationsCount =
      orchestration?.skepticAnnotationsCount != null ? orchestration.skepticAnnotationsCount : null;

    try {
      await query(
        `INSERT INTO dossier_statistics (
           run_id, total_duration_ms, tokens_input, tokens_output,
           sources_retrieved_count, sources_cited_count, citation_density,
           contradictions_count, refinement_rounds,
           agents_ran, agents_skipped, stage_durations, skeptic_annotations_count,
           computed_at
         ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, NOW())
         ON CONFLICT (run_id) DO UPDATE SET
           total_duration_ms = COALESCE(EXCLUDED.total_duration_ms, dossier_statistics.total_duration_ms),
           tokens_input = COALESCE(EXCLUDED.tokens_input, dossier_statistics.tokens_input),
           tokens_output = COALESCE(EXCLUDED.tokens_output, dossier_statistics.tokens_output),
           sources_retrieved_count = COALESCE(EXCLUDED.sources_retrieved_count, dossier_statistics.sources_retrieved_count),
           sources_cited_count = COALESCE(EXCLUDED.sources_cited_count, dossier_statistics.sources_cited_count),
           citation_density = COALESCE(EXCLUDED.citation_density, dossier_statistics.citation_density),
           contradictions_count = COALESCE(EXCLUDED.contradictions_count, dossier_statistics.contradictions_count),
           refinement_rounds = COALESCE(EXCLUDED.refinement_rounds, dossier_statistics.refinement_rounds),
           agents_ran = COALESCE(EXCLUDED.agents_ran, dossier_statistics.agents_ran),
           agents_skipped = COALESCE(EXCLUDED.agents_skipped, dossier_statistics.agents_skipped),
           stage_durations = COALESCE(EXCLUDED.stage_durations, dossier_statistics.stage_durations),
           skeptic_annotations_count = COALESCE(EXCLUDED.skeptic_annotations_count, dossier_statistics.skeptic_annotations_count),
           computed_at = NOW()`,
        [
          runId,
          totalDurationMs,
          tokensInput,
          tokensOutput,
          sourcesRetrieved,
          sourcesCited,
          citationDensity,
          contradictions,
          refinementRoundsForUpsert,
          agentsRanJson,
          agentsSkippedJson,
          stageDurationsJson,
          skepticAnnotationsCount,
        ],
      );
    } catch (wideErr) {
      const code = (wideErr as { code?: string })?.code;
      if (code === '42703') {
        await query(
          `INSERT INTO dossier_statistics (
             run_id, total_duration_ms, tokens_input, tokens_output,
             sources_retrieved_count, sources_cited_count, citation_density,
             contradictions_count, refinement_rounds, computed_at
           ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (run_id) DO UPDATE SET
             total_duration_ms = COALESCE(EXCLUDED.total_duration_ms, dossier_statistics.total_duration_ms),
             tokens_input = COALESCE(EXCLUDED.tokens_input, dossier_statistics.tokens_input),
             tokens_output = COALESCE(EXCLUDED.tokens_output, dossier_statistics.tokens_output),
             sources_retrieved_count = COALESCE(EXCLUDED.sources_retrieved_count, dossier_statistics.sources_retrieved_count),
             sources_cited_count = COALESCE(EXCLUDED.sources_cited_count, dossier_statistics.sources_cited_count),
             citation_density = COALESCE(EXCLUDED.citation_density, dossier_statistics.citation_density),
             contradictions_count = COALESCE(EXCLUDED.contradictions_count, dossier_statistics.contradictions_count),
             refinement_rounds = COALESCE(EXCLUDED.refinement_rounds, dossier_statistics.refinement_rounds),
             computed_at = NOW()`,
          [
            runId,
            totalDurationMs,
            tokensInput,
            tokensOutput,
            sourcesRetrieved,
            sourcesCited,
            citationDensity,
            contradictions,
            refinementRoundsForUpsert,
          ],
        );
      } else {
        throw wideErr;
      }
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '42P01' || code === '42703') {
      logger.debug('dossier-stats: table or column missing (deploy skew)', { runId, code });
      return;
    }
    logger.warn('dossier-stats: aggregate failed', {
      runId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
