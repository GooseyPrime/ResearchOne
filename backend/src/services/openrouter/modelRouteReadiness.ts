/**
 * Model route readiness (RJ-025 repair): before a research run does any work,
 * check that every stage the run cannot finish without has at least one route
 * that can answer for the exact model that stage uses.
 *
 * The routes come from the same definitions a call uses (`serverModelRoutes`,
 * built on the table in `providerRoutes.ts`): the stage's chosen model, then
 * that same model on each other provider that has a key and is confirmed to
 * serve it. No other model is ever counted.
 *
 * A key is not proof that a route can answer: the account may be out of
 * credit, or the provider may no longer serve the model. So a route counts as
 * usable only when it has answered recently (`routeAvailability.ts`). A route
 * nothing is known about is asked once, with the smallest request a provider
 * accepts (`probeRoute`), and the answer is kept for later runs.
 *
 * A run whose caller brought their own OpenRouter key is not probed: a probe
 * would be charged to their account. For such a run a route counts when the
 * provider table confirms OpenRouter serves the exact model.
 *
 * When a required stage has no usable route the run stops here, before any
 * model call, with a plain sentence and no charge (`ModelRoutesUnavailableError`).
 */
import type { ResearchObjective } from '../reasoning/reasoningModelPolicy';
import type { ReasoningModelRole } from '../reasoning/reasoningModelPolicy';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
  providerForRoute,
  resolvePrimaryModelForCall,
  serverModelRoutes,
  type ModelRoute,
} from './openrouterService';
import { probeRoute, type ProviderHealthResult, type ProviderHealthTarget } from './providerHealth';
import { providersServingModel, sameModelName, type ModelProviderName } from './providerRoutes';
import { routeAvailability, type RouteState } from './routeAvailability';

/**
 * The stages every research run waits on. If any of these has no usable
 * route, the run cannot produce a report, so it is not started.
 *
 *   - planner: works out the request and writes the plan.
 *   - retriever: turns the plan into searches.
 *   - reasoner: reads the evidence.
 *   - double_check: the challenge step every run waits for.
 *   - verifier: checks the report against the request.
 *   - outline_architect, section_drafter, coherence_refiner: write the report.
 *
 * Stages a run may skip (the internal challenger when the profile turns it off,
 * the plain-language summary, revision roles, specialists) are not checked
 * here: their own calls still fail plainly if their model cannot be reached.
 */
export const REQUIRED_RESEARCH_RUN_ROLES: readonly ReasoningModelRole[] = [
  'planner',
  'retriever',
  'reasoner',
  'double_check',
  'verifier',
  'outline_architect',
  'section_drafter',
  'coherence_refiner',
];

export interface RouteReadiness {
  provider: ModelProviderName;
  /** The id the model has on this provider. */
  model: string;
  state: RouteState;
  /** Why the route was last refused, when it was. */
  reason?: string;
}

export interface StageReadiness {
  role: ReasoningModelRole;
  /** The model the stage uses, as the run names it. */
  model: string;
  /** The model's name in the provider table. */
  modelName: string;
  routes: RouteReadiness[];
  usable: boolean;
}

export interface RunReadiness {
  ready: boolean;
  stages: StageReadiness[];
  /** The stages with no usable route. */
  unavailable: StageReadiness[];
}

export interface RunReadinessArgs {
  engineVersion?: string | null;
  researchObjective?: ResearchObjective | null;
  /** The run's own model choice per role, as `callRoleModel` receives it. */
  runtimeOverrideFor?: (role: ReasoningModelRole) => { primary?: string } | undefined;
  /** True when the run uses the caller's own OpenRouter key. */
  byok?: boolean;
  /** Replaced in tests. */
  probe?: (target: ProviderHealthTarget) => Promise<ProviderHealthResult>;
  roles?: readonly ReasoningModelRole[];
}

/** One call shape per stage to check: the model a call of that stage resolves to. */
function stageCalls(args: RunReadinessArgs): Array<{ role: ReasoningModelRole; model: string }> {
  const roles = args.roles ?? REQUIRED_RESEARCH_RUN_ROLES;
  const out: Array<{ role: ReasoningModelRole; model: string }> = [];
  const add = (role: ReasoningModelRole, model: string) => {
    if (!out.some((entry) => entry.role === role && entry.model === model)) out.push({ role, model });
  };
  for (const role of roles) {
    add(
      role,
      resolvePrimaryModelForCall({
        role,
        messages: [],
        engineVersion: args.engineVersion ?? undefined,
        researchObjective: args.researchObjective ?? undefined,
        runtimeOverrides: args.runtimeOverrideFor?.(role),
      })
    );
    if (role === 'planner') {
      // Intent and plan writing name the server's planning model for every run
      // (`intentClassifier.ts`, `planGenerator.ts`), so it is checked as well.
      add(
        role,
        resolvePrimaryModelForCall({
          role,
          messages: [],
          engineVersion: args.engineVersion ?? undefined,
          researchObjective: args.researchObjective ?? undefined,
          runtimeOverrides: { primary: config.models.planning },
        })
      );
    }
  }
  return out;
}

function routeKey(target: ProviderHealthTarget): string {
  return `${target.provider}\u0000${target.model}`;
}

/** For a caller's own key: whether the table confirms OpenRouter serves this exact id. */
function confirmedOnOpenRouter(model: string): boolean {
  return providersServingModel({ provider: 'openrouter', model }).some(
    (served) => served.provider === 'openrouter' && served.model === model.trim()
  );
}

/**
 * Check every required stage. Probes each route nothing is known about, once,
 * side by side. Never throws for a refusal: the answer is in the result.
 */
export async function checkRunModelReadiness(args: RunReadinessArgs): Promise<RunReadiness> {
  const byok = args.byok === true;
  const probe = args.probe ?? ((target: ProviderHealthTarget) => probeRoute(target));
  const calls = stageCalls(args);
  const routesByCall = calls.map((call) => ({
    ...call,
    routes: serverModelRoutes(call.role, call.model, { byok }).map((route: ModelRoute) => ({
      provider: providerForRoute(route),
      model: route.model,
    })),
  }));

  if (!byok) {
    const unknown = new Map<string, ProviderHealthTarget>();
    for (const call of routesByCall) {
      for (const target of call.routes) {
        if (!routeAvailability(target.provider, target.model)) unknown.set(routeKey(target), target);
      }
    }
    // Probes record their own outcome; a failed probe is a result, not an error.
    await Promise.all(
      Array.from(unknown.values()).map((target) =>
        probe(target).catch((err) => {
          logger.warn('model_route_readiness_probe_failed', {
            provider: target.provider,
            model: target.model,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      )
    );
  }

  const stages: StageReadiness[] = routesByCall.map((call) => {
    const routes: RouteReadiness[] = call.routes.map((target) => {
      if (byok) {
        return {
          ...target,
          state: target.provider === 'openrouter' && confirmedOnOpenRouter(target.model) ? 'usable' : 'not_usable',
          ...(target.provider === 'openrouter' && !confirmedOnOpenRouter(target.model)
            ? { reason: 'not_confirmed_on_provider' }
            : {}),
        };
      }
      const record = routeAvailability(target.provider, target.model);
      return { ...target, state: record?.state ?? 'unknown', ...(record?.reason ? { reason: record.reason } : {}) };
    });
    return {
      role: call.role,
      model: call.model,
      modelName: sameModelName({ provider: routes[0]?.provider ?? 'openrouter', model: call.model }),
      routes,
      usable: routes.some((route) => route.state === 'usable'),
    };
  });
  const unavailable = stages.filter((stage) => !stage.usable);
  return { ready: unavailable.length === 0, stages, unavailable };
}

/** The classification a run that could not start for this reason is stored with. */
export const NO_USABLE_MODEL_ROUTE = 'no_usable_model_route';

/**
 * A run stopped before any work because a required stage has no usable route
 * for its model. Carries `failureMeta`, so the orchestrator stores it as it is,
 * and `retryable`, so the run can be run again once a provider answers. The
 * message is for administrators; a customer reads the sentence chosen from
 * the classification (`customerFailureMessage.ts`).
 */
export class ModelRoutesUnavailableError extends Error {
  readonly retryable = true;
  readonly failureMeta: Record<string, unknown>;

  constructor(readiness: RunReadiness) {
    const summary = readiness.unavailable
      .map(
        (stage) =>
          `${stage.role} (${stage.modelName}): ${
            stage.routes.length === 0
              ? 'no provider with a key serves this model'
              : stage.routes.map((route) => `${route.provider} ${route.state}${route.reason ? ` (${route.reason})` : ''}`).join(', ')
          }`
      )
      .join('; ');
    super(`No usable route for the exact model of a required stage, so the run was not started: ${summary}`);
    this.name = 'ModelRoutesUnavailableError';
    this.failureMeta = {
      classification: NO_USABLE_MODEL_ROUTE,
      unavailableStages: readiness.unavailable.map((stage) => ({
        role: stage.role,
        model: stage.model,
        modelName: stage.modelName,
        routes: stage.routes,
      })),
      orchestratorHints: [
        'Every route for this stage\'s model is out of credit, refused, or not served. Top up or fix the provider account that serves the exact model (see POST /api/admin/providers/health), or choose a different model for the stage in the presets. No other model is used in its place.',
      ],
    };
  }
}

/** Check the run's required stages and throw `ModelRoutesUnavailableError` when one has no usable route. */
export async function assertRunModelRoutesReady(args: RunReadinessArgs): Promise<RunReadiness> {
  const readiness = await checkRunModelReadiness(args);
  if (!readiness.ready) throw new ModelRoutesUnavailableError(readiness);
  return readiness;
}
