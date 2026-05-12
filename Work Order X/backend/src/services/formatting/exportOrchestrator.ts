/**
 * Export orchestrator — coordinates a single export job from report
 * lookup through pandoc invocation through output persistence.
 *
 * Called by:
 *   - `reportExportWorker.ts` (BullMQ — the production path)
 *   - synchronous `/api/reports/:id/export?sync=true` (small reports
 *     where the user can wait — bounded to 10s)
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
import { readFile } from 'fs/promises';
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
}

export interface ExportJobOutput {
  format: ExportFormat;
  style: ExportStyle;
  outputBuffer: Buffer;
  outputBytes: number;
  pandocDurationMs: number;
  aliasCount: number;
}

interface ReportRow {
  id: string;
  title: string | null;
  body_markdown: string | null;
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

  // 1. Load the report body.
  const reports = await adminQuery<ReportRow>(
    `SELECT id, title, body_markdown
       FROM reports
      WHERE id = $1
      LIMIT 1`,
    [reportId]
  );
  if (reports.length === 0) {
    throw new PandocError(`report not found: ${reportId}`, 'validation_error');
  }
  const report = reports[0];
  if (!report.body_markdown) {
    throw new PandocError(`report has no body content: ${reportId}`, 'validation_error');
  }

  // 2. Assign / load evidence aliases for this report.
  const aliases = await assignEvidenceAliases(reportId);
  logger.info('export: aliases ready', {
    reportId, aliasCount: aliases.length, format, style,
  });

  // 3. Rewrite the report body to use pandoc citation syntax.
  //    Input:  "... as shown in [E1] ..."
  //    Output: "... as shown in [@E1] ..."
  const rewrittenBody = rewriteAliasesForPandoc(report.body_markdown);

  // 4. Wrap the body in a minimal title-block so pandoc can produce
  //    a proper document.
  const titleBlock = report.title
    ? `---\ntitle: ${JSON.stringify(report.title)}\n---\n\n`
    : '';

  // 5. Build the CSL-JSON bibliography from the aliases.
  const bibliography = aliasesToCslBibliography(aliases);

  // 6. Run pandoc.
  const pandocResult = await runPandoc({
    markdown: `${titleBlock}${rewrittenBody}\n\n## References\n`,
    cslJson: bibliography,
    format,
    style,
  });

  // 7. Read the output file before pandocRunner cleans the tempdir.
  //    pandocRunner's `finally` block removes the tempdir AFTER this
  //    function returns, so we must read here.
  const outputBuffer = await readFile(pandocResult.outputPath);

  return {
    format,
    style,
    outputBuffer,
    outputBytes: outputBuffer.length,
    pandocDurationMs: pandocResult.durationMs,
    aliasCount: aliases.length,
  };
}
