/**
 * Canonical dossier reads — SELECT from `v_dossier` only (Rule 32).
 */
import { query, queryOne } from '../../db/pool';
import {
  appendOwnershipFilter,
  buildOwnershipSql,
  rejectUnscopedReadOnScopeError,
} from '../../db/tenantScope';
import { logger } from '../../utils/logger';
import type {
  Dossier,
  DossierAuthContext,
  DossierListFilters,
  DossierListResult,
  DossierListRow,
  DossierPlan,
  DossierReportHistoryEntry,
  DossierReportHistoryResult,
  DossierReportLink,
  DossierRequest,
  DossierSortBy,
  DossierSourceEntry,
  DossierSourcesResult,
  DossierSpinoffEntry,
  DossierSpinoffsResult,
  DossierStats,
} from '../../types/dossier';

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/** Missing view/table or column — deploy ahead of migration (Rule 13 / Rule 32). */
function isDossierDeploySkewPgError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '42P01' || code === '42703';
}

function isViewMissingPgError(err: unknown): boolean {
  return (err as { code?: string })?.code === '42P01';
}

/** Belt-and-suspenders ownership on v_dossier (no legacy NULL rows). */
function pushDossierOwnership(conds: string[], params: unknown[], ctx: DossierAuthContext): void {
  appendOwnershipFilter(conds, params, { userId: ctx.userId, orgId: ctx.orgId });
}

function dossierOwnershipSql(ctx: DossierAuthContext, userParam: number, orgParam: number): string {
  return buildOwnershipSql('', userParam, orgParam);
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

function parseSourceClassBreakdown(raw: unknown): Record<string, unknown> | null {
  const obj = parseTierSummary(raw);
  return obj;
}

function mapRowToListEntry(r: Record<string, unknown>, extended: boolean): DossierListRow {
  const dossierCreatedAt = r.dossier_created_at ? new Date(String(r.dossier_created_at)).toISOString() : '';
  const lastActivityRaw = extended ? r.last_activity_at : null;
  const lastActivityAt =
    lastActivityRaw != null ? new Date(String(lastActivityRaw)).toISOString() : dossierCreatedAt || null;

  return {
    dossierId: String(r.dossier_id),
    runId: String(r.run_id),
    runStatus: String(r.run_status ?? ''),
    gateStatus: r.run_gate_status != null ? String(r.run_gate_status) : null,
    requestQuery: String(r.request_query ?? ''),
    // `extended`-gated with everything else 057 and before added: the legacy
    // select cannot name a column the view does not have yet.
    displayTitle: extended && r.run_display_title != null ? String(r.run_display_title) : null,
    runRef: extended && r.run_ref != null ? String(r.run_ref) : null,
    planIntent: r.plan_intent != null ? String(r.plan_intent) : null,
    dossierCreatedAt,
    reportId: r.report_id != null ? String(r.report_id) : null,
    reportTitle: r.report_title != null ? String(r.report_title) : null,
    sourcesCitedCount: r.sources_cited_count != null ? Number(r.sources_cited_count) : null,
    totalDurationMs: r.total_duration_ms != null ? Number(r.total_duration_ms) : null,
    lastActivityAt,
    versionNumber: extended && r.report_version_number != null ? Number(r.report_version_number) : null,
    isSpinoff: extended ? Boolean(r.is_spinoff) : false,
    isRevised: extended ? Boolean(r.is_revised) : false,
    spinoffFromReportId:
      extended && r.spinoff_from_report_id != null ? String(r.spinoff_from_report_id) : null,
    engineVersion: extended && r.engine_version != null ? String(r.engine_version) : null,
  };
}

function resolveListOrderBy(sortBy: DossierSortBy | undefined, extended: boolean): string {
  if (sortBy === 'last_activity_at' && extended) {
    return 'COALESCE(last_activity_at, dossier_created_at) DESC';
  }
  return 'dossier_created_at DESC';
}

/**
 * The dossier list projection, as a ladder rather than a cliff.
 *
 * A deploy can put this code in front of a database that has not run migration
 * 057 yet. The old handling caught the resulting "column does not exist" and
 * fell all the way back to the LEGACY projection — which drops the gate status,
 * last activity, version number, spinoff and revision flags and engine version,
 * none of which have anything to do with 057. A missing column from the newest
 * migration silently cost the list nine columns that had been there for
 * months, and the list rendered as though those runs had no history.
 *
 * Each rung removes only what the rung below it cannot have. `titleSearch`
 * moves with the columns for the same reason: a WHERE clause naming
 * `run_display_title` fails exactly like a SELECT naming it, so the search
 * predicate has to be dropped on the same rung the column is.
 *
 * This is the ladder I had already built for `listDossiers` in #227 and did
 * not apply to its neighbour — the thing Rule 44 T3 exists to prevent.
 */
type DossierListProjection = {
  /** How much of the row `mapRowToListEntry` may trust. */
  extended: boolean;
  /** True once `run_display_title` / `run_ref` are known to be selectable. */
  withDisplayTitle: boolean;
  select: string;
};

const LIST_PROJECTIONS: readonly DossierListProjection[] = [
  {
    extended: true,
    withDisplayTitle: true,
    select: `SELECT dossier_id, run_id, run_status, run_gate_status, request_query, run_display_title, run_ref, plan_intent, dossier_created_at,
            report_id, report_title, sources_cited_count, total_duration_ms,
            last_activity_at, report_version_number, is_spinoff, is_revised,
            spinoff_from_report_id, engine_version`,
  },
  {
    // Pre-057: everything the extended view had before the display title.
    extended: true,
    withDisplayTitle: false,
    select: `SELECT dossier_id, run_id, run_status, run_gate_status, request_query, plan_intent, dossier_created_at,
            report_id, report_title, sources_cited_count, total_duration_ms,
            last_activity_at, report_version_number, is_spinoff, is_revised,
            spinoff_from_report_id, engine_version`,
  },
  {
    // Pre-extended view entirely. The last rung, not the first response.
    extended: false,
    withDisplayTitle: false,
    select: `SELECT dossier_id, run_id, run_status, request_query, plan_intent, dossier_created_at,
            report_id, report_title, sources_cited_count, total_duration_ms`,
  },
];

/**
 * What a text search looks at.
 *
 * A run's heading in the list is its display title, so searching a list by the
 * words on it has to include that column — searching only `request_query` and
 * `report_title` means typing what you can see and getting nothing back.
 */
function buildSearchPredicate(paramIndex: number, withDisplayTitle: boolean): string {
  const columns = ['request_query', 'report_title'];
  if (withDisplayTitle) columns.push('run_display_title');
  return `(${columns.map((c) => `${c} ILIKE $${paramIndex} ESCAPE '\\'`).join(' OR ')})`;
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
    orchestrationProfile: row.plan_orchestration_profile != null ? String(row.plan_orchestration_profile) : null,
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
    sourceClassBreakdown: parseSourceClassBreakdown(row.source_class_breakdown),
    steelmanPassCount: row.steelman_pass_count != null ? Number(row.steelman_pass_count) : null,
  };

  return {
    dossierId: String(row.dossier_id),
    runId: String(row.run_id),
    runStatus: String(row.run_status ?? ''),
    gateStatus: row.run_gate_status != null ? String(row.run_gate_status) : null,
    request,
    plan,
    report,
    stats,
  };
}

export async function getDossierById(dossierId: string, ctx: DossierAuthContext): Promise<Dossier | null> {
  if (!isUuid(dossierId)) return null;
  try {
    const row = await queryOne<Record<string, unknown>>(
      `SELECT * FROM v_dossier WHERE dossier_id = $1::uuid AND ${dossierOwnershipSql(ctx, 2, 3)} LIMIT 1`,
      [dossierId, ctx.userId, ctx.orgId],
    );
    if (!row) return null;
    return mapRowToDossier(row);
  } catch (e) {
    if (isViewMissingPgError(e)) {
      logger.debug('dossier read: v_dossier unavailable (deploy skew)', { dossierId, err: String(e) });
      return null;
    }
    rejectUnscopedReadOnScopeError(e, 'dossierReadService.getDossierById');
  }
}

/** Canonical dossier read keyed by `research_runs.id` (Wave 5.1 plan gate GET). */
export async function getDossierByRunId(runId: string, ctx: DossierAuthContext): Promise<Dossier | null> {
  if (!isUuid(runId)) return null;
  try {
    const row = await queryOne<Record<string, unknown>>(
      `SELECT * FROM v_dossier WHERE run_id = $1::uuid AND ${dossierOwnershipSql(ctx, 2, 3)} LIMIT 1`,
      [runId, ctx.userId, ctx.orgId],
    );
    if (!row) return null;
    return mapRowToDossier(row);
  } catch (e) {
    if (isViewMissingPgError(e)) {
      logger.debug('dossier read: v_dossier unavailable (deploy skew)', { runId, err: String(e) });
      return null;
    }
    rejectUnscopedReadOnScopeError(e, 'dossierReadService.getDossierByRunId');
  }
}

export async function listDossiers(filters: DossierListFilters, ctx: DossierAuthContext): Promise<DossierListResult> {
  if (!ctx.userId) {
    return { rows: [], total: 0, page: Math.max(1, filters.page), pageSize: Math.min(100, Math.max(1, filters.pageSize)) };
  }

  const page = Math.max(1, filters.page);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize));
  const offset = (page - 1) * pageSize;

  const conds: string[] = [];
  const params: unknown[] = [];
  pushDossierOwnership(conds, params, ctx);
  let p = params.length + 1;

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
  const searchTrimmed = filters.search?.trim();
  const searchParamIndex = searchTrimmed ? p : null;
  if (searchTrimmed) {
    const pattern = `%${searchTrimmed.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    // The predicate itself is built per rung, because it may name a column the
    // database does not have yet. Only the parameter is fixed here.
    params.push(pattern);
    p++;
  }

  const sortBy = filters.sortBy ?? 'last_activity_at';
  const listParams = [...params, pageSize, offset];
  const limIdx = params.length + 1;
  const offIdx = params.length + 2;

  const whereFor = (withDisplayTitle: boolean): string => {
    const all = [...conds];
    if (searchParamIndex !== null) {
      all.push(buildSearchPredicate(searchParamIndex, withDisplayTitle));
    }
    return all.join(' AND ');
  };

  let lastError: unknown = null;
  for (let rung = 0; rung < LIST_PROJECTIONS.length; rung += 1) {
    const projection = LIST_PROJECTIONS[rung]!;
    const where = whereFor(projection.withDisplayTitle);
    try {
      const countRows = await query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM v_dossier WHERE ${where}`,
        params,
      );
      const rows = await query<Record<string, unknown>>(
        `${projection.select}
     FROM v_dossier
     WHERE ${where}
     ORDER BY ${resolveListOrderBy(sortBy, projection.extended)}
     LIMIT $${limIdx} OFFSET $${offIdx}`,
        listParams,
      );
      return {
        rows: rows.map((r) => mapRowToListEntry(r, projection.extended)),
        total: Number(countRows[0]?.c ?? 0),
        page,
        pageSize,
      };
    } catch (e) {
      // A missing view is terminal — no rung of the ladder can help, and every
      // rung would raise the same error while logging three times.
      if (isViewMissingPgError(e)) {
        logger.debug('dossier list: v_dossier unavailable (deploy skew)', { err: String(e) });
        return { rows: [], total: 0, page, pageSize };
      }
      if (!isDossierDeploySkewPgError(e)) throw e;
      lastError = e;
      logger.debug('dossier list: dropping to a narrower v_dossier projection (deploy skew)', {
        rung,
        err: String(e),
      });
    }
  }

  rejectUnscopedReadOnScopeError(lastError, 'dossierReadService.listDossiers');
}

function mapHistoryRows(reportRows: Record<string, unknown>[]): DossierReportHistoryEntry[] {
  return reportRows.map((row) => ({
    reportId: String(row.report_id),
    versionNumber: row.version_number != null ? Number(row.version_number) : 1,
    title: String(row.title ?? ''),
    status: String(row.status ?? ''),
    parentReportId: row.parent_report_id != null ? String(row.parent_report_id) : null,
    revisionNumber: row.revision_number != null ? Number(row.revision_number) : null,
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : '',
    finalizedAt: row.finalized_at != null ? new Date(String(row.finalized_at)).toISOString() : null,
  }));
}

export async function getDossierReportHistory(
  dossierId: string,
  ctx: DossierAuthContext,
): Promise<DossierReportHistoryResult | null> {
  if (!isUuid(dossierId)) return null;

  try {
    // Anchor must exist and be owned; no report yet is a valid empty history (queued/in-flight runs).
    const anchor = await queryOne<{ report_id: string | null; root_report_id: string | null }>(
      `SELECT d.report_id,
              COALESCE(r.root_report_id, r.id) AS root_report_id
       FROM v_dossier d
       LEFT JOIN reports r ON r.id = d.report_id
       WHERE d.dossier_id = $1::uuid AND ${dossierOwnershipSql(ctx, 2, 3)}
       LIMIT 1`,
      [dossierId, ctx.userId, ctx.orgId],
    );
    if (!anchor) return null;
    if (!anchor.root_report_id && !anchor.report_id) {
      return { entries: [] };
    }

    const rootId = anchor.root_report_id ?? anchor.report_id;

    // Prefer full lineage (revisions). Fall back to the single linked report if
    // report_revisions / root_report_id columns are unavailable or the lineage query fails.
    try {
      const reportRows = await query<Record<string, unknown>>(
        `SELECT r.id AS report_id,
                r.version_number,
                r.title,
                r.status::text AS status,
                r.parent_report_id,
                r.created_at,
                r.finalized_at,
                (
                  SELECT rv.revision_number
                  FROM report_revisions rv
                  WHERE rv.revised_report_id = r.id
                  ORDER BY rv.revision_number DESC
                  LIMIT 1
                ) AS revision_number
         FROM reports r
         WHERE COALESCE(r.root_report_id, r.id) = $1::uuid
           AND EXISTS (
             SELECT 1 FROM v_dossier vd
             WHERE vd.report_id = r.id AND ${dossierOwnershipSql(ctx, 2, 3)}
           )
         ORDER BY r.version_number ASC NULLS LAST, r.created_at ASC`,
        [rootId, ctx.userId, ctx.orgId],
      );
      return { entries: mapHistoryRows(reportRows) };
    } catch (lineageErr) {
      if (!isDossierDeploySkewPgError(lineageErr)) {
        logger.warn('dossier report history: lineage query failed; using single-report fallback', {
          dossierId,
          err: String(lineageErr),
        });
      } else {
        logger.debug('dossier report history: lineage columns unavailable (deploy skew)', {
          dossierId,
          err: String(lineageErr),
        });
      }
    }

    // Single-report fallback — still ownership-checked via the anchor.
    if (!anchor.report_id) {
      return { entries: [] };
    }
    try {
      const single = await query<Record<string, unknown>>(
        `SELECT r.id AS report_id,
                COALESCE(r.version_number, 1) AS version_number,
                r.title,
                r.status::text AS status,
                r.parent_report_id,
                r.created_at,
                r.finalized_at,
                NULL::int AS revision_number
         FROM reports r
         WHERE r.id = $1::uuid
         LIMIT 1`,
        [anchor.report_id],
      );
      return { entries: mapHistoryRows(single) };
    } catch (singleErr) {
      if (isDossierDeploySkewPgError(singleErr) || isViewMissingPgError(singleErr)) {
        logger.debug('dossier report history: reports unavailable (deploy skew)', {
          dossierId,
          err: String(singleErr),
        });
        return { entries: [] };
      }
      throw singleErr;
    }
  } catch (e) {
    if (isViewMissingPgError(e) || isDossierDeploySkewPgError(e)) {
      logger.debug('dossier report history: schema unavailable (deploy skew)', {
        dossierId,
        err: String(e),
      });
      // Owned dossier with no readable history must not 500 the detail page.
      return { entries: [] };
    }
    // Only escalate true tenant-scope column loss on the ownership predicate path.
    rejectUnscopedReadOnScopeError(e, 'dossierReadService.getDossierReportHistory');
  }
}

export async function getDossierSpinoffs(
  dossierId: string,
  ctx: DossierAuthContext,
): Promise<DossierSpinoffsResult | null> {
  if (!isUuid(dossierId)) return null;

  try {
    const anchor = await queryOne<{ run_id: string; report_id: string | null }>(
      `SELECT run_id, report_id FROM v_dossier WHERE dossier_id = $1::uuid AND ${dossierOwnershipSql(ctx, 2, 3)} LIMIT 1`,
      [dossierId, ctx.userId, ctx.orgId],
    );
    if (!anchor) return null;

    let rows: Record<string, unknown>[];
    try {
      rows = await query<Record<string, unknown>>(
        `SELECT dossier_id, run_id, request_query, run_status, engine_version,
                report_id, spinoff_from_report_id, dossier_created_at
         FROM v_dossier
         WHERE (${buildOwnershipSql('', 3, 4)})
           AND (spinoff_from_run_id = $1::uuid
            OR ($2::uuid IS NOT NULL AND spinoff_from_report_id = $2::uuid))
         ORDER BY dossier_created_at DESC`,
        [anchor.run_id, anchor.report_id, ctx.userId, ctx.orgId],
      );
    } catch (spinoffErr) {
      if (!isDossierDeploySkewPgError(spinoffErr)) throw spinoffErr;
      logger.debug('dossier spinoffs: spinoff columns unavailable (deploy skew)', { dossierId, err: String(spinoffErr) });
      return { spinoffs: [] };
    }

    const spinoffs: DossierSpinoffEntry[] = rows.map((row) => ({
      runId: String(row.run_id),
      dossierId: String(row.dossier_id),
      query: String(row.request_query ?? ''),
      runStatus: String(row.run_status ?? ''),
      engineVersion: row.engine_version != null ? String(row.engine_version) : null,
      reportId: row.report_id != null ? String(row.report_id) : null,
      spinoffFromReportId: row.spinoff_from_report_id != null ? String(row.spinoff_from_report_id) : null,
      createdAt: row.dossier_created_at ? new Date(String(row.dossier_created_at)).toISOString() : '',
    }));

    return { spinoffs };
  } catch (e) {
    if (isViewMissingPgError(e)) {
      logger.debug('dossier spinoffs: v_dossier unavailable (deploy skew)', { dossierId, err: String(e) });
      return null;
    }
    rejectUnscopedReadOnScopeError(e, 'dossierReadService.getDossierSpinoffs');
  }
}

export async function getDossierSources(
  dossierId: string,
  ctx: DossierAuthContext,
): Promise<DossierSourcesResult | null> {
  if (!isUuid(dossierId)) return null;

  try {
    const anchor = await queryOne<{ run_id: string; report_id: string | null }>(
      `SELECT run_id, report_id FROM v_dossier WHERE dossier_id = $1::uuid AND ${dossierOwnershipSql(ctx, 2, 3)} LIMIT 1`,
      [dossierId, ctx.userId, ctx.orgId],
    );
    if (!anchor) return null;

    const sourceRows = await query<Record<string, unknown>>(
      `SELECT s.id AS source_id,
              s.title,
              s.url,
              s.source_type::text AS source_type,
              s.discovered_by_run_id,
              s.fetch_method,
              (
                SELECT ij.status::text
                FROM ingestion_jobs ij
                WHERE ij.source_id = s.id
                ORDER BY ij.created_at DESC
                LIMIT 1
              ) AS ingestion_status,
              (
                SELECT COUNT(*)::int
                FROM chunks c
                WHERE c.source_id = s.id
              ) AS chunk_count,
              EXISTS (
                SELECT 1 FROM report_citations rc
                WHERE ($2::uuid IS NOT NULL AND rc.report_id = $2::uuid)
                  AND (
                    rc.source_id = s.id
                    OR (
                      rc.chunk_id IS NOT NULL
                      AND rc.source_id IS NULL
                      AND EXISTS (
                        SELECT 1 FROM chunks c
                        WHERE c.id = rc.chunk_id
                          AND c.source_id = s.id
                      )
                    )
                  )
              ) AS cited_in_report
       FROM sources s
       WHERE s.discovered_by_run_id = $1::uuid
       ORDER BY s.ingested_at DESC NULLS LAST`,
      [anchor.run_id, anchor.report_id],
    );

    const sources: DossierSourceEntry[] = sourceRows.map((row) => {
      const ingestionStatus = row.ingestion_status != null ? String(row.ingestion_status) : null;
      const fetchMethod = row.fetch_method != null ? String(row.fetch_method) : null;
      const fetchStatus =
        ingestionStatus === 'failed'
          ? 'failed'
          : ingestionStatus === 'completed'
            ? 'success'
            : fetchMethod
              ? 'success'
              : ingestionStatus;

      return {
        sourceId: String(row.source_id),
        title: row.title != null ? String(row.title) : null,
        url: row.url != null ? String(row.url) : null,
        sourceType: row.source_type != null ? String(row.source_type) : null,
        ingestionStatus,
        fetchStatus,
        citedInReport: Boolean(row.cited_in_report),
        discoveredByRunId: row.discovered_by_run_id != null ? String(row.discovered_by_run_id) : null,
        chunkCount: row.chunk_count != null ? Number(row.chunk_count) : null,
      };
    });

    return { sources };
  } catch (e) {
    if (isViewMissingPgError(e)) {
      logger.debug('dossier sources: v_dossier unavailable (deploy skew)', { dossierId, err: String(e) });
      return null;
    }
    rejectUnscopedReadOnScopeError(e, 'dossierReadService.getDossierSources');
  }
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

