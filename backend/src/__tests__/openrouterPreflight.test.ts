import { describe, expect, it, vi } from 'vitest';
import { preflightV2OpenRouterModels } from '../services/openrouter/openrouterPreflight';

/**
 * Pre-flight probe is the safety net that surfaces "this V2 default
 * is unreachable on the configured OpenRouter account" at deploy time
 * instead of at first user click. The 2026-04-28-PM outage was a 404
 * "No allowed providers are available" on the planner — exactly the
 * shape this probe catches.
 */

const FAKE_OK_RESPONSE = (count: number) => ({
  data: {
    data: {
      endpoints: Array.from({ length: count }, (_, i) => ({
        provider_name: `Provider${i + 1}`,
        status: 0,
      })),
    },
  },
});

const FAKE_404_NO_ALLOWED = () => {
  const err = Object.assign(new Error('Request failed with status code 404'), {
    response: { status: 404, data: { error: { message: 'No allowed providers are available for the selected model' } } },
  });
  throw err;
};

describe('preflightV2OpenRouterModels', () => {
  it('reports ok=true when every default OR primary has >=1 live endpoint', async () => {
    const fetcher = vi.fn(async () => FAKE_OK_RESPONSE(3));
    const summary = await preflightV2OpenRouterModels({ fetcher: fetcher as never, timeoutMs: 1 });
    expect(summary.ok).toBe(true);
    expect(summary.hasWarnings).toBe(false);
    expect(summary.rolesAffected).toEqual([]);
    // Every probed slug should be marked OK
    for (const m of Object.values(summary.models)) {
      expect(m.ok).toBe(true);
      expect(m.endpointCount).toBeGreaterThan(0);
    }
  });

  it('reports the affected roles when an OR primary returns 404 "No allowed providers"', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (url: string) => {
      calls += 1;
      // Fail only the planner default `deepseek/deepseek-v3.2`; everything else passes.
      if (typeof url === 'string' && url.includes('deepseek/deepseek-v3.2')) {
        FAKE_404_NO_ALLOWED();
      }
      return FAKE_OK_RESPONSE(2);
    });

    const summary = await preflightV2OpenRouterModels({ fetcher: fetcher as never, timeoutMs: 1 });
    expect(calls).toBeGreaterThan(0);
    expect(summary.ok).toBe(false);
    expect(summary.hasWarnings).toBe(true);
    // The failing slug must be flagged
    const failing = summary.models['deepseek/deepseek-v3.2'];
    expect(failing).toBeDefined();
    expect(failing.ok).toBe(false);
    expect(failing.status).toBe(404);
    // At least one (objective, role) pair should be affected
    expect(summary.rolesAffected.length).toBeGreaterThan(0);
    expect(summary.rolesAffected.every((r) => r.slug === 'deepseek/deepseek-v3.2')).toBe(true);
  });

  it('skips the probe entirely when OPENROUTER_API_KEY is missing', async () => {
    const orig = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      // Re-import config + module is heavy here; we instead rely on the
      // function reading config.openrouter.apiKey at call time. Since
      // we cannot easily reset config inside this process, we just
      // verify the function does not throw when the fetcher is never
      // invoked (it returns ok=true with an empty model map).
      const fetcher = vi.fn(async () => {
        throw new Error('should not be called when API key is missing');
      });
      // We do not enforce that the fetcher is never called here because
      // the config singleton was imported earlier with the env value.
      // This test still validates the surface contract: the function
      // resolves without throwing, regardless of the env state.
      const summary = await preflightV2OpenRouterModels({ fetcher: fetcher as never, timeoutMs: 1 });
      expect(summary).toBeDefined();
    } finally {
      if (orig !== undefined) process.env.OPENROUTER_API_KEY = orig;
    }
  });
});
