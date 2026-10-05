/**
 * Shared types for the autonomous discovery subsystem.
 * These types flow through the provider abstraction and orchestrator.
 */

export interface SearchQuery {
  text: string;
  tags?: string[];
  preferredSourceTypes?: string[];
  maxResults?: number;
}

export interface SearchResultCandidate {
  /** Normalised URL — used for deduplication */
  url: string;
  title: string;
  snippet: string;
  /** Relevance score from provider, 0–1 */
  score: number;
  /** Provider-specific rank (lower is better) */
  rank: number;
  /** Which provider returned this result */
  provider: string;
  /** Query that produced this result */
  sourceQuery: string;
  /** Optional content hash if content was already fetched */
  contentHash?: string;
  /**
   * Who wrote and published the work and when, where the provider's record
   * says. Used for the reference list. Carried into storage only when the
   * citation lock is on for the run.
   */
  bibliographic?: BibliographicDetails;
}

export interface BibliographicDetails {
  authors?: string[];
  publisher?: string;
  /** YYYY-MM-DD. Left out when the record gives less than a full day. */
  publishedAt?: string;
}

/** [year, month, day] as YYYY-MM-DD. A record that gives less than a full day gives no date: none is made up. */
export function isoFromParts(parts: ReadonlyArray<number> | undefined): string | undefined {
  if (!parts || parts.length < 3) return undefined;
  const [year, month, day] = parts;
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return undefined;
  if (!Number.isInteger(month) || month < 1 || month > 12) return undefined;
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The candidate as it was before reference details existed. */
export function withoutBibliographic(candidate: SearchResultCandidate): SearchResultCandidate {
  if (!('bibliographic' in candidate)) return candidate;
  const { bibliographic: _dropped, ...rest } = candidate;
  return rest;
}

/**
 * The candidate a run keeps. With the citation lock on for the run it keeps the
 * provider's reference details; with it off it is the candidate as it always was,
 * so nothing new is stored, logged or queued.
 */
export function candidateForRun(candidate: SearchResultCandidate, citationLockOn: boolean): SearchResultCandidate {
  return citationLockOn ? candidate : withoutBibliographic(candidate);
}

/**
 * What goes with a discovered source into storage for its reference entry: the
 * provider that found it, and whatever the provider's record says about who
 * wrote and published it. Empty when the candidate carries none, which is every
 * candidate of a run without the citation lock.
 */
export function bibliographicMetadata(candidate: SearchResultCandidate): { bibliographic?: BibliographicDetails & { provider: string } } {
  if (!candidate.bibliographic) return {};
  return { bibliographic: { ...candidate.bibliographic, provider: candidate.provider } };
}

export interface DiscoverySource {
  url: string;
  title: string;
  snippet: string;
  score: number;
  rank: number;
  provider: string;
  sourceQuery: string;
  /** Why the selector chose this source */
  selectionRationale: string;
  /** Whether this source was actually ingested */
  ingested: boolean;
  /** Ingestion job ID if ingested */
  ingestionJobId?: string;
  /** Why this source was skipped (if not ingested) */
  skipReason?: string;
}

export interface DiscoveryPlan {
  need_external_discovery: boolean;
  rationale: string;
  discovery_queries: string[];
  target_source_types: string[];
  preferred_evidence_tiers: string[];
  max_sources_to_ingest: number;
  exclusion_patterns: string[];
  disconfirming_evidence_criteria: string;
}

export interface DiscoveryRunSummary {
  runId: string;
  discoveryEnabled: boolean;
  planDecision: boolean;
  planRationale: string;
  queriesExecuted: string[];
  candidatesFound: number;
  candidatesSelected: number;
  sourcesIngested: number;
  sourcesSkipped: number;
  sources: DiscoverySource[];
  durationMs: number;
}
