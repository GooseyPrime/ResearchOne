/**
 * RJ-021. A model call is costed at the price of the provider that answered it.
 *
 * Two providers can publish the same model id at different prices, and NVIDIA's
 * developer endpoints are free. Before this, cost tracking looked a price up by
 * model id alone, so a Claude model called directly had no price at all (its
 * id is not the gateway's id) and a free NVIDIA call could be costed at a paid
 * provider's price for a model of the same name.
 *
 * Only the database is replaced here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as poolMod from '../db/pool';
import { emitCallTelemetry, runScope } from '../services/telemetry';
import { _resetPricingCache, computeCostUsd, getCallPrice } from '../services/telemetry/pricingCatalog';
import {
  SAME_MODEL_PROVIDER_TABLE,
  anthropicListPrice,
  nvidiaListPrice,
  providerPriceKey,
  togetherListPrice,
} from '../services/openrouter/providerRoutes';
import type { ModelCallResult } from '../services/openrouter/openrouterService';

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  adminQuery: vi.fn(),
}));

/**
 * RJ-025 removed the size-class tables these ids came from. The ids stay here
 * because the prices kept for them are still what a call to them is costed at.
 */
const CLAUDE_FAST = 'claude-haiku-5-5';
const CLAUDE_STRONG = 'claude-sonnet-5-5';
const NVIDIA_MODEL = 'moonshotai/kimi-k3';
const TOGETHER_PRICED_MODELS = [
  'deepseek-ai/DeepSeek-V4.1-Flash',
  'zai-org/GLM-5.3-Flash',
  'Qwen/Qwen3.8-Flash',
  'openai/gpt-oss-120b',
  'meta-llama/Llama-3.3-70B-Instruct-Turbo',
];

const adminQuery = poolMod.adminQuery as unknown as ReturnType<typeof vi.fn>;

/** The pricing table, as rows keyed by the `model` column. */
function pricingTable(rows: Record<string, [number, number]>): string[] {
  const lookedUp: string[] = [];
  adminQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (!sql.includes('FROM model_pricing')) return [];
    const key = String(params[0]);
    lookedUp.push(key);
    const row = rows[key];
    return row ? [{ input_price_per_1m_usd: String(row[0]), output_price_per_1m_usd: String(row[1]) }] : [];
  });
  return lookedUp;
}

function result(overrides: Partial<ModelCallResult>): ModelCallResult {
  return {
    content: 'text',
    model: CLAUDE_STRONG,
    role: 'section_drafter',
    promptTokens: 1_000_000,
    completionTokens: 100_000,
    durationMs: 10,
    usedFallback: true,
    primaryModel: 'deepseek/deepseek-v3.2',
    ...overrides,
  };
}

async function insertedRow(emitted: ModelCallResult): Promise<unknown[]> {
  emitCallTelemetry(emitted, { role: emitted.role, startedAtMs: 1_760_000_000_000 });
  await vi.waitFor(
    () => {
      expect(adminQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO agent_executions'))).toBe(true);
    },
    { timeout: 10_000 }
  );
  const call = adminQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO agent_executions'));
  return call?.[1] as unknown[];
}

beforeEach(() => {
  adminQuery.mockReset();
  _resetPricingCache();
});

describe('the published prices kept for the added providers', () => {
  it('has a price for the Claude models priced before RJ-025', () => {
    expect(anthropicListPrice(CLAUDE_FAST, 2_000)).toEqual({ inputPricePer1mUsd: 0.1, outputPricePer1mUsd: 0.5 });
    expect(anthropicListPrice(CLAUDE_STRONG, 2_000)).toEqual({ inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 });
  });

  it('prices the low-cost Claude model higher for a prompt over 100,000 tokens, as Anthropic does', () => {
    expect(anthropicListPrice('claude-haiku-5-5', 100_000)).toEqual({ inputPricePer1mUsd: 0.1, outputPricePer1mUsd: 0.5 });
    expect(anthropicListPrice('claude-haiku-5-5', 100_001)).toEqual({ inputPricePer1mUsd: 0.5, outputPricePer1mUsd: 2.5 });
    expect(anthropicListPrice('claude-sonnet-5-5', 500_000)).toEqual({ inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 });
  });

  it('has no made-up price for a model it does not know', () => {
    expect(anthropicListPrice('claude-not-a-model', 10)).toBeNull();
  });

  it('prices every NVIDIA call at nothing', () => {
    expect(nvidiaListPrice()).toEqual({ inputPricePer1mUsd: 0, outputPricePer1mUsd: 0 });
  });
});

describe('the price a call is costed at', () => {
  it('is the published price for an Anthropic call when the pricing table has no row for it', async () => {
    const lookedUp = pricingTable({});
    const price = await getCallPrice({ model: 'claude-sonnet-5-5', provider: 'anthropic', listPrice: { inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 } });
    expect(price).toEqual({ inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 });
    expect(lookedUp).toEqual([providerPriceKey('anthropic', 'claude-sonnet-5-5')]);
  });

  it('is the pricing table row keyed by provider and model when an operator has added one', async () => {
    pricingTable({ 'anthropic:claude-sonnet-5-5': [1.5, 7.5] });
    const price = await getCallPrice({ model: 'claude-sonnet-5-5', provider: 'anthropic', listPrice: { inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 } });
    expect(price).toEqual({ inputPricePer1mUsd: 1.5, outputPricePer1mUsd: 7.5 });
  });

  it('is nothing for an NVIDIA call, even when another provider has a paid price for the same model id', async () => {
    pricingTable({ 'openai/gpt-oss-20b': [0.05, 0.2] });
    const nvidia = await getCallPrice({ model: 'openai/gpt-oss-20b', provider: 'nvidia', listPrice: nvidiaListPrice() });
    const gateway = await getCallPrice({ model: 'openai/gpt-oss-20b', provider: 'openrouter' });
    expect(nvidia).toEqual({ inputPricePer1mUsd: 0, outputPricePer1mUsd: 0 });
    expect(gateway).toEqual({ inputPricePer1mUsd: 0.05, outputPricePer1mUsd: 0.2 });
  });

  it('is unchanged for OpenRouter and Hugging Face calls: the row for the model id', async () => {
    const lookedUp = pricingTable({ 'deepseek/deepseek-v3.2': [0.27, 0.4] });
    for (const provider of ['openrouter', 'huggingface_inference', undefined]) {
      expect(await getCallPrice({ model: 'deepseek/deepseek-v3.2', provider })).toEqual({ inputPricePer1mUsd: 0.27, outputPricePer1mUsd: 0.4 });
    }
    expect(new Set(lookedUp)).toEqual(new Set(['deepseek/deepseek-v3.2']));
  });
});

describe('the cost row written for a call', () => {
  it('costs an Anthropic call at Anthropic prices and records the provider and the route', async () => {
    pricingTable({});
    const params = await runScope.run({ runId: null }, () =>
      insertedRow(
        result({
          listPrice: { inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 },
          routeUsed: { model: CLAUDE_STRONG, provider: 'anthropic', position: 'cross_provider' },
          routesTried: [
            { model: 'deepseek/deepseek-v3.2', provider: 'openrouter', position: 'primary', round: 1, outcome: 'refused', classification: 'quota_exceeded', status: 402 },
            { model: CLAUDE_STRONG, provider: 'anthropic', position: 'cross_provider', round: 1, outcome: 'answered' },
          ],
        })
      )
    );

    // model, input price, output price, calculated cost, metadata
    expect(params[7]).toBe(CLAUDE_STRONG);
    expect(params[15]).toBe(2);
    expect(params[16]).toBe(10);
    expect(params[17]).toBeCloseTo(computeCostUsd(1_000_000, 100_000, { inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 }), 6);
    expect(params[17]).toBeCloseTo(3, 6);
    expect(JSON.parse(String(params[19]))).toEqual({
      primary_model: 'deepseek/deepseek-v3.2',
      provider: 'anthropic',
      route_position: 'cross_provider',
      routes_refused: 1,
    });
  });

  it('costs an NVIDIA call at nothing', async () => {
    pricingTable({ [NVIDIA_MODEL]: [0.6, 2.5] });
    const params = await runScope.run({ runId: null }, () =>
      insertedRow(
        result({
          model: NVIDIA_MODEL,
          listPrice: nvidiaListPrice(),
          routeUsed: { model: NVIDIA_MODEL, provider: 'nvidia', position: 'cross_provider' },
        })
      )
    );

    expect(params[17]).toBe(0);
    expect(JSON.parse(String(params[19])).provider).toBe('nvidia');
  });

  it('still costs an OpenRouter call from the pricing table row for its model', async () => {
    pricingTable({ 'deepseek/deepseek-v3.2': [0.27, 0.4] });
    const params = await runScope.run({ runId: null }, () =>
      insertedRow(
        result({
          model: 'deepseek/deepseek-v3.2',
          usedFallback: false,
          routeUsed: { model: 'deepseek/deepseek-v3.2', provider: 'openrouter', position: 'primary' },
        })
      )
    );

    expect(params[15]).toBe(0.27);
    expect(params[17]).toBeCloseTo(0.27 + 0.04, 6);
  });
});

describe('the published prices kept for Together (RJ-024)', () => {
  it('still has the price read from Together for each model priced in RJ-024', () => {
    expect(Object.fromEntries(TOGETHER_PRICED_MODELS.map((model) => [model, togetherListPrice(model)]))).toEqual({
      'deepseek-ai/DeepSeek-V4.1-Flash': { inputPricePer1mUsd: 0.3, outputPricePer1mUsd: 1.2 },
      'zai-org/GLM-5.3-Flash': { inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.5 },
      'Qwen/Qwen3.8-Flash': { inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.47 },
      'openai/gpt-oss-120b': { inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.6 },
      'meta-llama/Llama-3.3-70B-Instruct-Turbo': { inputPricePer1mUsd: 1.04, outputPricePer1mUsd: 1.04 },
    });
  });

  it('has no made-up price for a model it does not know', () => {
    expect(togetherListPrice('deepseek-ai/DeepSeek-V3.1')).toBeNull();
  });

  it('costs a Together call at the published price when the pricing table has no row for it', async () => {
    const lookedUp = pricingTable({});
    const model = 'openai/gpt-oss-120b';
    const price = await getCallPrice({ model, provider: 'together', listPrice: togetherListPrice(model) });
    expect(price).toEqual({ inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.6 });
    expect(lookedUp).toEqual([providerPriceKey('together', model)]);
  });

  it('does not cost a Together call at another provider price for a model of the same name', async () => {
    pricingTable({ 'openai/gpt-oss-120b': [9, 9] });
    const model = 'openai/gpt-oss-120b';
    const together = await getCallPrice({ model, provider: 'together', listPrice: togetherListPrice(model) });
    expect(together).toEqual({ inputPricePer1mUsd: 0.15, outputPricePer1mUsd: 0.6 });
  });

  it('uses the pricing table row keyed together:<model> when an operator has added one', async () => {
    pricingTable({ 'together:zai-org/GLM-5.3-Flash': [0.1, 0.4] });
    const model = 'zai-org/GLM-5.3-Flash';
    expect(await getCallPrice({ model, provider: 'together', listPrice: togetherListPrice(model) })).toEqual({
      inputPricePer1mUsd: 0.1,
      outputPricePer1mUsd: 0.4,
    });
  });

  it('falls back to the row for the model id for a Together model this file has no price for', async () => {
    pricingTable({ 'some/other-model': [0.2, 0.3] });
    expect(await getCallPrice({ model: 'some/other-model', provider: 'together' })).toEqual({ inputPricePer1mUsd: 0.2, outputPricePer1mUsd: 0.3 });
  });
});

describe('prices are keyed by provider and model (RJ-025)', () => {
  it('builds the key as <provider>:<model id>', () => {
    expect(providerPriceKey('anthropic', 'claude-opus-4-7')).toBe('anthropic:claude-opus-4-7');
    expect(providerPriceKey('together', 'openai/gpt-oss-120b')).toBe('together:openai/gpt-oss-120b');
    expect(providerPriceKey('nvidia', 'moonshotai/kimi-k3')).toBe('nvidia:moonshotai/kimi-k3');
  });

  it('has a published price for every Claude id the provider table sends to Anthropic', () => {
    const anthropicIds = SAME_MODEL_PROVIDER_TABLE.map((entry) => entry.servedBy.anthropic).filter((id): id is string => Boolean(id));
    expect(anthropicIds.sort()).toEqual(['claude-opus-4-7', 'claude-sonnet-4-5-20250929']);
    expect(anthropicListPrice('claude-sonnet-4-5-20250929', 2_000)).toEqual({ inputPricePer1mUsd: 3, outputPricePer1mUsd: 15 });
    expect(anthropicListPrice('claude-opus-4-7', 2_000)).toEqual({ inputPricePer1mUsd: 5, outputPricePer1mUsd: 25 });
  });

  it('costs the same Claude model at Anthropic prices on Anthropic and at the gateway row on OpenRouter', async () => {
    pricingTable({ 'anthropic/claude-opus-4.7': [5.5, 27] });
    const direct = await getCallPrice({ model: 'claude-opus-4-7', provider: 'anthropic', listPrice: anthropicListPrice('claude-opus-4-7', 10) });
    const gateway = await getCallPrice({ model: 'anthropic/claude-opus-4.7', provider: 'openrouter' });
    expect(direct).toEqual({ inputPricePer1mUsd: 5, outputPricePer1mUsd: 25 });
    expect(gateway).toEqual({ inputPricePer1mUsd: 5.5, outputPricePer1mUsd: 27 });
  });

  it('costs a same-model Hugging Face call from the row keyed huggingface_inference:<hub id> when there is one', async () => {
    pricingTable({ 'huggingface_inference:deepseek-ai/DeepSeek-V3.2': [0.26, 0.38], 'deepseek/deepseek-v3.2': [0.27, 0.4] });
    const price = await getCallPrice({ model: 'deepseek-ai/DeepSeek-V3.2', provider: 'huggingface_inference', sameModelAs: 'deepseek/deepseek-v3.2' });
    expect(price).toEqual({ inputPricePer1mUsd: 0.26, outputPricePer1mUsd: 0.38 });
  });

  it('otherwise costs it at the price of the role own id for the same model, so the call is not recorded as free', async () => {
    const lookedUp = pricingTable({ 'deepseek/deepseek-v3.2': [0.27, 0.4] });
    const price = await getCallPrice({ model: 'deepseek-ai/DeepSeek-V3.2', provider: 'huggingface_inference', sameModelAs: 'deepseek/deepseek-v3.2' });
    expect(price).toEqual({ inputPricePer1mUsd: 0.27, outputPricePer1mUsd: 0.4 });
    expect(lookedUp).toEqual(['huggingface_inference:deepseek-ai/DeepSeek-V3.2', 'deepseek-ai/DeepSeek-V3.2', 'deepseek/deepseek-v3.2']);
  });

  it('writes the cost row of a same-model Hugging Face call with that price and the provider that answered', async () => {
    pricingTable({ 'deepseek/deepseek-v3.2': [0.27, 0.4] });
    const params = await runScope.run({ runId: null }, () =>
      insertedRow(
        result({
          model: 'deepseek-ai/DeepSeek-V3.2',
          primaryModel: 'deepseek/deepseek-v3.2',
          routeUsed: { model: 'deepseek-ai/DeepSeek-V3.2', provider: 'huggingface_inference', position: 'cross_provider' },
        })
      )
    );

    expect(params[7]).toBe('deepseek-ai/DeepSeek-V3.2');
    expect(params[15]).toBe(0.27);
    expect(params[16]).toBe(0.4);
    expect(JSON.parse(String(params[19])).provider).toBe('huggingface_inference');
  });
});
