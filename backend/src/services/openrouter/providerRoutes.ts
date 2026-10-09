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
 *   - `together`:   hub models. Each is sent to Hugging Face Inference first
 *                   (when `HF_TOKEN` is set) and then to Together with the
 *                   same id (when `TOGETHER_API_KEY` is set).
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
 * The key a price row uses in the `model_pricing` table for a call that went
 * to one of the added providers: `anthropic:<model id>` or `nvidia:<model id>`.
 * The provider is part of the key because two providers can publish the same
 * model id at different prices.
 */
export function providerPriceKey(provider: 'anthropic' | 'nvidia', model: string): string {
  return `${provider}:${model}`;
}
