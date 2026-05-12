/**
 * Pricing catalog — model id → (input USD/1M, output USD/1M).
 *
 * Reads from the `model_pricing` table seeded by migration 030.
 * Caches lookups in-process for 60 seconds. Pricing edits in the
 * table do not require a redeploy — they propagate within one TTL.
 *
 * Per Cursor rule 25 (I-5): models not in the table resolve to (0, 0)
 * and we log at WARN. The agent_executions row is still written so
 * operators see "we used model X 14,200 tokens but no price configured."
 *
 * Per Cursor rule 25 (I-6): on Postgres 42P01 (relation does not exist
 * — migration 030 not yet applied), we return (0, 0) silently. Deploy-skew
 * during rollout is a known-tolerable state.
 */
import { adminQuery } from '../../db/pool';
import { logger } from '../../utils/logger';

export interface ModelPrice {
  readonly inputPricePer1mUsd: number;
  readonly outputPricePer1mUsd: number;
}

interface CacheEntry {
  price: ModelPrice;
  loadedAt: number;
}

const ZERO_PRICE: ModelPrice = Object.freeze({
  inputPricePer1mUsd: 0,
  outputPricePer1mUsd: 0,
});

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();
const unknownModelsLogged = new Set<string>();

/**
 * Look up the current price for a model. Best-effort and non-throwing.
 *
 * Cache hit if loaded within TTL. Cache miss queries the active row in
 * `model_pricing` (effective_until IS NULL, latest effective_from).
 *
 * @param model — exact model id as returned by ModelCallResult.model.
 */
export async function getModelPrice(model: string): Promise<ModelPrice> {
  if (!model) return ZERO_PRICE;

  const cached = cache.get(model);
  if (cached && Date.now() - cached.loadedAt < TTL_MS) {
    return cached.price;
  }

  try {
    const rows = await adminQuery<{
      input_price_per_1m_usd: string;
      output_price_per_1m_usd: string;
    }>(
      `SELECT input_price_per_1m_usd, output_price_per_1m_usd
         FROM model_pricing
        WHERE model = $1 AND effective_until IS NULL
        ORDER BY effective_from DESC
        LIMIT 1`,
      [model]
    );

    if (rows.length === 0) {
      if (!unknownModelsLogged.has(model)) {
        unknownModelsLogged.add(model);
        logger.warn('cost-sidecar: no price configured for model', { model });
      }
      cache.set(model, { price: ZERO_PRICE, loadedAt: Date.now() });
      return ZERO_PRICE;
    }

    const price: ModelPrice = Object.freeze({
      inputPricePer1mUsd: Number(rows[0].input_price_per_1m_usd),
      outputPricePer1mUsd: Number(rows[0].output_price_per_1m_usd),
    });
    cache.set(model, { price, loadedAt: Date.now() });
    return price;
  } catch (err) {
    // Migration 030 not yet applied — deploy-skew tolerance per rule 13.
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      logger.debug('cost-sidecar: model_pricing table missing (migration 030 pending)');
      cache.set(model, { price: ZERO_PRICE, loadedAt: Date.now() });
      return ZERO_PRICE;
    }
    // Any other error: log at DEBUG and continue with zero price.
    // We do NOT want a transient DB hiccup to escalate to ERROR-level
    // noise; the row is still written via emitCallTelemetry with the
    // cached price (or zero) and the operator can backfill.
    logger.debug('cost-sidecar: pricing lookup failed', { model, err });
    cache.set(model, { price: ZERO_PRICE, loadedAt: Date.now() });
    return ZERO_PRICE;
  }
}

/**
 * Compute cost for a given usage tuple. Pure function — no side effects.
 *
 * cost = (inputTokens / 1e6) * inputPrice + (outputTokens / 1e6) * outputPrice
 */
export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  price: ModelPrice
): number {
  const inCost = (inputTokens / 1_000_000) * price.inputPricePer1mUsd;
  const outCost = (outputTokens / 1_000_000) * price.outputPricePer1mUsd;
  return inCost + outCost;
}

/**
 * Test helper — clears the cache. Do not call in production code paths.
 * @internal
 */
export function _resetPricingCache(): void {
  cache.clear();
  unknownModelsLogged.clear();
}
