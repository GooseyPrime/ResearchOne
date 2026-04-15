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
