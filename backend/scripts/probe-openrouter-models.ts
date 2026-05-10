/**
 * Operator probe: OpenRouter catalog metadata + runtime `/chat/completions`
 * smoke for candidate slugs (same envelope as `openrouterPreflight.ts`).
 *
 * Loads env through `loadBackendEnv()` — do not `source` `.env` in bash.
 * Stdout is JSON only (no secrets).
 */
import axios from 'axios';
import { loadBackendEnv } from './loadBackendEnv';
import { buildOpenRouterAppHeaders, buildOpenRouterProviderBlock } from '../src/services/openrouter/openrouterProviderBlock';

loadBackendEnv();

const KNOWN_GOOD = [
  'deepseek/deepseek-chat-v3.1',
  'deepseek/deepseek-r1-0528',
  'deepseek/deepseek-v3.2',
  'moonshotai/kimi-k2-thinking',
  'qwen/qwen3-235b-a22b-thinking-2507',
] as const;

const KNOWN_BAD = [
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'sao10k/l3.3-euryale-70b',
] as const;

const PREFERRED_CHALLENGER = [
  'nousresearch/hermes-4-70b',
  'nousresearch/hermes-4-405b',
  'nousresearch/hermes-3-llama-3.1-70b',
  'nousresearch/hermes-3-llama-3.1-405b',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'openrouter/owl-alpha',
  'inclusionai/ring-2.6-1t:free',
  'z-ai/glm-4.5-air',
  'z-ai/glm-4.5-air:free',
] as const;

interface ModelsApiEntry {
  id?: string;
  canonical_slug?: string;
  name?: string;
  context_length?: number;
  top_provider?: { is_moderated?: boolean };
  supported_parameters?: string[];
  pricing?: unknown;
}

interface ProbeRow {
  slug: string;
  ok: boolean;
  status?: number;
  providerMessage?: string;
  durationMs: number;
  nameFromModelsApi?: string;
  canonicalSlugFromModelsApi?: string;
  contextLength?: number;
  isModerated?: boolean;
  supportedParameters?: string[];
  pricing?: unknown;
}

async function main(): Promise<void> {
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  if (!apiKey) {
    console.log(
      JSON.stringify({
        error: 'OPENROUTER_API_KEY is not set; refusing to probe.',
        hint: 'Set key in backend/.env and run from backend/: npm run probe:openrouter-models',
      })
    );
    process.exit(2);
    return;
  }

  let catalogById = new Map<string, ModelsApiEntry>();
  try {
    const res = await axios.get<{ data?: ModelsApiEntry[] }>(`${baseUrl}/models`, {
      headers: buildOpenRouterAppHeaders(apiKey),
      timeout: 60000,
    });
    const rows = res.data?.data ?? [];
    catalogById = new Map(rows.filter((r) => r.id).map((r) => [r.id as string, r]));
  } catch {
    catalogById = new Map();
  }

  const dataCollection = process.env.OPENROUTER_DATA_COLLECTION;
  const provider = buildOpenRouterProviderBlock(dataCollection);
  const headers = buildOpenRouterAppHeaders(apiKey, { 'X-ResearchOne-Call-Type': 'probe-script' });
  const chatUrl = `${baseUrl}/chat/completions`;

  const allCandidates = [
    ...KNOWN_GOOD,
    ...KNOWN_BAD,
    ...PREFERRED_CHALLENGER,
  ];
  const unique = [...new Set(allCandidates)];

  const probes: ProbeRow[] = [];
  for (const slug of unique) {
    const meta = catalogById.get(slug);
    const start = Date.now();
    try {
      const body = {
        model: slug,
        messages: [
          { role: 'system', content: 'preflight' },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 1,
        temperature: 0,
        provider,
      };
      const res = await axios.post(chatUrl, body, { headers, timeout: 25000 });
      const status = res.status;
      probes.push({
        slug,
        ok: status >= 200 && status < 300,
        status,
        durationMs: Date.now() - start,
        nameFromModelsApi: meta?.name,
        canonicalSlugFromModelsApi: meta?.canonical_slug,
        contextLength: meta?.context_length,
        isModerated: meta?.top_provider?.is_moderated,
        supportedParameters: meta?.supported_parameters,
        pricing: meta?.pricing,
      });
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const status = e.response?.status;
      const data = e.response?.data as { error?: { message?: string } } | undefined;
      const providerMessage = data?.error?.message || '';
      probes.push({
        slug,
        ok: false,
        status,
        providerMessage: providerMessage || undefined,
        durationMs: Date.now() - start,
        nameFromModelsApi: meta?.name,
        canonicalSlugFromModelsApi: meta?.canonical_slug,
        contextLength: meta?.context_length,
        isModerated: meta?.top_provider?.is_moderated,
        supportedParameters: meta?.supported_parameters,
        pricing: meta?.pricing,
      });
    }
  }

  const bySlug = Object.fromEntries(probes.map((p) => [p.slug, p]));

  const hermes4Ok = Boolean(bySlug['nousresearch/hermes-4-70b']?.ok);
  const hermes3Ok = Boolean(bySlug['nousresearch/hermes-3-llama-3.1-70b']?.ok);
  const defaultChallengerLadderOk = hermes4Ok && hermes3Ok;

  const preferredChallengerFailures = PREFERRED_CHALLENGER.filter((s) => !bySlug[s]?.ok).map((s) => ({
    slug: s,
    detail: bySlug[s],
  }));

  console.log(
    JSON.stringify(
      {
        probedAt: new Date().toISOString(),
        knownGood: KNOWN_GOOD.map((s) => bySlug[s]),
        knownBad: KNOWN_BAD.map((s) => bySlug[s]),
        preferredChallengerCandidates: PREFERRED_CHALLENGER.map((s) => bySlug[s]),
        selectedRecommendations: defaultChallengerLadderOk
          ? {
              primary: 'nousresearch/hermes-4-70b',
              fallback: 'nousresearch/hermes-3-llama-3.1-70b',
              note: 'Matches `V2_MODE_PRESETS` skeptic / internal_challenger defaults.',
            }
          : {
              primary: null,
              fallback: null,
              note:
                'Default Hermes adversarial ladder did not both pass runtime /chat/completions under this key — inspect preferredChallengerCandidates and operator policy before changing presets.',
              failures: preferredChallengerFailures,
            },
        probes: bySlug,
      },
      null,
      2
    )
  );

  if (!defaultChallengerLadderOk) {
    process.exit(3);
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ error: String((err as Error)?.message || err) }));
  process.exit(1);
});
