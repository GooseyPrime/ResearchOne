/**
 * The providers a role's call may be sent to, and the order they are tried in.
 *
 * The rule (RJ-025, Brandon): a call that moves to another provider must reach
 * the SAME MODEL there — the same weights, the same model version. A different
 * model is never a backup, because each vendor trains its models differently
 * and a different model behaves differently.
 *
 * So a role's routes are: the model the role chose, then that exact model on
 * every other provider that has a key on this server and is confirmed to serve
 * it. Which provider serves which model, and under which id, is the one table
 * in this file (`SAME_MODEL_PROVIDER_TABLE`). An id is never worked out from a
 * name while a call is running.
 *
 * Providers, and the setting each one needs:
 *
 *   - OpenRouter (gateway):        `OPENROUTER_API_KEY`
 *   - Anthropic (Messages API):    `ANTHROPIC_API_KEY`. Claude models only.
 *   - Together (serverless):       `TOGETHER_API_KEY`
 *   - Hugging Face Inference:      `HF_TOKEN`
 *   - NVIDIA NIM:                  `NVIDIA_API_KEY`, optionally `NVIDIA_BASE_URL`
 *
 * A provider with no key is left out of the routes.
 *
 * Order: `MODEL_PROVIDER_ORDER`, a comma-separated list of the four names
 * below. The default is `openrouter,anthropic,together,nvidia`.
 *
 *   - `openrouter`: the OpenRouter gateway.
 *   - `anthropic`:  Anthropic, called directly.
 *   - `together`:   two providers share this place and are separate routes:
 *                   Together first, then Hugging Face Inference.
 *   - `nvidia`:     NVIDIA NIM.
 */
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

/** A provider a model call can be sent to. */
export type ModelProviderName = 'openrouter' | 'huggingface_inference' | 'together' | 'anthropic' | 'nvidia';

/** Every provider, in the order routes inside one place of `MODEL_PROVIDER_ORDER` are listed. */
export const MODEL_PROVIDER_NAMES: readonly ModelProviderName[] = [
  'openrouter',
  'anthropic',
  'together',
  'huggingface_inference',
  'nvidia',
];

/** The place each provider has in `MODEL_PROVIDER_ORDER`. Hugging Face Inference shares Together's. */
export const PROVIDER_SLOT: Readonly<Record<ModelProviderName, ProviderSlot>> = {
  openrouter: 'openrouter',
  anthropic: 'anthropic',
  together: 'together',
  huggingface_inference: 'together',
  nvidia: 'nvidia',
};

/** One model, and the id it has on each provider. */
export interface SameModelEntry {
  /** The model, named once: the hub repository for open weights, Anthropic's own name for Claude. */
  readonly name: string;
  /** True for a Claude model. Only a Claude model is ever sent to Anthropic. */
  readonly claude: boolean;
  /** The id of this exact model on each provider confirmed to serve it on the date below. */
  readonly servedBy: Readonly<Partial<Record<ModelProviderName, string>>>;
  /**
   * An id that names this model on a provider that was NOT confirmed to serve
   * it on the date below. It is here only so a role that chose that id is
   * matched to this entry. No call is ever moved onto an id in this list.
   */
  readonly notConfirmed?: Readonly<Partial<Record<ModelProviderName, string>>>;
}

/**
 * Which providers serve which model, and under which id.
 *
 * CHECKED 10 Oct 2026, from each provider's own public catalog. No key was
 * used and no model was called. Sources:
 *
 *   - OpenRouter: `GET https://openrouter.ai/api/v1/models` (458 models) and
 *     `GET https://openrouter.ai/api/v1/models/<id>/endpoints`. A model counts
 *     as served when it is in the list and has at least one endpoint.
 *   - Hugging Face Inference: the model's Inference Providers mapping,
 *     `GET https://huggingface.co/api/models/<repo>?expand[]=inferenceProviderMapping`
 *     (the data behind the "Inference Providers" box on the model page). A
 *     model counts as served when at least one provider is `live`.
 *   - Together: the serverless chat list at
 *     `https://docs.together.ai/docs/serverless-models` (18 chat models).
 *     `GET /v1/models` needs a key, so the published list was read instead.
 *   - NVIDIA NIM: `GET https://integrate.api.nvidia.com/v1/models` (80 models).
 *   - Anthropic: `https://platform.claude.com/docs/en/about-claude/model-deprecations`
 *     (status per model id) and `.../about-claude/pricing`.
 *
 * What the catalogs showed for the models the roles choose:
 *
 *   - Together serves none of them. Its list has newer versions of the same
 *     lines (Kimi K3, DeepSeek V4.x, Qwen3.x), which are different models.
 *   - NVIDIA NIM serves none of them (it lists `moonshotai/kimi-k2.6` and
 *     `kimi-k3`, `deepseek-ai/deepseek-v4.1-flash`: different models).
 *   - Hermes 4 70B: OpenRouter still knows the id `nousresearch/hermes-4-70b`
 *     but lists it with no endpoint and leaves it out of its model list, so
 *     it is not confirmed there. Hugging Face Inference serves it.
 *   - Claude Sonnet 4 (`claude-sonnet-4-20250514`) was retired by Anthropic on
 *     15 Jun 2026; OpenRouter still lists it. Claude Haiku 3.5 is retired at
 *     Anthropic and gone from OpenRouter's list.
 *   - Claude Sonnet 4.5 is deprecated at Anthropic and is served until
 *     30 Nov 2026. Remove its `anthropic` id on that date.
 *
 * A model that is not in this table is served by the one provider its id
 * belongs to, and has no other route.
 *
 * Adding a row or an id: confirm it in the provider's own catalog first, and
 * change the date and the notes above. Do not add an id you could not confirm.
 */
export const SAME_MODEL_PROVIDER_TABLE: readonly SameModelEntry[] = [
  {
    name: 'moonshotai/Kimi-K2-Thinking',
    claude: false,
    servedBy: {
      openrouter: 'moonshotai/kimi-k2-thinking',
      huggingface_inference: 'moonshotai/Kimi-K2-Thinking',
    },
  },
  {
    name: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    claude: false,
    servedBy: {
      openrouter: 'qwen/qwen3-235b-a22b-thinking-2507',
      huggingface_inference: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    },
  },
  {
    name: 'deepseek-ai/DeepSeek-R1-0528',
    claude: false,
    servedBy: {
      openrouter: 'deepseek/deepseek-r1-0528',
      huggingface_inference: 'deepseek-ai/DeepSeek-R1-0528',
    },
  },
  {
    name: 'deepseek-ai/DeepSeek-V3.2',
    claude: false,
    servedBy: {
      openrouter: 'deepseek/deepseek-v3.2',
      huggingface_inference: 'deepseek-ai/DeepSeek-V3.2',
    },
  },
  {
    name: 'NousResearch/Hermes-4-70B',
    claude: false,
    servedBy: { huggingface_inference: 'NousResearch/Hermes-4-70B' },
    notConfirmed: { openrouter: 'nousresearch/hermes-4-70b' },
  },
  {
    name: 'NousResearch/Hermes-3-Llama-3.1-70B',
    claude: false,
    servedBy: {
      openrouter: 'nousresearch/hermes-3-llama-3.1-70b',
      huggingface_inference: 'NousResearch/Hermes-3-Llama-3.1-70B',
    },
  },
  {
    name: 'deepseek-ai/DeepSeek-V3.1',
    claude: false,
    servedBy: {
      openrouter: 'deepseek/deepseek-chat-v3.1',
      huggingface_inference: 'deepseek-ai/DeepSeek-V3.1',
    },
  },
  {
    name: 'deepseek-ai/DeepSeek-R1',
    claude: false,
    servedBy: {
      openrouter: 'deepseek/deepseek-r1',
      huggingface_inference: 'deepseek-ai/DeepSeek-R1',
    },
  },
  {
    name: 'deepseek-ai/DeepSeek-V3',
    claude: false,
    servedBy: {
      openrouter: 'deepseek/deepseek-chat',
      huggingface_inference: 'deepseek-ai/DeepSeek-V3',
    },
  },
  {
    name: 'meta-llama/Llama-3.3-70B-Instruct',
    claude: false,
    servedBy: {
      openrouter: 'meta-llama/llama-3.3-70b-instruct',
      huggingface_inference: 'meta-llama/Llama-3.3-70B-Instruct',
    },
  },
  {
    name: 'Claude Sonnet 4.5',
    claude: true,
    servedBy: {
      openrouter: 'anthropic/claude-sonnet-4.5',
      anthropic: 'claude-sonnet-4-5-20250929',
    },
  },
  {
    name: 'Claude Opus 4.7',
    claude: true,
    servedBy: {
      openrouter: 'anthropic/claude-opus-4.7',
      anthropic: 'claude-opus-4-7',
    },
  },
  {
    name: 'Claude Sonnet 4',
    claude: true,
    servedBy: { openrouter: 'anthropic/claude-sonnet-4' },
    notConfirmed: { anthropic: 'claude-sonnet-4-20250514' },
  },
];

/** The table entry for an id on a provider, or `null` when the model is not in the table. */
export function sameModelEntryFor(provider: ModelProviderName, modelId: string): SameModelEntry | null {
  const id = modelId.trim();
  return (
    SAME_MODEL_PROVIDER_TABLE.find(
      (entry) => entry.servedBy[provider] === id || entry.notConfirmed?.[provider] === id
    ) ?? null
  );
}

/** One provider and the id the model has there. */
export interface ProviderModelId {
  provider: ModelProviderName;
  model: string;
}

/**
 * Every provider confirmed to serve the model a role chose, the role's own
 * provider included when it is confirmed. A model that is not in the table is
 * taken to be served by the provider its id belongs to, and by no other.
 *
 * Anthropic is returned only for a Claude model. This is checked here as well
 * as in the table, so a wrong row cannot send another vendor's model there.
 */
export function providersServingModel(chosen: ProviderModelId): ProviderModelId[] {
  const entry = sameModelEntryFor(chosen.provider, chosen.model);
  if (!entry) return [{ provider: chosen.provider, model: chosen.model.trim() }];
  const serving: ProviderModelId[] = [];
  for (const provider of MODEL_PROVIDER_NAMES) {
    const model = entry.servedBy[provider];
    if (!model) continue;
    if (provider === 'anthropic' && !entry.claude) continue;
    serving.push({ provider, model });
  }
  return serving;
}

/**
 * The other providers a call for this model may be moved to: the same model,
 * on each provider that serves it and has a key on this server. The role's own
 * provider is not in the list. The result is in `MODEL_PROVIDER_NAMES` order;
 * the caller puts it in the server's `MODEL_PROVIDER_ORDER`.
 */
export function sameModelRoutesOnOtherProviders(
  chosen: ProviderModelId,
  hasKey: Readonly<Record<ModelProviderName, boolean>>
): ProviderModelId[] {
  return providersServingModel(chosen).filter((route) => route.provider !== chosen.provider && hasKey[route.provider]);
}

/** Whether two ids, each on its own provider, are the same model according to the table. */
export function isSameModel(a: ProviderModelId, b: ProviderModelId): boolean {
  if (a.provider === b.provider && a.model.trim() === b.model.trim()) return true;
  const entry = sameModelEntryFor(a.provider, a.model);
  return entry !== null && entry === sameModelEntryFor(b.provider, b.model);
}

/** The table's name for a model, or the id itself when the model is not in the table. */
export function sameModelName(chosen: ProviderModelId): string {
  return sameModelEntryFor(chosen.provider, chosen.model)?.name ?? chosen.model.trim();
}

export interface ListPrice {
  readonly inputPricePer1mUsd: number;
  readonly outputPricePer1mUsd: number;
}

const FREE: ListPrice = Object.freeze({ inputPricePer1mUsd: 0, outputPricePer1mUsd: 0 });

/**
 * Anthropic's published prices, USD per million tokens, read from its pricing
 * page on 9 Oct 2026 (Sonnet 4.5 and Opus 4.7 on 10 Oct 2026, RJ-025). Haiku
 * 5.5 is priced by the length of the prompt: a request whose prompt is over
 * 100,000 tokens pays the higher pair.
 */
const ANTHROPIC_LIST_PRICES: Readonly<Record<string, { base: ListPrice; longPrompt?: { overTokens: number; price: ListPrice } }>> = {
  'claude-haiku-5-5': {
    base: { inputPricePer1mUsd: 0.1, outputPricePer1mUsd: 0.5 },
    longPrompt: { overTokens: 100_000, price: { inputPricePer1mUsd: 0.5, outputPricePer1mUsd: 2.5 } },
  },
  'claude-sonnet-5-5': { base: { inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 } },
  'claude-opus-5-5': { base: { inputPricePer1mUsd: 4, outputPricePer1mUsd: 20 } },
  'claude-fable-5-1': { base: { inputPricePer1mUsd: 10, outputPricePer1mUsd: 50 } },
  'claude-sonnet-4-5-20250929': { base: { inputPricePer1mUsd: 3, outputPricePer1mUsd: 15 } },
  'claude-opus-4-7': { base: { inputPricePer1mUsd: 5, outputPricePer1mUsd: 25 } },
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
 * `GET /v1/models` on 10 Oct 2026. No role's model is served by Together today
 * (see the table above), so no call reaches these; they stay so that a
 * Together call is still priced by `together:<model id>` when a row is added
 * to the table.
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
