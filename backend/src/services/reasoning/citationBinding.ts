/**
 * Saves the citations of a locked report: one row per citation in the text,
 * tied to its section, its passage and its source, with a quote copied word for
 * word from the passage. Nothing here calls a model.
 */
import { query, withTransaction } from '../../db/pool';
import { logger } from '../../utils/logger';
import type { BoundCitation } from './citationLock';

export async function persistBoundCitations(args: { runId: string; reportId: string; bound: BoundCitation[] }): Promise<number> {
  const { runId, reportId, bound } = args;
  if (bound.length === 0) return 0;

  const sectionRows = await query<{ id: string; section_order: number }>(
    `SELECT id, section_order FROM report_sections WHERE report_id = $1`,
    [reportId]
  );
  const sectionIdByOrder = new Map(sectionRows.map((row) => [Number(row.section_order), row.id]));

  const chunkIds = [...new Set(bound.map((row) => row.chunkId))];
  const sourceRows = await query<{ id: string; source_id: string | null }>(
    `SELECT id, source_id FROM chunks WHERE id = ANY($1::uuid[])`,
    [chunkIds]
  );
  const sourceIdByChunk = new Map(sourceRows.map((row) => [row.id, row.source_id]));

  let written = 0;
  await withTransaction(async (client) => {
    // Saving twice must leave one set of rows, so a retry or a resumed run cannot double them.
    await client.query(`DELETE FROM report_citations WHERE report_id = $1`, [reportId]);
    for (const row of bound) {
      // A passage that is no longer stored cannot back a citation. The report
      // already shows the number, so this is a failed save, not a row to skip:
      // throwing rolls the transaction back and the caller decides.
      if (!sourceIdByChunk.has(row.chunkId)) {
        throw new Error(`Cited passage ${row.chunkId} is no longer stored; citation ${row.order} cannot be saved`);
      }
      await client.query(
        `INSERT INTO report_citations (
           report_id, section_id, chunk_id, source_id, chunk_quote, citation_order, citation_text
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reportId,
          row.sectionOrder == null ? null : sectionIdByOrder.get(row.sectionOrder) ?? null,
          row.chunkId,
          sourceIdByChunk.get(row.chunkId) ?? null,
          row.quote,
          row.order,
          `[${row.number}]`,
        ]
      );
      written += 1;
    }
  });
  logger.info(`[citations:${runId}] Saved ${written} bound citation(s)`);
  return written;
}
