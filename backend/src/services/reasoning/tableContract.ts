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
    | 'table_columns_missing'
    /** Rows that belong to a table are sitting outside one as loose text. */
    | 'table_truncated';
  message: string;
}

/**
 * GFM delimiter row.
 *
 * The GFM spec requires only that delimiter cells contain hyphens with optional
 * leading/trailing colons — one hyphen is legal. We match the renderer rather
 * than a stricter convention on purpose: being stricter than `remark-gfm`
 * would make us report "required table missing" for a table the reader can
 * plainly see, which is the exact failure class this module exists to prevent.
 */
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Split a GFM row on unescaped pipes only. `A \| B` is ONE cell, not two. */
function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      // Keep the literal pipe; it is content, not a column boundary.
      current += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Blank out fenced code blocks before scanning for tables.
 *
 * A pipe table inside ``` renders as code, not a table. Without this, a report
 * containing a table *example* would satisfy a table requirement it never
 * actually delivered — a deterministic check that can be bypassed by fencing is
 * worse than no check (Rule 42 R42-1).
 *
 * Lines are replaced rather than removed so line offsets stay accurate.
 */
function maskFencedCodeBlocks(markdown: string): string {
  const lines = (markdown ?? '').split(/\r?\n/);
  let inFence = false;
  let fenceMarker = '';
  return lines
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1] ?? '';
        if (!inFence) {
          inFence = true;
          fenceMarker = marker[0] ?? '`';
          return '';
        }
        if (marker[0] === fenceMarker) {
          inFence = false;
          fenceMarker = '';
        }
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

/**
 * Extract GFM pipe tables from markdown.
 *
 * A table is a header row, a delimiter row, then one or more body rows. Rows
 * whose cell count differs from the header are still captured so the caller can
 * report them as malformed rather than silently dropping data.
 */
export function extractMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = maskFencedCodeBlocks(markdown).split(/\r?\n/);
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

/**
 * Lines that read as table rows but are not inside any table.
 *
 * The operator's run shipped a table of opportunities that stopped at row 13
 * and then continued as pipe-delimited text underneath it — the model broke
 * the table (a blank line, a stray heading, a row split across two lines) and
 * kept going in plain text. Every check in this file looked at the table that
 * WAS parsed, so a table missing seven of its rows and trailing them below as
 * prose passed a row-count check that counted the fragment.
 *
 * A line counts as an orphan when it has at least two unescaped pipes with
 * content either side and is not part of a parsed table, a delimiter row, or a
 * fenced block. That is deliberately narrow: ordinary prose almost never has
 * two pipes on one line, and being wrong here costs a false contract failure.
 */
export function findOrphanTableRows(markdown: string): string[] {
  const masked = maskFencedCodeBlocks(markdown ?? '');
  const lines = masked.split(/\r?\n/);

  // Mark every line that belongs to a recognised table.
  const claimed = new Set<number>();
  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = lines[i] ?? '';
    const delimiterLine = lines[i + 1] ?? '';
    if (!headerLine.includes('|')) continue;
    if (!DELIMITER_ROW.test(delimiterLine)) continue;
    if (splitRow(headerLine).length < 2) continue;
    claimed.add(i);
    claimed.add(i + 1);
    let cursor = i + 2;
    while (cursor < lines.length) {
      const line = lines[cursor] ?? '';
      if (!line.includes('|') || line.trim() === '') break;
      claimed.add(cursor);
      cursor += 1;
    }
    i = cursor - 1;
  }

  const orphans: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (claimed.has(i)) continue;
    const line = lines[i] ?? '';
    if (!line.trim()) continue;
    if (DELIMITER_ROW.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 3) continue;
    // Require real content in at least three cells, so a sentence that happens
    // to contain "a | b" is not read as a stranded row.
    if (cells.filter((cell) => cell.length > 0).length < 3) continue;
    orphans.push(line.trim());
  }
  return orphans;
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
 * Format keys are snake_case, and `_` is a word character — so `\btable\b`
 * never matched `comparison_table`. The check must see the words, not the key.
 */
function mentionsTable(value: string | null | undefined): boolean {
  return TABLE_REQUEST_PATTERN.test((value ?? '').replace(/[_-]+/g, ' '));
}

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
  requestedArtifactCount?: number,
  /**
   * Formats the user asked for on the request form.
   *
   * The section drafter is told to emit a table when the requested FORMAT says
   * so (`contractRequestsTable` reads both), but this auditor read only the
   * brief. Choosing "Comparison table" therefore instructed the writer and
   * verified nothing — the exact instruct-and-do-not-check split that lets a
   * report ship as prose when a table was asked for.
   */
  requestedFormats?: readonly string[] | null
): TableContractExpectation {
  const formatWantsTable = (requestedFormats ?? []).some((format) => mentionsTable(format));
  if (!brief) {
    return formatWantsTable
      ? { required: true, expectedRowCount: requestedArtifactCount }
      : { required: false };
  }

  const artifacts = brief.requestedArtifacts ?? [];
  const tableArtifact = artifacts.find((artifact) => {
    return mentionsTable(`${artifact.type ?? ''} ${artifact.description ?? ''}`);
  });

  const constraintsMentionTable = (brief.userConstraints ?? []).some((constraint) =>
    mentionsTable(constraint?.description)
  );

  if (!tableArtifact && !constraintsMentionTable && !formatWantsTable) {
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

  const orphanRows = findOrphanTableRows(markdown);
  const truncationIssues: TableContractIssue[] =
    orphanRows.length > 0
      ? [
          {
            code: 'table_truncated' as const,
            message:
              `${orphanRows.length} pipe-delimited row(s) appear outside any table — the table was broken ` +
              'and the remaining rows continue as loose text. Emit one unbroken table: header row, ' +
              'delimiter row, then every data row on its own line with no blank line between them. ' +
              `First stranded row: ${orphanRows[0]?.slice(0, 160)}`,
          },
        ]
      : [];

  const tables = extractMarkdownTables(markdown);
  if (tables.length === 0) {
    if (truncationIssues.length > 0) return truncationIssues;
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
  if (!best) return truncationIssues;

  const issues: TableContractIssue[] = [...truncationIssues];
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
