/**
 * Provider health check (RJ-024, RJ-025). Administrators only.
 *
 * Two things are reported:
 *
 *   1. For each provider that has a key on this server and serves a model
 *      some role chose: one very small request (an answer of at most 5
 *      tokens) with that model, and whether it answered. A provider that has
 *      a key but serves no role's model is listed and not called.
 *   2. For each role: the model it chose, which providers serve that exact
 *      model, how many, and how many of those have a key on this server. A
 *      role with one provider has no other route if that provider refuses.
 *      This part is read from the table in `providerRoutes.ts`; it sends
 *      nothing.
 *
 * It runs only when an administrator calls `POST /api/admin/providers/health`.
 * Nothing calls it at startup, on a timer or during a run: every check is a
 * real request on the server's own provider accounts.
 *
 * The error text returned is the provider's own message, shortened, with
 * anything that looks like a key removed.
 */
import axios, { type AxiosError } from 'axios';
import { InferenceClient } from '@huggingface/inference';
import { config } from '../../config';
import { REASONING_MODEL_ROLES, type ReasoningModelRole } from '../reasoning/reasoningModelPolicy';
import { buildOpenRouterAppHeaders } from './openrouterProviderBlock';
import {
  anthropicMessagesEndpoint,
  anthropicRequestHeaders,
  chosenModelsForRole,
  classifyModelError,
  extractProviderMessage,
  nvidiaChatEndpoint,
  providerForChosenModel,
  togetherChatEndpoint,
  type ModelErrorClassification,
  type ModelRouteProvider,
} from './openrouterService';
import {
  MODEL_PROVIDER_NAMES,
  providersServingModel,
  routeConfigurationReason,
  sameModelName,
  type ModelProviderName,
  type RouteConfigurationReason,
} from './providerRoutes';

/** The size of the answer asked for. The request is as small as a provider accepts. */
export const PROVIDER_HEALTH_MAX_TOKENS = 5;
const PROVIDER_HEALTH_TIMEOUT_MS = 30_000;
const PROVIDER_HEALTH_PROMPT = 'Reply with the word ok.';
const ERROR_TEXT_MAX_CHARS = 240;

export interface ProviderHealthTarget {
  provider: ModelRouteProvider;
  model: string;
}

export interface ProviderHealthResult extends ProviderHealthTarget {
  ok: boolean;
  /** The HTTP status the provider answered with, or `null` when there was none (no connection, or a client that hides it). */
  status: number | null;
  durationMs: number;
  /** Set when the provider refused. */
  classification?: ModelErrorClassification;
  /** Set when the refusal is about how the route is set up on this server. */
  configurationReason?: RouteConfigurationReason;
  /** The provider's message, shortened, with key-like strings removed. */
  error?: string;
}

function configuredSecrets(): string[] {
  return [
    config.openrouter.apiKey,
    config.anthropic.apiKey,
    config.anthropic.workspaceId,
    config.together.apiKey,
    config.nvidia.apiKey,
    config.hfToken,
  ]
    .map((value) => (value ?? '').trim())
    .filter((value) => value.length >= 6);
}

/**
 * Shorten a provider's message and take out anything that looks like a key:
 * the keys set on this server, `Bearer ...` values, strings with a well-known
 * key prefix, and any long unbroken run of letters and digits.
 */
export function redactKeyLikeText(text: string, secrets: readonly string[] = configuredSecrets()): string {
  let out = String(text ?? '');
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= 6) out = out.split(secret).join('[removed]');
  }
  out = out
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [removed]')
    .replace(/\b(?:sk|pk|rk|hf|nvapi|tgp|gsk|xai|key|wrkspc|org)[-_][A-Za-z0-9_-]{8,}/gi, '[removed]')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '[removed]')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > ERROR_TEXT_MAX_CHARS ? `${out.slice(0, ERROR_TEXT_MAX_CHARS - 1)}…` : out;
}

/** Which providers have a key on this server. */
export function providersWithKey(): Record<ModelProviderName, boolean> {
  return {
    openrouter: Boolean(config.openrouter.apiKey?.trim()),
    anthropic: Boolean(config.anthropic.apiKey?.trim()),
    together: Boolean(config.together.apiKey?.trim()),
    huggingface_inference: Boolean(config.hfToken?.trim()),
    nvidia: Boolean(config.nvidia.apiKey?.trim()),
  };
}

/** One model a role uses, and the providers that serve that exact model. */
export interface ModelProviderCoverage {
  /** The id the role names. */
  model: string;
  /** The model's name in the provider table, or the id when the table has no row for it. */
  modelName: string;
  /** Every provider confirmed to serve this exact model. */
  servedBy: ModelProviderName[];
  /** How many providers serve it. */
  providerCount: number;
  /** Of those, the ones that have a key on this server. */
  servedByWithKey: ModelProviderName[];
  /** How many of them have a key on this server: the number of routes a call really has. */
  providerCountWithKey: number;
  /** True when one provider or none serves it: there is no same-model route to move to. */
  singleProvider: boolean;
  /** False when the provider the role's own id belongs to was not confirmed to serve it. */
  ownProviderConfirmed: boolean;
}

export interface RoleProviderCoverage extends ModelProviderCoverage {
  role: ReasoningModelRole;
  /**
   * A different model the same role uses for one kind of research, or as the
   * server's own setting. Left out when the role uses one model everywhere.
   */
  otherModels?: Array<ModelProviderCoverage & { usedFor: string }>;
}

function coverageForModel(model: string, hasKey: Readonly<Record<ModelProviderName, boolean>>): ModelProviderCoverage {
  const chosen = { provider: providerForChosenModel(model), model };
  const servedBy = providersServingModel(chosen).map((route) => route.provider);
  const servedByWithKey = servedBy.filter((provider) => hasKey[provider]);
  return {
    model,
    modelName: sameModelName(chosen),
    servedBy,
    providerCount: servedBy.length,
    servedByWithKey,
    providerCountWithKey: servedByWithKey.length,
    singleProvider: servedBy.length <= 1,
    ownProviderConfirmed: servedBy.includes(chosen.provider),
  };
}

/**
 * For every role: how many providers serve the model it chose (RJ-025). Read
 * from the provider table; no provider is called.
 */
export function roleProviderCoverage(
  hasKey: Readonly<Record<ModelProviderName, boolean>> = providersWithKey()
): RoleProviderCoverage[] {
  return REASONING_MODEL_ROLES.map((role) => {
    const [first, ...others] = chosenModelsForRole(role);
    const otherModels = others.map((entry) => ({ ...coverageForModel(entry.model, hasKey), usedFor: entry.usedFor }));
    return {
      role,
      ...coverageForModel(first.model, hasKey),
      ...(otherModels.length > 0 ? { otherModels } : {}),
    };
  });
}

/**
 * The providers to ask, each with the first role model it serves. A provider
 * is asked only when it has a key on this server AND serves a model some role
 * chose: asking it for any other model would say nothing about a route a call
 * can take.
 */
export function providerHealthTargets(): ProviderHealthTarget[] {
  const hasKey = providersWithKey();
  const targets: ProviderHealthTarget[] = [];
  // The research engine's own choices first, role by role; then the models a
  // role uses for one kind of research or as the server's setting.
  const chosen = [
    ...REASONING_MODEL_ROLES.map((role) => chosenModelsForRole(role)[0]),
    ...REASONING_MODEL_ROLES.flatMap((role) => chosenModelsForRole(role).slice(1)),
  ];
  for (const provider of MODEL_PROVIDER_NAMES) {
    if (!hasKey[provider]) continue;
    for (const entry of chosen) {
      const route = providersServingModel({ provider: providerForChosenModel(entry.model), model: entry.model }).find(
        (served) => served.provider === provider
      );
      if (route) {
        targets.push({ provider, model: route.model });
        break;
      }
    }
  }
  return targets;
}

/**
 * Providers that have a key on this server but serve no model any role chose.
 * No call can reach them, so the health check does not ask them.
 */
export function providersServingNoRoleModel(): ModelProviderName[] {
  const hasKey = providersWithKey();
  const asked = new Set(providerHealthTargets().map((target) => target.provider));
  return MODEL_PROVIDER_NAMES.filter((provider) => hasKey[provider] && !asked.has(provider));
}

async function sendHealthRequest(target: ProviderHealthTarget): Promise<number | null> {
  const messages = [{ role: 'user', content: PROVIDER_HEALTH_PROMPT }];
  const body = { model: target.model, messages, max_tokens: PROVIDER_HEALTH_MAX_TOKENS };
  const bearer = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
  const request = { timeout: PROVIDER_HEALTH_TIMEOUT_MS };

  switch (target.provider) {
    case 'openrouter':
      return (
        await axios.post(`${config.openrouter.baseUrl}/chat/completions`, body, {
          ...request,
          headers: buildOpenRouterAppHeaders(config.openrouter.apiKey),
        })
      ).status;
    case 'anthropic':
      return (await axios.post(anthropicMessagesEndpoint(), body, { ...request, headers: anthropicRequestHeaders() })).status;
    case 'together':
      return (await axios.post(togetherChatEndpoint(), body, { ...request, headers: bearer(config.together.apiKey) })).status;
    case 'nvidia':
      return (await axios.post(nvidiaChatEndpoint(), body, { ...request, headers: bearer(config.nvidia.apiKey) })).status;
    case 'huggingface_inference': {
      const client = new InferenceClient(config.hfToken.trim()) as unknown as {
        chatCompletion: (args: Record<string, unknown>) => Promise<unknown>;
      };
      await client.chatCompletion(body);
      return 200;
    }
  }
}

async function checkOne(target: ProviderHealthTarget): Promise<ProviderHealthResult> {
  const startedAt = Date.now();
  try {
    const status = await sendHealthRequest(target);
    return { ...target, ok: true, status: status ?? 200, durationMs: Date.now() - startedAt };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError;
      const message = extractProviderMessage(axiosErr);
      const classification = classifyModelError(axiosErr);
      const configurationReason = classification === 'route_config_error' ? routeConfigurationReason(message) : null;
      return {
        ...target,
        ok: false,
        status: axiosErr.response?.status ?? null,
        durationMs,
        classification,
        ...(configurationReason ? { configurationReason } : {}),
        error: redactKeyLikeText(message),
      };
    }
    return {
      ...target,
      ok: false,
      status: null,
      durationMs,
      classification: 'provider_unavailable',
      error: redactKeyLikeText(err instanceof Error ? err.message : String(err)),
    };
  }
}

/** Ask each configured provider once, side by side. Never throws: a refusal is a result. */
export async function checkProviderHealth(): Promise<ProviderHealthResult[]> {
  return Promise.all(providerHealthTargets().map((target) => checkOne(target)));
}
