/**
 * Discovery orchestrator.
 * Sits between planning and internal retrieval in the research pipeline.
 *
 * Flow:
 * 1. Ask the planner/discovery model whether external discovery is needed
 * 2. If yes, execute bounded search queries via configured providers
 * 3. Deduplicate and score candidates
 * 4. Enqueue ingestion for selected sources (up to max_sources_to_ingest)
 * 5. Wait for ingestion/embedding to complete (bounded timeout)
 * 6. Return a DiscoveryRunSummary for audit and provenance
 *
 * Design rules:
 * - Model may propose discovery targets; backend executes bounded, auditable actions
 * - Never treat search ranking as truth ranking
 * - Preserve candidate metadata even when a candidate is skipped
 */

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { query, queryOne } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { callRoleModel } from '../openrouter/openrouterService';
import { withPreamble } from '../../constants/prompts';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import {
  DiscoveryPlan,
  DiscoveryRunSummary,
  DiscoverySource,
  SearchResultCandidate,
} from './providerTypes';
import { SearchProvider } from './providers/searchProvider';
import { GenericWebSearchProvider } from './providers/genericWebSearch';
import { BraveSearchProvider } from './providers/braveSearch';
import { TavilySearchProvider } from './providers/tavilySearch';

/** Discovery planner system prompt */
const DISCOVERY_PLANNER_PROMPT = `You are a discovery planning agent for ResearchOne, a disciplined research system.
Your role is to decide whether a research query requires external discovery beyond the current corpus.

CRITICAL RULES:
- Only recommend external discovery when corpus evidence is likely insufficient
- Be specific about what evidence types would add value
- Prefer primary sources and structured data over opinion content
- Flag exclusion patterns for low-quality or off-topic domains
- Output valid JSON only — no preamble or commentary

Output JSON with this exact schema:
{
  "need_external_discovery": boolean,
  "rationale": "string",
  "discovery_queries": ["string", ...],
  "target_source_types": ["web_url", "pdf", ...],
  "preferred_evidence_tiers": ["established_fact", "strong_evidence", "testimony", "inference", "speculation"],
  "max_sources_to_ingest": number,
  "exclusion_patterns": ["string", ...],
  "disconfirming_evidence_criteria": "string"
}`;

/** Get the configured search provider(s) */
function getSearchProviders(): SearchProvider[] {
  const providerName = config.discovery.provider;
  switch (providerName) {
    case 'cascade':
      return [new TavilySearchProvider(), new BraveSearchProvider(), new GenericWebSearchProvider()];
    case 'brave':
      return [new BraveSearchProvider()];
    case 'generic':
      return [new GenericWebSearchProvider()];
    case 'tavily':
      return [new TavilySearchProvider()];
    default:
      return [new TavilySearchProvider()];
  }
}

function isSensitiveTopic(text: string): boolean {
  const lowered = text.toLowerCase();
  return ['censorship', 'suppressed', 'classified', 'geopolit', 'military', 'whistleblower', 'intelligence']
    .some((token) => lowered.includes(token));
}

/** Normalise a URL for deduplication (remove fragment, trailing slash, lowercase scheme+host) */
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw.toLowerCase().trim();
  }
}

/**
 * Run the autonomous external discovery stage for a research run.
 */
export async function runDiscoveryOrchestrator(args: {
  runId: string;
  researchQuery: string;
  plan: Record<string, unknown>;
  filterTags?: string[];
}): Promise<DiscoveryRunSummary> {
  const { runId, researchQuery, plan } = args;
  const startTime = Date.now();

  if (!config.discovery.enabled) {
    logger.info(`[discovery:${runId}] Discovery disabled via config`);
    return buildSummary(runId, false, 'Discovery disabled via DISCOVERY_ENABLED=false', [], [], [], startTime);
  }

  logger.info(`[discovery:${runId}] Starting discovery orchestration`);

  // ─── Step 1: Ask model whether discovery is needed ─────────────────────────
  let discoveryPlan: DiscoveryPlan;
  try {
    const planResult = await callRoleModel({
      role: 'planner',
      messages: [
        { role: 'system', content: withPreamble(DISCOVERY_PLANNER_PROMPT) },
        {
          role: 'user',
          content: `Research Query: ${researchQuery}\n\nCurrent Research Plan:\n${JSON.stringify(plan, null, 2)}\n\nDecide whether external discovery is needed. Output JSON only.`,
        },
      ],
      maxTokens: 1024,
    });

    const jsonMatch = planResult.content.match(/\{[\s\S]*\}/);
    discoveryPlan = JSON.parse(jsonMatch?.[0] ?? planResult.content) as DiscoveryPlan;
  } catch (err) {
    logger.warn(`[discovery:${runId}] Discovery plan parsing failed:`, err);
    discoveryPlan = {
      need_external_discovery: false,
      rationale: 'Discovery plan parsing failed — skipping external discovery',
      discovery_queries: [],
      target_source_types: [],
      preferred_evidence_tiers: [],
      max_sources_to_ingest: 0,
      exclusion_patterns: [],
      disconfirming_evidence_criteria: '',
    };
  }

  await persistDiscoveryEvent(runId, 'plan', 'planner', researchQuery, 0, 0, { plan: discoveryPlan });

  if (!discoveryPlan.need_external_discovery) {
    logger.info(`[discovery:${runId}] Model decided discovery not needed: ${discoveryPlan.rationale}`);
    return buildSummary(runId, false, discoveryPlan.rationale, [], [], [], startTime);
  }

  const maxIngest = Math.min(
    discoveryPlan.max_sources_to_ingest || config.discovery.maxIngestPerRun,
    config.discovery.maxIngestPerRun
  );

  logger.info(`[discovery:${runId}] Discovery needed. Queries: ${discoveryPlan.discovery_queries.join(' | ')}`);

  // ─── Step 2: Execute search queries ─────────────────────────────────────────
  const providers = getSearchProviders();
  const orderedProviders = isSensitiveTopic(researchQuery)
    ? [...providers].sort((a, b) => (a.name === 'brave' ? -1 : b.name === 'brave' ? 1 : 0))
    : providers;
  const allCandidates: SearchResultCandidate[] = [];
  const seenUrls = new Set<string>();
  const queriesExecuted: string[] = [];

  for (const searchQuery of discoveryPlan.discovery_queries.slice(0, config.discovery.maxQueriesPerRun)) {
    queriesExecuted.push(searchQuery);

    for (const provider of orderedProviders) {
      try {
        const results = await provider.search({
          text: searchQuery,
          maxResults: config.discovery.maxResults,
        });

        let newCount = 0;
        for (const r of results) {
          const key = normalizeUrl(r.url);
          // Skip excluded patterns
          const isExcluded = discoveryPlan.exclusion_patterns.some(pat => key.includes(pat));
          if (isExcluded || seenUrls.has(key)) continue;
          seenUrls.add(key);
          allCandidates.push(r);
          newCount++;
        }

        await persistDiscoveryEvent(runId, 'search', provider.name, searchQuery, results.length, newCount, {
          query: searchQuery,
          raw_count: results.length,
          new_count: newCount,
        });

        logger.debug(`[discovery:${runId}] ${provider.name} "${searchQuery}": ${results.length} results, ${newCount} new`);
      } catch (err) {
        logger.error(`[discovery:${runId}] Provider ${provider.name} search failed:`, err);
      }
    }
  }

  logger.info(`[discovery:${runId}] Total candidates after dedup: ${allCandidates.length}`);

  // ─── Step 3: Score/rank candidates ──────────────────────────────────────────
  // Sort by score descending, then rank ascending
  const ranked = [...allCandidates].sort((a, b) => b.score - a.score || a.rank - b.rank);

  // ─── Step 4: Check which candidates are already in corpus ───────────────────
  const selected: DiscoverySource[] = [];
  const skipped: DiscoverySource[] = [];

  for (let i = 0; i < ranked.length && selected.length < maxIngest; i++) {
    const candidate = ranked[i];
    const normalised = normalizeUrl(candidate.url);

    // Check if already ingested
    const alreadyIngested = await queryOne<{ id: string }>(
      `SELECT id FROM sources WHERE url=$1 OR url=$2`,
      [candidate.url, normalised]
    );

    if (alreadyIngested) {
      skipped.push({
        ...candidate,
        selectionRationale: 'already in corpus',
        ingested: false,
        skipReason: 'already_in_corpus',
      });
      continue;
    }

    // Enqueue ingestion
    const jobId = uuidv4();
    try {
      await query(
        `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
         VALUES ($1, $2, 'web_url', 'queued', $3)`,
        [jobId, candidate.url, JSON.stringify({ discovery_run_id: runId, query: candidate.sourceQuery })]
      );

      const finalUrl = await ensureReachableUrl(candidate.url);
      await ingestionQueue.add('ingest-url', {
        ingestionJobId: jobId,
        url: finalUrl,
        sourceType: 'web_url',
        tags: [],
        metadata: { discovery_run_id: runId },
        importedVia: 'autonomous_discovery',
        discoveredByRunId: runId,
        discoveryQuery: candidate.sourceQuery,
        sourceRank: candidate.rank,
        fetchMethod: 'http_get',
      });

      selected.push({
        ...candidate,
        selectionRationale: `score=${candidate.score.toFixed(2)}, rank=${candidate.rank}`,
        ingested: true,
        ingestionJobId: jobId,
      });

      logger.info(`[discovery:${runId}] Queued ingestion for: ${finalUrl} (job ${jobId})`);
    } catch (err) {
      logger.error(`[discovery:${runId}] Failed to queue ingestion for ${candidate.url}:`, err);
      skipped.push({
        ...candidate,
        selectionRationale: 'ingestion queue failed',
        ingested: false,
        skipReason: 'queue_error',
      });
    }
  }

  // Mark remaining candidates as skipped (max reached or not selected)
  for (let i = selected.length + skipped.length; i < ranked.length; i++) {
    skipped.push({
      ...ranked[i],
      selectionRationale: 'max_sources_to_ingest reached',
      ingested: false,
      skipReason: 'max_reached',
    });
  }

  // ─── Step 5: Wait for ingestion jobs to complete (bounded timeout) ──────────
  if (selected.length > 0) {
    logger.info(`[discovery:${runId}] Waiting for ${selected.length} ingestion jobs to complete...`);
    await waitForIngestionJobs(
      selected.map(s => s.ingestionJobId!).filter(Boolean),
      config.discovery.ingestionWaitTimeoutMs
    );
  }

  await persistDiscoveryEvent(runId, 'complete', 'orchestrator', researchQuery, allCandidates.length, selected.length, {
    selected: selected.map(s => ({ url: s.url, jobId: s.ingestionJobId })),
    skipped: skipped.map(s => ({ url: s.url, reason: s.skipReason })),
  });

  const summary = buildSummary(
    runId,
    true,
    discoveryPlan.rationale,
    queriesExecuted,
    selected,
    skipped,
    startTime
  );

  logger.info(`[discovery:${runId}] Discovery complete. Ingested: ${selected.length}, Skipped: ${skipped.length}`);

  return summary;
}

async function ensureReachableUrl(url: string): Promise<string> {
  try {
    const response = await axios.head(url, { timeout: 6000, validateStatus: () => true });
    if (response.status >= 200 && response.status < 400) {
      return url;
    }
    return `https://web.archive.org/web/*/${url}`;
  } catch {
    return `https://web.archive.org/web/*/${url}`;
  }
}

/** Wait for ingestion jobs to complete or timeout */
async function waitForIngestionJobs(jobIds: string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(jobIds);

  while (pending.size > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 3000));

    const placeholders = [...pending].map((_, i) => `$${i + 1}`).join(',');
    const rows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM ingestion_jobs WHERE id IN (${placeholders})`,
      [...pending]
    );

    for (const row of rows) {
      if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
        pending.delete(row.id);
      }
    }
  }

  if (pending.size > 0) {
    logger.warn(`[discovery] ${pending.size} ingestion jobs still pending after timeout — continuing research`);
  }
}

/** Persist a discovery audit event */
async function persistDiscoveryEvent(
  runId: string,
  phase: string,
  provider: string,
  queryText: string,
  resultCount: number,
  selectedCount: number,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO discovery_events (id, run_id, phase, provider, query_text, result_count, selected_count, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuidv4(), runId, phase, provider, queryText, resultCount, selectedCount, JSON.stringify(payload)]
    );
  } catch (err) {
    // Don't fail the research run if audit persistence fails
    logger.warn('[discovery] Failed to persist discovery event:', err);
  }
}

function buildSummary(
  runId: string,
  planDecision: boolean,
  planRationale: string,
  queriesExecuted: string[],
  selected: DiscoverySource[],
  skipped: DiscoverySource[],
  startTime: number
): DiscoveryRunSummary {
  return {
    runId,
    discoveryEnabled: config.discovery.enabled,
    planDecision,
    planRationale,
    queriesExecuted,
    candidatesFound: selected.length + skipped.length,
    candidatesSelected: selected.length,
    sourcesIngested: selected.filter(s => s.ingested).length,
    sourcesSkipped: skipped.length,
    sources: [...selected, ...skipped],
    durationMs: Date.now() - startTime,
  };
}

export { DISCOVERY_PLANNER_PROMPT };
