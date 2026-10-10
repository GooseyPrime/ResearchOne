/**
 * Provider health check (RJ-024). Administrators only.
 *
 * Sends one very small request (an answer of at most 5 tokens) to each
 * provider that has a key on this server, using the first model the routes
 * would use there, and reports whether it answered.
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
import { crossProviderBackupModelsForRole, isHfRepoModel } from '../reasoning/reasoningModelPolicy';
import { buildOpenRouterAppHeaders } from './openrouterProviderBlock';
import {
  anthropicMessagesEndpoint,
  anthropicRequestHeaders,
  classifyModelError,
  extractProviderMessage,
  nvidiaChatEndpoint,
  togetherChatEndpoint,
  type ModelErrorClassification,
  type ModelRouteProvider,
} from './openrouterService';
import { routeConfigurationReason, togetherModelsForRole, type RouteConfigurationReason } from './providerRoutes';

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

/**
 * The providers that have a key on this server, each with the first model the
 * routes would use there. A provider with no key is left out.
 */
export function providerHealthTargets(): ProviderHealthTarget[] {
  const targets: ProviderHealthTarget[] = [];
  const backups = crossProviderBackupModelsForRole('planner', { openrouter: true, hub: true });
  if (config.openrouter.apiKey?.trim()) {
    const model = backups.find((id) => !isHfRepoModel(id));
    if (model) targets.push({ provider: 'openrouter', model });
  }
  if (config.anthropic.apiKey?.trim()) targets.push({ provider: 'anthropic', model: config.anthropic.models.fast });
  if (config.together.apiKey?.trim()) {
    const model = togetherModelsForRole('planner')[0];
    if (model) targets.push({ provider: 'together', model });
  }
  if (config.hfToken?.trim()) {
    const model = backups.find((id) => isHfRepoModel(id));
    if (model) targets.push({ provider: 'huggingface_inference', model });
  }
  if (config.nvidia.apiKey?.trim()) targets.push({ provider: 'nvidia', model: config.nvidia.models.fast });
  return targets;
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
