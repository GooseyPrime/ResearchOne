import { dropSystemSections, readerNumbersIn } from '../reasoning/citationLock';
import { scoreNoRepetition, scorePresentationClean, scoreStructureComplete } from '../reasoning/baselineReport';

export interface EvalCitation {
  alias: string;
  chunkQuote: string;
  chunkText: string;
  chunkId?: string | null;
  citationText?: string | null;
  claimText?: string | null;
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
  authority_share: null;
  doi_resolution: null;
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

function aliasesIn(report: string): string[] {
  return [...report.matchAll(/\[(E\d+)\]/g)].map((match) => match[1]);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function aliasKey(value: string): string {
  return value.replace(/[\[\]]/g, '').trim();
}

export function scoreCitationBound(report: string, citations: EvalCitation[], citationLock = false): number {
  if (citations.length === 0) return 0;
  if (citationLock) {
    const aliases = aliasesIn(report).map(aliasKey);
    if (aliases.length === 0) return scoreReaderNumbersBound(report, citations);
    const byAlias = new Map(citations.map((row) => [aliasKey(row.alias), row]));
    const bound = aliases.filter((alias) => {
      const row = byAlias.get(alias);
      return Boolean(row && row.chunkId && row.chunkQuote.trim().length > 0);
    }).length;
    return bound / aliases.length;
  }
  const bound = citations.filter((row) => Boolean(row.chunkId) && row.chunkQuote.trim().length > 0).length;
  return bound / citations.length;
}

/**
 * A locked report cites with reader numbers. The k-th number in the prose is
 * backed by the k-th saved citation: it must carry the same number, a passage
 * and a quote. Numbers in code, in links and in the reference list do not count.
 */
function scoreReaderNumbersBound(report: string, citations: EvalCitation[]): number {
  const markers = readerNumbersIn(dropSystemSections(report));
  if (markers.length === 0) return 0;
  const rows = citations.filter((row) => /^\[\d+\]$/.test((row.citationText ?? '').trim()));
  const bound = markers.filter((marker, index) => {
    const row = rows[index];
    return Boolean(row && (row.citationText ?? '').trim() === marker && row.chunkId && row.chunkQuote.trim().length > 0);
  }).length;
  return bound / markers.length;
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
    authority_share: null,
    doi_resolution: null,
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
