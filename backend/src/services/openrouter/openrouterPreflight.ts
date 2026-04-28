import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { V2_MODE_PRESETS } from '../../config/researchEnsemblePresets';
import { isHfRepoModel, REASONING_MODEL_ROLES, RESEARCH_OBJECTIVES } from '../reasoning/reasoningModelPolicy';

export interface PreflightModelStatus {
  slug: string;
  ok: boolean;
  /** Number of upstream provider endpoints OpenRouter exposes for this slug. */
  endpointCount: number;
  /** Reason this slug is not OK; only present when `ok=false`. */
  reason?: string;
  /** HTTP status from OpenRouter, when available. */
  status?: number;
  /** Whether at least one endpoint reported live (uptime > 0). */
  anyLive?: boolean;
}

export interface PreflightSummary {
  ok: boolean;
  /** True iff at least one role primary failed pre-flight, regardless of `ok`. */
  hasWarnings: boolean;
  /** Per-slug results (deduplicated across roles / objectives). */
  models: Record<string, PreflightModelStatus>;
  /** Roles whose default primary failed (per objective). */
  rolesAffected: Array<{ objective: string; role: string; slug: string; reason: string }>;
  /** Wall-clock duration in ms. */
  durationMs: number;
}

/**
 * Probe OpenRouter `/api/v1/models/<slug>/endpoints` for every distinct
 * V2 default primary slug in `V2_MODE_PRESETS`. The point: if a default
 * primary is unreachable for the configured `OPENROUTER_API_KEY`, log a
 * warning at startup with the exact role(s) and slug(s) so the operator
 * sees the problem before a user clicks Run on a V2 run.
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
  /** Override fetch (used in tests). */
  fetcher?: typeof axios.get;
  /** Override timeout. */
  timeoutMs?: number;
}): Promise<PreflightSummary> {
  const start = Date.now();
  const summary: PreflightSummary = {
    ok: true,
    hasWarnings: false,
    models: {},
    rolesAffected: [],
    durationMs: 0,
  };

  if (!config.openrouter.apiKey?.trim()) {
    logger.warn('[v2-preflight] OPENROUTER_API_KEY is not set; skipping V2 OpenRouter pre-flight');
    summary.durationMs = Date.now() - start;
    return summary;
  }

  // Collect distinct OpenRouter slugs referenced as primaries by the V2
  // default presets, mapped back to the roles / objectives that use them.
  const slugToRoles = new Map<string, Array<{ objective: string; role: string }>>();
  for (const objective of RESEARCH_OBJECTIVES) {
    const preset = V2_MODE_PRESETS[objective];
    for (const role of REASONING_MODEL_ROLES) {
      const slug = preset[role]?.primary;
      if (!slug) continue;
      if (isHfRepoModel(slug)) continue; // HF repo ids do not go through OR
      const list = slugToRoles.get(slug) ?? [];
      list.push({ objective, role });
      slugToRoles.set(slug, list);
    }
  }

  const fetcher = args?.fetcher ?? axios.get;
  const timeout = args?.timeoutMs ?? 12000;
  const baseUrl = config.openrouter.baseUrl.replace(/\/+$/, '');

  await Promise.all(
    Array.from(slugToRoles.keys()).map(async (slug) => {
      try {
        const url = `${baseUrl}/models/${slug}/endpoints`;
        const res = await fetcher(url, {
          headers: {
            Authorization: `Bearer ${config.openrouter.apiKey}`,
            Accept: 'application/json',
          },
          timeout,
        });
        const endpoints =
          (res?.data as { data?: { endpoints?: unknown[] } })?.data?.endpoints ?? [];
        const count = Array.isArray(endpoints) ? endpoints.length : 0;
        const anyLive =
          Array.isArray(endpoints) &&
          endpoints.some((e) => {
            const ep = e as { status?: unknown };
            return typeof ep.status === 'number' ? ep.status >= 0 : true;
          });
        summary.models[slug] = { slug, ok: count > 0, endpointCount: count, anyLive };
        if (count === 0) {
          summary.ok = false;
          summary.hasWarnings = true;
          for (const r of slugToRoles.get(slug) ?? []) {
            summary.rolesAffected.push({
              objective: r.objective,
              role: r.role,
              slug,
              reason: 'no live OpenRouter endpoints for this slug',
            });
          }
        }
      } catch (err) {
        const e = err as { response?: { status?: number; data?: unknown }; message?: string };
        const status = e?.response?.status;
        summary.models[slug] = {
          slug,
          ok: false,
          endpointCount: 0,
          status,
          reason: status ? `HTTP ${status}` : (e?.message || 'request failed'),
        };
        summary.ok = false;
        summary.hasWarnings = true;
        for (const r of slugToRoles.get(slug) ?? []) {
          summary.rolesAffected.push({
            objective: r.objective,
            role: r.role,
            slug,
            reason: status ? `HTTP ${status}` : (e?.message || 'request failed'),
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
 * startup (best-effort, never blocks listen).
 */
export async function runV2OpenRouterPreflightAndLog(): Promise<PreflightSummary> {
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
  if (summary.hasWarnings) {
    logger.warn(
      `[v2-preflight] ${summary.rolesAffected.length} role(s) have unreachable default primaries on OpenRouter`,
      {
        durationMs: summary.durationMs,
        rolesAffected: summary.rolesAffected,
        models: summary.models,
      }
    );
  } else {
    const okCount = Object.keys(summary.models).length;
    logger.info(
      `[v2-preflight] All ${okCount} V2 default OpenRouter primaries reachable in ${summary.durationMs}ms`
    );
  }
  return summary;
}
