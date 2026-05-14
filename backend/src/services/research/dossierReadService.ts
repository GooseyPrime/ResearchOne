/**
 * Canonical dossier reads — SELECT from `v_dossier` only (Rule 32).
 */
import { query, queryOne } from '../../db/pool';
import type {
  Dossier,
  DossierAuthContext,
  DossierListFilters,
  DossierListResult,
  DossierListRow,
  DossierPlan,
  DossierReportLink,
  DossierRequest,
  DossierStats,
} from '../../types/dossier';

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function parseTierSummary(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapRowToDossier(row: Record<string, unknown>): Dossier {
  const reportEvidenceTierSummary = parseTierSummary(row.report_evidence_tier_summary);

  const request: DossierRequest = {
    query: String(row.request_query ?? ''),
    supplemental: row.request_supplemental != null ? String(row.request_supplemental) : null,
    supplementalAttachments: row.request_supplemental_attachments ?? null,
    createdAt: row.dossier_created_at ? new Date(String(row.dossier_created_at)).toISOString() : '',
  };

  const plan: DossierPlan = {
    planId: row.plan_id != null ? String(row.plan_id) : null,
    intent: String(row.plan_intent ?? 'legacy'),
    planSummary: row.plan_summary != null ? String(row.plan_summary) : null,
    planPayload:
      row.plan_payload && typeof row.plan_payload === 'object'
        ? (row.plan_payload as Record<string, unknown>)
        : {},
    planStatus: row.plan_status != null ? String(row.plan_status) : null,
    refinementRounds: row.plan_refinement_rounds != null ? Number(row.plan_refinement_rounds) : null,
  };

  const report: DossierReportLink = {
    reportId: row.report_id != null ? String(row.report_id) : null,
    title: row.report_title != null ? String(row.report_title) : null,
    status: row.report_status != null ? String(row.report_status) : null,
    finalizedAt: row.report_finalized_at != null ? new Date(String(row.report_finalized_at)).toISOString() : null,
  };

  const stats: DossierStats = {
    totalDurationMs: row.total_duration_ms != null ? Number(row.total_duration_ms) : null,
    tokensInput: row.tokens_input != null ? Number(row.tokens_input) : null,
    tokensOutput: row.tokens_output != null ? Number(row.tokens_output) : null,
    sourcesRetrievedCount: row.sources_retrieved_count != null ? Number(row.sources_retrieved_count) : null,
    sourcesCitedCount: row.sources_cited_count != null ? Number(row.sources_cited_count) : null,
    citationDensity: row.citation_density != null ? Number(row.citation_density) : null,
    skepticAnnotationsCount:
      row.skeptic_annotations_count != null ? Number(row.skeptic_annotations_count) : null,
    contradictionsCount: row.contradictions_count != null ? Number(row.contradictions_count) : null,
    refinementRounds: row.stats_refinement_rounds != null ? Number(row.stats_refinement_rounds) : null,
    agentsRan: row.agents_ran ?? null,
    agentsSkipped: row.agents_skipped ?? null,
    stageDurations: row.stage_durations ?? null,
    modelsUsed: row.models_used ?? null,
    estimatedCostCents: row.estimated_cost_cents != null ? Number(row.estimated_cost_cents) : null,
    actualCostCents: row.actual_cost_cents != null ? Number(row.actual_cost_cents) : null,
    reportEvidenceTierSummary,
  };

  return {
    dossierId: String(row.dossier_id),
    runId: String(row.run_id),
    runStatus: String(row.run_status ?? ''),
    request,
    plan,
    report,
    stats,
  };
}

export async function getDossierById(dossierId: string, _ctx: DossierAuthContext): Promise<Dossier | null> {
  if (!isUuid(dossierId)) return null;
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM v_dossier WHERE dossier_id = $1::uuid LIMIT 1`,
    [dossierId],
  );
  if (!row) return null;
  return mapRowToDossier(row);
}

export async function listDossiers(filters: DossierListFilters, _ctx: DossierAuthContext): Promise<DossierListResult> {
  const page = Math.max(1, filters.page);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize));
  const offset = (page - 1) * pageSize;

  const conds: string[] = ['1=1'];
  const params: unknown[] = [];
  let p = 1;

  if (filters.intent) {
    conds.push(`plan_intent = $${p++}`);
    params.push(filters.intent);
  }
  if (filters.status) {
    conds.push(`run_status = $${p++}`);
    params.push(filters.status);
  }
  if (filters.dateFrom) {
    conds.push(`dossier_created_at >= $${p++}::timestamptz`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conds.push(`dossier_created_at <= $${p++}::timestamptz`);
    params.push(filters.dateTo);
  }

  const where = conds.join(' AND ');
  const countRows = await query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM v_dossier WHERE ${where}`,
    params,
  );
  const total = Number(countRows[0]?.c ?? 0);

  params.push(pageSize, offset);
  const limIdx = p++;
  const offIdx = p++;
  const rows = await query<Record<string, unknown>>(
    `SELECT dossier_id, run_id, run_status, request_query, plan_intent, dossier_created_at,
            report_id, report_title, sources_cited_count, total_duration_ms
     FROM v_dossier
     WHERE ${where}
     ORDER BY dossier_created_at DESC
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    params,
  );

  const mapped: DossierListRow[] = rows.map((r) => ({
    dossierId: String(r.dossier_id),
    runId: String(r.run_id),
    runStatus: String(r.run_status ?? ''),
    requestQuery: String(r.request_query ?? ''),
    planIntent: r.plan_intent != null ? String(r.plan_intent) : null,
    dossierCreatedAt: r.dossier_created_at ? new Date(String(r.dossier_created_at)).toISOString() : '',
    reportId: r.report_id != null ? String(r.report_id) : null,
    reportTitle: r.report_title != null ? String(r.report_title) : null,
    sourcesCitedCount: r.sources_cited_count != null ? Number(r.sources_cited_count) : null,
    totalDurationMs: r.total_duration_ms != null ? Number(r.total_duration_ms) : null,
  }));

  return { rows: mapped, total, page, pageSize };
}

export async function getDossierRequest(dossierId: string, ctx: DossierAuthContext): Promise<DossierRequest | null> {
  const d = await getDossierById(dossierId, ctx);
  return d?.request ?? null;
}

export async function getDossierPlan(dossierId: string, ctx: DossierAuthContext): Promise<DossierPlan | null> {
  const d = await getDossierById(dossierId, ctx);
  return d?.plan ?? null;
}

export async function getDossierReportLink(
  dossierId: string,
  ctx: DossierAuthContext,
): Promise<DossierReportLink | null> {
  const d = await getDossierById(dossierId, ctx);
  return d?.report ?? null;
}

export async function getDossierStats(dossierId: string, ctx: DossierAuthContext): Promise<DossierStats | null> {
  const d = await getDossierById(dossierId, ctx);
  return d?.stats ?? null;
}

