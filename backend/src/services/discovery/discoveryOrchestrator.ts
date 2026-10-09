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
  searchSeedFor,
  redactQueryEcho,
  MAX_PLANNER_QUERY_CHARS,
  MAX_PLANNER_PLAN_CHARS,
} from './deterministicDiscoveryQueries';
import { query, queryOne } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { fillReferenceDetails, recordAuthorityTier, storedBibliographic } from '../ingestion/ingestionService';
import { authorityTierOfResults, authorityTiersEnabled, storedAuthorityTier } from '../authority/authorityTier';
import { selectByRelevance } from './candidateRelevance';
import { recordDiscoveryEvent } from './discoveryEvents';
import {
  RELEVANCE_BATCH_SIZE,
  documentKey,
  judgeRelevance,
  notUsedLabel,
  relevanceGateEnabled,
  rememberVerdict,
  verdictFor,
  type RelevanceCheckReport,
} from './relevanceGate';
import { effectiveIngestCap } from './sourceBudget';
import { callRoleModel } from '../openrouter/openrouterService';
import { runScope } from '../telemetry';
import type { ResearchObjective } from '../reasoning/reasoningModelPolicy';
import { withPreamble } from '../../constants/prompts';
import { logger } from '../../utils/logger';
import {
  citationLockEnabled,
  config,
  discoveryIngestFloor,
  discoveryQueryBudget,
  doiResolveEnabled,
  providerRoutingEnabled,
} from '../../config';
import { providersForRequest, selectProviders, sourceDescriptionsFor, type DiscoveryRoute, type ProviderKey, type ProviderSelection } from './providerRouting';
import { isSpecialistAgentId, type SpecialistAgentId } from '../reasoning/agentCapabilityRegistry';
import {
  DiscoveryPlan,
  DiscoveryRunSummary,
  DiscoverySource,
  BibliographicDetails,
  SearchResultCandidate,
  bibliographicMetadata,
  withAuthorityTier,
  normalizeDiscoveryUrl,
  candidateForRun,
  resultForRun,
  fullestBibliographic,
  providerRecord,
} from './providerTypes';
import { SearchProvider } from './providers/searchProvider';
import { PROVIDER_REGISTRY } from './providerRegistry';

/** Built from the registry: adding a service there makes it available here. */
const PROVIDER_BUILDERS: Record<ProviderKey, () => SearchProvider> = Object.fromEntries(
  Object.entries(PROVIDER_REGISTRY).map(([key, entry]) => [key, entry.build])
) as Record<ProviderKey, () => SearchProvider>;

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

/** The general web providers the server is configured with, in cascade order. */
function webProviderKeys(): ProviderKey[] {
  switch (config.discovery.provider) {
    case 'cascade':
      return ['tavily', 'brave', 'generic'];
    case 'brave':
      return ['brave'];
    case 'generic':
      return ['generic'];
    default:
      return ['tavily'];
  }
}

/**
 * Slice 7. Gap-filling rounds (round 3 on), planned by the model from what was
 * actually found. Without routing these rounds append fixed phrases ("demand
 * signals", "monetization") to a planned query, whatever the subject.
 */
const DISCOVERY_GAP_PROMPT = `You are a discovery GAP-FILLING planning agent for ResearchOne.
Earlier search rounds have run. Your job is to find what the research request still needs that the material found so far does not cover, and to write new search queries aimed at exactly those gaps.

CRITICAL RULES:
- Read the research request and the titles and snippets found so far. Name the specific gaps: questions the request asks that nothing found answers, kinds of source that are missing (for example an official record, a primary document, a dataset, a dissenting account), periods, places or parties not yet covered.
- Write each query about the request's own subject, in the words a good searcher would use for it. Do not add generic words that are not about the subject.
- The searches go to the sources listed below. Write queries those sources can answer.

SOURCES SEARCHED:
{sources}
- Do not repeat or lightly reword a query already run.
- If what was found already covers the request, return "done": true and no queries.
- Output valid JSON only.

Output JSON with this exact schema:
{
  "gaps": ["string", ...],
  "queries": ["string", ...],
  "done": boolean
}`;

/**
 * The next gap-filling round's queries, or null when the rounds should end:
 * the planner judged the request covered, proposed nothing new, or could not
 * be read on either model. Each outcome is logged and recorded with the run.
 */
export async function planGapQueries(args: {
  runId: string;
  round: number;
  researchQuery: string;
  /** What each searched source covers (`sourceDescriptionsFor`). */
  sources: string;
  queriesExecuted: readonly string[];
  found: readonly SearchResultCandidate[];
  maxQueries: number;
  model: {
    engineVersion?: string;
    researchObjective?: ResearchObjective;
    allowFallbackByRole?: Record<string, boolean>;
    byokApiKeyOverride?: string;
  };
}): Promise<string[] | null> {
  const sample = args.found.slice(0, 30).map((c, i) => ({
    n: i + 1,
    title: c.title,
    url: c.url,
    snippet: typeof c.snippet === 'string' ? c.snippet.slice(0, 220) : '',
  }));
  try {
    const result = await callRoleModel({
      role: 'planner',
      ...args.model,
      messages: [
        { role: 'system', content: withPreamble(DISCOVERY_GAP_PROMPT.replace('{sources}', args.sources)) },
        {
          role: 'user',
          content:
            `Research Query: ${capForPlannerPrompt(args.researchQuery, MAX_PLANNER_QUERY_CHARS)}\n\n` +
            `Found so far (${args.found.length} total, sample below):\n${JSON.stringify(sample, null, 2)}\n\n` +
            `Queries already run (do not repeat):\n${args.queriesExecuted.map((q) => `- ${q}`).join('\n')}\n\n` +
            `Write at most ${args.maxQueries} queries for the gaps. Output JSON only.`,
        },
      ],
      maxTokens: 1024,
    });
    const match = result.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? result.content) as { gaps?: unknown; queries?: unknown; done?: unknown };
    const gaps = Array.isArray(parsed.gaps) ? parsed.gaps.filter((gap): gap is string => typeof gap === 'string') : [];
    const queries = (Array.isArray(parsed.queries) ? parsed.queries : [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      .map((q) => q.replace(/\s+/g, ' ').trim())
      .filter((q, at, all) => !args.queriesExecuted.includes(q) && all.indexOf(q) === at)
      .slice(0, Math.max(0, args.maxQueries));
    const done = parsed.done === true || queries.length === 0;
    await persistDiscoveryEvent(args.runId, `plan_round_${args.round}`, 'planner', args.researchQuery, 0, 0, { gaps, queries: done ? [] : queries, done });
    if (done) {
      logger.info(`[discovery:${args.runId}] Round ${args.round}: planner found no gaps to search`);
      return null;
    }
    logger.info(`[discovery:${args.runId}] Round ${args.round} gap queries: ${queries.join(' | ')}`);
    return queries;
  } catch (err) {
    // Rounds 1 and 2 have run; the extra rounds end, and that is recorded.
    logger.warn(`[discovery:${args.runId}] Round ${args.round} gap planning failed; ending extra search rounds:`, err);
    await persistDiscoveryEvent(args.runId, `plan_round_${args.round}`, 'planner', args.researchQuery, 0, 0, { failed: true, ...providerErrorRecord(err) });
    return null;
  }
}

/**
 * Get the configured search provider(s). With PROVIDER_ROUTING_ENABLED on, `selectProviders` decides instead.
 *
 * The specialist mapping still adds its connectors, but a scholarly-only one
 * (arXiv, PubMed Central, ClinicalTrials.gov, USPTO) is held back unless the
 * request itself is on a route that uses it (`providersForRequest`). The
 * mapping ties those four to specialists that are scheduled for report types
 * that have nothing to do with science, which is how a question about an
 * election was sent to arXiv.
 */
function getSearchProviders(
  specialistAgentIds: readonly string[],
  brief: { researchQuery: string; intent?: string | null; researchObjective?: string | null }
): { providers: SearchProvider[]; keys: ProviderKey[]; heldBack: ProviderKey[]; routes: DiscoveryRoute[] } {
  const connectorKeys = new Set<ProviderKey>();
  for (const specialistId of specialistAgentIds) {
    if (!isSpecialistAgentId(specialistId)) continue;
    for (const key of SPECIALIST_CONNECTOR_KEYS[specialistId] ?? []) {
      connectorKeys.add(key);
    }
  }
  const { allowed, heldBack, routes } = providersForRequest([...connectorKeys], brief);
  const keys = [...webProviderKeys(), ...allowed];
  return { providers: keys.map((key) => provider(key)), keys, heldBack, routes };
}

/** Candidates judged at a time before any is queued: two model calls, made together. */
const RELEVANCE_WAVE = RELEVANCE_BATCH_SIZE * 2;
/**
 * The most candidates one pass sends to the judge. The list is ranked, so past
 * this depth a pass that still has too few relevant sources is better served
 * by new searches than by reading further down the same results.
 */
const MAX_JUDGED_PER_PASS = 200;
/** Extra search rounds a pass may run when the relevance check leaves it short of sources. */
const MAX_RELEVANCE_GAP_ROUNDS = 2;
/** Queries each of those rounds may send. They may exceed the run's ordinary query budget by this much and no more. */
const RELEVANCE_GAP_QUERIES_PER_ROUND = 3;

function isSensitiveTopic(text: string): boolean {
  const lowered = text.toLowerCase();
  return ['censorship', 'suppressed', 'classified', 'geopolit', 'military', 'whistleblower', 'intelligence']
    .some((token) => lowered.includes(token));
}

/** Normalise a URL for deduplication (remove fragment, trailing slash, lowercase scheme+host) */
const normalizeUrl = normalizeDiscoveryUrl;

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
  /**
   * Slice 7. What the request is about, for choosing providers with
   * PROVIDER_ROUTING_ENABLED on. Ignored with it off.
   */
  routingBrief?: { intent?: string | null; layer2: boolean };
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
  /**
   * Fired after each batch of candidates is checked for relevance, so the run's
   * trace says how many were set aside and whether a model made the decision
   * (Rule 42 R42-3: a fallback must be visible in the trace).
   */
  onRelevanceCheck?: (report: RelevanceCheckReport) => Promise<void> | void;
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
  routingBrief?: { intent?: string | null; layer2: boolean };
  maxIngestCapOverride?: number;
  minUsableSources?: number;
  maxCoverageRounds?: number;
  onRoundComplete?: (payload: { round: number; candidatesAfter: number }) => Promise<void> | void;
  /** Fired when the LLM planner yielded no usable queries and deterministic recovery took over (Rule 42 R42-3). */
  onDeterministicFallback?: (payload: { reason: string; queries: string[] }) => Promise<void> | void;
  onRelevanceCheck?: (report: RelevanceCheckReport) => Promise<void> | void;
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
    routingBrief,
    maxIngestCapOverride,
    minUsableSources,
    maxCoverageRounds,
    onRoundComplete,
    onDeterministicFallback,
    onRelevanceCheck,
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

  // The caller's budget is a FLOOR, not just a ceiling.
  //
  // This used to be `min(planner's number, cap)`, so a planner that asked for
  // ten sources capped a 7,000-word report at ten however large a budget the
  // request earned — which is the under-sourcing the scaled budget was written
  // to fix, still happening, with the new helper computing a number that
  // nothing used. Testing the helper in isolation missed it: the test was
  // shaped like the fix instead of like the failure (Codex P1, PR #229).
  //
  // The planner may still ask for MORE than the floor, up to the hard ceiling.
  // What it may no longer do is ask for less than the deliverable needs.
  const budgetFloor =
    typeof maxIngestCapOverride === 'number' && maxIngestCapOverride > 0
      ? maxIngestCapOverride
      : discoveryIngestFloor();
  const maxIngest = effectiveIngestCap({
    budgetFloor,
    plannerRequest: discoveryPlan.max_sources_to_ingest,
  });

  logger.info(`[discovery:${runId}] Discovery round 1 needed. Queries: ${discoveryPlan.discovery_queries.join(' | ')}`);

  // ─── Step 2: Execute search queries ─────────────────────────────────────────
  // Slice 7. With routing on the request decides the providers and the
  // specialist mapping is not consulted: one routing system at a time.
  const routing: ProviderSelection | null = providerRoutingEnabled()
    ? selectProviders(
        {
          researchQuery,
          intent: routingBrief?.intent ?? null,
          researchObjective: researchObjective ?? null,
          layer2: routingBrief?.layer2 === true,
          seed: searchSeedFor(researchQuery, discoveryPlan.discovery_queries),
        },
        { webProviders: webProviderKeys() }
      )
    : null;
  if (routing) {
    logger.info(`[discovery:${runId}] Routes ${routing.routes.join(', ')}; providers ${routing.providers.join(', ')}`);
    await persistDiscoveryEvent(runId, 'routing', 'router', researchQuery, 0, 0, {
      routes: routing.routes,
      providers: routing.providers,
      not_configured: routing.notConfigured,
      extra_queries: routing.extraQueries.map(({ text, purpose, providers: to }) => ({ text, purpose, providers: to })),
    });
  }
  const unrouted = routing
    ? null
    : getSearchProviders(specialistAgentIds ?? [], {
        researchQuery,
        intent: routingBrief?.intent ?? null,
        researchObjective: researchObjective ?? null,
      });
  if (unrouted && unrouted.heldBack.length > 0) {
    logger.info(`[discovery:${runId}] Not searched for this request (scholarly-only, request is on ${unrouted.routes.join(', ')}): ${unrouted.heldBack.join(', ')}`);
    await persistDiscoveryEvent(runId, 'providers_held_back', 'router', researchQuery, 0, 0, {
      routes: unrouted.routes,
      held_back: unrouted.heldBack,
      why: 'scholarly-only service; the request is not scientific, medical, technical or about patents',
    });
  }
  const providers = routing ? routing.providers.map((key) => provider(key)) : unrouted!.providers;
  /** The services this pass searches, for the gap-filling planner. */
  const searchedKeys: readonly ProviderKey[] = routing ? routing.providers : unrouted!.keys;
  /** Queries sent only to some providers (slice 7 extra queries). Others go to every provider. */
  const queryProviders = new Map<string, ReadonlySet<string>>(
    (routing?.extraQueries ?? []).map((extra) => [extra.text, new Set<string>(extra.providers)])
  );
  const orderedProviders = isSensitiveTopic(researchQuery)
    ? [...providers].sort((a, b) => (a.name === 'brave' ? -1 : b.name === 'brave' ? 1 : 0))
    : providers;
  const allCandidates: SearchResultCandidate[] = [];
  const seenUrls = new Set<string>();
  /** Where each kept candidate sits in `allCandidates`, by normalised address. */
  const candidateAt = new Map<string, number>();
  /** Every provider's own reference record for an address, kept so the choice between them never depends on arrival order. */
  const recordsFor = new Map<string, BibliographicDetails[]>();
  /** Every provider result seen for an address, kept only with authority tiers on. */
  const resultsFor = new Map<string, SearchResultCandidate[]>();
  const queriesExecuted: string[] = [];
  let roundsExecuted = 0;
  /** The highest round number a search has run under. */
  let lastRoundNumber = 0;
  // Total query budget shared across all discovery rounds.
  const totalQueryBudget = discoveryQueryBudget();
  /**
   * What `runSearchRound` may spend up to. The run's budget, raised only by the
   * few queries a relevance gap-filling round is allowed (see below).
   */
  let queryBudget = totalQueryBudget;

  const recordProviderError = (name: string, searchQuery: string, round: number, reason: unknown) =>
    persistDiscoveryEvent(runId, 'provider_error', name, searchQuery, 0, 0, { round, query: searchQuery, ...providerErrorRecord(reason) });

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
      if (queriesExecuted.length >= queryBudget) break;
      queriesExecuted.push(searchQuery);

      // Fan out configured providers in parallel for this query. Dedup via `seenUrls` /
      // `allCandidates` is still safe: each provider processes its results in one synchronous
      // block before awaiting `persistDiscoveryEvent`, so no interleaved double-insert races.
      const only = queryProviders.get(searchQuery);
      const searchers = only ? orderedProviders.filter((candidate) => only.has(candidate.name)) : orderedProviders;
      const providerResults = await Promise.allSettled(
        searchers.map(async (provider) => {
          // Slice 7. Providers return [] when they cannot search, so a failure is
          // told through `onFailure` rather than as a rejection. Switch off: not passed.
          let failure: { reason: unknown } | null = null;
          const results = await provider.search({
            text: searchQuery,
            maxResults: config.discovery.maxResults,
            ...(routing ? { onFailure: (reason: unknown) => { failure = { reason }; } } : {}),
          });

          let newCount = 0;
          for (const found of results) {
            const r = resultForRun(found, doiResolveEnabled());
            const key = normalizeUrl(r.url);
            const isExcluded = exclusionPatterns.some((pat) => key.includes(pat));
            if (isExcluded) continue;
            if (seenUrls.has(key)) {
              // The same address from a second provider is still one candidate.
              // With the citation lock on it keeps the fuller reference record of
              // the two, whichever provider answered first.
              const at = candidateAt.get(key);
              if (authorityTiersEnabled() && at !== undefined) {
                // A second provider may record what the work is where the first did not.
                const seen = [...(resultsFor.get(key) ?? []), r];
                resultsFor.set(key, seen);
                allCandidates[at] = withAuthorityTier(allCandidates[at], authorityTierOfResults(seen));
              }
              const record = citationLockEnabled() ? providerRecord(r) : undefined;
              if (record && at !== undefined) {
                const records = [...(recordsFor.get(key) ?? []), record];
                recordsFor.set(key, records);
                allCandidates[at] = { ...allCandidates[at], bibliographic: fullestBibliographic(records) };
              }
              continue;
            }
            seenUrls.add(key);
            candidateAt.set(key, allCandidates.length);
            const firstRecord = citationLockEnabled() ? providerRecord(r) : undefined;
            if (firstRecord) recordsFor.set(key, [firstRecord]);
            // Reference details travel with a candidate only when the citation lock
            // is on for this run. With it off a candidate is exactly what it was.
            // The tier is worked out here, from the provider's own record, because
            // that record is dropped below when the citation lock is off and the
            // run's switches do not reach the worker that stores the source.
            if (authorityTiersEnabled()) resultsFor.set(key, [r]);
            allCandidates.push(
              authorityTiersEnabled()
                ? withAuthorityTier(candidateForRun(r, citationLockEnabled()), authorityTierOfResults([r]))
                : candidateForRun(r, citationLockEnabled())
            );
            newCount++;
          }

          await persistDiscoveryEvent(runId, `search_round_${roundNumber}`, provider.name, searchQuery, results.length, newCount, {
            round: roundNumber,
            query: searchQuery,
            raw_count: results.length,
            new_count: newCount,
          });

          if (failure) await recordProviderError(provider.name, searchQuery, roundNumber, (failure as { reason: unknown }).reason);

          logger.debug(`[discovery:${runId}] r${roundNumber} ${provider.name} "${searchQuery}": ${results.length} results, ${newCount} new`);
          return newCount;
        })
      );

      for (const [at, pr] of providerResults.entries()) {
        if (pr.status === 'fulfilled') {
          roundNewCandidates += pr.value;
        } else {
          const reason = pr.reason;
          logger.error(`[discovery:${runId}] r${roundNumber} provider fan-out search failed:`, reason);
          // Slice 7. One provider failing does not fail the run; it is recorded with the run.
          if (routing) await recordProviderError(searchers[at].name, searchQuery, roundNumber, reason);
        }
      }
    }
    roundsExecuted += 1;
    lastRoundNumber = Math.max(lastRoundNumber, roundNumber);
    return roundNewCandidates;
  };

  // ─── Round 1: initial query set ─────────────────────────────────────────────
  const round1Queries = routing
    ? withExtraQueries(discoveryPlan.discovery_queries, routing.extraQueries.map((extra) => extra.text), totalQueryBudget)
    : discoveryPlan.discovery_queries.slice(0, totalQueryBudget);
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
    let extraQueries: string[];
    if (routing) {
      // Slice 7. The planner reads what was found and decides what is still
      // missing; no fixed words are added to the request.
      const planned = await planGapQueries({
        runId,
        round: nextRound,
        researchQuery,
        sources: sourceDescriptionsFor(routing.providers),
        queriesExecuted,
        found: allCandidates,
        maxQueries: Math.min(3, remainingBudget),
        model: { engineVersion, researchObjective, allowFallbackByRole, byokApiKeyOverride },
      });
      if (!planned) break;
      extraQueries = planned;
    } else {
      const uncoveredHint = [
        'demand signals',
        'competitor reality',
        'technical feasibility',
        'regulatory constraints',
        'monetization',
        'acquisition',
      ];
      const seed = discoveryPlan.discovery_queries[nextRound % discoveryPlan.discovery_queries.length] ?? researchQuery;
      extraQueries = uncoveredHint
        .map((hint) => `${seed} ${hint}`)
        .filter((q) => !queriesExecuted.includes(q))
        .slice(0, Math.min(3, remainingBudget));
    }
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
  const byScore = (list: readonly SearchResultCandidate[]) => [...list].sort((a, b) => b.score - a.score || a.rank - b.rank);
  // The fewest sources this pass should end with: what the plan asked for, and never fewer than three.
  const relevanceFloor = Math.max(minUsableSources ?? 0, Math.min(3, maxIngest));
  // The relevance check. On unless switched off for an emergency; with it off
  // the word-overlap check below is all there is, as before.
  const gateOn = relevanceGateEnabled();

  const selected: DiscoverySource[] = [];
  const skipped: DiscoverySource[] = [];
  /** Addresses already decided on, so a later round considers only what is new. */
  const handled = new Set<string>();
  /** Candidates the judge kept, for the gap-filling planner to read. */
  const relevantFound: SearchResultCandidate[] = [];
  /** Relevant candidates that were already stored: usable by this run without a fetch. */
  let relevantAlreadyStored = 0;
  /** Candidates the relevance check set aside. */
  let setAside = 0;
  const keyOfCandidate = (candidate: SearchResultCandidate) => documentKey(candidate.url, candidate.title);

  /**
   * Ask the judge about one batch of candidates, remember what it said for the
   * rest of the run, and write the batch to the run's discovery record.
   */
  const judgeWave = async (wave: SearchResultCandidate[], round: number): Promise<void> => {
    // A model's verdict from an earlier pass of this run stands; only the rest are asked about.
    const fresh = wave.filter((candidate) => verdictFor(runId, keyOfCandidate(candidate))?.basis !== 'model');
    const judged = await judgeRelevance({
      runId,
      researchQuery,
      items: fresh.map((candidate) => ({
        key: keyOfCandidate(candidate),
        title: candidate.title ?? '',
        url: candidate.url,
        source: candidate.provider,
        excerpt: typeof candidate.snippet === 'string' ? candidate.snippet : '',
      })),
      model: { engineVersion, researchObjective, allowFallbackByRole, byokApiKeyOverride },
    });
    for (const [key, verdict] of judged.verdicts) rememberVerdict(runId, key, verdict);
    const notUsed = wave.filter((candidate) => verdictFor(runId, keyOfCandidate(candidate))?.relevant !== true);
    const report: RelevanceCheckReport = {
      round,
      judged: wave.length,
      relevant: wave.length - notUsed.length,
      notUsed: notUsed.length,
      decidedWithoutModel: judged.decidedWithoutModel,
    };
    await persistDiscoveryEvent(runId, 'relevance_gate', 'judge', researchQuery, wave.length, report.relevant, {
      round,
      judged: report.judged,
      relevant: report.relevant,
      // Each candidate left out, with the reason. The judge's own words and the
      // kind of any failure are kept; no error message is, since one can carry
      // a request address with a key in it.
      not_used: notUsed.map((candidate) => {
        const verdict = verdictFor(runId, keyOfCandidate(candidate));
        return {
          url: candidate.url,
          title: candidate.title,
          provider: candidate.provider,
          reason: verdict?.reason ?? 'off_topic',
          decided_by: verdict?.basis ?? 'word_overlap',
          why: verdict?.note ?? '',
        };
      }),
      ...(judged.decidedWithoutModel > 0 ? { decided_without_model: judged.decidedWithoutModel, failure_kinds: judged.failureKinds } : {}),
    });
    if (judged.decidedWithoutModel > 0) {
      logger.warn(
        `[discovery:${runId}] relevance check: no model verdict for ${judged.decidedWithoutModel} of ${wave.length} candidate(s) ` +
          `(${judged.failureKinds.join(', ')}); decided by shared vocabulary and marked for a second check before use`
      );
    }
    try {
      await onRelevanceCheck?.(report);
    } catch {
      /* non-fatal */
    }
  };

  // ─── Step 4: Check which candidates are already in corpus ───────────────────
  /**
   * Go down a ranked list, queueing what the run will read, until it has
   * `maxIngest`. With the relevance check on, a candidate is judged before it
   * is looked at here, and one judged off-topic is never fetched or stored.
   */
  const considerCandidates = async (
    pool: readonly SearchResultCandidate[],
    offTopicUrls: ReadonlySet<string | null | undefined>,
    round: number
  ): Promise<void> => {
    let judgedUpTo = 0;
    for (let i = 0; i < pool.length && selected.length < maxIngest; i++) {
      if (gateOn && i >= judgedUpTo) {
        if (judgedUpTo >= MAX_JUDGED_PER_PASS) break;
        const wave = pool.slice(judgedUpTo, judgedUpTo + RELEVANCE_WAVE);
        judgedUpTo += wave.length;
        await judgeWave(wave, round);
      }
      const candidate = pool[i];
      const normalised = normalizeUrl(candidate.url);
      handled.add(normalised);

      if (gateOn) {
        const verdict = verdictFor(runId, keyOfCandidate(candidate));
        if (verdict?.relevant !== true) {
          setAside += 1;
          skipped.push({
            ...candidate,
            selectionRationale: notUsedLabel(verdict?.reason),
            ingested: false,
            skipReason: verdict?.reason === 'vendor_sales' ? 'vendor_sales' : 'not_relevant',
          });
          continue;
        }
        relevantFound.push(candidate);
      }

      // Check if already ingested
      const alreadyIngested = await queryOne<{ id: string }>(
        `SELECT id FROM sources WHERE url=$1 OR url=$2`,
        [candidate.url, normalised]
      );

      if (alreadyIngested) {
        // The source is stored from an earlier run, perhaps before reference
        // details were kept. What this run's provider record says fills what the
        // stored source lacks. A candidate carries details only with the citation
        // lock on, and a failure here costs the reference entry, not the run.
        const referenceDetails = storedBibliographic(bibliographicMetadata(candidate));
        if (referenceDetails) {
          try {
            await fillReferenceDetails(alreadyIngested.id, referenceDetails);
          } catch (err) {
            logger.warn(`[discovery:${runId}] could not add reference details to a stored source: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // A source stored before tiers were recorded gains one; a recorded tier is kept.
        // Never fails the run: a write that keeps failing is logged and the run goes on.
        if (authorityTiersEnabled()) await recordAuthorityTier(alreadyIngested.id, storedAuthorityTier(candidate.authorityTier));
        if (gateOn) relevantAlreadyStored += 1;
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
          metadata: { discovery_run_id: runId, ...bibliographicMetadata(candidate) },
          importedVia: 'autonomous_discovery',
          discoveredByRunId: runId,
          discoveryQuery: candidate.sourceQuery,
          sourceRank: candidate.rank,
          fetchMethod: 'http_get',
          ...(authorityTiersEnabled() && candidate.authorityTier ? { authorityTier: candidate.authorityTier } : {}),
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

    // Whatever was not reached: the run already has all it may ingest, or the
    // judge's allowance for this pass ran out. Neither is fetched.
    const full = selected.length >= maxIngest;
    for (const candidate of pool) {
      const normalised = normalizeUrl(candidate.url);
      if (handled.has(normalised)) continue;
      handled.add(normalised);
      skipped.push({
        ...candidate,
        selectionRationale: full || !gateOn ? 'max_sources_to_ingest reached' : 'not checked for relevance; not used',
        ingested: false,
        skipReason: full || !gateOn ? 'max_reached' : 'not_judged',
      });
    }
  };

  if (!gateOn) {
    // Emergency setting: the check a model makes is off, and this is the path
    // as it was before the check existed. Is it about the thing that was asked?
    //
    // Provider scores are not comparable across providers — arXiv's idea of a
    // good match for "affiliate marketing niches" is still a paper — and nothing
    // between an API response and the ingest queue used to ask whether the
    // result was on topic. On-topic candidates are ingested first; off-topic
    // ones are held back and used only to avoid starving a run of sources, and
    // when they are used it is recorded as such.
    // Off-topic candidates top up to the FLOOR, and no further. See
    // `selectByRelevance` for what the whole-list version cost.
    const { ranked, toppedUpUrls: offTopicUrls, dropped } = selectByRelevance(
      researchQuery,
      byScore(allCandidates),
      relevanceFloor
    );
    if (dropped > 0 || offTopicUrls.size > 0) {
      logger.info(
        `[discovery:${runId}] off-topic candidates for this request: ${dropped} dropped, ` +
          `${offTopicUrls.size} kept to reach the ${relevanceFloor}-source floor`
      );
    }
    await considerCandidates(ranked, offTopicUrls, Math.max(1, lastRoundNumber));
  } else {
    await considerCandidates(byScore(allCandidates), new Set(), Math.max(1, lastRoundNumber));

    // ─── Gap-filling after the relevance check ────────────────────────────────
    // The check can leave a pass with fewer relevant sources than the run needs.
    // Before that is reported as a shortfall, the planner reads what WAS
    // relevant and writes new searches for what is still missing (slice 7's
    // `planGapQueries`, used here whether or not provider routing is on). What
    // those searches find goes through the same check. Bounded: at most
    // MAX_RELEVANCE_GAP_ROUNDS rounds of RELEVANCE_GAP_QUERIES_PER_ROUND queries.
    //
    // "Usable" here counts relevant candidates queued or already stored. A
    // source that later fails to fetch is the caller's concern, as it always was.
    const sourcesNeeded = Math.min(maxIngest, relevanceFloor);
    const usable = () => selected.length + relevantAlreadyStored;
    let gapRounds = 0;
    while (setAside > 0 && usable() < sourcesNeeded && selected.length < maxIngest && gapRounds < MAX_RELEVANCE_GAP_ROUNDS) {
      gapRounds += 1;
      const round = Math.max(3, lastRoundNumber + 1);
      logger.info(
        `[discovery:${runId}] relevance check left ${usable()} of ${sourcesNeeded} sources needed ` +
          `(${setAside} set aside); gap-filling round ${round}`
      );
      await persistDiscoveryEvent(runId, 'relevance_shortfall', 'orchestrator', researchQuery, usable(), sourcesNeeded, {
        round,
        usable: usable(),
        needed: sourcesNeeded,
        set_aside: setAside,
      });
      const planned = await planGapQueries({
        runId,
        round,
        researchQuery,
        sources: sourceDescriptionsFor(searchedKeys),
        queriesExecuted,
        found: relevantFound,
        maxQueries: RELEVANCE_GAP_QUERIES_PER_ROUND,
        model: { engineVersion, researchObjective, allowFallbackByRole, byokApiKeyOverride },
      });
      if (!planned) break;
      // These rounds may go past the run's ordinary query budget, by their own
      // small allowance: the budget is usually spent by round 1, and a pass that
      // the check has emptied must still be able to look again.
      queryBudget = Math.max(queryBudget, queriesExecuted.length + planned.length);
      const roundNew = await runSearchRound(round, planned, discoveryPlan.exclusion_patterns);
      logger.info(`[discovery:${runId}] Round ${round} complete: +${roundNew} candidates (total ${allCandidates.length})`);
      try { await onRoundComplete?.({ round, candidatesAfter: allCandidates.length }); } catch { /* non-fatal */ }
      if (roundNew === 0) break;
      await considerCandidates(
        byScore(allCandidates.filter((candidate) => !handled.has(normalizeUrl(candidate.url)))),
        new Set(),
        round
      );
    }
    if (gapRounds > 0) {
      // The count on the run row was written before these rounds ran.
      try {
        await query(`UPDATE research_runs SET discovery_round_count=$1 WHERE id=$2`, [roundsExecuted, runId]);
      } catch {
        // Column may not yet be present pre-migration 013 — non-fatal.
      }
    }
    if (setAside > 0 && usable() < sourcesNeeded) {
      logger.warn(`[discovery:${runId}] after the relevance check and ${gapRounds} gap-filling round(s): ${usable()} of ${sourcesNeeded} sources needed`);
    }
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
    ...(gateOn ? { relevance: { set_aside: setAside, relevant_already_stored: relevantAlreadyStored } } : {}),
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
/**
 * Slice 7. Round 1 with the route's extra queries kept inside the query budget.
 * At least one planned query always runs; extras that would not fit are dropped.
 */
export function withExtraQueries(planned: readonly string[], extras: readonly string[], budget: number): string[] {
  const fresh = extras.filter((text, at) => !planned.includes(text) && extras.indexOf(text) === at);
  const reserved = Math.min(fresh.length, Math.max(0, budget - 1));
  return [...planned.slice(0, Math.max(0, budget - reserved)), ...fresh.slice(0, reserved)];
}

/**
 * What is kept about a provider failure: the kind of error and the HTTP status.
 * Not the message, which can carry a request address and, with it, a key.
 */
export function providerErrorRecord(reason: unknown): { error_kind: string; http_status?: number } {
  const err = (reason ?? {}) as { code?: unknown; name?: unknown; response?: { status?: unknown } };
  const kind = typeof err.code === 'string' && err.code ? err.code : typeof err.name === 'string' && err.name ? err.name : 'unknown';
  const status = typeof err.response?.status === 'number' ? err.response.status : undefined;
  return status === undefined ? { error_kind: kind } : { error_kind: kind, http_status: status };
}

const persistDiscoveryEvent = recordDiscoveryEvent;

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
