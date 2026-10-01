export interface EvalCitation {
  alias: string;
  chunkQuote: string;
  chunkText: string;
  doi?: string;
  resolveStatus?: string | null;
}

export interface EvalScoreInput {
  reportMarkdown: string;
  citations: EvalCitation[];
  keyFacts?: string[];
  contradictions?: string[];
  fixtureConflict?: string;
  anomalyPhrase?: string;
}

export interface EvalScores {
  answer_correct: number | null;
  citation_bound: number;
  quote_verbatim: number;
  authority_share: null;
  doi_resolution: number;
  contradiction_retention: number | null;
  anomaly_retained: number | null;
}

function aliasesIn(report: string): string[] {
  return [...report.matchAll(/\[(E\d+)\]/g)].map((match) => match[1]);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function scoreCitationBound(report: string, citations: EvalCitation[]): number {
  const aliases = aliasesIn(report);
  if (aliases.length === 0) return 1;
  const byAlias = new Map(citations.map((row) => [row.alias, row]));
  const bound = aliases.filter((alias) => {
    const row = byAlias.get(alias);
    return Boolean(row && row.chunkQuote.trim().length > 0);
  }).length;
  return bound / aliases.length;
}

export function scoreQuoteVerbatim(citations: EvalCitation[]): number {
  const quoted = citations.filter((row) => row.chunkQuote.trim().length > 0);
  if (quoted.length === 0) return 1;
  const verbatim = quoted.filter((row) => normalize(row.chunkText).includes(normalize(row.chunkQuote))).length;
  return verbatim / quoted.length;
}

export function scoreAnswerCorrect(report: string, keyFacts: string[]): number {
  if (keyFacts.length === 0) return 1;
  const text = normalize(report);
  const present = keyFacts.filter((fact) => text.includes(normalize(fact))).length;
  return present / keyFacts.length;
}

export function scoreDoiResolution(citations: EvalCitation[]): number {
  const withDoi = citations.filter((row) => row.doi && row.doi.trim().length > 0);
  if (withDoi.length === 0) return 1;
  const resolved = withDoi.filter((row) => row.resolveStatus === 'resolved').length;
  return resolved / withDoi.length;
}

export function scoreStoredReport(input: EvalScoreInput): EvalScores {
  const report = input.reportMarkdown;
  return {
    answer_correct: input.keyFacts ? scoreAnswerCorrect(report, input.keyFacts) : null,
    citation_bound: scoreCitationBound(report, input.citations),
    quote_verbatim: scoreQuoteVerbatim(input.citations),
    authority_share: null,
    doi_resolution: scoreDoiResolution(input.citations),
    contradiction_retention: input.fixtureConflict
      ? (input.contradictions ?? []).some((row) => normalize(row).includes(normalize(input.fixtureConflict ?? '')))
        ? 1
        : 0
      : null,
    anomaly_retained: input.anomalyPhrase
      ? normalize(report).includes(normalize(input.anomalyPhrase)) ||
        input.citations.some((row) => normalize(row.chunkQuote).includes(normalize(input.anomalyPhrase ?? '')))
        ? 1
        : 0
      : null,
  };
}
