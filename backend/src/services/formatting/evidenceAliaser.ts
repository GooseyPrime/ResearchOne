/**
 * Evidence aliaser — Lossless Evidence Aliases.
 *
 * Per Cursor rule 28 I-8: aliases are stable per (report_id,
 * citation_id) across re-exports. Once assigned, an alias never
 * changes for that pair within the lifetime of the report version.
 *
 * The "Lossless" property: each row in `evidence_aliases` carries a
 * snapshotted `csl_json` so the citation form is frozen at alias-
 * assignment time, surviving later edits to the underlying `sources`
 * row. A report exported six months ago and cited externally still
 * reproduces the original citation if regenerated, even if the
 * source's authors were corrected since.
 *
 * Sequencing rule: ordinals start at 1 and are assigned in the order
 * citations FIRST appear in the report body — typically by section
 * order. This is what readers expect: "[E1]" is the first citation
 * mentioned, not an arbitrary identifier.
 */
import { adminQuery } from '../../db/pool';
import { sourceToCslJson, type SourceRow, type CslJsonEntry } from './cslConverter';

export interface AliasAssignment {
  citationId: string;
  alias: string;
  ordinal: number;
  cslJson: CslJsonEntry;
}

interface ReportCitationRow {
  citation_id: string;
  source_id: string;
  source: SourceRow;
}

/**
 * Assign or retrieve aliases for every citation in a report.
 *
 * Idempotent: if aliases already exist for this report, they're
 * returned unchanged. If new citations have been added since the
 * last call, they're appended with the next available ordinals —
 * preserving the alias stability for already-aliased citations.
 *
 * @param reportId  — the report whose citations to alias.
 * @param dryRun    — when true, computes assignments without DB writes.
 *                    Used by the export preview path.
 */
export async function assignEvidenceAliases(
  reportId: string,
  options: { dryRun?: boolean } = {}
): Promise<AliasAssignment[]> {
  const dryRun = options.dryRun ?? false;

  // 1. Load existing aliases for this report.
  const existingRows = await adminQuery<{
    citation_id: string;
    alias: string;
    ordinal: number;
    csl_json: CslJsonEntry;
  }>(
    `SELECT citation_id, alias, ordinal, csl_json
       FROM evidence_aliases
      WHERE report_id = $1
      ORDER BY ordinal ASC`,
    [reportId]
  );

  const existingByCitation = new Map<string, AliasAssignment>();
  let maxOrdinal = 0;
  for (const row of existingRows) {
    existingByCitation.set(row.citation_id, {
      citationId: row.citation_id,
      alias: row.alias,
      ordinal: row.ordinal,
      cslJson: row.csl_json,
    });
    if (row.ordinal > maxOrdinal) maxOrdinal = row.ordinal;
  }

  // 2. Load all citations for this report in their canonical order.
  //
  // Canonical order: by section position, then by created_at within a
  // section. This matches the order a reader encounters citations
  // when reading the report top-to-bottom.
  const citations = await adminQuery<ReportCitationRow>(
    `SELECT
       rc.id AS citation_id,
       rc.source_id,
       row_to_json(s.*) AS source
     FROM report_citations rc
     JOIN sources s ON s.id = rc.source_id
     LEFT JOIN report_sections sec ON sec.id = rc.section_id
     WHERE rc.report_id = $1
       AND rc.source_id IS NOT NULL
     ORDER BY COALESCE(sec.position, 999999) ASC, rc.created_at ASC`,
    [reportId]
  );

  // 3. Build the assignment list — existing first, then new.
  const result: AliasAssignment[] = [];
  const newAssignments: AliasAssignment[] = [];

  for (const c of citations) {
    const existing = existingByCitation.get(c.citation_id);
    if (existing) {
      result.push(existing);
      continue;
    }
    // New citation — assign next ordinal.
    maxOrdinal += 1;
    const csl = sourceToCslJson(c.source as SourceRow, {
      idOverride: `E${maxOrdinal}`,
    });
    const assignment: AliasAssignment = {
      citationId: c.citation_id,
      alias: `[E${maxOrdinal}]`,
      ordinal: maxOrdinal,
      cslJson: csl,
    };
    result.push(assignment);
    newAssignments.push(assignment);
  }

  // 4. Persist new assignments unless dryRun.
  if (!dryRun && newAssignments.length > 0) {
    // ON CONFLICT DO NOTHING handles a race where two export jobs
    // for the same report run concurrently. The unique constraint
    // (report_id, citation_id) makes the second insert a no-op.
    for (const a of newAssignments) {
      await adminQuery(
        `INSERT INTO evidence_aliases
           (report_id, citation_id, alias, ordinal, csl_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (report_id, citation_id) DO NOTHING`,
        [reportId, a.citationId, a.alias, a.ordinal, JSON.stringify(a.cslJson)]
      );
    }
  }

  // Sort by ordinal for stable output regardless of map iteration order.
  result.sort((x, y) => x.ordinal - y.ordinal);
  return result;
}

/**
 * Render aliases as a CSL-JSON bibliography array — the format pandoc
 * accepts via `--bibliography=path/to/refs.json`.
 *
 * The `id` field for each entry uses the alias (e.g. "E1") instead of
 * the source UUID, so pandoc's citation rendering (`[@E1]` syntax in
 * the markdown) resolves through CSL-JSON cleanly.
 */
export function aliasesToCslBibliography(
  assignments: AliasAssignment[]
): CslJsonEntry[] {
  return assignments.map((a) => ({
    ...a.cslJson,
    id: `E${a.ordinal}`,
  }));
}

/**
 * Replace alias references in a report body with pandoc citation
 * syntax.
 *
 * Input:  "as shown in [E1] and [E3]"
 * Output: "as shown in [@E1] and [@E3]"
 *
 * The `@`-prefixed form is what pandoc's citeproc filter looks for.
 * Pandoc replaces `[@E1]` with the formatted in-text citation
 * (e.g. "(Lane, 2025)" for author-date, or "[1]" for numeric) and
 * builds the bibliography from the CSL-JSON.
 */
export function rewriteAliasesForPandoc(reportBody: string): string {
  // Match `[E<digits>]` not already preceded by `@`.
  // Negative lookbehind requires the `s` flag is fine; pattern is
  // straightforward.
  return reportBody.replace(/(?<!@)\[E(\d+)\]/g, '[@E$1]');
}
