import { dropSystemSections, readerNumbersIn } from '../reasoning/citationLock';
import { scoreNoRepetition, scorePresentationClean, scoreStructureComplete } from '../reasoning/baselineReport';

export interface EvalCitation {
  alias: string;
  chunkQuote: string;
  chunkText: string;
  chunkId?: string | null;
  citationText?: string | null;
  claimText?: string | null;
  /** Slice 6. The cited source's authority tier, 1 to 4, or null when it has none. Absent when not read. */
  authorityTier?: number | null;
}

/** What a run's link check found, one count per distinct DOI, as the worker recorded it. */
export interface DoiCheckCounts {
  resolved: number;
  unresolved: number;
}

/**
 * Of the distinct DOIs a run checked and got an answer for, the share that
 * resolve. Counted per DOI from the run's own record, which includes sources
 * left out for not resolving; the saved citations cannot show those. Null when
 * the run recorded no answered check: the switch was off, or no source had a DOI.
 */
export function scoreDoiResolution(counts: DoiCheckCounts | null | undefined): number | null {
  const resolved = Number(counts?.resolved ?? 0);
  const unresolved = Number(counts?.unresolved ?? 0);
  if (!Number.isFinite(resolved) || !Number.isFinite(unresolved) || resolved + unresolved <= 0) return null;
  return resolved / (resolved + unresolved);
}

export interface ContradictionLink {
  documentA: string;
  documentB: string;
}

export interface EvalScoreInput {
  reportMarkdown: string;
  citations: EvalCitation[];
  keyFacts?: string[];
  contradictionLinks?: ContradictionLink[];
  fixtureSides?: [string, string];
  anomalyPhrase?: string;
  quoteSupports?: number | null;
  quoteSupportsNotJudged?: number | null;
  citationLock?: boolean;
  doiChecks?: DoiCheckCounts | null;
  seconds?: number | null;
  tokens?: number | null;
  reportQuality?: number | null;
}

export interface EvalScores {
  answer_correct: number | null;
  citation_bound: number;
  quote_verbatim: number;
  quote_supports: number | null;
  quote_supports_not_judged: number | null;
  authority_share: number | null;
  doi_resolution: number | null;
  contradiction_retention: number | null;
  anomaly_retained: number | null;
  time_to_report: number | null;
  tokens: number | null;
  gate_status?: string | null;
  degraded_reason?: string | null;
  pairwise_vs_reference?: number | null;
  pairwise_chatgpt?: number | null;
  pairwise_perplexity?: number | null;
  presentation_clean: number;
  structure_complete: number;
  no_repetition: number;
  report_quality: number | null;
  report_quality_subscores?: Record<string, number> | null;
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function scoreCitationBound(report: string, citations: EvalCitation[], citationLock = false): number {
  if (citations.length === 0) return 0;
  // A locked report cites with reader numbers and nothing else. An export
  // alias left in one is a fault, so it is never a second way to score.
  if (citationLock) return scoreReaderNumbersBound(report, citations);
  const bound = citations.filter((row) => Boolean(row.chunkId) && row.chunkQuote.trim().length > 0).length;
  return bound / citations.length;
}

/**
 * A locked report cites with reader numbers. The k-th number in the prose is
 * backed by the k-th saved citation: it must carry the same number, a passage
 * and a quote. Numbers in code, in links and in the reference list do not count.
 * Every saved row counts: a row with no number, or a row beyond the last number
 * in the prose, is a citation the report does not show and lowers the score.
 */
function scoreReaderNumbersBound(report: string, citations: EvalCitation[]): number {
  const markers = readerNumbersIn(dropSystemSections(report));
  if (markers.length === 0) return 0;
  const bound = markers.filter((marker, index) => {
    const row = citations[index];
    return Boolean(row && (row.citationText ?? '').trim() === marker && row.chunkId && row.chunkQuote.trim().length > 0);
  }).length;
  return bound / Math.max(markers.length, citations.length);
}

export function scoreQuoteVerbatim(citations: EvalCitation[]): number {
  if (citations.length === 0) return 0;
  const quoted = citations.filter((row) => row.chunkQuote.trim().length > 0);
  if (quoted.length === 0) return 0;
  const verbatim = quoted.filter((row) => normalize(row.chunkText).includes(normalize(row.chunkQuote))).length;
  return verbatim / quoted.length;
}

export function scoreAnswerCorrect(report: string, keyFacts: string[]): number {
  if (keyFacts.length === 0) return 1;
  const text = normalize(report);
  const present = keyFacts.filter((fact) => text.includes(normalize(fact))).length;
  return present / keyFacts.length;
}

/**
 * Slice 6. The share of citations whose source is in the top two authority
 * tiers (official or primary records, peer-reviewed work). A citation whose
 * source has no tier counts as outside them. Null when there are no citations,
 * or when no tier was read for any of them.
 */
export function scoreAuthorityShare(citations: EvalCitation[]): number | null {
  if (citations.length === 0 || citations.every((citation) => citation.authorityTier === undefined)) return null;
  const top = citations.filter((citation) => citation.authorityTier === 1 || citation.authorityTier === 2).length;
  return top / citations.length;
}

export function scoreContradictionRetention(links: ContradictionLink[], sides: [string, string]): number {
  const wanted = new Set(sides.map(normalize));
  return links.some((link) => {
    const pair = new Set([normalize(link.documentA), normalize(link.documentB)]);
    return pair.size === 2 && [...wanted].every((side) => pair.has(side));
  })
    ? 1
    : 0;
}

export function scoreStoredReport(input: EvalScoreInput): EvalScores {
  const report = input.reportMarkdown;
  return {
    answer_correct: input.keyFacts ? scoreAnswerCorrect(report, input.keyFacts) : null,
    citation_bound: scoreCitationBound(report, input.citations, input.citationLock),
    quote_verbatim: scoreQuoteVerbatim(input.citations),
    quote_supports: input.quoteSupports ?? null,
    quote_supports_not_judged: input.quoteSupportsNotJudged ?? null,
    authority_share: scoreAuthorityShare(input.citations),
    doi_resolution: scoreDoiResolution(input.doiChecks),
    contradiction_retention: input.fixtureSides
      ? scoreContradictionRetention(input.contradictionLinks ?? [], input.fixtureSides)
      : null,
    anomaly_retained: input.anomalyPhrase
      ? normalize(report).includes(normalize(input.anomalyPhrase)) ||
        input.citations.some((row) => normalize(row.chunkQuote).includes(normalize(input.anomalyPhrase ?? '')))
        ? 1
        : 0
      : null,
    time_to_report: input.seconds ?? null,
    tokens: input.tokens ?? null,
    presentation_clean: scorePresentationClean(report),
    structure_complete: scoreStructureComplete(report),
    no_repetition: scoreNoRepetition([{ content: report }]),
    report_quality: input.reportQuality ?? null,
    report_quality_subscores: null,
  };
}

/** A missing judge is a failed gate. It must not be stored as a silent pass. */
export function applyJudgeGate(scores: EvalScores, judgment: { mean: number; subScores: Record<string, number> } | null): EvalScores {
  if (judgment == null) {
    return { ...scores, report_quality: null, report_quality_subscores: null, gate_status: 'verification_failed' };
  }
  return { ...scores, report_quality: judgment.mean, report_quality_subscores: judgment.subScores };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}
