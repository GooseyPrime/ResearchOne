/**
 * Saves the citations of a locked report: one row per citation in the text,
 * tied to its section, its passage and its source, with a quote copied word for
 * word from the passage. Nothing here calls a model.
 */
import { withTransaction } from '../../db/pool';
import { logger } from '../../utils/logger';
import type { BoundCitation } from './citationLock';

/** The part of a database client this needs; the report save passes its own transaction. */
export interface CitationWriter {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Write the rows through a transaction the caller owns. The report save uses
 * this so a report and its citations are committed together or not at all.
 */
export async function writeBoundCitations(
  client: CitationWriter,
  args: { runId: string; reportId: string; bound: BoundCitation[] }
): Promise<number> {
  const { runId, reportId, bound } = args;
  // Saving twice must leave one set of rows.
  await client.query(`DELETE FROM report_citations WHERE report_id = $1`, [reportId]);
  if (bound.length === 0) return 0;

  const sectionRows = (await client.query(`SELECT id, section_order FROM report_sections WHERE report_id = $1`, [reportId])).rows;
  const sectionIdByOrder = new Map(sectionRows.map((row) => [Number(row.section_order), String(row.id)]));

  const chunkIds = [...new Set(bound.map((row) => row.chunkId))];
  const sourceRows = (await client.query(`SELECT id, source_id FROM chunks WHERE id = ANY($1::uuid[])`, [chunkIds])).rows;
  const sourceIdByChunk = new Map(sourceRows.map((row) => [String(row.id), (row.source_id as string | null) ?? null]));

  let written = 0;
  for (const row of bound) {
    // A passage that is no longer stored cannot back a citation. The report
    // shows the number, so this is a failed save, not a row to skip: throwing
    // rolls the whole transaction back.
    if (!sourceIdByChunk.has(row.chunkId)) {
      throw new Error(`Cited passage ${row.chunkId} is no longer stored; citation ${row.order} cannot be saved`);
    }
    // Every citation sits in a saved section. One that cannot be placed would be
    // a number in the text that no section can look up, so it fails the save too.
    const sectionId = row.sectionOrder == null ? undefined : sectionIdByOrder.get(row.sectionOrder);
    if (!sectionId) {
      throw new Error(`Citation ${row.order} has no saved section; it cannot be saved`);
    }
    await client.query(
      `INSERT INTO report_citations (
         report_id, section_id, chunk_id, source_id, chunk_quote, citation_order, citation_text
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        reportId,
        sectionId,
        row.chunkId,
        sourceIdByChunk.get(row.chunkId) ?? null,
        row.quote,
        row.order,
        `[${row.number}]`,
      ]
    );
    written += 1;
  }
  logger.info(`[citations:${runId}] Saved ${written} bound citation(s)`);
  return written;
}

/** The same save in a transaction of its own. */
export async function persistBoundCitations(args: { runId: string; reportId: string; bound: BoundCitation[] }): Promise<number> {
  return withTransaction((client) => writeBoundCitations(client as unknown as CitationWriter, args));
}

/**
 * Save what the link check found beside each saved citation of a report, in
 * the transaction that saves the citations, so the two cannot come apart.
 * Before migration 059 the columns do not exist (42703): that one case is
 * undone to a savepoint and skipped, leaving the transaction usable. Any other
 * failure is thrown and fails the save, like any other part of it.
 */
export async function recordDoiChecks(client: CitationWriter, reportId: string, checks: Array<{ chunkId: string; status: string | null; notice: string | null }>): Promise<void> {
  if (checks.length === 0) return;
  const groups = new Map<string, { status: string | null; notice: string | null; chunkIds: string[] }>();
  for (const check of checks) {
    const key = `${check.status ?? ''}\u0000${check.notice ?? ''}`;
    const group = groups.get(key) ?? { status: check.status, notice: check.notice, chunkIds: [] };
    group.chunkIds.push(check.chunkId);
    groups.set(key, group);
  }
  await client.query('SAVEPOINT link_check_notes');
  try {
    for (const group of groups.values()) {
      await client.query(`UPDATE report_citations SET resolve_status=$2, editorial_notice=$3 WHERE report_id=$1 AND chunk_id = ANY($4::uuid[])`, [reportId, group.status, group.notice, group.chunkIds]);
    }
    await client.query('RELEASE SAVEPOINT link_check_notes');
  } catch (err) {
    const missingColumn = (err as { code?: string })?.code === '42703' && /resolve_status|editorial_notice/.test(String((err as Error)?.message ?? ''));
    if (!missingColumn) throw err;
    await client.query('ROLLBACK TO SAVEPOINT link_check_notes');
    logger.debug('[citation-lock] link-check columns not present yet; note not saved', { reportId });
  }
}
