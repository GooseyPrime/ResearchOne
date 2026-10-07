/**
 * What the reading page needs beyond the report text (slice 5, items 2 to 4).
 *
 * Citations with the quoted passage behind each number, the sources they point
 * to, the findings with their strength in words, and the status a person
 * reads. Nothing here returns a grade label, a raw status or an internal id as
 * text for a reader: strength and source type are words, and the status is
 * "Ready", "Needs review" or "Failed" with a plain reason.
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
  word: 'Ready' | 'Needs review' | 'Failed' | 'In progress';
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
    const reason = describeGateFailure(gate);
    // A report that exists but did not pass a check is kept for review; one with nothing to show failed.
    return gate === 'no_evidence' ? { word: 'Failed', reason } : { word: 'Needs review', reason };
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

/** Assemble the page's data from the stored rows. Kept apart from the reads so it can be tested without a database. */
export function buildReaderEvidence(args: {
  status: ReaderStatus;
  citationRows: CitationRow[];
  claimRows: Array<{ id: string; claim_text: string; evidence_tier: string | null; source_id: string | null; chunk_id: string | null }>;
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
        kind: sourceKindInWords({ kind: row.source_kind, provider: row.source_provider, url: row.source_url, hasFile: Boolean(row.source_filename) }),
        notice: row.editorial_notice?.trim() || null,
      });
    }
    citations.push({
      sectionId: row.section_id,
      number: numberOf(row.citation_text),
      order: row.citation_order ?? index,
      quote: row.chunk_quote?.trim() || null,
      sourceId: row.source_id,
    });
  }
  // A finding belongs on the Evidence tab only when a citation of THIS report
  // is bound to it: by the finding itself, or by the passage it was drawn
  // from. Its sources and passages are those citations', nothing else. A
  // revision keeps its base report's run, so the run's findings are not all
  // the revision's; its own citations decide. Another finding from a cited
  // source, drawn from a passage the report never cites, is not listed.
  const findings: ReaderFinding[] = [];
  for (const claim of args.claimRows) {
    if (!claim.claim_text.trim()) continue;
    const bound = ordered.filter((row) => row.claim_id === claim.id || (claim.chunk_id !== null && row.chunk_id === claim.chunk_id));
    if (bound.length === 0) continue;
    findings.push({
      text: stripInternalLabelsFromReport(claim.claim_text.trim()),
      strength: strengthInWords(claim.evidence_tier),
      sourceIds: [...new Set(bound.map((row) => row.source_id).filter((id): id is string => Boolean(id) && sources.has(id as string)))],
      quotes: [...new Set(bound.map((row) => row.chunk_quote?.trim() || '').filter(Boolean))],
    });
  }
  return { status: args.status, sources: [...sources.values()], citations, findings };
}

/** Columns added by later migrations; a database that lacks one is read without it. */
const isMissingColumn = (err: unknown): boolean => (err as { code?: string })?.code === '42703' || (err as { code?: string })?.code === '42P01';

export async function loadReaderEvidence(report: { id: string; status: string | null; run_id: string | null }): Promise<ReaderEvidence> {
  const select = (extra: string): string =>
    `SELECT rc.section_id, rc.chunk_id, rc.claim_id, rc.source_id, rc.citation_text, rc.citation_order, rc.chunk_quote${extra},
            s.title AS source_title, s.url AS source_url, s.authors AS source_authors, s.publication AS source_publication,
            s.published_at AS source_published_at, s.original_filename AS source_filename,
            s.metadata->'bibliographic'->>'kind' AS source_kind, s.metadata->'bibliographic'->>'provider' AS source_provider
       FROM report_citations rc LEFT JOIN sources s ON s.id = rc.source_id
      WHERE rc.report_id = $1`;
  let citationRows: CitationRow[];
  try {
    citationRows = await query<CitationRow>(select(', rc.editorial_notice'), [report.id]);
  } catch (err) {
    if (!isMissingColumn(err)) throw err;
    logger.debug(`[reader:${report.id}] Reading citations without the editorial notice (deploy skew)`);
    citationRows = await query<CitationRow>(select(''), [report.id]);
  }
  let claimRows: Array<{ id: string; claim_text: string; evidence_tier: string | null; source_id: string | null; chunk_id: string | null }> = [];
  let run: { status: string | null; gate_status: string | null } | undefined;
  if (report.run_id) {
    try {
      claimRows = await query(
        `SELECT id, claim_text, evidence_tier::text AS evidence_tier, source_id, chunk_id
           FROM claims WHERE run_id = $1 AND claim_text IS NOT NULL ORDER BY created_at ASC LIMIT 200`,
        [report.run_id]
      );
    } catch (err) {
      if (!isMissingColumn(err)) throw err;
      logger.debug(`[reader:${report.id}] Findings could not be read (deploy skew); the Evidence tab lists cited passages`);
    }
    const runs = await query<{ status: string | null; gate_status: string | null }>(
      `SELECT status, failure_meta->>'gate_status' AS gate_status FROM research_runs WHERE id = $1`,
      [report.run_id]
    );
    run = runs[0];
  }
  return buildReaderEvidence({
    status: readerStatus({ reportStatus: report.status, runStatus: run?.status, gateStatus: run?.gate_status }),
    citationRows,
    claimRows,
  });
}
