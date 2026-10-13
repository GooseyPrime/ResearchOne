/**
 * Startup preflight for model routes (RJ-025 repair).
 *
 * The targets are built from the same definitions a research call uses: for
 * every research kind and every role, the model the research engine chooses
 * (`resolvePrimaryModelForCall`), and each route that exact model has on this
 * server (`serverModelRoutes`, built on the table in `providerRoutes.ts`).
 * A different model is never a target, because a call never moves to one.
 *
 * Each distinct route (provider and the id the model has there) is asked once
 * with the smallest request the provider accepts, through the same request
 * path the admin health check uses (`probeRoute`), and the outcome is kept in
 * `routeAvailability.ts`. The run readiness check reads it, so the first
 * customer run after a deploy does not have to find a broken route itself.
 *
 * It never fails startup. A role with no route that answered is logged for an
 * administrator; the run readiness check stops such a run before any work.
 *
 * Cost: one request of at most 5 tokens per distinct route per start. Set
 * `OPENROUTER_PREFLIGHT=false` to turn it off (the name is kept from when it
 * only asked OpenRouter, so existing settings keep working).
 */
import { logger } from '../../utils/logger';
import { RESEARCH_ENGINE_VERSION } from '../../config/researchEngine';
import { REASONING_MODEL_ROLES, RESEARCH_OBJECTIVES } from '../reasoning/reasoningModelPolicy';
import { providerForRoute, resolvePrimaryModelForCall, serverModelRoutes } from './openrouterService';
import { probeRoute, type ProviderHealthResult, type ProviderHealthTarget } from './providerHealth';
import { sameModelName, type ModelProviderName } from './providerRoutes';

export interface PreflightRouteStatus {
  provider: ModelProviderName;
  /** The id the model has on this provider. */
  model: string;
  ok: boolean;
  status?: number | null;
  /** Why the route is not usable; only present when `ok=false`. */
  reason?: string;
  durationMs: number;
}

export interface PreflightRoleWithoutRoute {
  objective: string;
  role: string;
  /** The model the role chose, as the research engine names it. */
  model: string;
  modelName: string;
  /** Every route the model has on this server, none of which answered. */
  routes: Array<{ provider: ModelProviderName; model: string; reason?: string }>;
}

export interface PreflightSummary {
  ok: boolean;
  /** True when at least one route did not answer, even if every role still has one that did. */
  hasWarnings: boolean;
  /** One entry per distinct route asked. */
  routes: PreflightRouteStatus[];
  /** Roles whose model has no route that answered. */
  rolesWithoutRoute: PreflightRoleWithoutRoute[];
  durationMs: number;
  /** Whether the probe was skipped (turned off by setting). */
  skipped?: boolean;
}

interface RoleRouteSet {
  objective: string;
  role: string;
  model: string;
  routes: ProviderHealthTarget[];
}

/** Every role's routes, per research kind, from the definitions calls use. */
export function preflightRouteSets(): RoleRouteSet[] {
  const sets: RoleRouteSet[] = [];
  for (const objective of RESEARCH_OBJECTIVES) {
    for (const role of REASONING_MODEL_ROLES) {
      const model = resolvePrimaryModelForCall({
        role,
        messages: [],
        engineVersion: RESEARCH_ENGINE_VERSION,
        researchObjective: objective,
      });
      sets.push({
        objective,
        role,
        model,
        routes: serverModelRoutes(role, model).map((route) => ({ provider: providerForRoute(route), model: route.model })),
      });
    }
  }
  return sets;
}

function keyOf(target: ProviderHealthTarget): string {
  return `${target.provider}\u0000${target.model}`;
}

export async function preflightModelRoutes(args?: {
  /** Replaced in tests; never a real provider in a test. */
  probe?: (target: ProviderHealthTarget) => Promise<ProviderHealthResult>;
  disabled?: boolean;
}): Promise<PreflightSummary> {
  const start = Date.now();
  if (args?.disabled) {
    return { ok: true, hasWarnings: false, routes: [], rolesWithoutRoute: [], durationMs: 0, skipped: true };
  }
  const probe = args?.probe ?? ((target: ProviderHealthTarget) => probeRoute(target));
  const sets = preflightRouteSets();
  const distinct = new Map<string, ProviderHealthTarget>();
  for (const set of sets) for (const route of set.routes) distinct.set(keyOf(route), route);

  const results = new Map<string, ProviderHealthResult>();
  await Promise.all(
    Array.from(distinct.entries()).map(async ([key, target]) => {
      try {
        results.set(key, await probe(target));
      } catch (err) {
        results.set(key, {
          ...target,
          ok: false,
          status: null,
          durationMs: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  const routes: PreflightRouteStatus[] = Array.from(results.values()).map((result) => ({
    provider: result.provider,
    model: result.model,
    ok: result.ok,
    status: result.status,
    ...(result.ok ? {} : { reason: result.classification ?? result.error ?? 'refused' }),
    durationMs: result.durationMs,
  }));

  const rolesWithoutRoute: PreflightRoleWithoutRoute[] = [];
  for (const set of sets) {
    const answered = set.routes.some((route) => results.get(keyOf(route))?.ok === true);
    if (answered) continue;
    rolesWithoutRoute.push({
      objective: set.objective,
      role: set.role,
      model: set.model,
      modelName: sameModelName({ provider: set.routes[0]?.provider ?? 'openrouter', model: set.model }),
      routes: set.routes.map((route) => {
        const result = results.get(keyOf(route));
        return { ...route, ...(result && !result.ok ? { reason: result.classification ?? result.error } : {}) };
      }),
    });
  }

  return {
    ok: rolesWithoutRoute.length === 0,
    hasWarnings: routes.some((route) => !route.ok),
    routes,
    rolesWithoutRoute,
    durationMs: Date.now() - start,
  };
}

/** Whether `OPENROUTER_PREFLIGHT` turns the preflight off. */
export function preflightDisabledBySetting(raw: string | undefined = process.env.OPENROUTER_PREFLIGHT): boolean {
  const value = (raw ?? 'true').trim().toLowerCase();
  return value === 'false' || value === '0' || value === 'no';
}

/**
 * Run the preflight and log a summary. Called at app startup (best-effort,
 * never blocks listen).
 */
export async function runModelRoutePreflightAndLog(): Promise<PreflightSummary> {
  if (preflightDisabledBySetting()) {
    logger.info('[model-route-preflight] Disabled via OPENROUTER_PREFLIGHT=false');
    return preflightModelRoutes({ disabled: true });
  }
  let summary: PreflightSummary;
  try {
    summary = await preflightModelRoutes();
  } catch (err) {
    logger.warn('[model-route-preflight] Preflight failed; continuing without it', err);
    return { ok: false, hasWarnings: true, routes: [], rolesWithoutRoute: [], durationMs: 0 };
  }
  if (summary.rolesWithoutRoute.length > 0) {
    logger.warn(
      `[model-route-preflight] ${summary.rolesWithoutRoute.length} role/research-kind pair(s) have no route that answered for their exact model; runs that need them will not start`,
      { durationMs: summary.durationMs, rolesWithoutRoute: summary.rolesWithoutRoute, routes: summary.routes }
    );
  } else if (summary.hasWarnings) {
    logger.warn('[model-route-preflight] Some routes did not answer; every role still has one that did', {
      durationMs: summary.durationMs,
      routes: summary.routes.filter((route) => !route.ok),
    });
  } else {
    logger.info(`[model-route-preflight] All ${summary.routes.length} model routes answered in ${summary.durationMs}ms`);
  }
  return summary;
}
