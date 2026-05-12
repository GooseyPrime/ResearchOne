/**
 * CSL-JSON converter — turns ResearchOne `sources` rows into the
 * Citation Style Language JSON schema that Pandoc consumes.
 *
 * Per Cursor rule 28 I-7: this module is a PURE FUNCTION. No DB
 * access, no subprocess calls, no clock reads. All tests are
 * snapshots of (input row → expected output JSON). When the field
 * mapping changes, snapshots update in the same PR.
 *
 * Spec: https://docs.citationstyles.org/en/stable/specification.html
 * Schema: https://github.com/citation-style-language/schema/blob/master/csl-data.json
 */

export interface SourceRow {
  id: string;
  url: string | null;
  title: string | null;
  /** authors[]::text from sources table. May be ["Last, First", ...] or
   *  ["First Last", ...] — we handle both. */
  authors: string[] | null;
  publication: string | null;
  /** ISO 8601 string or Postgres timestamptz string. */
  published_at: string | null;
  source_type: string | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CslAuthor {
  family?: string;
  given?: string;
  /** For institutional authors. */
  literal?: string;
}

export interface CslDate {
  /** Date parts in `[year, month, day]` order, with month/day optional. */
  'date-parts': Array<[number] | [number, number] | [number, number, number]>;
}

export interface CslJsonEntry {
  id: string;
  type: string;
  title?: string;
  author?: CslAuthor[];
  issued?: CslDate;
  URL?: string;
  'container-title'?: string;
  publisher?: string;
  language?: string;
  accessed?: CslDate;
  /** Always preserved — operators investigating citation issues can
   *  look at the raw source row through this metadata. */
  note?: string;
}

/**
 * Map our `source_type` enum to a CSL `type` value.
 *
 * CSL types: https://docs.citationstyles.org/en/stable/specification.html#appendix-iii-types
 * If you add a new source_type, add its mapping here in the same PR.
 */
function cslType(sourceType: string | null): string {
  switch (sourceType) {
    case 'web_url':            return 'webpage';
    case 'pdf':                return 'document';
    case 'arxiv':              return 'article-journal';
    case 'doi':                return 'article-journal';
    case 'pubmed':             return 'article-journal';
    case 'wikipedia':          return 'entry-encyclopedia';
    case 'patent':             return 'patent';
    case 'court_filing':       return 'legal_case';
    case 'social_media':       return 'post';
    case 'video':              return 'motion_picture';
    case 'podcast':            return 'broadcast';
    case 'manual_upload':      return 'document';
    case 'archive':            return 'webpage';
    case 'preprint':           return 'article-journal';
    case 'dataset':            return 'dataset';
    default:                   return 'document';
  }
}

/**
 * Parse an author string into CSL family/given.
 *
 * Accepts:
 *   "Last, First"      → { family: "Last", given: "First" }
 *   "Last, First M."   → { family: "Last", given: "First M." }
 *   "First M. Last"    → { family: "Last", given: "First M." }
 *   "Some Org Name"    → { literal: "Some Org Name" } (heuristic: if
 *                          contains "Inc", "Ltd", "University",
 *                          "Organization", etc.)
 *   "" / null          → null (caller filters)
 */
function parseAuthor(raw: string): CslAuthor | null {
  const s = raw.trim();
  if (!s) return null;

  // Institutional author heuristic.
  if (
    /\b(Inc\.?|Ltd\.?|LLC|University|College|Institute|Foundation|Corporation|Company|Group|Council|Society|Association|Department|Office|Bureau|Commission|Agency|Organization)\b/i.test(
      s
    )
  ) {
    return { literal: s };
  }

  // "Last, First" — comma-separated.
  if (s.includes(',')) {
    const [family, given] = s.split(',', 2).map((p) => p.trim());
    if (family && given) return { family, given };
    if (family) return { family };
  }

  // "First M. Last" — space-separated; last token is family.
  const parts = s.split(/\s+/);
  if (parts.length === 1) {
    // Single word — could be a mononym, surname, or institution we
    // didn't catch. Treat as family.
    return { family: parts[0] };
  }
  const family = parts[parts.length - 1];
  const given = parts.slice(0, -1).join(' ');
  return { family, given };
}

/**
 * Parse an ISO date / Postgres timestamp string into CSL date-parts.
 * Returns null when no date can be reconstructed.
 */
function parseDate(raw: string | null): CslDate | null {
  if (!raw) return null;
  // Postgres timestamptz strings look like "2026-05-11 16:30:00+00".
  // ISO strings look like "2026-05-11T16:30:00Z".
  // Bare dates look like "2026-05-11".
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(raw);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (Number.isNaN(year) || year < 1000 || year > 9999) return null;
  if (m[2] && m[3]) {
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (Number.isFinite(month) && Number.isFinite(day)) {
      return { 'date-parts': [[year, month, day]] };
    }
  }
  if (m[2]) {
    const month = parseInt(m[2], 10);
    if (Number.isFinite(month)) {
      return { 'date-parts': [[year, month]] };
    }
  }
  return { 'date-parts': [[year]] };
}

/**
 * Convert a `sources` row to a CSL-JSON entry.
 *
 * `id` is set to the source row id (UUID) by default. Callers that
 * want a different citation key (e.g. evidence alias `E1`) override
 * via the `idOverride` arg.
 *
 * Per Rule 28 I-7: pure function. No DB, no I/O.
 */
export function sourceToCslJson(
  source: SourceRow,
  opts: { idOverride?: string } = {}
): CslJsonEntry {
  const entry: CslJsonEntry = {
    id: opts.idOverride ?? source.id,
    type: cslType(source.source_type),
  };

  if (source.title) entry.title = source.title;

  if (source.authors && source.authors.length > 0) {
    const parsed = source.authors
      .map((a) => parseAuthor(a))
      .filter((a): a is CslAuthor => a !== null);
    if (parsed.length > 0) entry.author = parsed;
  }

  const issued = parseDate(source.published_at);
  if (issued) entry.issued = issued;

  if (source.url) entry.URL = source.url;
  if (source.publication) entry['container-title'] = source.publication;
  if (source.language) entry.language = source.language;

  // If we have a URL but no publication date, modern CSL conventions
  // ask for an "accessed" date so reviewers know when we saw it.
  // Use ingested_at if available in metadata.
  if (source.url && !issued && source.metadata) {
    const ingested = (source.metadata as Record<string, unknown>).ingested_at;
    if (typeof ingested === 'string') {
      const a = parseDate(ingested);
      if (a) entry.accessed = a;
    }
  }

  // Preserve the source row id in a note for traceability — handy
  // when a reviewer asks "which underlying source row produced this
  // citation."
  entry.note = `source_id:${source.id}`;

  return entry;
}

/**
 * Convert many source rows to a CSL-JSON array (the format Pandoc
 * expects via `--bibliography` flag).
 */
export function sourcesToCslJson(sources: SourceRow[]): CslJsonEntry[] {
  return sources.map((s) => sourceToCslJson(s));
}
