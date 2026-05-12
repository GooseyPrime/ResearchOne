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

export interface ExportJobInput {
  reportId: string;
  format: ExportFormat;
  style: ExportStyle;
  /** User who initiated the export (for scope + audit). */
  userId?: string | null;
  /** Override default pandoc wall-clock timeout (ms). */
  pandocTimeoutMs?: number;
}

export interface ExportJobOutput {
  format: ExportFormat;
  style: ExportStyle;
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

  // 2. Assign / load evidence aliases for this report.
  const aliases = await assignEvidenceAliases(reportId);
  logger.info('export: aliases ready', {
    reportId, aliasCount: aliases.length, format, style,
  });

  // 3. Rewrite the report body to use pandoc citation syntax.
  //    Input:  "... as shown in [E1] ..."
  //    Output: "... as shown in [@E1] ..."
  const rewrittenBody = rewriteAliasesForPandoc(bodyMarkdown);

  // 4. Wrap the body in a minimal title-block so pandoc can produce
  //    a proper document.
  const titleBlock = title
    ? `---\ntitle: ${JSON.stringify(title)}\n---\n\n`
    : '';

  // 5. Build the CSL-JSON bibliography from the aliases.
  const bibliography = aliasesToCslBibliography(aliases);

  // 6. Run pandoc.
  const pandocResult = await runPandoc({
    markdown: `${titleBlock}${rewrittenBody}\n\n## References\n`,
    cslJson: bibliography,
    format,
    style,
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
    body = sectionRows.map((s) => `## ${s.title}\n\n${s.content}`).join('\n\n');
  } else {
    const parts: string[] = [];
    if (meta.executive_summary?.trim()) {
      parts.push(`## Executive summary\n\n${meta.executive_summary}`);
    }
    if (meta.conclusion?.trim()) {
      parts.push(`## Conclusion\n\n${meta.conclusion}`);
    }
    body = parts.join('\n\n');
  }

  if (!body.trim()) {
    throw new PandocError(`report has no body content: ${reportId}`, 'validation_error');
  }

  return { title: meta.title ?? null, bodyMarkdown: body };
}
