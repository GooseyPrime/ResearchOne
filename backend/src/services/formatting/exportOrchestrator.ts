/**
 * Export orchestrator — coordinates a single export job from report
 * lookup through pandoc invocation through output persistence.
 *
 * Called by:
 *   - `reportExportWorker.ts` (BullMQ — the production path)
 *   - synchronous `/api/reports/:id/export` with `sync: true` (only
 *     markdown and HTML; server-enforced short pandoc timeout)
 *
 * Per Cursor rule 28 invariants applied across this file:
 *   I-7 cslConverter is consulted as a pure function for the source
 *       set assigned to the report's citations.
 *   I-8 evidenceAliaser provides stable [E1]-style aliases.
 *   I-2 / I-5 pandocRunner handles the sandboxing — orchestrator
 *       just hands it markdown + bibliography.
 *
 * Returned `outputBuffer` is what the API route writes to the
 * response or uploads to object storage. The pandocRunner tempdir is
 * already cleaned by the time orchestrator returns.
 */
import { adminQuery } from '../../db/pool';
import { assignEvidenceAliases, aliasesToCslBibliography, rewriteAliasesForPandoc } from './evidenceAliaser';
import { runPandoc, PandocError, type ExportFormat, type ExportStyle } from './pandocRunner';
import { runScope } from '../telemetry';
import { logger } from '../../utils/logger';
import { stripInternalLabelsFromReport } from './reportPresentation';
import { readerExportBody } from './readerExport';
import { readerViewForRun } from '../eval/readerView';
import { resolveReferenceStyle, type ReferenceStyle } from './referenceList';
import { sourcesByNumber, withReferenceStyle, type LockedCitationSourceRow } from './lockedReportExport';

/** What an export may ask for: a named style, or the numbered default. */
export type RequestedExportStyle = ExportStyle | 'numeric';

/** The style file Pandoc is given. The numbered default has no author-date form; IEEE is the numbered style on file. */
export function pandocStyleFor(style: RequestedExportStyle): ExportStyle {
  return style === 'numeric' ? 'ieee' : style;
}

export interface ExportJobInput {
  reportId: string;
  format: ExportFormat;
  style: RequestedExportStyle;
  /** User who initiated the export (for scope + audit). */
  userId?: string | null;
  /** Override default pandoc wall-clock timeout (ms). */
  pandocTimeoutMs?: number;
}

export interface ExportJobOutput {
  format: ExportFormat;
  style: RequestedExportStyle;
  outputBuffer: Buffer;
  outputBytes: number;
  pandocDurationMs: number;
  aliasCount: number;
}

/**
 * Orchestrate one export job.
 *
 * Throws `PandocError` for classified failures; the caller is
 * responsible for translating to HTTP / queue status.
 *
 * Sets the runScope for cost telemetry (Rule 25 I-2): exports that
 * invoke the `citation_formatter` LLM role flow their telemetry
 * under (reportId, userId).
 */
export async function exportReport(input: ExportJobInput): Promise<ExportJobOutput> {
  return runScope.run(
    {
      runId: null,
      reportId: input.reportId,
      userId: input.userId ?? null,
    },
    () => exportReportInner(input)
  );
}

async function exportReportInner(input: ExportJobInput): Promise<ExportJobOutput> {
  const { reportId, format, style } = input;

  // 1. Load report title + markdown body from real schema columns
  //    (`report_sections`, not a fictional `reports.body_markdown`).
  const { title, bodyMarkdown } = await loadReportMarkdownForExport(reportId);

  // A report written with the citation lock is exported as it was saved:
  // its numbers and its reference list are already in the text.
  const state = await loadLockedReportState(reportId);
  // Slice 5: a report in the reader view is exported as the reader view shows it.
  const readerView = await readerViewForRun(state?.runId);
  if (state?.savedStyle) return exportLockedReport(input, state.savedStyle, readerView);

  // 2. Assign / load evidence aliases for this report.
  const aliases = await assignEvidenceAliases(reportId);
  logger.info('export: aliases ready', {
    reportId, aliasCount: aliases.length, format, style,
  });

  // 3. Rewrite the report body to use pandoc citation syntax.
  //    Input:  "... as shown in [E1] ..."
  //    Output: "... as shown in [@E1] ..."
  const rewrittenBody = rewriteAliasesForPandoc(readerView ? readerExportBody(title, bodyMarkdown) : bodyMarkdown);

  // 4. Wrap the body in a minimal title-block so pandoc can produce
  //    a proper document.
  const titleBlock = title
    ? `---\ntitle: ${JSON.stringify(stripInternalLabelsFromReport(title))}\n---\n\n`
    : '';

  // 5. Build the CSL-JSON bibliography from the aliases.
  const bibliography = aliasesToCslBibliography(aliases);

  // 6. Run pandoc.
  const pandocResult = await runPandoc({
    markdown: `${titleBlock}${rewrittenBody}\n\n## References\n`,
    cslJson: bibliography,
    format,
    style: pandocStyleFor(style),
    timeoutMs: input.pandocTimeoutMs,
  });

  return {
    format,
    style,
    outputBuffer: pandocResult.outputBuffer,
    outputBytes: pandocResult.outputBytes,
    pandocDurationMs: pandocResult.durationMs,
    aliasCount: aliases.length,
  };
}

/**
 * Whether the report's run wrote it with the citation lock, and the reference
 * style it was saved in, with the run that wrote it. `savedStyle` is null for
 * every other report. Null altogether for a database that does not have the
 * columns this reads: those reports export as they always did.
 */
async function loadLockedReportState(reportId: string): Promise<{ savedStyle: ReferenceStyle | null; runId: string | null } | null> {
  try {
    const rows = await adminQuery<{ locked: string | null; reference_style: string | null; citation_style: string | null; run_id?: string | null }>(
      `SELECT rr.corpus_after->>'citationLock' AS locked,
              r.metadata->>'reference_style' AS reference_style,
              rr.citation_style,
              r.run_id
         FROM reports r
         LEFT JOIN research_runs rr ON rr.id = r.run_id
        WHERE r.id = $1
        LIMIT 1`,
      [reportId]
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    const runId = typeof row.run_id === 'string' ? row.run_id : null;
    // `savedStyle` is set only for a report written with the citation lock.
    if (row.locked !== 'true') return { savedStyle: null, runId };
    return { savedStyle: resolveReferenceStyle(row.reference_style ?? row.citation_style), runId };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42703' || code === '42P01') {
      logger.debug('export: lock state unavailable on this schema; exporting as an unlocked report', { reportId });
      return null;
    }
    throw err;
  }
}

async function exportLockedReport(input: ExportJobInput, savedStyle: ReferenceStyle, readerView: boolean): Promise<ExportJobOutput> {
  const { reportId, format, style } = input;
  const metaRows = await adminQuery<ReportMetaRow>(`SELECT title, executive_summary, conclusion FROM reports WHERE id = $1 LIMIT 1`, [reportId]);
  if (metaRows.length === 0) throw new PandocError(`report not found: ${reportId}`, 'validation_error');
  const saved = await adminQuery<SectionRow>(
    `SELECT title, content, section_order FROM report_sections WHERE report_id = $1 ORDER BY section_order ASC`,
    [reportId]
  );
  if (saved.length === 0) throw new PandocError(`report has no body content: ${reportId}`, 'validation_error');

  let sections = saved;
  const wanted = resolveReferenceStyle(style);
  if (wanted !== savedStyle) {
    const citationRows = await adminQuery<LockedCitationSourceRow>(
      `SELECT rc.citation_text, s.title, s.authors, s.publication, s.published_at, s.url, s.original_filename,
              s.retrieval_timestamp, s.metadata->'bibliographic'->>'provider' AS provider,
              s.metadata->'bibliographic'->>'kind' AS kind
         FROM report_citations rc
         JOIN sources s ON s.id = rc.source_id
        WHERE rc.report_id = $1
        ORDER BY rc.citation_order ASC NULLS LAST, rc.created_at ASC`,
      [reportId]
    );
    const restyled = withReferenceStyle(saved, sourcesByNumber(citationRows), wanted);
    sections = restyled.sections;
    if (!restyled.rebuilt) {
      // The sources behind the citations no longer match the saved list (a
      // source was removed, or the list was edited). Handing over the saved
      // list under the name of the style asked for would be a file that is not
      // what its label says, so the export is refused with the reason.
      logger.warn('export: reference list could not be written in the requested style', { reportId, wanted, savedStyle });
      throw new PandocError(
        `The reference list of this report cannot be rewritten in the ${wanted} style. Export it in the style it was saved in (${savedStyle}).`,
        'validation_error'
      );
    }
  }

  const title = metaRows[0].title ?? null;
  const assembled = sections
    .map((section) => `## ${stripInternalLabelsFromReport(section.title)}\n\n${stripInternalLabelsFromReport(section.content)}`)
    .join('\n\n');
  const body = readerView ? readerExportBody(title, assembled) : assembled;
  const titleBlock = title ? `---\ntitle: ${JSON.stringify(stripInternalLabelsFromReport(title))}\n---\n\n` : '';
  const pandocResult = await runPandoc({
    markdown: `${titleBlock}${body}\n`,
    cslJson: [],
    format,
    style: pandocStyleFor(style),
    timeoutMs: input.pandocTimeoutMs,
  });
  return {
    format,
    style,
    outputBuffer: pandocResult.outputBuffer,
    outputBytes: pandocResult.outputBytes,
    pandocDurationMs: pandocResult.durationMs,
    aliasCount: 0,
  };
}

interface ReportMetaRow {
  title: string;
  executive_summary: string | null;
  conclusion: string | null;
}

interface SectionRow {
  title: string;
  content: string;
  section_order: number;
}

async function loadReportMarkdownForExport(
  reportId: string
): Promise<{ title: string | null; bodyMarkdown: string }> {
  const metaRows = await adminQuery<ReportMetaRow>(
    `SELECT title, executive_summary, conclusion
       FROM reports
      WHERE id = $1
      LIMIT 1`,
    [reportId]
  );
  if (metaRows.length === 0) {
    throw new PandocError(`report not found: ${reportId}`, 'validation_error');
  }
  const meta = metaRows[0];

  const sectionRows = await adminQuery<SectionRow>(
    `SELECT title, content, section_order
       FROM report_sections
      WHERE report_id = $1
      ORDER BY section_order ASC`,
    [reportId]
  );

  let body: string;
  if (sectionRows.length > 0) {
    body = sectionRows
      .map((s) => `## ${stripInternalLabelsFromReport(s.title)}\n\n${stripInternalLabelsFromReport(s.content)}`)
      .join('\n\n');
  } else {
    const parts: string[] = [];
    if (meta.executive_summary?.trim()) {
      parts.push(`## Executive summary\n\n${stripInternalLabelsFromReport(meta.executive_summary)}`);
    }
    if (meta.conclusion?.trim()) {
      parts.push(`## Conclusion\n\n${stripInternalLabelsFromReport(meta.conclusion)}`);
    }
    body = parts.join('\n\n');
  }

  if (!body.trim()) {
    throw new PandocError(`report has no body content: ${reportId}`, 'validation_error');
  }

  return { title: meta.title ?? null, bodyMarkdown: body };
}
