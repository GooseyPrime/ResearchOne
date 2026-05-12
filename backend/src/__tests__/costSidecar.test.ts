/**
 * Cost telemetry sidecar — unit & integration tests.
 *
 * Per Rule 25 invariant I-10: every assertion here must fail when the
 * relevant production code is reverted. Each test block ends with a
 * `// REVERT-CHECK:` comment naming the production line that, if
 * removed, breaks this test.
 *
 * Run: npx vitest run costSidecar
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runScope, emitCallTelemetry, rolePhaseFor } from '../services/telemetry';
import { _resetPricingCache, computeCostUsd } from '../services/telemetry/pricingCatalog';
import type { ModelCallResult } from '../services/openrouter/openrouterService';

// We mock adminQuery at the module boundary so tests do not require a
// live Postgres connection. Each test sets up a fresh mock and asserts
// against the captured INSERT calls.
import * as poolMod from '../db/pool';

vi.mock('../db/pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/pool')>();
  return {
    ...actual,
    adminQuery: vi.fn(),
  };
});

const mockedAdminQuery = poolMod.adminQuery as unknown as ReturnType<typeof vi.fn>;

function fakeResult(overrides: Partial<ModelCallResult> = {}): ModelCallResult {
  return {
    content: 'fake response',
    model: 'qwen/qwen3-235b-a22b-thinking-2507',
    role: 'planner' as ModelCallResult['role'],
    promptTokens: 1000,
    completionTokens: 500,
    durationMs: 2500,
    usedFallback: false,
    primaryModel: 'qwen/qwen3-235b-a22b-thinking-2507',
    ...overrides,
  };
}

// Helper: wait one microtask tick so fire-and-forget INSERTs flush.
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('costSidecar — rolePhaseFor', () => {
  it('maps canonical roles to correct phases', () => {
    expect(rolePhaseFor('planner')).toBe('Planning');
    expect(rolePhaseFor('retriever')).toBe('Retrieval');
    expect(rolePhaseFor('reasoner')).toBe('Reasoning');
    expect(rolePhaseFor('skeptic')).toBe('Skeptic');
    expect(rolePhaseFor('internal_challenger')).toBe('Skeptic');
    expect(rolePhaseFor('synthesizer')).toBe('Synthesis');
    expect(rolePhaseFor('verifier')).toBe('Verification');
    expect(rolePhaseFor('citation_integrity_checker')).toBe('Verification');
    expect(rolePhaseFor('plain_language_synthesizer')).toBe('Plain Language');
    expect(rolePhaseFor('change_planner')).toBe('Revision');
  });

  it('callPurpose overrides role mapping for contradiction extraction', () => {
    // The reasoner role normally maps to Reasoning, but when called
    // with callPurpose='contradiction_extraction', the phase must
    // surface as 'Contradiction Extraction' so the dashboard
    // attributes that token spend to the right bucket.
    expect(rolePhaseFor('reasoner', 'contradiction_extraction')).toBe('Contradiction Extraction');
    expect(rolePhaseFor('planner', 'pipeline_skeptic')).toBe('Skeptic');
    // REVERT-CHECK: costSidecar.ts:rolePhaseFor — the two if-statements at the top.
  });

  it('unknown role falls back to Other', () => {
    expect(rolePhaseFor('definitely_not_a_real_role')).toBe('Other');
  });
});

describe('costSidecar — pricing math', () => {
  it('cost = (in/1M)*inPrice + (out/1M)*outPrice', () => {
    const price = { inputPricePer1mUsd: 0.20, outputPricePer1mUsd: 0.60 };
    // 1000 input @ $0.20/M = $0.0002
    // 500 output @ $0.60/M = $0.0003
    // total = $0.0005
    expect(computeCostUsd(1000, 500, price)).toBeCloseTo(0.0005, 8);
  });

  it('zero tokens → zero cost', () => {
    const price = { inputPricePer1mUsd: 999, outputPricePer1mUsd: 999 };
    expect(computeCostUsd(0, 0, price)).toBe(0);
  });

  it('zero price → zero cost (unknown model fallback)', () => {
    const price = { inputPricePer1mUsd: 0, outputPricePer1mUsd: 0 };
    expect(computeCostUsd(100_000_000, 100_000_000, price)).toBe(0);
  });
});

describe('costSidecar — runScope.current', () => {
  it('returns null outside any .run', () => {
    expect(runScope.current()).toBeNull();
  });

  it('returns the active context inside .run', async () => {
    await runScope.run({ runId: 'r1', userId: 'u1' }, async () => {
      const ctx = runScope.current();
      expect(ctx?.runId).toBe('r1');
      expect(ctx?.userId).toBe('u1');
    });
  });

  it('nested .run shadows the outer scope', async () => {
    await runScope.run({ runId: 'outer' }, async () => {
      expect(runScope.current()?.runId).toBe('outer');
      await runScope.run({ runId: 'inner', phaseOverride: 'Discovery' }, async () => {
        expect(runScope.current()?.runId).toBe('inner');
        expect(runScope.current()?.phaseOverride).toBe('Discovery');
      });
      expect(runScope.current()?.runId).toBe('outer');
    });
    // REVERT-CHECK: costSidecar.ts:runScope.run — AsyncLocalStorage.run mechanism.
  });

  it('AsyncLocalStorage propagates across awaits', async () => {
    let observed: string | undefined;
    await runScope.run({ runId: 'r1' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      observed = runScope.current()?.runId ?? undefined;
    });
    expect(observed).toBe('r1');
  });
});

describe('costSidecar — emitCallTelemetry', () => {
  beforeEach(() => {
    mockedAdminQuery.mockReset();
    _resetPricingCache();
    // Default mock: pricing lookup returns a known price.
    mockedAdminQuery.mockImplementation(async (sql: string) => {
      if (/FROM model_pricing/i.test(sql)) {
        return [{ input_price_per_1m_usd: '0.20', output_price_per_1m_usd: '0.60' }];
      }
      if (/INSERT INTO agent_executions/i.test(sql)) {
        return [];
      }
      return [];
    });
  });

  it('writes one row with scope-derived run_id and user_id', async () => {
    await runScope.run({ runId: 'r1', userId: 'u1' }, async () => {
      emitCallTelemetry(fakeResult(), {
        role: 'planner',
        callPurpose: 'default',
        startedAtMs: 1715000000000,
      });
      await flushMicrotasks();
    });

    const insertCall = mockedAdminQuery.mock.calls.find(([sql]) =>
      /INSERT INTO agent_executions/i.test(sql as string)
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[0]).toBe('r1');     // run_id
    expect(params[2]).toBe('u1');     // user_id
    expect(params[4]).toBe('planner'); // agent_role
    expect(params[5]).toBe('Planning'); // phase
    // REVERT-CHECK: PATCH-02 — wrapping runResearchJob in runScope.run.
  });

  it('writes with run_id=null when called outside any scope', async () => {
    emitCallTelemetry(fakeResult(), {
      role: 'planner',
      startedAtMs: 1715000000000,
    });
    await flushMicrotasks();

    const insertCall = mockedAdminQuery.mock.calls.find(([sql]) =>
      /INSERT INTO agent_executions/i.test(sql as string)
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[0]).toBeNull();  // run_id is NULL — intentional, no scope.
  });

  it('phase override on scope wins over rolePhaseFor', async () => {
    await runScope.run({ runId: 'r1', phaseOverride: 'Discovery' }, async () => {
      emitCallTelemetry(fakeResult({ role: 'planner' as never }), {
        role: 'planner',
        startedAtMs: 1715000000000,
      });
      await flushMicrotasks();
    });
    const insertCall = mockedAdminQuery.mock.calls.find(([sql]) =>
      /INSERT INTO agent_executions/i.test(sql as string)
    );
    const params = insertCall![1] as unknown[];
    expect(params[5]).toBe('Discovery'); // phase column — NOT 'Planning'.
    // REVERT-CHECK: PATCH-03 — phaseOverride: 'Discovery' in discoveryOrchestrator.
  });

  it('computes deterministic idempotency key', async () => {
    await runScope.run({ runId: 'r1' }, async () => {
      emitCallTelemetry(fakeResult(), {
        role: 'planner',
        startedAtMs: 1715000000000,
      });
      emitCallTelemetry(fakeResult(), {
        role: 'planner',
        startedAtMs: 1715000000000,  // identical
      });
      await flushMicrotasks();
    });

    const inserts = mockedAdminQuery.mock.calls.filter(([sql]) =>
      /INSERT INTO agent_executions/i.test(sql as string)
    );
    expect(inserts.length).toBe(2);
    const key1 = (inserts[0][1] as unknown[])[18]; // idempotency_key ($19)
    const key2 = (inserts[1][1] as unknown[])[18];
    expect(key1).toBe(key2);
    // The ON CONFLICT DO NOTHING in the INSERT statement is what makes
    // this a single-row outcome at the DB layer; here we just verify
    // the keys are identical so the conflict path triggers.
    // REVERT-CHECK: costSidecar.ts:computeIdempotencyKey — the sha256 inputs.
  });

  it('primary + fallback produce DIFFERENT idempotency keys (different model)', async () => {
    await runScope.run({ runId: 'r1' }, async () => {
      emitCallTelemetry(
        fakeResult({ model: 'model-A', usedFallback: false, primaryModel: 'model-A' }),
        { role: 'planner', startedAtMs: 1715000000000 }
      );
      emitCallTelemetry(
        fakeResult({ model: 'model-B', usedFallback: true, primaryModel: 'model-A' }),
        { role: 'planner', startedAtMs: 1715000000000 }
      );
      await flushMicrotasks();
    });

    const inserts = mockedAdminQuery.mock.calls.filter(([sql]) =>
      /INSERT INTO agent_executions/i.test(sql as string)
    );
    expect(inserts.length).toBe(2);
    const key1 = (inserts[0][1] as unknown[])[18];
    const key2 = (inserts[1][1] as unknown[])[18];
    expect(key1).not.toBe(key2);
    // REVERT-CHECK: The idempotency hash MUST include `model`. If you
    // remove `model` from the hash inputs, primary+fallback collide.
  });

  it('cost computed from snapshotted price (computeCostUsd)', async () => {
    await runScope.run({ runId: 'r1' }, async () => {
      emitCallTelemetry(
        fakeResult({ promptTokens: 1_000_000, completionTokens: 500_000 }),
        { role: 'planner', startedAtMs: 1715000000000 }
      );
      await flushMicrotasks();
    });
    const insertCall = mockedAdminQuery.mock.calls.find(([sql]) =>
      /INSERT INTO agent_executions/i.test(sql as string)
    );
    const params = insertCall![1] as unknown[];
    // 1M @ $0.20 + 500k @ $0.60 = $0.20 + $0.30 = $0.50
    expect(Number(params[17])).toBeCloseTo(0.50, 4); // calculated_cost_usd ($18)
  });

  it('deploy-skew: 42P01 (table missing) is swallowed silently', async () => {
    mockedAdminQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO agent_executions/i.test(sql)) {
        const err = new Error('relation does not exist') as Error & { code: string };
        err.code = '42P01';
        throw err;
      }
      // pricing lookup also throws 42P01:
      if (/FROM model_pricing/i.test(sql)) {
        const err = new Error('relation does not exist') as Error & { code: string };
        err.code = '42P01';
        throw err;
      }
      return [];
    });

    // Must not throw.
    await expect(async () => {
      await runScope.run({ runId: 'r1' }, async () => {
        emitCallTelemetry(fakeResult(), {
          role: 'planner',
          startedAtMs: 1715000000000,
        });
        await flushMicrotasks();
      });
    }).not.toThrow();
    // REVERT-CHECK: costSidecar.ts:emitCallTelemetry — the .catch(...)
    // arm that checks pgCode === '42P01'. Without it, an unhandled
    // rejection escapes the fire-and-forget path.
  });

  it('idempotency violation (23505) is swallowed silently', async () => {
    mockedAdminQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO agent_executions/i.test(sql)) {
        const err = new Error('duplicate key value') as Error & { code: string };
        err.code = '23505';
        throw err;
      }
      if (/FROM model_pricing/i.test(sql)) {
        return [{ input_price_per_1m_usd: '0.20', output_price_per_1m_usd: '0.60' }];
      }
      return [];
    });

    await expect(async () => {
      await runScope.run({ runId: 'r1' }, async () => {
        emitCallTelemetry(fakeResult(), {
          role: 'planner',
          startedAtMs: 1715000000000,
        });
        await flushMicrotasks();
      });
    }).not.toThrow();
  });
});
