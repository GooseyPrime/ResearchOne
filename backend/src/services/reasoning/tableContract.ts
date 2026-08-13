/**
 * Deterministic markdown-table checks for the Deliverable Contract Auditor
 * (WO-AB).
 *
 * This is intentionally NOT a new agent and NOT a model call. Whether a
 * required table exists, is well-formed, and carries the requested columns and
 * row count is a mechanical property of the text — exactly the kind of check
 * Rule 42 R42-1 says must not be delegated to something that can be satisfied
 * by plausible-looking filler.
 *
 * Rendering quality is a frontend concern; table *contract compliance* belongs
 * here.
 */

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
  /** Character offset of the table in the source markdown. */
  index: number;
}

export interface TableContractIssue {
  code:
    | 'table_missing'
    | 'table_malformed'
    | 'table_row_count'
    | 'table_columns_missing';
  message: string;
}

const DELIMITER_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Extract GFM pipe tables from markdown.
 *
 * A table is a header row, a delimiter row, then one or more body rows. Rows
 * whose cell count differs from the header are still captured so the caller can
 * report them as malformed rather than silently dropping data.
 */
export function extractMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = (markdown ?? '').split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  let offset = 0;
  const lineOffsets = lines.map((line) => {
    const start = offset;
    offset += line.length + 1;
    return start;
  });

  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = lines[i] ?? '';
    const delimiterLine = lines[i + 1] ?? '';
    if (!headerLine.includes('|')) continue;
    if (!DELIMITER_ROW.test(delimiterLine)) continue;

    const headers = splitRow(headerLine);
    if (headers.length < 2) continue;

    const rows: string[][] = [];
    let cursor = i + 2;
    while (cursor < lines.length) {
      const line = lines[cursor] ?? '';
      if (!line.includes('|') || line.trim() === '') break;
      rows.push(splitRow(line));
      cursor += 1;
    }

    tables.push({ headers, rows, index: lineOffsets[i] ?? 0 });
    i = cursor - 1;
  }

  return tables;
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface TableContractExpectation {
  /** At least one table must be present. */
  required: boolean;
  /** Column names the table must contain (matched loosely). */
  requiredColumns?: readonly string[];
  /** Exact body-row count the table must have (e.g. a requested item count). */
  expectedRowCount?: number;
}

/** Words that indicate the user asked for a tabular artifact. */
const TABLE_REQUEST_PATTERN = /\btables?\b|\bmatrix\b|\bgrid\b|\bspreadsheet\b|\bcolumns?\b/i;

/**
 * Derive a table expectation from the confirmed brief.
 *
 * Only requires a table when the user actually asked for one — most report
 * types have no tabular requirement and must not be failed for lacking a table.
 */
export function resolveTableExpectation(
  brief: {
    requestedArtifacts?: ReadonlyArray<{
      type?: string;
      description?: string;
      exactCount?: number;
      explicitRequiredFields?: readonly string[];
      inferredRequiredFields?: readonly string[];
    }>;
    userConstraints?: ReadonlyArray<{ description?: string }>;
  } | null | undefined,
  requestedArtifactCount?: number
): TableContractExpectation {
  if (!brief) return { required: false };

  const artifacts = brief.requestedArtifacts ?? [];
  const tableArtifact = artifacts.find((artifact) => {
    const haystack = `${artifact.type ?? ''} ${artifact.description ?? ''}`;
    return TABLE_REQUEST_PATTERN.test(haystack);
  });

  const constraintsMentionTable = (brief.userConstraints ?? []).some((constraint) =>
    TABLE_REQUEST_PATTERN.test(constraint?.description ?? '')
  );

  if (!tableArtifact && !constraintsMentionTable) {
    return { required: false };
  }

  const requiredColumns = [
    ...(tableArtifact?.explicitRequiredFields ?? []),
    ...(tableArtifact?.inferredRequiredFields ?? []),
  ];

  return {
    required: true,
    requiredColumns: requiredColumns.length > 0 ? requiredColumns : undefined,
    // Prefer the table artifact's own count; fall back to the run-level
    // requested count (e.g. "exactly 20 opportunities").
    expectedRowCount: tableArtifact?.exactCount ?? requestedArtifactCount,
  };
}

/**
 * Check a report's tables against an expectation.
 *
 * Returns issues rather than throwing so the auditor can merge them into
 * `missing_requirements` alongside model-produced findings.
 */
export function checkTableContract(
  markdown: string,
  expectation: TableContractExpectation
): TableContractIssue[] {
  if (!expectation.required) return [];

  const tables = extractMarkdownTables(markdown);
  if (tables.length === 0) {
    return [
      {
        code: 'table_missing',
        message:
          'The requested table is absent. A pipe-delimited markdown table with a header row and a delimiter row is required.',
      },
    ];
  }

  // Score candidate tables and report against the best match, so an unrelated
  // small table elsewhere in the report cannot mask the real one.
  const wanted = (expectation.requiredColumns ?? []).map(normalizeHeader).filter(Boolean);
  const scored = tables.map((table) => {
    const present = new Set(table.headers.map(normalizeHeader));
    const matched = wanted.filter((column) =>
      [...present].some((header) => header.includes(column) || column.includes(header))
    );
    return { table, matchedCount: matched.length, matched };
  });
  scored.sort((a, b) => b.matchedCount - a.matchedCount || b.table.rows.length - a.table.rows.length);

  const best = scored[0];
  if (!best) return [];

  const issues: TableContractIssue[] = [];
  const { table } = best;

  const malformed = table.rows.filter((row) => row.length !== table.headers.length);
  if (malformed.length > 0) {
    issues.push({
      code: 'table_malformed',
      message:
        `${malformed.length} of ${table.rows.length} table rows do not have ${table.headers.length} cells. ` +
        'Every row must have exactly one cell per column, and cell content must not contain unescaped "|".',
    });
  }

  if (wanted.length > 0) {
    const present = new Set(table.headers.map(normalizeHeader));
    const missing = (expectation.requiredColumns ?? []).filter((column) => {
      const normalized = normalizeHeader(column);
      return ![...present].some(
        (header) => header.includes(normalized) || normalized.includes(header)
      );
    });
    if (missing.length > 0) {
      issues.push({
        code: 'table_columns_missing',
        message: `Table is missing required columns: ${missing.join(', ')}.`,
      });
    }
  }

  if (
    typeof expectation.expectedRowCount === 'number' &&
    expectation.expectedRowCount > 0 &&
    table.rows.length !== expectation.expectedRowCount
  ) {
    issues.push({
      code: 'table_row_count',
      message: `Table has ${table.rows.length} data rows; ${expectation.expectedRowCount} were requested.`,
    });
  }

  return issues;
}
