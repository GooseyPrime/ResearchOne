import type { IntentId } from '../planning/intentTaxonomy';
import { countsAgainstIndependence } from './sourceIndependence';

export interface CorpusGateThresholds {
  minDistinctDomains: number;
  minDistinctSources: number;
  minTotalChunks: number;
  maxSingleDomainShare: number;
  maxSelfSourceShare: number;
  maxMedianSourceAgeMonths: number;
  globalBootstrapMinTotalChunks: number;
}

export interface CorpusSourceRecord {
  sourceId: string;
  sourceUrl: string | null;
  tags: string[];
  publishedAt: string | Date | null;
  ingestedAt: string | Date | null;
  ownerUserId: string | null;
  sourceOrigin: 'external_discovery' | 'user_upload' | 'researchone_generated' | 'user_supplied_url' | null;
  partitionKey: string | null;
  chunkCount: number;
}

export interface CorpusGateDecision {
  partition: string;
  status: 'sealed' | 'unsealed';
  reason: string;
  sealCategory: 'bootstrap' | 'composition' | 'unclassified' | null;
  thresholds: CorpusGateThresholds;
  minSimilarity: number;
  citableChunks: number;
  backgroundChunks: number;
}

export const UNCLASSIFIED_PARTITION = 'unclassified';

/**
 * Last-resort corpus partition when neither the request's filter tags nor any
 * retrieved source declares one.
 *
 * These names describe the KIND of work, never a subject. The discovery family
 * was previously called `market.affiliate` — a topic borrowed from the request
 * that happened to be under development. That is wrong twice over: an
 * opportunity_discovery report about medical devices would have been filed under
 * affiliate marketing, and because Rule 40 unlocks per partition, satisfying the
 * thresholds for one subject would have unsealed every unrelated subject sharing
 * the partition.
 *
 * Subject-level partitioning belongs in the tags, which take precedence over
 * this map. Grouping is unchanged from the previous map so unlock behaviour is
 * unaffected; only the name is now subject-neutral.
 */
const INTENT_PARTITION_MAP: Partial<Record<IntentId, string>> = {
  opportunity_discovery: 'discovery.general',
  comparative: 'discovery.general',
  feasibility: 'discovery.general',
  recommendation: 'discovery.general',
  exploratory: 'discovery.general',
  implementation: 'implementation.general',
  how_to: 'implementation.general',
  factual_report: 'reference.general',
  literature_review: 'reference.general',
  survey: 'reference.general',
  timeline: 'reference.general',
  reference_lookup: 'reference.general',
  adjudication: 'adjudication.general',
  investigation: 'adjudication.general',
  story_verification: 'adjudication.general',
  position_brief: 'adjudication.general',
};

export function resolveCorpusPartition(args: {
  intentId?: IntentId;
  filterTags?: string[];
  sourceRecords?: CorpusSourceRecord[];
}): string {
  const filterTagPartition = extractPartitionFromTags(args.filterTags ?? []);
  if (filterTagPartition) return filterTagPartition;

  for (const record of args.sourceRecords ?? []) {
    if (record.partitionKey?.trim()) return record.partitionKey.trim().toLowerCase();
    const tagPartition = extractPartitionFromTags(record.tags);
    if (tagPartition) return tagPartition;
  }

  if (args.intentId && INTENT_PARTITION_MAP[args.intentId]) {
    return INTENT_PARTITION_MAP[args.intentId]!;
  }

  return UNCLASSIFIED_PARTITION;
}

export function evaluateCorpusGate(args: {
  partition: string;
  sourceRecords: CorpusSourceRecord[];
  thresholds: CorpusGateThresholds;
  minSimilarity: number;
  globalTotalChunks: number;
  now?: Date;
}): CorpusGateDecision {
  const {
    partition,
    sourceRecords,
    thresholds,
    minSimilarity,
    globalTotalChunks,
  } = args;

  if (partition === UNCLASSIFIED_PARTITION) {
    return {
      partition,
      status: 'sealed',
      reason: 'partition unclassified is permanently sealed',
      sealCategory: 'unclassified',
      thresholds,
      minSimilarity,
      citableChunks: 0,
      backgroundChunks: 0,
    };
  }

  const distinctSourceCount = new Set(sourceRecords.map((record) => record.sourceId)).size;
  const totalChunks = sourceRecords.reduce((sum, record) => sum + Math.max(0, record.chunkCount || 0), 0);

  const domainCounts = new Map<string, number>();
  let selfSourceCount = 0;
  for (const record of sourceRecords) {
    const domain = registrableDomain(record.sourceUrl);
    if (domain) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
    // Everything that is not externally discovered counts against the
    // partition's independence ceiling: the system's own output, the
    // requester's uploads, and the requester's supplied URLs alike. Counting
    // only `researchone_generated` let a partition made entirely of private
    // uploads report selfSourceShare 0 and unseal (Codex, PR #217).
    if (countsAgainstIndependence(record)) {
      selfSourceCount += 1;
    }
  }

  const distinctDomainCount = domainCounts.size;
  const maxSingleDomainCount = domainCounts.size > 0 ? Math.max(...domainCounts.values()) : 0;
  const maxSingleDomainShare = distinctSourceCount > 0 ? maxSingleDomainCount / distinctSourceCount : 1;
  const selfSourceShare = distinctSourceCount > 0 ? selfSourceCount / distinctSourceCount : 1;
  const medianSourceAgeMonths = computeMedianSourceAgeMonths(sourceRecords, args.now ?? new Date());

  const bootstrapReasons: string[] = [];
  const compositionReasons: string[] = [];
  if (globalTotalChunks < thresholds.globalBootstrapMinTotalChunks) {
    bootstrapReasons.push(`global_total_chunks ${globalTotalChunks} < ${thresholds.globalBootstrapMinTotalChunks}`);
  }
  if (distinctDomainCount < thresholds.minDistinctDomains) {
    bootstrapReasons.push(`distinct_domains ${distinctDomainCount} < ${thresholds.minDistinctDomains}`);
  }
  if (distinctSourceCount < thresholds.minDistinctSources) {
    bootstrapReasons.push(`distinct_sources ${distinctSourceCount} < ${thresholds.minDistinctSources}`);
  }
  if (totalChunks < thresholds.minTotalChunks) {
    bootstrapReasons.push(`total_chunks ${totalChunks} < ${thresholds.minTotalChunks}`);
  }
  if (maxSingleDomainShare > thresholds.maxSingleDomainShare) {
    compositionReasons.push(`single_domain_share ${maxSingleDomainShare.toFixed(2)} > ${thresholds.maxSingleDomainShare.toFixed(2)}`);
  }
  if (selfSourceShare > thresholds.maxSelfSourceShare) {
    compositionReasons.push(`self_source_share ${selfSourceShare.toFixed(2)} > ${thresholds.maxSelfSourceShare.toFixed(2)}`);
  }
  if (medianSourceAgeMonths > thresholds.maxMedianSourceAgeMonths) {
    compositionReasons.push(`median_source_age_months ${medianSourceAgeMonths.toFixed(1)} > ${thresholds.maxMedianSourceAgeMonths}`);
  }
  const reasons = [...bootstrapReasons, ...compositionReasons];
  const sealCategory =
    reasons.length === 0
      ? null
      : bootstrapReasons.length > 0
        ? 'bootstrap'
        : 'composition';

  return {
    partition,
    status: reasons.length > 0 ? 'sealed' : 'unsealed',
    reason: reasons.length > 0 ? reasons.join('; ') : 'thresholds satisfied',
    sealCategory,
    thresholds,
    minSimilarity,
    citableChunks: 0,
    backgroundChunks: 0,
  };
}

export function intentNeedsIndependentExternalEvidence(intentId?: IntentId): boolean {
  return intentId === 'opportunity_discovery'
    || intentId === 'comparative'
    || intentId === 'feasibility'
    || intentId === 'recommendation'
    || intentId === 'exploratory';
}

export function extractPartitionFromTags(tags: string[]): string | null {
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const match = tag.trim().match(/^partition:(.+)$/i);
    if (match?.[1]) return match[1].trim().toLowerCase();
  }
  return null;
}

function registrableDomain(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();
    if (!hostname || hostname === 'localhost') return hostname || null;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return hostname;
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

function computeMedianSourceAgeMonths(sourceRecords: CorpusSourceRecord[], now: Date): number {
  const monthAges = sourceRecords
    .map((record) => coerceDate(record.publishedAt) ?? coerceDate(record.ingestedAt))
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
    .map((value) => Math.max(0, (now.getTime() - value.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)))
    .sort((a, b) => a - b);

  if (monthAges.length === 0) return Number.POSITIVE_INFINITY;
  const middle = Math.floor(monthAges.length / 2);
  if (monthAges.length % 2 === 0) {
    return (monthAges[middle - 1] + monthAges[middle]) / 2;
  }
  return monthAges[middle]!;
}

function coerceDate(value: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
