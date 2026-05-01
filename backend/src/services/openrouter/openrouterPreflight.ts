import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { V2_MODE_PRESETS } from '../../config/researchEnsemblePresets';
import { isHfRepoModel, REASONING_MODEL_ROLES, RESEARCH_OBJECTIVES } from '../reasoning/reasoningModelPolicy';

/**
 * Build the OpenRouter `provider` block exactly as `callOpenRouter` does
 * at runtime. Kept as a copy in this module (not a re-export) because
 * importing from `openrouterService` would pull the whole HF / runtime
 * stack into preflight and complicate startup-order constraints. If the
 * runtime block ever changes shape, update both places. The
 * `openrouterRequestBody.test.ts` regression locks the runtime side; the
 * `openrouterPreflight.test.ts` suite locks this side.
 */
function buildPreflightProviderBlock(): Record<string, unknown> {
  const dataCollection = (config.openrouter.dataCollection || 'allow').toLowerCase();
  // Mirrors `buildOpenRouterProviderBlock` in openrouterService.ts exactly.
  // `require_parameters` is omitted — see that function's comment for why.
  return {
    allow_fallbacks: true,
    data_collection: dataCollection === 'deny' ? 'deny' : 'allow',
    sort: 'throughput',
  };
}

export interface PreflightModelStatus {
  slug: string;
  ok: boolean;
  /**
   * HTTP status from the `/chat/completions` smoke probe, when the
   * request reached OpenRouter. Absent for transport-layer errors
   * (DNS, connection refused, etc.).
   */
  status?: number;
  /** Reason this slug is not OK; only present when `ok=false`. */
  reason?: string;
  /**
   * Provider message extracted from OpenRouter's error body when status
   * is 4xx/5xx — typically the actionable line such as
   * `"No allowed providers are available for the selected model"`.
   */
  providerMessage?: string;
  /**
   * Wall-clock duration of the probe call in ms. Useful for diagnosing
   * timeout-vs-policy failures in startup logs.
   */
  durationMs: number;
}

export interface PreflightSummary {
  ok: boolean;
  /** True iff at least one probed slug failed pre-flight, regardless of `ok`. */
  hasWarnings: boolean;
  /** Per-slug results (deduplicated across roles / objectives). */
  models: Record<string, PreflightModelStatus>;
  /**
   * Roles whose default primary or preset fallback failed (per objective).
   * Both tiers are now probed because preset fallbacks always fire
   * automatically on primary failure — an unreachable fallback is a
   * reliability gap that should surface at deploy time, not at the
   * second user click. See PR #42 (Copilot review finding).
   */
  rolesAffected: Array<{
    objective: string;
    role: string;
    slug: string;
    reason: string;
    /** Whether the failing slug was the role's primary or preset fallback. */
    tier?: 'primary' | 'fallback';
  }>;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Whether the probe was skipped wholesale (no API key, or disabled by env). */
  skipped?: boolean;
}

/**
 * Probe every distinct V2 default OpenRouter slug (both primaries and
 * preset fallbacks) in `V2_MODE_PRESETS` by issuing a 1-token
 * `/chat/completions` request that mirrors `callOpenRouter` exactly:
 *
 *   - same `Authorization` / `HTTP-Referer` / `X-Title` headers
 *   - same `provider` block (`allow_fallbacks`, `data_collection`, `sort`;
 *     `require_parameters` intentionally omitted — see buildOpenRouterProviderBlock)
 *   - same base URL
 *
 * This is the gold-standard reachability gate: a slug that 200s here
 * will 200 at runtime; a slug that 404s with `No allowed providers are
 * available` here will 404 the same way at runtime. Earlier revisions
 * of this probe queried `/models/<slug>/endpoints` for metadata, which
 * **did not** apply the runtime `provider.data_collection` policy and
 * could report a model as reachable even when runtime calls would 404.
 * That is the PR #41 review finding (Codex P1 — 2026-04-28-PM).
 *
 * Both primaries and preset fallbacks are probed: since preset fallbacks
 * now fire automatically on any primary failure, an unreachable fallback
 * is a reliability gap that should surface at deploy time.
 *
 * Cost: each call consumes ~1 completion token per distinct slug per
 * startup. Slugs deduplicated across roles/objectives/tiers. Operators
 * who need to suppress this can set `OPENROUTER_PREFLIGHT=false`.
 *
 * This **does not** fail startup. The orchestrator will still attempt
 * the call at runtime; a pre-flight failure just means the agent has
 * told the operator to expect that role to fail. We never mutate
 * `V2_MODE_PRESETS` from here.
 *
 * Skipped slugs: HF repo ids (route through HF Inference, not OpenRouter)
 * and any slug we cannot reach because OPENROUTER_API_KEY is unset.
 */
export async function preflightV2OpenRouterModels(args?: {
  /**
   * Override `axios.post` (used in tests). Must accept the same
   * `(url, body, options)` signature.
   */
  fetcher?: typeof axios.post;
  /** Override timeout. */
  timeoutMs?: number;
  /** Disable wholesale (used by `OPENROUTER_PREFLIGHT=false`). */
  disabled?: boolean;
}): Promise<PreflightSummary> {
  const start = Date.now();
  const summary: PreflightSummary = {
    ok: true,
    hasWarnings: false,
    models: {},
    rolesAffected: [],
    durationMs: 0,
  };

  if (args?.disabled) {
    summary.skipped = true;
    summary.durationMs = Date.now() - start;
    return summary;
  }

  if (!config.openrouter.apiKey?.trim()) {
    logger.warn('[v2-preflight] OPENROUTER_API_KEY is not set; skipping V2 OpenRouter pre-flight');
    summary.skipped = true;
    summary.durationMs = Date.now() - start;
    return summary;
  }

  // Collect distinct OpenRouter slugs referenced as primaries OR preset
  // fallbacks by the V2 default presets, mapped back to the roles /
  // objectives that use them and which tier they occupy.
  const slugToRoles = new Map<
    string,
    Array<{ objective: string; role: string; tier: 'primary' | 'fallback' }>
  >();
  for (const objective of RESEARCH_OBJECTIVES) {
    const preset = V2_MODE_PRESETS[objective];
    for (const role of REASONING_MODEL_ROLES) {
      const entry = preset[role];
      if (!entry) continue;
      for (const tier of ['primary', 'fallback'] as const) {
        const slug = tier === 'primary' ? entry.primary : entry.fallback;
        if (!slug) continue;
        if (isHfRepoModel(slug)) continue; // HF repo ids do not go through OR
        const list = slugToRoles.get(slug) ?? [];
        list.push({ objective, role, tier });
        slugToRoles.set(slug, list);
      }
    }
  }

  const fetcher = args?.fetcher ?? axios.post;
  const timeout = args?.timeoutMs ?? 12000;
  const baseUrl = config.openrouter.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const provider = buildPreflightProviderBlock();
  const headers = {
    Authorization: `Bearer ${config.openrouter.apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://researchone.app',
    'X-Title': 'ResearchOne',
    // Distinguishes startup smoke-test calls from live research calls in
    // OpenRouter's generation logs. Prevents operators from mistaking
    // intentional 1-token probes (finish_reason=length) for real run failures.
    'X-ResearchOne-Call-Type': 'preflight',
  };

  await Promise.all(
    Array.from(slugToRoles.keys()).map(async (slug) => {
      const probeStart = Date.now();
      const body = {
        model: slug,
        // Minimal-cost smoke probe. We do not care about the content of the
        // reply — only that the request envelope is accepted by the
        // configured account / provider-data-collection policy.
        messages: [
          { role: 'system', content: 'preflight' },
          { role: 'user', content: 'ping' },
        ],
        max_tokens: 1,
        temperature: 0,
        provider,
      };
      try {
        const res = await fetcher(url, body, { headers, timeout });
        const status = (res as { status?: number })?.status ?? 200;
        summary.models[slug] = {
          slug,
          ok: status >= 200 && status < 300,
          status,
          durationMs: Date.now() - probeStart,
        };
        if (!summary.models[slug].ok) {
          summary.ok = false;
          summary.hasWarnings = true;
          for (const r of slugToRoles.get(slug) ?? []) {
            summary.rolesAffected.push({
              objective: r.objective,
              role: r.role,
              tier: r.tier,
              slug,
              reason: `HTTP ${status} on /chat/completions probe`,
            });
          }
        }
      } catch (err) {
        const e = err as {
          response?: { status?: number; data?: unknown };
          message?: string;
        };
        const status = e?.response?.status;
        const data = e?.response?.data as
          | string
          | { error?: { message?: string }; message?: string }
          | undefined;
        const providerMessage =
          typeof data === 'string'
            ? data
            : data && typeof data === 'object'
              ? data.error?.message || data.message || ''
              : '';
        const baseReason = status ? `HTTP ${status}` : e?.message || 'request failed';
        const reason = providerMessage ? `${baseReason}: ${providerMessage}` : baseReason;
        summary.models[slug] = {
          slug,
          ok: false,
          status,
          reason,
          providerMessage: providerMessage || undefined,
          durationMs: Date.now() - probeStart,
        };
        summary.ok = false;
        summary.hasWarnings = true;
        for (const r of slugToRoles.get(slug) ?? []) {
          summary.rolesAffected.push({
            objective: r.objective,
            role: r.role,
            tier: r.tier,
            slug,
            reason,
          });
        }
      }
    })
  );

  summary.durationMs = Date.now() - start;
  return summary;
}

/**
 * Run the pre-flight and log a structured summary. Called at app
 * startup (best-effort, never blocks listen). Honors
 * `OPENROUTER_PREFLIGHT=false` to suppress the probe entirely.
 */
export async function runV2OpenRouterPreflightAndLog(): Promise<PreflightSummary> {
  const enabledRaw = (process.env.OPENROUTER_PREFLIGHT ?? 'true').trim().toLowerCase();
  const disabled = enabledRaw === 'false' || enabledRaw === '0' || enabledRaw === 'no';
  if (disabled) {
    logger.info('[v2-preflight] Disabled via OPENROUTER_PREFLIGHT=false');
    return {
      ok: true,
      hasWarnings: false,
      models: {},
      rolesAffected: [],
      durationMs: 0,
      skipped: true,
    };
  }

  let summary: PreflightSummary;
  try {
    summary = await preflightV2OpenRouterModels();
  } catch (err) {
    logger.warn('[v2-preflight] Pre-flight probe failed; continuing without it', err);
    return {
      ok: false,
      hasWarnings: true,
      models: {},
      rolesAffected: [],
      durationMs: 0,
    };
  }
  if (summary.skipped) return summary;
  if (summary.hasWarnings) {
    logger.warn(
      `[v2-preflight] ${summary.rolesAffected.length} role(s) have unreachable default primary or fallback slugs on OpenRouter`,
      {
        durationMs: summary.durationMs,
        rolesAffected: summary.rolesAffected,
        models: summary.models,
      }
    );
  } else {
    const okCount = Object.keys(summary.models).length;
    logger.info(
      `[v2-preflight] All ${okCount} V2 default OpenRouter slugs (primaries + fallbacks) reachable in ${summary.durationMs}ms`
    );
  }
  return summary;
}
