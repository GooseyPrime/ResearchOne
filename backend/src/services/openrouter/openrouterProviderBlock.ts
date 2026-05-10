/**
 * Single source for the OpenRouter `provider` JSON block used by live
 * `/chat/completions` calls (`openrouterService.ts`), startup preflight
 * (`openrouterPreflight.ts`), and operator probe scripts (`scripts/`).
 *
 * Keep behavior aligned — regressions are guarded by
 * `openrouterRequestBody.test.ts` and `openrouterPreflight.test.ts`.
 *
 * Reference: https://openrouter.ai/docs/features/provider-routing
 */
export function buildOpenRouterProviderBlock(dataCollectionRaw: string | undefined): Record<string, unknown> {
  const dataCollection = (dataCollectionRaw || 'allow').toLowerCase();
  // `require_parameters` is intentionally omitted. Setting it to `true`
  // excludes upstreams that report parameter restrictions (thinking-class
  // models). See inline comment in PR #41 history / openrouterService.
  return {
    allow_fallbacks: true,
    data_collection: dataCollection === 'deny' ? 'deny' : 'allow',
    sort: 'throughput',
  };
}

/** Headers aligned with `callOpenRouter` plus optional probe discriminator. */
export function buildOpenRouterAppHeaders(
  apiKey: string,
  extra?: Record<string, string | undefined>
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://researchone.io',
    'X-Title': 'ResearchOne',
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== '') headers[k] = v;
    }
  }
  return headers;
}
