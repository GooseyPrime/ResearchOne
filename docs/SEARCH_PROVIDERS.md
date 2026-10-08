# Search providers

This guide covers every search service discovery can use: what each one covers, when it runs, and what it needs. It also says how to add a new one.

The source of truth is `backend/src/services/discovery/providerRegistry.ts`. A test fails if a service is registered there but has no section here, or if a section leaves out a setting the service needs.

## How a run chooses services

With `PROVIDER_ROUTING_ENABLED` on, discovery decides what the request is about and searches the services registered for those kinds of request. Each kind is called a route:

| Route | Chosen when | Services, in order |
| --- | --- | --- |
| scientific | Literature reviews, or medical and scientific words in the request | OpenAlex, Crossref, PubMed Central, ClinicalTrials.gov, arXiv, then the web services |
| patent | The patent-gap objective, or patent words in the request | USPTO PatentsView, OpenAlex, then the web services |
| market | Opportunity reports, or business and market words in the request | Parallel, then the web services |
| code | Software and repository words in the request | The web services, plus one search limited to GitHub |
| default | None of the above | The web services, OpenAlex, Crossref, plus one search for official and primary records |

A request can match more than one route, and each route it matches adds its services. A challenge run also adds every service marked for challenge runs (Brave today), plus one search for reports that don't fit the usual account.

"The web services" means whatever the server is set to with `SEARCH_PROVIDER`: `tavily` (the default), `brave`, `generic`, or `cascade` (all three, in that order).

A service whose key or address is not set sits out of the run. It is listed under `not_configured` in the run's `routing` record in `discovery_events`. Setting the key brings it in on the next run, with no code change.

A service that fails during a search does not stop the run. Each failure is recorded as a `provider_error` row. The row keeps the kind of error and the HTTP status, never the error message, because a message can contain a request address with a key in it.

From the third search round on, a planning model reads what has been found so far and writes the queries for what is still missing. It is told what each searched service covers, using the `covers` line from the registry, so a clear `covers` line produces better queries.

With `PROVIDER_ROUTING_ENABLED` off, discovery uses the web services plus the specialist mapping in `discoveryOrchestrator.ts`, as it did before slice 7.

## The services

### Tavily (`tavily`)

- **Covers:** general web search tuned for research. Each result comes with page text.
- **Used for:** every route, as a web service, when `SEARCH_PROVIDER` is `tavily` or `cascade`.
- **Needs:** `TAVILY_API_KEY`. `TAVILY_BASE_URL` is optional.
- **Good at:** news, organisation pages, reports published on the web.
- **Not for:** finding scholarly records by DOI. The scholarly catalogues below do that better.

### Brave Search (`brave`)

- **Covers:** an independent general web index. Useful for pages other engines rank low.
- **Used for:** every route, as a web service, when `SEARCH_PROVIDER` is `brave` or `cascade`. Every challenge run also uses it when the key is set.
- **Needs:** `SEARCH_PROVIDER_API_KEY`.
- **Good at:** a second view of the web, and sensitive topics (such runs search it first).

### Generic web search endpoint (`generic`)

- **Covers:** any JSON web search service at a configured address, such as SearXNG, Serper or a service of our own. The service must return `results: [{ url, title, content or snippet, score }]`.
- **Used for:** every route, as a web service, when `SEARCH_PROVIDER` is `generic` or `cascade`.
- **Needs:** `SEARCH_PROVIDER_BASE_URL`. `SEARCH_PROVIDER_API_KEY` is optional.

### Parallel (`parallel`)

- **Covers:** business and market information: companies, products, pricing and demand.
- **Used for:** the market route, first.
- **Needs:** `PARALLEL_API_KEY`. `PARALLEL_BASE_URL` is optional.
- **Not for:** scholarly or medical questions.

### OpenAlex (`openalex`)

- **Covers:** a catalogue of scholarly works in every field, with authors, venues and DOIs.
- **Used for:** the scientific route (first), the patent route (second) and the default route.
- **Needs:** nothing. `OPENALEX_USER_AGENT` identifies us politely to the service.
- **Good at:** journal articles, with reference details the citation lock can use.

### Crossref (`crossref`)

- **Covers:** the registry of DOIs for journal articles, books and reports, with publisher records.
- **Used for:** the scientific and default routes.
- **Needs:** nothing. `CROSSREF_USER_AGENT` identifies us politely to the service.

### PubMed Central (`pmc`)

- **Covers:** full-text biomedical and life-science articles.
- **Used for:** the scientific route.
- **Needs:** nothing.

### ClinicalTrials.gov (`clinicaltrials`)

- **Covers:** registered clinical studies, with their design, status and posted results.
- **Used for:** the scientific route.
- **Needs:** nothing.

### arXiv (`arxiv`)

- **Covers:** preprints in physics, mathematics, computer science, quantitative biology and related fields.
- **Used for:** the scientific route, last before the web.
- **Needs:** nothing.
- **Note:** preprints are not established as peer reviewed. The source-ranking switch ranks them that way.

### USPTO PatentsView (`uspto`)

- **Covers:** granted United States patents, with their claims, inventors and assignees.
- **Used for:** the patent route, first.
- **Needs:** nothing.

### Not search services

- **Scite** (`SCITE_API_KEY`) adds citation context and retraction status to scholarly sources that have already been found. It does not search, so it is not in the registry.
- **URL fetch** reads an address the plan already names. It is not routed.

## Adding a new service

1. **Write the adapter.** Create `backend/src/services/discovery/providers/<name>Search.ts`, implementing `SearchProvider` from `providers/searchProvider.ts`. Give `name` the same value as the registry key.
   - Return `SearchResultCandidate[]`, setting `provider` to the key.
   - When the key or address is missing: log a warning, call `query.onFailure?.(PROVIDER_NOT_CONFIGURED)`, and return `[]`.
   - When a request fails: log it, call `query.onFailure?.(err)`, and return `[]`. Never throw for an ordinary failure, because one failing service must not fail the run.
   - When the service gives reference details (authors, publisher, date, DOI, kind of work), put them on `bibliographic`, the way `crossrefSearch.ts` does.
2. **Add its settings** to `config.discovery` in `backend/src/config/index.ts`, and add the setting names (never values) to the discovery block of `README.md`.
3. **Register it** in `PROVIDER_REGISTRY`. Fill in `title`, a one-sentence `covers`, the routes it serves with a rank (lower runs earlier; the web services sit at `WEB_RANK`), `needs`, `isConfigured` and `build`. Mark `web: true` if it is a general web service. Mark `challengeRuns: true` if every challenge run should use it.
4. **Describe it here**, under "The services", with a heading in the form `### <title> (\`<key>\`)` and every setting it needs.
5. **Test it.** Add a test in `providers/__tests__/` that replaces the network and checks the results are mapped correctly. The test should also check that a failed request calls `onFailure` and returns `[]` (see `providerFailureReport.test.ts`). The registry tests then check that the service builds, and that this guide describes it.
6. **Set the key in production.** Until it is set, the service sits out of every run and shows as not configured.

A new route, meaning a new kind of request, needs a route name in `DiscoveryRoute`, words for it in `routesFor` (`providerRouting.ts`), its web rank in `WEB_RANK`, and a row in the table above.
