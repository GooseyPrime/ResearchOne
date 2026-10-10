/**
 * The providers a role's call may be sent to, and the order they are tried in
 * (RJ-021).
 *
 * A role keeps its own model and its own backup. What this file adds is two
 * more providers a call can move to, and one setting that decides the order:
 *
 *   - Anthropic, called directly (Messages API). Setting: `ANTHROPIC_API_KEY`.
 *   - NVIDIA NIM, an OpenAI-compatible API. Settings: `NVIDIA_API_KEY` and,
 *     optionally, `NVIDIA_BASE_URL`.
 *
 * A provider with no key is left out of the routes. Nothing else changes for it.
 *
 * Order: `MODEL_PROVIDER_ORDER`, a comma-separated list of the four names
 * below. The default is `openrouter,anthropic,together,nvidia`.
 *
 *   - `openrouter`: models reached through the OpenRouter gateway.
 *   - `anthropic`:  Claude models, called directly.
 *   - `together`:   two providers share this place and are separate routes
 *                   (RJ-024). Together's serverless models come first (when
 *                   `TOGETHER_API_KEY` is set), then the hub models on
 *                   Hugging Face Inference (when `HF_TOKEN` is set). A hub id
 *                   is never sent to Together: Together serves its own ids.
 *   - `nvidia`:     models hosted on NVIDIA NIM.
 *
 * Every role has a model on Anthropic and on NVIDIA. The two tables below are
 * typed by role, so a role added to `REASONING_MODEL_ROLES` without a model
 * here does not compile.
 */
import type { ReasoningModelRole } from '../reasoning/reasoningModelPolicy';

/** A place in `MODEL_PROVIDER_ORDER`. */
export type ProviderSlot = 'openrouter' | 'anthropic' | 'together' | 'nvidia';

export const DEFAULT_MODEL_PROVIDER_ORDER: readonly ProviderSlot[] = ['openrouter', 'anthropic', 'together', 'nvidia'];

const SLOT_NAMES: Readonly<Record<string, ProviderSlot>> = {
  openrouter: 'openrouter',
  anthropic: 'anthropic',
  claude: 'anthropic',
  together: 'together',
  togetherai: 'together',
  huggingface: 'together',
  hf: 'together',
  hub: 'together',
  nvidia: 'nvidia',
  nim: 'nvidia',
};

export interface ParsedProviderOrder {
  order: ProviderSlot[];
  /** Names in the setting that are not a provider. They are ignored. */
  unknown: string[];
}

/**
 * Read `MODEL_PROVIDER_ORDER`. Names may be separated by commas, spaces or
 * arrows. A name that is not a provider is ignored, and a provider the setting
 * leaves out is added at the end in its default place, so a typing mistake
 * changes the order but can never remove a provider.
 */
export function parseModelProviderOrder(raw: string | undefined | null): ParsedProviderOrder {
  const order: ProviderSlot[] = [];
  const unknown: string[] = [];
  const names = (raw ?? '')
    .split(/[\s,;>|]+|-+>?/)
    .map((name) => name.trim().toLowerCase().replace(/[^a-z]/g, ''))
    .filter((name) => name.length > 0);
  for (const name of names) {
    const slot = SLOT_NAMES[name];
    if (!slot) {
      unknown.push(name);
      continue;
    }
    if (!order.includes(slot)) order.push(slot);
  }
  for (const slot of DEFAULT_MODEL_PROVIDER_ORDER) {
    if (!order.includes(slot)) order.push(slot);
  }
  return { order, unknown };
}

/** The two sizes of model each added provider offers a role. */
export type RouteModelClass = 'fast' | 'strong';

/**
 * Which size each role uses on the added providers.
 *
 * `fast`: planning, judging relevance, sorting, locating, formatting and the
 * specialist extractions. Short structured answers, called many times per run.
 *
 * `strong`: reasoning over the sources, restating a position in its strongest
 * form, Double-check, writing and refining the report, and verifying it.
 */
export const ROUTE_MODEL_CLASS_BY_ROLE: Readonly<Record<ReasoningModelRole, RouteModelClass>> = {
  planner: 'fast',
  retriever: 'fast',
  source_class_classifier: 'fast',
  reasoner: 'strong',
  strongest_form: 'strong',
  double_check: 'strong',
  synthesizer: 'strong',
  verifier: 'strong',
  plain_language_synthesizer: 'fast',
  outline_architect: 'strong',
  section_drafter: 'strong',
  internal_challenger: 'strong',
  coherence_refiner: 'strong',
  revision_intake: 'fast',
  report_locator: 'fast',
  change_planner: 'fast',
  section_rewriter: 'strong',
  citation_integrity_checker: 'fast',
  citation_formatter: 'fast',
  final_revision_verifier: 'strong',
  contract_auditor: 'fast',
  market_scout: 'fast',
  competitor_mapper: 'fast',
  demand_signal_analyst: 'fast',
  feasibility_architect: 'fast',
  story_verifier: 'fast',
  timeline_reconstructor: 'fast',
  data_analysis_specialist: 'fast',
  quantitative_quality_auditor: 'fast',
};

/**
 * Claude model ids, as listed on Anthropic's models page on 9 Oct 2026.
 * Haiku is the low-cost model; Sonnet writes and checks the report.
 */
export const ANTHROPIC_DEFAULT_MODELS: Readonly<Record<RouteModelClass, string>> = {
  fast: 'claude-haiku-5-5',
  strong: 'claude-sonnet-5-5',
};

/**
 * NVIDIA NIM model ids, as listed by `GET /v1/models` on
 * integrate.api.nvidia.com on 9 Oct 2026. Both are open-weights lines this
 * repository already uses elsewhere (DeepSeek and Kimi).
 */
export const NVIDIA_DEFAULT_MODELS: Readonly<Record<RouteModelClass, string>> = {
  fast: 'deepseek-ai/deepseek-v4.1-flash',
  strong: 'moonshotai/kimi-k3',
};

/**
 * Together's serverless chat models, cheapest capable first (RJ-024).
 *
 * Every id was read from Together's `GET /v1/models` on 10 Oct 2026, listed
 * with a per-token price, which is how Together marks a model that answers
 * without a dedicated endpoint. The two ids used before
 * (`deepseek-ai/DeepSeek-V3.1`, `deepseek-ai/DeepSeek-V3`) answered 400
 * "Unable to access non-serverless model" on every call, so the Together key
 * never answered anything.
 *
 * The same list serves every role: a call reaches it only after the role's own
 * model and backup were refused for a provider-side reason.
 */
export const TOGETHER_BACKUP_MODELS: readonly string[] = [
  'deepseek-ai/DeepSeek-V4.1-Flash',
  'zai-org/GLM-5.3-Flash',
  'Qwen/Qwen3.8-Flash',
  'openai/gpt-oss-120b',
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
];

/**
 * The Together models a role's call may be sent to, in order. The role is part
 * of the signature so a role-specific rule has one place to go; today every
 * role gets the whole list.
 */
export function togetherModelsForRole(
  role: ReasoningModelRole,
  models: readonly string[] = TOGETHER_BACKUP_MODELS
): string[] {
  void role;
  return [...models];
}

export interface ProviderRouteModels {
  anthropic: Readonly<Record<RouteModelClass, string>>;
  nvidia: Readonly<Record<RouteModelClass, string>>;
}

function modelsByRole(models: Readonly<Record<RouteModelClass, string>>): Record<ReasoningModelRole, string> {
  const entries = Object.entries(ROUTE_MODEL_CLASS_BY_ROLE) as Array<[ReasoningModelRole, RouteModelClass]>;
  return Object.fromEntries(entries.map(([role, size]) => [role, models[size]])) as Record<ReasoningModelRole, string>;
}

/** The Claude model each role uses when its call is sent to Anthropic. */
export function anthropicModelsByRole(
  models: Readonly<Record<RouteModelClass, string>> = ANTHROPIC_DEFAULT_MODELS
): Record<ReasoningModelRole, string> {
  return modelsByRole(models);
}

/** The NIM-hosted model each role uses when its call is sent to NVIDIA. */
export function nvidiaModelsByRole(
  models: Readonly<Record<RouteModelClass, string>> = NVIDIA_DEFAULT_MODELS
): Record<ReasoningModelRole, string> {
  return modelsByRole(models);
}

export interface ListPrice {
  readonly inputPricePer1mUsd: number;
  readonly outputPricePer1mUsd: number;
}

const FREE: ListPrice = Object.freeze({ inputPricePer1mUsd: 0, outputPricePer1mUsd: 0 });

/**
 * Anthropic's published prices, USD per million tokens, read from its pricing
 * page on 9 Oct 2026. Haiku 5.5 is priced by the length of the prompt: a
 * request whose prompt is over 100,000 tokens pays the higher pair.
 */
const ANTHROPIC_LIST_PRICES: Readonly<Record<string, { base: ListPrice; longPrompt?: { overTokens: number; price: ListPrice } }>> = {
  'claude-haiku-5-5': {
    base: { inputPricePer1mUsd: 0.1, outputPricePer1mUsd: 0.5 },
    longPrompt: { overTokens: 100_000, price: { inputPricePer1mUsd: 0.5, outputPricePer1mUsd: 2.5 } },
  },
  'claude-sonnet-5-5': { base: { inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 } },
  'claude-opus-5-5': { base: { inputPricePer1mUsd: 4, outputPricePer1mUsd: 20 } },
  'claude-fable-5-1': { base: { inputPricePer1mUsd: 10, outputPricePer1mUsd: 50 } },
};

/**
 * The published price of one Anthropic request, or `null` for a model this
 * file has no price for (the pricing table in the database is then the only
 * source, and a missing row is logged).
 */
export function anthropicListPrice(model: string, promptTokens: number): ListPrice | null {
  const entry = ANTHROPIC_LIST_PRICES[model];
  if (!entry) return null;
  if (entry.longPrompt && promptTokens > entry.longPrompt.overTokens) return entry.longPrompt.price;
  return entry.base;
}

/** NVIDIA's developer endpoints are free of charge, so a call there costs nothing. */
export function nvidiaListPrice(): ListPrice {
  return FREE;
}

/**
 * Together's published serverless prices, USD per million tokens, read from
 * `GET /v1/models` on 10 Oct 2026.
 */
const TOGETHER_LIST_PRICES: Readonly<Record<string, ListPrice>> = {
  'deepseek-ai/DeepSeek-V4.1-Flash': { inputPricePer1mUsd: 0.3, outputPricePer1mUsd: 1.2 },
  'zai-org/GLM-5.3-Flash': { inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.5 },
  'Qwen/Qwen3.8-Flash': { inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.47 },
  'openai/gpt-oss-120b': { inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.6 },
  'meta-llama/Llama-3.3-70B-Instruct-Turbo': { inputPricePer1mUsd: 1.04, outputPricePer1mUsd: 1.04 },
};

/**
 * The published price of a Together model, or `null` for a model this file
 * has no price for (the pricing table in the database is then the only
 * source, and a missing row is logged).
 */
export function togetherListPrice(model: string): ListPrice | null {
  return TOGETHER_LIST_PRICES[model] ?? null;
}

/** A provider whose prices are kept in this file and keyed by provider in `model_pricing`. */
export type ListPricedProvider = 'anthropic' | 'nvidia' | 'together';

/**
 * The key a price row uses in the `model_pricing` table for a call that went
 * to one of these providers: `anthropic:<model id>`, `nvidia:<model id>` or
 * `together:<model id>`. The provider is part of the key because two providers
 * can publish the same model id at different prices.
 */
export function providerPriceKey(provider: ListPricedProvider, model: string): string {
  return `${provider}:${model}`;
}

/** Why a provider refused a route for a reason that only a change of settings can clear. */
export type RouteConfigurationReason = 'model_needs_dedicated_endpoint' | 'key_needs_workspace_header';

/**
 * Reads a provider's 400 message for the two refusals that are about how the
 * route is set up on this server, not about the request (RJ-024):
 *
 *   - Together: "Unable to access non-serverless model ... create and start a
 *     new dedicated endpoint". The model id is not one the key can call.
 *   - Anthropic: "This API key is not scoped to a workspace, so this request
 *     must include the anthropic-workspace-id header". The key needs
 *     `ANTHROPIC_WORKSPACE_ID`, or to be replaced by a workspace key.
 *
 * Sending the same request to another provider can succeed, so the call moves
 * on. Returns `null` for any other message.
 */
export function routeConfigurationReason(message: string | undefined | null): RouteConfigurationReason | null {
  const text = message ?? '';
  if (/non-serverless model|dedicated endpoint/i.test(text)) return 'model_needs_dedicated_endpoint';
  if (/anthropic-workspace-id|not scoped to a workspace/i.test(text)) return 'key_needs_workspace_header';
  return null;
}

/** One plain sentence per reason, for the server log an administrator reads. */
export const ROUTE_CONFIGURATION_ADVICE: Readonly<Record<RouteConfigurationReason, string>> = {
  model_needs_dedicated_endpoint:
    'The provider does not serve this model without a dedicated endpoint. Replace the model id with a serverless one, or start a dedicated endpoint for it.',
  key_needs_workspace_header:
    'The API key is not tied to a workspace. Set ANTHROPIC_WORKSPACE_ID to the workspace id, or replace the key with one created inside a workspace.',
};
