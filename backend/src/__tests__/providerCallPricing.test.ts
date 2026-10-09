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
  ANTHROPIC_DEFAULT_MODELS,
  NVIDIA_DEFAULT_MODELS,
  anthropicListPrice,
  nvidiaListPrice,
  providerPriceKey,
} from '../services/openrouter/providerRoutes';
import type { ModelCallResult } from '../services/openrouter/openrouterService';

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  adminQuery: vi.fn(),
}));

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
    model: ANTHROPIC_DEFAULT_MODELS.strong,
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
  it('has a price for each default Claude model', () => {
    expect(anthropicListPrice(ANTHROPIC_DEFAULT_MODELS.fast, 2_000)).toEqual({ inputPricePer1mUsd: 0.1, outputPricePer1mUsd: 0.5 });
    expect(anthropicListPrice(ANTHROPIC_DEFAULT_MODELS.strong, 2_000)).toEqual({ inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 });
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

  it('is unchanged for OpenRouter, Hugging Face and Together calls: the row for the model id', async () => {
    const lookedUp = pricingTable({ 'deepseek/deepseek-v3.2': [0.27, 0.4] });
    for (const provider of ['openrouter', 'huggingface_inference', 'together', undefined]) {
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
          routeUsed: { model: ANTHROPIC_DEFAULT_MODELS.strong, provider: 'anthropic', position: 'cross_provider' },
          routesTried: [
            { model: 'deepseek/deepseek-v3.2', provider: 'openrouter', position: 'primary', round: 1, outcome: 'refused', classification: 'quota_exceeded', status: 402 },
            { model: ANTHROPIC_DEFAULT_MODELS.strong, provider: 'anthropic', position: 'cross_provider', round: 1, outcome: 'answered' },
          ],
        })
      )
    );

    // model, input price, output price, calculated cost, metadata
    expect(params[7]).toBe(ANTHROPIC_DEFAULT_MODELS.strong);
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
    pricingTable({ [NVIDIA_DEFAULT_MODELS.strong]: [0.6, 2.5] });
    const params = await runScope.run({ runId: null }, () =>
      insertedRow(
        result({
          model: NVIDIA_DEFAULT_MODELS.strong,
          listPrice: nvidiaListPrice(),
          routeUsed: { model: NVIDIA_DEFAULT_MODELS.strong, provider: 'nvidia', position: 'cross_provider' },
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
