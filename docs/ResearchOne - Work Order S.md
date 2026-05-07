# Work Order S — Scholarly Provider Layer

**Goal.** Add a tier of agentic and scholarly data providers behind feature flags: Parallel Web Systems Search, Parallel Web Systems Extract (ingestion adapter), the Scite API client (read-only metadata — no prompt-engineering work; that lives in WO-M), and six open scholarly baselines (OpenAlex, Crossref, arXiv, PubMed Central, USPTO, ClinicalTrials.gov). All providers implement the existing `SearchProvider` interface or the existing ingestion `fetchUrl` contract so downstream stages — discovery selection, retriever analysis, citation mapping — receive the same shapes they already consume. No orchestrator-stage logic changes.

**Pre-work.** `.cursor/rules/14-third-party-api-contracts.mdc` (signed-request, retry, and schema-validation discipline for every external API), `.cursor/rules/13-deploy-skew-and-schema.mdc` (config validation must tolerate missing keys when feature-flagged off), `.cursor/rules/17-ripple-and-grep-callers.mdc` (every change to `getSearchProviders()` requires grepping all callers), `.cursor/rules/20-research-policy-guardrails.mdc` (no provider may auto-mutate `evidence_tier`; provider results carry institutional-status metadata only — Skeptic and Verifier reason about it per WO-M). Existing files: `backend/src/services/discovery/providerTypes.ts`, `backend/src/services/discovery/providers/searchProvider.ts`, `backend/src/services/discovery/providers/tavilySearch.ts` (template for new providers), `backend/src/services/discovery/discoveryOrchestrator.ts` (provider switch on `getSearchProviders()`), `backend/src/services/ingestion/ingestionService.ts` (existing `fetchUrl` for Parallel Extract integration), `backend/src/config/index.ts` (provider config + startup validation pattern at lines 14, 189–194, 265–307). Confirm Parallel Web Systems API contract at https://parallel.ai/docs and Scite API contract at https://api.scite.ai/docs — record exact request/response shapes in JSDoc on each new provider.

**Dependencies.**
```bash
cd backend && npm install p-limit@^6 fast-xml-parser@^4
# axios already present; no new HTTP client needed
```

**Files to create.**

Provider implementations (each implementing `SearchProvider` from `searchProvider.ts`, returning `SearchResultCandidate[]` per `providerTypes.ts`):

- `backend/src/services/discovery/providers/parallelSearch.ts` — POSTs `searchQuery.text` to Parallel Search API, maps Parallel's pre-compressed citation-aware excerpts into `SearchResultCandidate.snippet`, sets `provider: 'parallel'`. Honors `searchQuery.maxResults` (default from `config.discovery.maxResults`). Logs API errors via `logger.warn` per Cursor rule 11; returns `[]` on quota/network failure rather than throwing (cascade-safe).
- `backend/src/services/discovery/providers/openAlexSearch.ts` — Free academic graph (no API key, but identifies via `OPENALEX_USER_AGENT` for polite-pool throughput). Filters to `is_oa=true OR has_pdf` when `searchQuery.preferredSourceTypes` includes `peer_reviewed`. Captures DOI in `SearchResultCandidate.contentHash` (we reuse this slot — alternatively add an optional `doi` field to `SearchResultCandidate` if cleaner).
- `backend/src/services/discovery/providers/crossrefSearch.ts` — Crossref REST works endpoint. Polite-pool via `CROSSREF_USER_AGENT` (must include contact email per Crossref policy). Returns DOI-keyed metadata.
- `backend/src/services/discovery/providers/arxivSearch.ts` — arXiv API (Atom XML response, parsed via `fast-xml-parser`). For physics/CS/math/quant-bio queries.
- `backend/src/services/discovery/providers/pubmedCentralSearch.ts` — PMC E-utilities endpoint. Returns PMC-ID-keyed metadata, full-text-available filter respected.
- `backend/src/services/discovery/providers/usptoSearch.ts` — USPTO PatentsView API. Triggered when `researchObjective === 'PATENT_GAP_ANALYSIS'` per discovery selector logic. Returns patent number, claims summary, assignee.
- `backend/src/services/discovery/providers/clinicalTrialsSearch.ts` — ClinicalTrials.gov API v2. Returns NCT-ID-keyed metadata with phase, status, sponsor.
- `backend/src/services/discovery/providers/sciteScholarly.ts` — **Read-only metadata client only.** Three exported functions: `getInstitutionalStatus(doi: string)` returning `{ status: 'active' | 'retracted' | 'editorial_concern' | 'corrected' }`, `getCitationCounts(doi: string)` returning `{ supporting, contrasting, mentioning }`, `getContrastingPaperDois(doi: string)` returning `string[]`. **This is plumbing. It does not modify chunks, does not write to `evidence_tier`, does not call any prompt — it is a pure metadata fetcher consumed by the Stage 4/6/8 wiring in WO-M.** Cached aggressively in Redis with TTL 24h (Scite metadata changes slowly).

Ingestion adapter (implements the same `FetchResult` contract that `fetchUrl` returns):

- `backend/src/services/ingestion/parallelExtractor.ts` — Single exported function `extractWithParallel(url: string): Promise<FetchResult>`. Returns `{ html, text, canonical_url, title, fetch_method: 'parallel_extract_v1', original_mime_type }` matching the existing `FetchResult` shape. Throws on HTTP error so caller can fall through to default fetcher.

Tests:

- `backend/src/services/discovery/providers/__tests__/parallelSearch.test.ts`
- `backend/src/services/discovery/providers/__tests__/openAlexSearch.test.ts`
- `backend/src/services/discovery/providers/__tests__/crossrefSearch.test.ts`
- `backend/src/services/discovery/providers/__tests__/arxivSearch.test.ts`
- `backend/src/services/discovery/providers/__tests__/pubmedCentralSearch.test.ts`
- `backend/src/services/discovery/providers/__tests__/usptoSearch.test.ts`
- `backend/src/services/discovery/providers/__tests__/clinicalTrialsSearch.test.ts`
- `backend/src/services/discovery/providers/__tests__/sciteScholarly.test.ts`
- `backend/src/services/ingestion/__tests__/parallelExtractor.test.ts`
- `backend/src/services/discovery/__tests__/cascadeStrategy.test.ts` — multi-provider cascade with one provider failing

**Files to modify.**

`backend/src/config/index.ts` — Extend `ALLOWED_SEARCH_PROVIDERS` to `['tavily', 'generic', 'brave', 'cascade', 'parallel', 'scholarly_cascade']`. Add config entries:

```typescript
discovery: {
  // ... existing fields ...
  parallelApiKey: process.env.PARALLEL_API_KEY || '',
  parallelBaseUrl: process.env.PARALLEL_BASE_URL || 'https://api.parallel.ai/v1',
  sciteApiKey: process.env.SCITE_API_KEY || '',
  sciteBaseUrl: process.env.SCITE_BASE_URL || 'https://api.scite.ai/v1',
  openAlexUserAgent: process.env.OPENALEX_USER_AGENT || 'ResearchOne/1.0 (mailto:ops@researchone.io)',
  crossrefUserAgent: process.env.CROSSREF_USER_AGENT || 'ResearchOne/1.0 (mailto:ops@researchone.io)',
  // Feature flags — independent of `provider` so any provider can be enabled
  // for opportunistic per-DOI/per-URL enrichment regardless of search provider.
  scholarlyEnrichmentEnabled: process.env.SCHOLARLY_ENRICHMENT_ENABLED === 'true',
  parallelExtractEnabled: process.env.PARALLEL_EXTRACT_ENABLED === 'true',
  sciteEnrichmentEnabled: process.env.SCITE_ENRICHMENT_ENABLED === 'true',
},
```

Add startup validation: when `provider === 'parallel'`, require `PARALLEL_API_KEY`. When `scholarlyEnrichmentEnabled`, no API keys required (all six baselines are unauthenticated). When `sciteEnrichmentEnabled`, require `SCITE_API_KEY`. When `parallelExtractEnabled`, require `PARALLEL_API_KEY`. **All validation must be feature-flag-gated** so deploys with these flags off don't fail on missing keys (per Cursor rule 13).

`backend/src/services/discovery/discoveryOrchestrator.ts` — Modify `getSearchProviders()` to accept the run's `researchObjective` so it can dispatch specialty providers (USPTO for `PATENT_GAP_ANALYSIS`, ClinicalTrials.gov for runs tagged with medical terms in `searchQuery.tags`). Add new switch branches:

```typescript
case 'parallel':
  return [new ParallelSearchProvider()];
case 'scholarly_cascade':
  // Order matters — Parallel first for quality, OpenAlex for breadth, Crossref for coverage,
  // then arXiv/PMC for full-text. Specialty providers join based on objective.
  return [
    new ParallelSearchProvider(),
    new OpenAlexSearchProvider(),
    new CrossrefSearchProvider(),
    new ArxivSearchProvider(),
    new PubMedCentralSearchProvider(),
    ...(researchObjective === 'PATENT_GAP_ANALYSIS' ? [new UsptoSearchProvider()] : []),
    ...(queryTagsContainMedical(searchQuery.tags) ? [new ClinicalTrialsSearchProvider()] : []),
    new TavilySearchProvider(), // fallback web breadth
  ];
case 'cascade':
  // Existing cascade unchanged for backward compatibility
  return [new TavilySearchProvider(), new BraveSearchProvider(), new GenericWebSearchProvider()];
```

Per Cursor rule 17, grep every caller of `getSearchProviders()` (orchestrator currently calls it at line 199) and pass `researchObjective` through. Update tests for any caller that constructs a fake provider list.

`backend/src/services/ingestion/ingestionService.ts` — Modify `fetchUrl` (currently at line 253) to attempt Parallel Extract first when `config.discovery.parallelExtractEnabled === true`, falling through to the existing fetcher on any error. Preserve all existing provenance metadata; tag `parse_method: 'parallel_extract_v1'` on the source row when Parallel succeeded. **The existing fetcher remains the safety net — under no circumstance does Parallel failure block ingestion.**

```typescript
async function fetchUrl(url: string): Promise<FetchResult> {
  if (config.discovery.parallelExtractEnabled) {
    try {
      return await extractWithParallel(url);
    } catch (err) {
      logger.info(`[ingestion] Parallel Extract failed for ${url}, falling through`, { err });
    }
  }
  // ... existing implementation unchanged ...
}
```

Schema migration `backend/src/db/migrations/017_scholarly_provider_metadata.sql`:

```sql
-- Add allowed parse_method values; existing CHECK constraint may need ALTER if it exists.
-- Otherwise this is a documentation-only migration; chunks.metadata JSONB already accepts arbitrary keys.
COMMENT ON COLUMN sources.parse_method IS
  'Allowed values: html_boilerpipe, pdf_parse, markdown_normalize, plain_text, parallel_extract_v1';

-- Optional: index for sources hydrated via Parallel Extract for analytics
CREATE INDEX IF NOT EXISTS idx_sources_parse_method ON sources(parse_method)
  WHERE parse_method = 'parallel_extract_v1';
```

`backend/.env.production.example` — append the new env vars from the config diff above with empty defaults and inline comments explaining when each is required (feature-flag-gated).

**Acceptance criteria.**

- `SEARCH_PROVIDER=parallel` with `PARALLEL_API_KEY` set: discovery returns `SearchResultCandidate[]` with `provider: 'parallel'`. Smoke query returns ≥1 result on a known-discoverable topic.
- `SEARCH_PROVIDER=scholarly_cascade`: orchestrator queries all enabled scholarly providers in parallel via `Promise.allSettled`, dedupes by normalized URL/DOI, returns merged ranked list. One provider failing (e.g. arXiv 503) does NOT block the cascade.
- `SCHOLARLY_ENRICHMENT_ENABLED=false` (default): NO API key required for any scholarly provider; startup succeeds; all six baseline providers are unreachable from the runtime (not registered in the switch).
- `PARALLEL_EXTRACT_ENABLED=true` with valid `PARALLEL_API_KEY`: ingesting a known JS-heavy URL (e.g. an SPA news site) returns parsed text where the legacy fetcher would have returned the JS shell. Ingestion `parse_method` row reads `parallel_extract_v1`.
- `PARALLEL_EXTRACT_ENABLED=true` with Parallel returning 500: ingestion completes via fallback fetcher, `parse_method` reads the legacy method name, log line confirms fallthrough was taken.
- `sciteScholarly.getInstitutionalStatus(doi)` returns `'retracted'` for a known retracted DOI (use `10.1038/srep17070` — the well-publicized 2015 retraction — or any other Scite-indexed retracted paper).
- `sciteScholarly.getInstitutionalStatus(doi)` does NOT mutate any chunk, claim, or report row. **It is read-only.** Confirmed via test that runs the function then inspects DB state.
- USPTO provider activates ONLY when `researchObjective === 'PATENT_GAP_ANALYSIS'`. Confirmed by running a `GENERAL_EPISTEMIC_RESEARCH` query and asserting USPTO was not called (mock provider call counter).
- All providers respect `searchQuery.maxResults` ceiling.
- Startup with all feature flags off and only `TAVILY_API_KEY` set: every existing test passes unchanged. **No regression on the existing pipeline.**

**Tests required (must fail without the fix).**

- `parallelSearch.test.ts`: mock Parallel API returning a 3-result fixture; assert mapping into `SearchResultCandidate[]` is correct (snippet field carries the agentic excerpt, not the URL or title). Assert `provider: 'parallel'` on every result. Assert `[]` returned on 401, 429, 500, network error. **Must fail if the mapper drops the agentic excerpt or throws on quota errors.**
- `openAlexSearch.test.ts`: mock OpenAlex response; assert DOI extraction; assert User-Agent header set per polite-pool policy. **Must fail if User-Agent missing.**
- `cascadeStrategy.test.ts`: register three fake providers, one always-throws, two succeed; assert orchestrator returns merged results from the two successes and logs the third's failure; assert no result is lost from a successful provider when another fails. **Must fail if `Promise.all` is used instead of `Promise.allSettled`.**
- `parallelExtractor.test.ts` (in ingestion `__tests__`): mock Parallel Extract success, assert `FetchResult.fetch_method === 'parallel_extract_v1'`. Mock failure; assert exception propagates so caller can fall through. **Must fail if the extractor swallows the exception itself rather than propagating.**
- `sciteScholarly.test.ts`: mock Scite responses for known retracted DOI; assert `getInstitutionalStatus` returns `'retracted'`. **Critical regression test:** call `getInstitutionalStatus` and then query DB for the chunk that referenced the DOI; assert chunk's `evidence_tier` is unchanged (still whatever Reasoner assigned). **Must fail if any code path auto-tiers retracted-source chunks** — this is the PolicyOne guardrail captured in code.
- `usptoSearch.test.ts`: assert provider is invoked only when `researchObjective === 'PATENT_GAP_ANALYSIS'` is plumbed through. **Must fail if USPTO is added to the cascade unconditionally.**
- Startup test: with `SCHOLARLY_ENRICHMENT_ENABLED=false` and no Scite/Parallel keys set, server starts cleanly. **Must fail if validation requires keys for disabled features.**

**Critical reminders.**

1. **No prompt changes in this WO.** Scite metadata is fetched and stored on chunk metadata only. The Stage 4/6/8/10 prompt updates that consume this metadata — and the explicit guardrails against auto-debunking — live in WO-M. WO-S delivers the plumbing; WO-M delivers the epistemic policy.
2. **No PII risk for these providers.** OpenAlex, Crossref, arXiv, PMC, USPTO, ClinicalTrials.gov return only published bibliographic metadata. The User-Agent strings are the only identifying info we send (per polite-pool conventions). Parallel and Scite receive query strings and DOIs only — no user-identifying content. Document this in the privacy disclosure addition for WO-O.
3. **API keys never logged.** Per Cursor rule 11, `logger.warn` calls in providers must scrub the Authorization header. Verify with grep across new providers before merge.
4. **Cache discipline.** The Scite client uses Redis with 24h TTL. Cache key is `scite:status:{doi}`, `scite:counts:{doi}`, `scite:contrasting:{doi}`. Cache misses go to Scite; cache hits never touch the network. **Acceptance:** running the same DOI twice in 24h produces exactly one Scite API call.
5. **All providers are independent of authentication.** Discovery runs before tier-checks complete in the orchestrator; if a provider fails because a tier-restricted feature is enabled for the wrong tier, that's a tier-enforcement bug in WO-G's middleware, NOT a provider bug. Providers don't know about tiers. Tier-gating happens at the orchestrator entry.

**Effort estimate.** 5–6 days for one engineer. Parallel Search and Parallel Extract are 1 day each. The six scholarly providers share ~80% of their boilerplate; total ~2 days. The Scite client + caching is 1 day. Tests + integration with `discoveryOrchestrator.ts` is 1 day. Per-provider smoke testing against real APIs is half a day.

**Sequencing.** Ships in parallel with WOs F–G. **Independent of the commercial layer** because all features are flag-gated off by default. Once WO-G's tier rules table is in place, WO-G's middleware (not this WO) restricts which tiers can enable Parallel/Scite features for a given run.
