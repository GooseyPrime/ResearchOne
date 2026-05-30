/**
 * Flat dossier timeline events (Wave 5.5+ Gate 5).
 * Reads through v_dossier + related tables with RLS via security_invoker view.
 */
import { query } from '../../db/pool';
import { logger } from '../../utils/logger';
import type {
  DossierAuthContext,
  DossierTimelineFilters,
  DossierTimelineResult,
  DossierTimelineRow,
} from '../../types/dossier';

function isDossierDeploySkewPgError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === '42P01' || code === '42703';
}

function mapTimelineRow(r: Record<string, unknown>): DossierTimelineRow {
  return {
    occurredAt: r.occurred_at ? new Date(String(r.occurred_at)).toISOString() : '',
    eventType: String(r.event_type ?? ''),
    dossierId: r.dossier_id != null ? String(r.dossier_id) : null,
    runId: r.run_id != null ? String(r.run_id) : null,
    reportId: r.report_id != null ? String(r.report_id) : null,
    query: r.query != null ? String(r.query) : null,
    revisionNumber: r.revision_number != null ? Number(r.revision_number) : null,
    engineVersion: r.engine_version != null ? String(r.engine_version) : null,
    runStatus: r.run_status != null ? String(r.run_status) : null,
  };
}

const TIMELINE_UNION = `
  SELECT d.dossier_created_at AS occurred_at,
         'initial_run'::text AS event_type,
         d.dossier_id,
         d.run_id,
         d.report_id,
         d.request_query AS query,
         NULL::int AS revision_number,
         d.engine_version,
         d.run_status::text AS run_status
  FROM v_dossier d
  WHERE NOT COALESCE(d.is_spinoff, false)

  UNION ALL

  SELECT d.dossier_created_at AS occurred_at,
         'research_spinoff'::text AS event_type,
         d.dossier_id,
         d.run_id,
         d.report_id,
         d.request_query AS query,
         NULL::int AS revision_number,
         d.engine_version,
         d.run_status::text AS run_status
  FROM v_dossier d
  WHERE COALESCE(d.is_spinoff, false)

  UNION ALL

  SELECT rv.created_at AS occurred_at,
         'report_revision'::text AS event_type,
         d.dossier_id,
         d.run_id,
         rv.revised_report_id AS report_id,
         d.request_query AS query,
         rv.revision_number,
         d.engine_version,
         d.run_status::text AS run_status
  FROM report_revisions rv
  JOIN reports r ON r.id = rv.report_id
  JOIN v_dossier d ON d.run_id = r.run_id

  UNION ALL

  SELECT pr.created_at AS occurred_at,
         'plan_refinement'::text AS event_type,
         d.dossier_id,
         d.run_id,
         d.report_id,
         d.request_query AS query,
         pr.revision_number,
         d.engine_version,
         d.run_status::text AS run_status
  FROM plan_revisions pr
  JOIN research_plans rp ON rp.id = pr.plan_id
  JOIN v_dossier d ON d.run_id = rp.run_id
`;

/** Spinoff columns may be absent before migration 047 — fall back to initial_run + revisions only. */
const TIMELINE_UNION_LEGACY = `
  SELECT d.dossier_created_at AS occurred_at,
         'initial_run'::text AS event_type,
         d.dossier_id,
         d.run_id,
         d.report_id,
         d.request_query AS query,
         NULL::int AS revision_number,
         d.engine_version,
         d.run_status::text AS run_status
  FROM v_dossier d

  UNION ALL

  SELECT rv.created_at AS occurred_at,
         'report_revision'::text AS event_type,
         d.dossier_id,
         d.run_id,
         rv.revised_report_id AS report_id,
         d.request_query AS query,
         rv.revision_number,
         d.engine_version,
         d.run_status::text AS run_status
  FROM report_revisions rv
  JOIN reports r ON r.id = rv.report_id
  JOIN v_dossier d ON d.run_id = r.run_id

  UNION ALL

  SELECT pr.created_at AS occurred_at,
         'plan_refinement'::text AS event_type,
         d.dossier_id,
         d.run_id,
         d.report_id,
         d.request_query AS query,
         pr.revision_number,
         d.engine_version,
         d.run_status::text AS run_status
  FROM plan_revisions pr
  JOIN research_plans rp ON rp.id = pr.plan_id
  JOIN v_dossier d ON d.run_id = rp.run_id
`;

export async function listTimelineEvents(
  filters: DossierTimelineFilters,
  _ctx: DossierAuthContext,
): Promise<DossierTimelineResult> {
  const page = Math.max(1, filters.page);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize));
  const offset = (page - 1) * pageSize;

  const conds: string[] = ['1=1'];
  const params: unknown[] = [];
  let p = 1;

  if (filters.dateFrom) {
    conds.push(`occurred_at >= $${p++}::timestamptz`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conds.push(`occurred_at <= $${p++}::timestamptz`);
    params.push(filters.dateTo);
  }

  const where = conds.join(' AND ');
  const listParams = [...params, pageSize, offset];
  const limIdx = params.length + 1;
  const offIdx = params.length + 2;

  let countRows: { c: string }[];
  let rows: Record<string, unknown>[];

  try {
    countRows = await query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM (${TIMELINE_UNION}) events WHERE ${where}`,
      params,
    );
    rows = await query<Record<string, unknown>>(
      `SELECT * FROM (${TIMELINE_UNION}) events
       WHERE ${where}
       ORDER BY occurred_at DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      listParams,
    );
  } catch (e) {
    if (!isDossierDeploySkewPgError(e)) throw e;
    logger.debug('dossier timeline: extended union unavailable (deploy skew)', { err: String(e) });
    try {
      countRows = await query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM (${TIMELINE_UNION_LEGACY}) events WHERE ${where}`,
        params,
      );
      rows = await query<Record<string, unknown>>(
        `SELECT * FROM (${TIMELINE_UNION_LEGACY}) events
         WHERE ${where}
         ORDER BY occurred_at DESC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        listParams,
      );
    } catch (fallbackErr) {
      if (isDossierDeploySkewPgError(fallbackErr)) {
        logger.debug('dossier timeline: v_dossier unavailable (deploy skew)', { err: String(fallbackErr) });
        return { rows: [], total: 0, page, pageSize };
      }
      throw fallbackErr;
    }
  }

  const total = Number(countRows[0]?.c ?? 0);
  const mapped: DossierTimelineRow[] = rows.map(mapTimelineRow);
  return { rows: mapped, total, page, pageSize };
}
