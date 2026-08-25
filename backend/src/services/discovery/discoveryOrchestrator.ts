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
import {
  buildDeterministicDiscoveryQueries,
  capForPlannerPrompt,
  redactQueryEcho,
  MAX_PLANNER_QUERY_CHARS,
  MAX_PLANNER_PLAN_CHARS,
} from './deterministicDiscoveryQueries';
import { query, queryOne } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { partitionByRelevance } from './candidateRelevance';
import { callRoleModel } from '../openrouter/openrouterService';
import { runScope } from '../telemetry';
import type { ResearchObjective } from '../reasoning/reasoningModelPolicy';
import { withPreamble } from '../../constants/prompts';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { isSpecialistAgentId, type SpecialistAgentId } from '../reasoning/agentCapabilityRegistry';
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
import { OpenAlexSearchProvider } from './providers/openAlexSearch';
import { CrossrefSearchProvider } from './providers/crossrefSearch';
import { ArxivSearchProvider } from './providers/arxivSearch';
import { PubmedCentralSearchProvider } from './providers/pubmedCentralSearch';
import { UsptoSearchProvider } from './providers/usptoSearch';
import { ClinicalTrialsSearchProvider } from './providers/clinicalTrialsSearch';
import { ParallelSearchProvider } from './providers/parallelSearch';

const PROVIDER_BUILDERS = {
  tavily: () => new TavilySearchProvider(),
  brave: () => new BraveSearchProvider(),
  generic: () => new GenericWebSearchProvider(),
  parallel: () => new ParallelSearchProvider(),
  openalex: () => new OpenAlexSearchProvider(),
  crossref: () => new CrossrefSearchProvider(),
  arxiv: () => new ArxivSearchProvider(),
  pmc: () => new PubmedCentralSearchProvider(),
  uspto: () => new UsptoSearchProvider(),
  clinicaltrials: () => new ClinicalTrialsSearchProvider(),
} as const;

type ProviderKey = keyof typeof PROVIDER_BUILDERS;
const providerCache = new Map<ProviderKey, SearchProvider>();

function provider(key: ProviderKey): SearchProvider {
  // Provider classes are expected to be stateless wrappers around external APIs.
  // We memoize instances to avoid repeated construction within long-lived workers.
  const cached = providerCache.get(key);
  if (cached) return cached;
  const built = PROVIDER_BUILDERS[key]();
  providerCache.set(key, built);
  return built;
}

const SPECIALIST_CONNECTOR_KEYS: Partial<Record<SpecialistAgentId, readonly ProviderKey[]>> = {
  market_scout: ['parallel'],
  demand_signal_analyst: ['parallel'],
  competitor_mapper: ['parallel'],
  story_verifier: ['openalex', 'crossref'],
  timeline_reconstructor: ['openalex', 'crossref'],
  data_analysis_specialist: ['arxiv', 'pmc', 'uspto', 'clinicaltrials'],
  quantitative_quality_auditor: ['arxiv', 'pmc', 'uspto', 'clinicaltrials'],
  feasibility_architect: ['arxiv', 'pmc', 'uspto', 'clinicaltrials'],
};

/** Discovery planner system prompt (round 1 — initial search). */
const DISCOVERY_PLANNER_PROMPT = `You are a discovery planning agent for ResearchOne, a disciplined research system.
Your role is to plan external discovery for a research query. External discovery is always required — always output need_external_discovery: true and always generate discovery_queries.

CRITICAL RULES:
- Always set need_external_discovery to true
- Always generate at least 2 discovery_queries
- Be specific about what evidence types would add value
- Prefer primary sources and structured data over opinion content
- Flag exclusion patterns for low-quality or off-topic domains
- Output valid JSON only — no preamble or commentary

Output JSON with this exact schema:
{
  "need_external_discovery": true,
  "rationale": "string",
  "discovery_queries": ["string", ...],
  "target_source_types": ["web_url", "pdf", ...],
  "preferred_evidence_tiers": ["established_fact", "strong_evidence", "testimony", "inference", "speculation"],
  "max_sources_to_ingest": number,
  "exclusion_patterns": ["string", ...],
  "disconfirming_evidence_criteria": "string"
}`;

/** Discovery planner system prompt (round 2 — sleuthing pass).
 *  After round 1 retrieves an initial set of sources, this round inspects
 *  the results and proposes follow-up queries that pursue specific entities,
 *  citations, contradictions, or unexplored avenues found in round-1 hits.
 *  This is what gives the report its "investigative" feel rather than the
 *  shallow one-shot retrieval the user complained about. */
const DISCOVERY_FOLLOWUP_PROMPT = `You are a discovery FOLLOW-UP planning agent for ResearchOne.
Round 1 of discovery already executed. You are now performing a SLEUTHING pass: look at what was actually found and propose follow-up queries that pursue specific entities, contradictions, citations, or unexplored avenues that emerged from round 1.

CRITICAL RULES:
- Read the round-1 candidate titles/snippets. Identify named entities, claims that beg verification, references that beg follow-up, and angles the round-1 queries did NOT cover.
- Propose 2–5 NEW queries that materially expand the investigation. Do not duplicate round-1 phrasing.
- If round 1 already covered the topic exhaustively, return follow_up_queries: [] and explain why.
- Output valid JSON only.

Output JSON with this exact schema:
{
  "rationale": "string",
  "follow_up_queries": ["string", ...],
  "exclusion_patterns": ["string", ...]
}`;

/** Get the configured search provider(s) */
function getSearchProviders(specialistAgentIds: readonly string[] = []): SearchProvider[] {
  const connectorKeys = new Set<ProviderKey>();
  for (const specialistId of specialistAgentIds) {
    if (!isSpecialistAgentId(specialistId)) continue;
    for (const key of SPECIALIST_CONNECTOR_KEYS[specialistId] ?? []) {
      connectorKeys.add(key);
    }
  }
  const specialistConnectors = [...connectorKeys].map((key) => provider(key));

  const providerName = config.discovery.provider;
  switch (providerName) {
    case 'cascade':
      return [provider('tavily'), provider('brave'), provider('generic'), ...specialistConnectors];
    case 'brave':
      return [provider('brave'), ...specialistConnectors];
    case 'generic':
      return [provider('generic'), ...specialistConnectors];
    case 'tavily':
      return [provider('tavily'), ...specialistConnectors];
    default:
      return [provider('tavily'), ...specialistConnectors];
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
 * Public entry. Wraps the discovery body in a nested telemetry scope
 * that overrides `phase` to 'Discovery' so all `callRoleModel` calls
 * here surface as Discovery in the admin cost dashboard, not Planning.
 *
 * The nested scope inherits `runId`, `userId`, `reportId`, `orgId`
 * from the parent (set by `runResearchJob` per PATCH 02) via
 * `runScope.current()` spread.
 *
 * Edge case: if Discovery is ever invoked outside a research run
 * (e.g. a hypothetical "discovery-only" API), `runScope.current()`
 * returns null. The OR-fallback below handles that — we still set
 * runId from args.
 */
export async function runDiscoveryOrchestrator(args: {
  runId: string;
  researchQuery: string;
  plan: Record<string, unknown>;
  filterTags?: string[];
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
  userId?: string;
  specialistAgentIds?: string[];
  /** Per-run add-on override (parallel_search → higher ingest cap). */
  maxIngestCapOverride?: number;
  minUsableSources?: number;
  maxCoverageRounds?: number;
  /** Optional callback fired after each discovery round so the parent
   *  orchestrator can emit a live trace event ("Discovery round 2 complete
   *  +N candidates"). */
  onRoundComplete?: (payload: { round: number; candidatesAfter: number }) => Promise<void> | void;
  /** Fired when the LLM planner yielded no usable queries and deterministic recovery took over (Rule 42 R42-3). */
  onDeterministicFallback?: (payload: { reason: string; queries: string[] }) => Promise<void> | void;
}): Promise<DiscoveryRunSummary> {
  const parent = runScope.current();
  return runScope.run(
    {
      ...(parent ?? {}),
      runId: parent?.runId ?? args.runId,
      userId: parent?.userId ?? args.userId ?? null,
      phaseOverride: 'Discovery',
    },
    () => runDiscoveryOrchestratorInner(args)
  );
}

async function runDiscoveryOrchestratorInner(args: {
  runId: string;
  researchQuery: string;
  plan: Record<string, unknown>;
  filterTags?: string[];
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
  userId?: string;
  specialistAgentIds?: string[];
  maxIngestCapOverride?: number;
  minUsableSources?: number;
  maxCoverageRounds?: number;
  onRoundComplete?: (payload: { round: number; candidatesAfter: number }) => Promise<void> | void;
  /** Fired when the LLM planner yielded no usable queries and deterministic recovery took over (Rule 42 R42-3). */
  onDeterministicFallback?: (payload: { reason: string; queries: string[] }) => Promise<void> | void;
}): Promise<DiscoveryRunSummary> {
  const {
    runId,
    researchQuery,
    plan,
    engineVersion,
    researchObjective,
    allowFallbackByRole,
    byokApiKeyOverride,
    userId,
    specialistAgentIds,
    maxIngestCapOverride,
    minUsableSources,
    maxCoverageRounds,
    onRoundComplete,
    onDeterministicFallback,
  } = args;
  const startTime = Date.now();

  if (!config.discovery.enabled) {
    logger.info(`[discovery:${runId}] Discovery disabled via config`);
    return buildSummary(runId, false, 'Discovery disabled via DISCOVERY_ENABLED=false', [], [], [], startTime);
  }

  logger.info(`[discovery:${runId}] Starting discovery orchestration`);

  // ─── Step 1: Get discovery plan from model ─────────────────────────────────
  let discoveryPlan: DiscoveryPlan;
  try {
    const planResult = await callRoleModel({
      role: 'planner',
      engineVersion,
      researchObjective,
      allowFallbackByRole,
      byokApiKeyOverride,
      messages: [
        { role: 'system', content: withPreamble(DISCOVERY_PLANNER_PROMPT) },
        {
          role: 'user',
          // WO-AA F-4: this call is load-bearing — if it fails, discovery
          // produces nothing and (with the Rule 40 corpus gate) the run has no
          // evidence at all. Structured prompts run to hundreds of lines and
          // the plan re-embeds the query, so an uncapped payload was a likely
          // cause of the planner failure in run 6c59b711. Budget both parts.
          content:
            `Research Query: ${capForPlannerPrompt(researchQuery, MAX_PLANNER_QUERY_CHARS)}\n\n` +
            `Current Research Plan:\n${capForPlannerPrompt(
              redactQueryEcho(JSON.stringify(plan, null, 2), researchQuery),
              MAX_PLANNER_PLAN_CHARS
            )}\n\n` +
            `Plan external discovery queries for this research. Output JSON only.`,
        },
      ],
      maxTokens: 2048,
    });

    const jsonMatch = planResult.content.match(/\{[\s\S]*\}/);
    discoveryPlan = JSON.parse(jsonMatch?.[0] ?? planResult.content) as DiscoveryPlan;
  } catch (err) {
    logger.warn(`[discovery:${runId}] Discovery plan parsing failed:`, err);
    discoveryPlan = {
      need_external_discovery: true,
      rationale: 'Discovery plan parsing failed — no queries to execute',
      discovery_queries: [],
      target_source_types: [],
      preferred_evidence_tiers: [],
      max_sources_to_ingest: 0,
      exclusion_patterns: [],
      disconfirming_evidence_criteria: '',
    };
  }

  // Also recover when the planner returned parseable JSON but an empty/malformed
  // query array — the catch above only covers hard parse failures.
  if (!Array.isArray(discoveryPlan.discovery_queries)) {
    discoveryPlan.discovery_queries = [];
  }

  // Policy enforcement: external discovery is always warranted per ResearchOne epistemic
  // policy. Override any model-produced false to guarantee retries/fallbacks are never
  // short-circuited by a model that was overly conservative.
  discoveryPlan.need_external_discovery = true;

  await persistDiscoveryEvent(runId, 'plan', 'planner', researchQuery, 0, 0, { plan: discoveryPlan });

  // A failed or empty planner response must NEVER silently disable external
  // search. With the Rule 40 corpus gate sealing partitions by default,
  // discovery is the only evidence path — a single flaky planner call
  // previously zeroed the entire evidence base for the run and produced a
  // report built on nothing (Rule 42).
  if (discoveryPlan.discovery_queries.length === 0) {
    const fallbackQueries = buildDeterministicDiscoveryQueries(researchQuery, plan);
    if (fallbackQueries.length > 0) {
      logger.warn(
        `[discovery:${runId}] Planner produced no queries (${discoveryPlan.rationale}) — ` +
        `falling back to ${fallbackQueries.length} deterministic queries derived from the research request`
      );
      discoveryPlan.discovery_queries = fallbackQueries;
      await persistDiscoveryEvent(runId, 'plan', 'deterministic_fallback', researchQuery, 0, 0, {
        reason: 'planner_produced_no_queries',
        rationale: discoveryPlan.rationale,
        queries: fallbackQueries,
      });
      // Rule 42 R42-3 requires model-control fallbacks to log, persist AND
      // emit progress. Without this the run trace shows only the generic
      // planning message, so degraded deterministic recovery is
      // indistinguishable from normal model-planned discovery.
      try {
        await onDeterministicFallback?.({
          reason: 'planner_produced_no_queries',
          queries: fallbackQueries,
        });
      } catch { /* non-fatal */ }
    } else {
      logger.error(`[discovery:${runId}] No queries and no deterministic fallback could be derived — skipping search`);
      return buildSummary(runId, false, discoveryPlan.rationale, [], [], [], startTime);
    }
  }

  const capCeiling =
    typeof maxIngestCapOverride === 'number' && maxIngestCapOverride > 0
      ? maxIngestCapOverride
      : config.discovery.maxIngestPerRun;
  const maxIngest = Math.min(discoveryPlan.max_sources_to_ingest || capCeiling, capCeiling);

  logger.info(`[discovery:${runId}] Discovery round 1 needed. Queries: ${discoveryPlan.discovery_queries.join(' | ')}`);

  // ─── Step 2: Execute search queries ─────────────────────────────────────────
  const providers = getSearchProviders(specialistAgentIds ?? []);
  const orderedProviders = isSensitiveTopic(researchQuery)
    ? [...providers].sort((a, b) => (a.name === 'brave' ? -1 : b.name === 'brave' ? 1 : 0))
    : providers;
  const allCandidates: SearchResultCandidate[] = [];
  const seenUrls = new Set<string>();
  const queriesExecuted: string[] = [];
  let roundsExecuted = 0;
  // Total query budget shared across all discovery rounds.
  const totalQueryBudget = config.discovery.maxQueriesPerRun;

  /** Execute one round of search queries against the configured providers,
   *  deduplicating against `seenUrls` and persisting per-query audit events. */
  const runSearchRound = async (
    roundNumber: number,
    queries: string[],
    exclusionPatterns: string[]
  ) => {
    if (queries.length === 0) return 0;
    let roundNewCandidates = 0;
    for (const searchQuery of queries) {
      if (queriesExecuted.length >= totalQueryBudget) break;
      queriesExecuted.push(searchQuery);

      // Fan out configured providers in parallel for this query. Dedup via `seenUrls` /
      // `allCandidates` is still safe: each provider processes its results in one synchronous
      // block before awaiting `persistDiscoveryEvent`, so no interleaved double-insert races.
      const providerResults = await Promise.allSettled(
        orderedProviders.map(async (provider) => {
          const results = await provider.search({
            text: searchQuery,
            maxResults: config.discovery.maxResults,
          });

          let newCount = 0;
          for (const r of results) {
            const key = normalizeUrl(r.url);
            const isExcluded = exclusionPatterns.some((pat) => key.includes(pat));
            if (isExcluded || seenUrls.has(key)) continue;
            seenUrls.add(key);
            allCandidates.push(r);
            newCount++;
          }

          await persistDiscoveryEvent(runId, `search_round_${roundNumber}`, provider.name, searchQuery, results.length, newCount, {
            round: roundNumber,
            query: searchQuery,
            raw_count: results.length,
            new_count: newCount,
          });

          logger.debug(`[discovery:${runId}] r${roundNumber} ${provider.name} "${searchQuery}": ${results.length} results, ${newCount} new`);
          return newCount;
        })
      );

      for (const pr of providerResults) {
        if (pr.status === 'fulfilled') {
          roundNewCandidates += pr.value;
        } else {
          const reason = pr.reason;
          logger.error(`[discovery:${runId}] r${roundNumber} provider fan-out search failed:`, reason);
        }
      }
    }
    roundsExecuted += 1;
    return roundNewCandidates;
  };

  // ─── Round 1: initial query set ─────────────────────────────────────────────
  const round1Queries = discoveryPlan.discovery_queries.slice(0, totalQueryBudget);
  const round1New = await runSearchRound(1, round1Queries, discoveryPlan.exclusion_patterns);
  logger.info(`[discovery:${runId}] Round 1 complete: +${round1New} candidates (total ${allCandidates.length})`);
  try { await onRoundComplete?.({ round: 1, candidatesAfter: allCandidates.length }); } catch { /* non-fatal */ }

  // ─── Round 2: sleuthing pass ────────────────────────────────────────────────
  // Ask the planner to look at round-1 candidate titles/URLs and propose
  // follow-up queries pursuing specific entities, citations, contradictions,
  // or unexplored avenues. Bounded by remaining query budget (capped at 5).
  const remainingQueryBudget = Math.max(0, totalQueryBudget - queriesExecuted.length);
  if (allCandidates.length > 0 && remainingQueryBudget > 0) {
    try {
      const round1Sample = allCandidates.slice(0, 20).map((c, i) => ({
        n: i + 1,
        title: c.title,
        url: c.url,
        snippet: typeof c.snippet === 'string' ? c.snippet.slice(0, 220) : '',
      }));
      const followupResult = await callRoleModel({
        role: 'planner',
        engineVersion,
        researchObjective,
        byokApiKeyOverride,
        allowFallbackByRole,
        messages: [
          { role: 'system', content: withPreamble(DISCOVERY_FOLLOWUP_PROMPT) },
          {
            role: 'user',
            content: `Research Query: ${researchQuery}\n\nRound 1 candidates (${allCandidates.length} total, sample below):\n${JSON.stringify(round1Sample, null, 2)}\n\nRound 1 queries already executed (do not duplicate):\n${queriesExecuted.map((q) => `- ${q}`).join('\n')}\n\nPropose follow-up queries that materially expand the investigation. Output JSON only.`,
          },
        ],
        maxTokens: 1024,
      });
      const fmatch = followupResult.content.match(/\{[\s\S]*\}/);
      const parsed = fmatch ? (JSON.parse(fmatch[0]) as { rationale?: string; follow_up_queries?: unknown; exclusion_patterns?: unknown }) : null;
      const followUpQueries = Array.isArray(parsed?.follow_up_queries)
        ? (parsed!.follow_up_queries as unknown[])
            .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
            .map((q) => q.trim())
            .filter((q) => !queriesExecuted.includes(q))
            .slice(0, Math.min(5, remainingQueryBudget))
        : [];
      const round2Exclusions = Array.isArray(parsed?.exclusion_patterns)
        ? [
            ...discoveryPlan.exclusion_patterns,
            ...(parsed!.exclusion_patterns as unknown[]).filter((p): p is string => typeof p === 'string'),
          ]
        : discoveryPlan.exclusion_patterns;

      await persistDiscoveryEvent(runId, 'plan_round_2', 'planner', researchQuery, 0, 0, {
        rationale: parsed?.rationale ?? '',
        follow_up_queries: followUpQueries,
      });

      if (followUpQueries.length > 0) {
        logger.info(`[discovery:${runId}] Round 2 queries: ${followUpQueries.join(' | ')}`);
        const round2New = await runSearchRound(2, followUpQueries, round2Exclusions);
        logger.info(`[discovery:${runId}] Round 2 complete: +${round2New} candidates (total ${allCandidates.length})`);
        try { await onRoundComplete?.({ round: 2, candidatesAfter: allCandidates.length }); } catch { /* non-fatal */ }
      } else {
        logger.info(`[discovery:${runId}] Round 2 produced no follow-up queries — round 1 already covered the topic`);
      }
    } catch (err) {
      logger.warn(`[discovery:${runId}] Round 2 follow-up planning failed (continuing with round-1 results):`, err);
    }
  } else if (allCandidates.length === 0) {
    logger.info(`[discovery:${runId}] Skipping round 2 — round 1 returned no candidates`);
  } else {
    logger.info(`[discovery:${runId}] Skipping round 2 — query budget exhausted`);
  }

  // ─── Additional bounded coverage rounds ─────────────────────────────────────
  const roundsCap = Math.max(2, Math.min(maxCoverageRounds ?? 4, 6));
  let nextRound = 3;
  while (
    nextRound <= roundsCap &&
    queriesExecuted.length < totalQueryBudget &&
    allCandidates.length < (minUsableSources ?? maxIngest) * 2
  ) {
    const remainingBudget = Math.max(0, totalQueryBudget - queriesExecuted.length);
    if (remainingBudget <= 0) break;
    const uncoveredHint = [
      'demand signals',
      'competitor reality',
      'technical feasibility',
      'regulatory constraints',
      'monetization',
      'acquisition',
    ];
    const seed = discoveryPlan.discovery_queries[nextRound % discoveryPlan.discovery_queries.length] ?? researchQuery;
    const extraQueries = uncoveredHint
      .map((hint) => `${seed} ${hint}`)
      .filter((q) => !queriesExecuted.includes(q))
      .slice(0, Math.min(3, remainingBudget));
    if (extraQueries.length === 0) break;
    const roundNew = await runSearchRound(nextRound, extraQueries, discoveryPlan.exclusion_patterns);
    logger.info(`[discovery:${runId}] Round ${nextRound} complete: +${roundNew} candidates (total ${allCandidates.length})`);
    try { await onRoundComplete?.({ round: nextRound, candidatesAfter: allCandidates.length }); } catch { /* non-fatal */ }
    if (roundNew === 0) break;
    nextRound += 1;
  }

  logger.info(`[discovery:${runId}] Total candidates after ${roundsExecuted} round(s): ${allCandidates.length}`);

  // Persist the round count on the run row so the FailedRunReportPage trace
  // can show whether the second-round sleuthing pass actually executed.
  try {
    await query(
      `UPDATE research_runs SET discovery_round_count=$1 WHERE id=$2`,
      [roundsExecuted, runId]
    );
  } catch {
    // Column may not yet be present pre-migration 013 — non-fatal.
  }

  // ─── Step 3: Score/rank candidates ──────────────────────────────────────────
  // Sort by score descending, then rank ascending.
  const scoreRanked = [...allCandidates].sort((a, b) => b.score - a.score || a.rank - b.rank);

  // Then: is it about the thing that was asked?
  //
  // Provider scores are not comparable across providers — arXiv's idea of a
  // good match for "affiliate marketing niches" is still a paper — and nothing
  // between an API response and the ingest queue used to ask whether the
  // result was on topic. On-topic candidates are ingested first; off-topic
  // ones are held back and used only to avoid starving a run of sources, and
  // when they are used it is recorded as such.
  const relevance = partitionByRelevance(researchQuery, scoreRanked);
  const relevanceFloor = Math.max(minUsableSources ?? 0, Math.min(3, maxIngest));
  const ranked =
    relevance.onTopic.length >= relevanceFloor
      ? [...relevance.onTopic, ...relevance.offTopic]
      : scoreRanked;
  const offTopicUrls = new Set(relevance.offTopic.map((candidate) => candidate.url));
  if (relevance.offTopic.length > 0) {
    logger.info(
      `[discovery:${runId}] ${relevance.offTopic.length} of ${scoreRanked.length} candidates read as off-topic for this request` +
        (relevance.onTopic.length >= relevanceFloor ? ' and were deprioritised' : ' but were kept — too few on-topic candidates to drop them')
    );
  }

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
      const ijMeta = JSON.stringify({ discovery_run_id: runId, query: candidate.sourceQuery });
      try {
        await query(
          `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata, user_id)
           VALUES ($1, $2, 'web_url', 'queued', $3, $4)`,
          [jobId, candidate.url, ijMeta, userId ?? null]
        );
      } catch (ijErr) {
        if ((ijErr as { code?: string })?.code !== '42703') throw ijErr;
        await query(
          `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
           VALUES ($1, $2, 'web_url', 'queued', $3)`,
          [jobId, candidate.url, ijMeta]
        );
      }

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
        selectionRationale: offTopicUrls.has(candidate.url)
          ? `score=${candidate.score.toFixed(2)}, rank=${candidate.rank}, off-topic for this request (kept: too few on-topic candidates)`
          : `score=${candidate.score.toFixed(2)}, rank=${candidate.rank}`,
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
export async function waitForIngestionJobs(jobIds: string[], timeoutMs: number): Promise<void> {
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

export interface IngestionJobOutcome {
  jobId: string;
  status: string;
  fileName: string | null;
  url: string | null;
  errorMessage: string | null;
}

/** Read terminal ingestion job rows for supplemental ingest feedback. */
export async function fetchIngestionJobOutcomes(jobIds: string[]): Promise<IngestionJobOutcome[]> {
  if (jobIds.length === 0) return [];

  const placeholders = jobIds.map((_, i) => `$${i + 1}`).join(',');
  try {
    const rows = await query<{
      id: string;
      status: string;
      file_name: string | null;
      url: string | null;
      error_message: string | null;
    }>(
      `SELECT id, status, file_name, url, error_message
       FROM ingestion_jobs
       WHERE id IN (${placeholders})`,
      jobIds
    );
    return rows.map((row) => ({
      jobId: row.id,
      status: row.status,
      fileName: row.file_name,
      url: row.url,
      errorMessage: row.error_message,
    }));
  } catch (err) {
    if ((err as { code?: string })?.code === '42703') {
      const rows = await query<{ id: string; status: string; file_name: string | null; url: string | null }>(
        `SELECT id, status, file_name, url FROM ingestion_jobs WHERE id IN (${placeholders})`,
        jobIds
      );
      return rows.map((row) => ({
        jobId: row.id,
        status: row.status,
        fileName: row.file_name,
        url: row.url,
        errorMessage: null,
      }));
    }
    throw err;
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

export { DISCOVERY_PLANNER_PROMPT, DISCOVERY_FOLLOWUP_PROMPT };
