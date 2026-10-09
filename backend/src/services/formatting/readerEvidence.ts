/**
 * What the reading page needs beyond the report text (slice 5, items 2 to 4).
 *
 * Citations with the quoted passage behind each number, the sources they point
 * to, the findings with their strength in words, and the status a person
 * reads. Nothing here returns a grade label, a raw status or an internal id as
 * text for a reader: strength and source type are words, and the status is
 * "Ready", "Finished with fewer sources than planned", "Needs review" or
 * "Failed", with a plain reason.
 */
import { query } from '../../db/pool';
import { logger } from '../../utils/logger';
import { describeGateFailure } from '../reasoning/runStatusDisplay';
import type { ReportGateStatus } from '../reasoning/reportGateStatus';
import { sourceKindInWords } from './referenceList';
import { stripInternalLabelsFromReport } from './reportPresentation';

/** How strongly the sources support a finding, in ordinary words. Shown only on the Evidence tab. */
export function strengthInWords(tier: string | null | undefined): string {
  switch ((tier ?? '').toLowerCase()) {
    case 'established_fact':
      return 'Well established: several independent sources agree';
    case 'strong_evidence':
      return 'Strongly supported by the sources';
    case 'testimony':
      return 'A first-hand account or a single source’s statement';
    case 'inference':
      return 'Reasoned from the sources, not stated by them directly';
    case 'speculation':
      return 'Tentative: the sources raise it without establishing it';
    default:
      return 'Strength not assessed';
  }
}

export interface ReaderStatus {
  word: 'Ready' | 'Finished with fewer sources than planned' | 'Needs review' | 'Failed' | 'In progress';
  reason: string | null;
}

const GATE_STATUSES: ReadonlySet<string> = new Set(['completed', 'completed_degraded', 'contract_failed', 'verification_failed', 'no_evidence']);

/**
 * The status a person reads. Never an enum value.
 *
 * What went wrong is looked at first: a check the report did not pass, then a
 * run that did not finish. A report row can say "finalized" while its run
 * failed afterwards, and a draft can belong to a run that already failed;
 * neither is "Ready" or "In progress". Only then does the report's own state
 * decide. (The same order as `resolveRunDisplayState`.)
 */
export function readerStatus(args: { reportStatus: string | null; runStatus?: string | null; gateStatus?: string | null }): ReaderStatus {
  const gate = args.gateStatus && GATE_STATUSES.has(args.gateStatus) ? (args.gateStatus as ReportGateStatus) : null;
  if (gate && gate !== 'completed') {
    // The stored explanation for this one names pipeline parts; a reader is told what it meant for them.
    const reason = gate === 'no_evidence' ? 'The search found no sources this report could cite, so no report was written.' : describeGateFailure(gate);
    // A report that exists but did not pass a check is kept for review; one with nothing to show failed.
    if (gate === 'no_evidence') return { word: 'Failed', reason };
    // Written, and readable, from fewer sources than the plan called for: said as that, not as a fault.
    if (gate === 'completed_degraded') return { word: 'Finished with fewer sources than planned', reason };
    return { word: 'Needs review', reason };
  }
  if (args.runStatus === 'failed' || args.runStatus === 'aborted') return { word: 'Failed', reason: 'The run that wrote this report did not finish.' };
  if (args.runStatus === 'cancelled') return { word: 'Failed', reason: 'The run that wrote this report was cancelled before it finished.' };
  if (args.reportStatus === 'draft' || args.reportStatus === 'generating') return { word: 'In progress', reason: 'This report is still being written.' };
  if (args.reportStatus === 'under_review') return { word: 'Needs review', reason: 'This report did not pass every check. It has been kept for review rather than finalised.' };
  return { word: 'Ready', reason: null };
}

export interface ReaderSource {
  id: string;
  title: string;
  publisher: string | null;
  authors: string[];
  date: string | null;
  url: string | null;
  kind: string;
  /** Set when the publisher has retracted or corrected the work. */
  notice: string | null;
}

export interface ReaderCitation {
  sectionId: string | null;
  /** The number shown in the text. */
  number: number | null;
  /** Position among the report's citations, in reading order. */
  order: number;
  quote: string | null;
  sourceId: string | null;
}

export interface ReaderFinding {
  text: string;
  strength: string;
  sourceIds: string[];
  quotes: string[];
}

export interface ReaderEvidence {
  status: ReaderStatus;
  sources: ReaderSource[];
  citations: ReaderCitation[];
  findings: ReaderFinding[];
  /**
   * For a report written before citations were numbered: the passage label in
   * its text ("Chunk 7" is 7) and the reader number it becomes. A label with no
   * saved citation is absent, and the page takes it out.
   */
  legacyLabels: Record<string, number>;
}

interface CitationRow {
  section_id: string | null;
  chunk_id: string | null;
  claim_id: string | null;
  source_id: string | null;
  citation_text: string | null;
  citation_order: number | null;
  chunk_quote: string | null;
  editorial_notice?: string | null;
  source_title: string | null;
  source_url: string | null;
  source_authors: string[] | null;
  source_publication: string | null;
  source_published_at: Date | string | null;
  source_filename: string | null;
  source_kind: string | null;
  source_provider: string | null;
}

function isoDay(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function numberOf(citationText: string | null): number | null {
  const match = /^\[(\d+)\]$/.exec((citationText ?? '').trim());
  return match ? Number(match[1]) : null;
}

/** A stored finding: the passage it is filed under, and every passage recorded as supporting it. */
export interface ReaderClaimRow {
  id: string;
  claim_text: string;
  evidence_tier: string | null;
  source_id: string | null;
  chunk_id: string | null;
  supporting_chunk_ids?: string[] | null;
}

/** Assemble the page's data from the stored rows. Kept apart from the reads so it can be tested without a database. */
export function buildReaderEvidence(args: {
  status: ReaderStatus;
  citationRows: CitationRow[];
  claimRows: ReaderClaimRow[];
  /** The run's passages in the order the writer was shown them: an older report's "Chunk N" is the N-th. */
  passageOrder?: string[];
  /** Slice 6. Name a plain web page by where it was read, when the run had authority tiers on. */
  authorityWords?: boolean;
}): ReaderEvidence {
  const sources = new Map<string, ReaderSource>();
  const citations: ReaderCitation[] = [];
  const ordered = [...args.citationRows].sort((a, b) => (a.citation_order ?? 0) - (b.citation_order ?? 0));
  for (const [index, row] of ordered.entries()) {
    if (row.source_id && !sources.has(row.source_id)) {
      sources.set(row.source_id, {
        id: row.source_id,
        title: (row.source_title ?? '').trim() || 'Untitled source',
        publisher: row.source_publication?.trim() || null,
        authors: (row.source_authors ?? []).filter((author) => typeof author === 'string' && author.trim().length > 0),
        date: isoDay(row.source_published_at),
        url: row.source_url,
        kind: sourceKindInWords({ kind: row.source_kind, provider: row.source_provider, url: row.source_url, hasFile: Boolean(row.source_filename), authorityWords: args.authorityWords === true }),
        notice: row.editorial_notice?.trim() || null,
      });
    }
    // A citation saved before numbers existed carries none. It takes its
    // source's place in the order sources are first cited, which is the order
    // the Sources tab lists them in.
    const sourceNumber = row.source_id ? [...sources.keys()].indexOf(row.source_id) + 1 : 0;
    citations.push({
      sectionId: row.section_id,
      number: numberOf(row.citation_text) ?? (sourceNumber > 0 ? sourceNumber : null),
      order: row.citation_order ?? index,
      quote: row.chunk_quote?.trim() || null,
      sourceId: row.source_id,
    });
  }
  // A finding belongs on the Evidence tab only when a citation of THIS report
  // is bound to it: by the finding itself, or by a passage it was drawn
  // from. A finding can rest on several passages and is filed under one; the
  // report may cite any of them, so all of them are looked at. Its sources and passages are those citations', nothing else. A
  // revision keeps its base report's run, so the run's findings are not all
  // the revision's; its own citations decide. Another finding from a cited
  // source, drawn from a passage the report never cites, is not listed.
  const findings: ReaderFinding[] = [];
  for (const claim of args.claimRows) {
    if (!claim.claim_text.trim()) continue;
    const passages = new Set<string>([claim.chunk_id, ...(Array.isArray(claim.supporting_chunk_ids) ? claim.supporting_chunk_ids : [])].filter((id): id is string => typeof id === 'string' && id.length > 0));
    const bound = ordered.filter((row) => row.claim_id === claim.id || (row.chunk_id !== null && passages.has(row.chunk_id)));
    if (bound.length === 0) continue;
    findings.push({
      text: stripInternalLabelsFromReport(claim.claim_text.trim()),
      strength: strengthInWords(claim.evidence_tier),
      sourceIds: [...new Set(bound.map((row) => row.source_id).filter((id): id is string => Boolean(id) && sources.has(id as string)))],
      quotes: [...new Set(bound.map((row) => row.chunk_quote?.trim() || '').filter(Boolean))],
    });
  }
  const legacyLabels: Record<string, number> = {};
  if (ordered.some((row) => numberOf(row.citation_text) === null)) {
    const numberByChunk = new Map<string, number>();
    ordered.forEach((row, index) => {
      const number = citations[index].number;
      if (row.chunk_id && number !== null && !numberByChunk.has(row.chunk_id)) numberByChunk.set(row.chunk_id, number);
    });
    (args.passageOrder ?? []).forEach((chunkId, index) => {
      const number = numberByChunk.get(chunkId);
      if (number !== undefined) legacyLabels[String(index + 1)] = number;
    });
  }
  return { status: args.status, sources: [...sources.values()], citations, findings, legacyLabels };
}

/** Columns added by later migrations; a database that lacks one is read without it. */
const isMissingColumn = (err: unknown): boolean => (err as { code?: string })?.code === '42703' || (err as { code?: string })?.code === '42P01';

/** How rows are read. The page reads as the signed-in person; an export job reads with the job's own access. */
type Read = <T>(sql: string, params: unknown[]) => Promise<T[]>;

export async function loadReaderEvidence(
  report: { id: string; status: string | null; run_id: string | null },
  read: Read = query as Read,
  options: { authorityWords?: boolean } = {}
): Promise<ReaderEvidence> {
  const select = (extra: string): string =>
    `SELECT rc.section_id, rc.chunk_id, rc.claim_id, COALESCE(rc.source_id, c.source_id) AS source_id, rc.citation_text, rc.citation_order, rc.chunk_quote${extra},
            s.title AS source_title, s.url AS source_url, s.authors AS source_authors, s.publication AS source_publication,
            s.published_at AS source_published_at, s.original_filename AS source_filename,
            s.metadata->'bibliographic'->>'kind' AS source_kind, s.metadata->'bibliographic'->>'provider' AS source_provider
       FROM report_citations rc
       LEFT JOIN chunks c ON c.id = rc.chunk_id
       -- A citation saved without the old mapper's source id still names its passage, whose source is known.
       LEFT JOIN sources s ON s.id = COALESCE(rc.source_id, c.source_id)
      WHERE rc.report_id = $1`;
  let citationRows: CitationRow[];
  try {
    citationRows = await read<CitationRow>(select(', rc.editorial_notice'), [report.id]);
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    logger.debug(`[reader:${report.id}] Reading citations without the editorial notice (deploy skew)`);
    citationRows = await read<CitationRow>(select(''), [report.id]);
  }
  let claimRows: ReaderClaimRow[] = [];
  let run: { status: string | null; gate_status: string | null; retrieval_ids: string[] | null } | undefined;
  if (report.run_id) {
    try {
      claimRows = await read(
        `SELECT id, claim_text, evidence_tier::text AS evidence_tier, source_id, chunk_id, supporting_chunk_ids
           FROM claims WHERE run_id = $1 AND claim_text IS NOT NULL ORDER BY created_at ASC LIMIT 200`,
        [report.run_id]
      );
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      logger.debug(`[reader:${report.id}] Findings could not be read (deploy skew); the Evidence tab lists cited passages`);
    }
    const runs = await read<{ status: string | null; gate_status: string | null; retrieval_ids: string[] | null }>(
      `SELECT status, failure_meta->>'gate_status' AS gate_status, retrieval_ids FROM research_runs WHERE id = $1`,
      [report.run_id]
    );
    run = runs[0];
  }
  return buildReaderEvidence({
    status: readerStatus({ reportStatus: report.status, runStatus: run?.status, gateStatus: run?.gate_status }),
    citationRows,
    claimRows,
    passageOrder: Array.isArray(run?.retrieval_ids) ? run.retrieval_ids.map(String) : [],
    authorityWords: options.authorityWords === true,
  });
}
