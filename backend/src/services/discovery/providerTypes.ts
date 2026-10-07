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
  /**
   * Slice 6. The source's authority tier, 1 to 4, worked out from the provider's
   * record when the result came in. Set only when AUTHORITY_TIERS_ENABLED is on
   * for the run; with it off a candidate does not carry the field.
   */
  authorityTier?: number;
}

export interface BibliographicDetails {
  authors?: string[];
  publisher?: string;
  /** What the provider's record says the work is, in words: "journal article", "preprint", "book chapter". */
  kind?: string;
  /** YYYY-MM-DD. Left out when the record gives less than a full day, or a day that does not exist. */
  publishedAt?: string;
  /** The work's DOI when the provider's record gives one, as "10.xxxx/…". Kept apart from the address, which may be the provider's own page. */
  doi?: string;
  /**
   * The provider whose record these details came from, when that is not the
   * provider of the candidate carrying them: the same address found by two
   * providers keeps one candidate and the fuller record.
   */
  provider?: string;
}

/**
 * Whether YYYY-MM-DD names a day that exists. `Date.parse` turns 31 February
 * into 3 March instead of refusing it, and the database refuses it outright,
 * which would fail the job that stores the source. A day is real only if it
 * comes back unchanged.
 */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) >= 1000;
}

/** [year, month, day] as YYYY-MM-DD. A record that gives less than a full day, or a day that does not exist, gives no date: none is made up. */
export function isoFromParts(parts: ReadonlyArray<number> | undefined): string | undefined {
  if (!parts || parts.length < 3) return undefined;
  const [year, month, day] = parts;
  if (![year, month, day].every((part) => Number.isInteger(part))) return undefined;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isCalendarDay(iso) ? iso : undefined;
}

/** The candidate with its tier, or unchanged when there is none to give. */
export function withAuthorityTier(candidate: SearchResultCandidate, tier: number | null): SearchResultCandidate {
  return tier === null ? candidate : { ...candidate, authorityTier: tier };
}

/** The candidate as it was before reference details existed. */
export function withoutBibliographic(candidate: SearchResultCandidate): SearchResultCandidate {
  if (!('bibliographic' in candidate)) return candidate;
  const { bibliographic: _dropped, ...rest } = candidate;
  return rest;
}

/**
 * A provider's result as a run may use it. A DOI in the provider's record is
 * kept only when the run checks DOIs (DOI_RESOLVE_ENABLED): with that switch
 * off the record is what it was before the switch existed, so nothing new is
 * stored.
 */
export function resultForRun(candidate: SearchResultCandidate, doiChecksOn: boolean): SearchResultCandidate {
  if (doiChecksOn || !candidate.bibliographic?.doi) return candidate;
  const { doi: _doi, ...rest } = candidate.bibliographic;
  return { ...candidate, bibliographic: rest };
}

/**
 * Metadata a person sent with a request to ingest something, as it may be
 * stored. A DOI under `bibliographic` is kept only when DOI checks are on: with
 * the switch off, no route stores the new field.
 */
export function requestMetadataForStorage(metadata: Record<string, unknown> | undefined, doiChecksOn: boolean): Record<string, unknown> {
  const out = { ...(metadata ?? {}) };
  const record = out.bibliographic;
  if (!doiChecksOn && record && typeof record === 'object' && !Array.isArray(record) && 'doi' in record) {
    const { doi: _doi, ...rest } = record as Record<string, unknown>;
    out.bibliographic = rest;
  }
  return out;
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
  return { bibliographic: { ...candidate.bibliographic, provider: candidate.bibliographic.provider ?? candidate.provider } };
}

const DETAIL_FIELDS = ['authors', 'publisher', 'kind', 'publishedAt'] as const;

function detailCount(details: BibliographicDetails): number {
  return DETAIL_FIELDS.filter((field) => {
    const value = details[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }).length;
}

/** A candidate's reference record with the provider it came from, or undefined when it has none. */
export function providerRecord(candidate: SearchResultCandidate): BibliographicDetails | undefined {
  if (!candidate.bibliographic) return undefined;
  return { ...candidate.bibliographic, provider: candidate.bibliographic.provider ?? candidate.provider };
}

/**
 * One reference record from the records several providers hold for one address.
 * The choice is made over the providers' own records, never over a record
 * already merged, so it cannot depend on which provider answered first: the
 * record with the most details wins, a tie goes to the provider whose name
 * sorts first, and what the winner lacks is filled from the others in that same
 * order. The result carries the winner's provider, since the kind it names is
 * that provider's wording.
 */
export function fullestBibliographic(records: ReadonlyArray<BibliographicDetails>): BibliographicDetails | undefined {
  if (records.length === 0) return undefined;
  const ordered = [...records].sort((a, b) => detailCount(b) - detailCount(a) || (a.provider ?? '').localeCompare(b.provider ?? '') || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const merged: BibliographicDetails = { ...ordered[0] };
  for (const other of ordered.slice(1)) {
    if (!merged.authors?.length && other.authors?.length) merged.authors = other.authors;
    if (!merged.publisher && other.publisher) merged.publisher = other.publisher;
    if (!merged.kind && other.kind) merged.kind = other.kind;
    if (!merged.publishedAt && other.publishedAt) merged.publishedAt = other.publishedAt;
    if (!merged.doi && other.doi) merged.doi = other.doi;
  }
  return merged;
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
