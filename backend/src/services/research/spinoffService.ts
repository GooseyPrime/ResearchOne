import { query } from '../../db/pool';
import { buildOwnershipSql, rejectUnscopedReadOnScopeError } from '../../db/tenantScope';

/** Marker in merged supplemental so tests can assert prior-report context was injected. */
export const SPINOFF_PRIOR_REPORT_MARKER = '[Spinoff prior report context';

const PRIOR_REPORT_CONTEXT_MAX_CHARS = 8000;

export type SpinoffParentReport = {
  reportId: string;
  runId: string | null;
  title: string;
  query: string;
  supplemental: string | null;
  engineVersion: string | null;
  researchObjective: string | null;
  targetWordCount: number | null;
  citationStyle: string | null;
  modelOverrides: Record<string, unknown> | null;
  supplementalAttachments: unknown;
};

export type SpinoffPrefill = {
  fromReportId: string;
  fromRunId?: string;
  reportTitle: string;
  query: string;
  supplemental?: string | null;
  engineVersion?: string | null;
  researchObjective?: string | null;
  citationStyle?: string | null;
  targetWordCount?: number | null;
  modelOverrides?: Record<string, unknown> | null;
  filterTags?: string[];
};

type AuthScope = { userId: string | null; orgId: string | null };

/** Unwrap persisted `{ overrides: { role: … } }` envelope for spinoff prefill consumers. */
function flattenModelOverridesForPrefill(
  raw: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const nested = raw.overrides;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return raw;
}

export async function resolveOwnedReportForSpinoff(
  reportId: string,
  auth: AuthScope
): Promise<SpinoffParentReport | null> {
  const { userId, orgId } = auth;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await query(
      `SELECT r.id AS report_id, r.title, r.run_id,
              rr.query, rr.supplemental, rr.engine_version, rr.research_objective,
              rr.target_word_count, rr.citation_style, rr.model_overrides,
              rr.supplemental_attachments
         FROM reports r
         LEFT JOIN research_runs rr ON rr.id = r.run_id
        WHERE r.id = $1 AND ${buildOwnershipSql('r', 2, 3)}`,
      [reportId, userId, orgId]
    );
  } catch (scopeErr) {
    rejectUnscopedReadOnScopeError(scopeErr, 'spinoffService.resolveOwnedReportForSpinoff');
  }

  if (rows.length === 0) return null;
  const row = rows[0];
  const runId = (row.run_id as string | null) ?? null;

  return {
    reportId: String(row.report_id),
    runId,
    title: String(row.title ?? ''),
    query: String(row.query ?? ''),
    supplemental: (row.supplemental as string | null) ?? null,
    engineVersion: (row.engine_version as string | null) ?? null,
    researchObjective: (row.research_objective as string | null) ?? null,
    targetWordCount:
      typeof row.target_word_count === 'number' ? row.target_word_count : null,
    citationStyle: (row.citation_style as string | null) ?? null,
    modelOverrides: (row.model_overrides as Record<string, unknown> | null) ?? null,
    supplementalAttachments: row.supplemental_attachments ?? null,
  };
}

export async function buildPriorReportContextBlock(reportId: string): Promise<string> {
  const reportRows = await query<{ title: string }>(
    'SELECT title FROM reports WHERE id=$1',
    [reportId]
  );
  const title = reportRows[0]?.title ?? 'Prior report';
  const sections = await query<{ title: string; content: string }>(
    'SELECT title, content FROM report_sections WHERE report_id=$1 ORDER BY section_order',
    [reportId]
  );
  const parts: string[] = [
    `${SPINOFF_PRIOR_REPORT_MARKER} — report "${title}"]`,
    '',
  ];
  for (const sec of sections) {
    parts.push(`## ${sec.title}`);
    parts.push(sec.content ?? '');
    parts.push('');
  }
  return parts.join('\n').slice(0, PRIOR_REPORT_CONTEXT_MAX_CHARS);
}

/** Inject prior-report block unless user supplemental already includes the marker. */
export function mergeSupplementalWithPriorContext(
  userSupplemental: string,
  priorBlock: string
): string {
  const trimmed = userSupplemental.trim();
  if (trimmed.includes(SPINOFF_PRIOR_REPORT_MARKER)) {
    return trimmed;
  }
  if (!trimmed) return priorBlock;
  return `${priorBlock}\n\n---\n\nUser supplemental:\n${trimmed}`;
}

export function mapParentToSpinoffPrefill(parent: SpinoffParentReport): SpinoffPrefill {
  return {
    fromReportId: parent.reportId,
    fromRunId: parent.runId ?? undefined,
    reportTitle: parent.title,
    query: parent.query,
    supplemental: parent.supplemental,
    engineVersion: parent.engineVersion,
    researchObjective: parent.researchObjective,
    citationStyle: parent.citationStyle,
    targetWordCount: parent.targetWordCount,
    modelOverrides: flattenModelOverridesForPrefill(parent.modelOverrides),
    filterTags: [],
  };
}

export async function getSpinoffPrefill(
  reportId: string,
  auth: AuthScope
): Promise<SpinoffPrefill | null> {
  const parent = await resolveOwnedReportForSpinoff(reportId, auth);
  if (!parent) return null;
  return mapParentToSpinoffPrefill(parent);
}

export type SpinoffLineage = {
  spinoffFromRunId: string | null;
  spinoffFromReportId: string;
};

/** INSERT research_runs with deploy-skew fallbacks; lineage columns optional when migration 046 absent. */
export async function insertQueuedResearchRunWithLineage(params: {
  runId: string;
  title: string;
  query: string;
  supplemental: string;
  normalizedOverridesJson: string;
  attachmentsJson: string;
  engineVersion: string | null;
  researchObjective: string | null;
  targetWordCount: number | null;
  userId: string | null;
  orgId: string | null;
  lineage?: SpinoffLineage;
}): Promise<void> {
  const {
    runId,
    title,
    query: researchQuery,
    supplemental,
    normalizedOverridesJson,
    attachmentsJson,
    engineVersion,
    researchObjective,
    targetWordCount,
    userId,
    orgId,
    lineage,
  } = params;

  if (lineage) {
    try {
      await query(
        `INSERT INTO research_runs (
           id, title, query, supplemental, status, model_overrides, supplemental_attachments,
           engine_version, research_objective, target_word_count, user_id, org_id,
           spinoff_from_run_id, spinoff_from_report_id
         ) VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)`,
        [
          runId,
          title,
          researchQuery,
          supplemental ?? '',
          normalizedOverridesJson,
          attachmentsJson,
          engineVersion,
          researchObjective,
          targetWordCount,
          userId,
          orgId,
          lineage.spinoffFromRunId,
          lineage.spinoffFromReportId,
        ]
      );
      return;
    } catch (insertErr) {
      const code = (insertErr as { code?: string } | null)?.code;
      if (code !== '42703') throw insertErr;
      // migration 046 not applied — fall through to standard INSERT without lineage
    }
  }

  try {
    await query(
      `INSERT INTO research_runs (id, title, query, supplemental, status, model_overrides, supplemental_attachments, engine_version, research_objective, target_word_count, user_id, org_id)
       VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, $7, $8, $9, $10, $11)`,
      [
        runId,
        title,
        researchQuery,
        supplemental ?? '',
        normalizedOverridesJson,
        attachmentsJson,
        engineVersion,
        researchObjective,
        targetWordCount,
        userId,
        orgId,
      ]
    );
  } catch (insertErr) {
    if (userId) {
      rejectUnscopedReadOnScopeError(insertErr, 'spinoffService.insertQueuedResearchRunWithLineage');
    }
    const code = (insertErr as { code?: string } | null)?.code;
    if (code !== '42703') throw insertErr;
    await query(
      `INSERT INTO research_runs (id, title, query, supplemental, status, model_overrides, supplemental_attachments, engine_version, research_objective, target_word_count)
       VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, $7, $8, $9)`,
      [
        runId,
        title,
        researchQuery,
        supplemental ?? '',
        normalizedOverridesJson,
        attachmentsJson,
        engineVersion,
        researchObjective,
        targetWordCount,
      ]
    );
  }
}
