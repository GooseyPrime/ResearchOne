import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../config';
import { preflightV2OpenRouterModels } from '../services/openrouter/openrouterPreflight';

/**
 * Pre-flight probe is the safety net that surfaces "this V2 default
 * is unreachable on the configured OpenRouter account" at deploy time
 * instead of at first user click. The 2026-04-28-PM outage was a 404
 * "No allowed providers are available" on the planner — exactly the
 * shape this probe catches.
 *
 * Post-PR41-review (2026-04-28-PM, Codex P1 + Copilot 5/6/7), the
 * probe issues a real `/chat/completions` request that mirrors
 * `callOpenRouter` exactly: same headers, same `provider` block
 * (including `data_collection`), same base URL. That way preflight
 * pass ⇔ runtime pass for the configured account / policy. Earlier
 * revisions of this probe used `/models/<slug>/endpoints` for
 * metadata only and missed account-side provider-filter rejections.
 */

const FAKE_OK_RESPONSE = () => ({
  status: 200,
  data: {
    choices: [{ message: { content: '' } }],
    usage: { prompt_tokens: 4, completion_tokens: 1 },
  },
});

const FAKE_404_NO_ALLOWED = () => {
  const err = Object.assign(new Error('Request failed with status code 404'), {
    response: {
      status: 404,
      data: { error: { message: 'No allowed providers are available for the selected model' } },
    },
  });
  throw err;
};

describe('preflightV2OpenRouterModels', () => {
  let origApiKey: string;
  beforeEach(() => {
    // Ensure config.openrouter.apiKey is non-empty so the probe runs.
    origApiKey = config.openrouter.apiKey;
    if (!origApiKey || !origApiKey.trim()) {
      (config.openrouter as { apiKey: string }).apiKey = 'test-key-for-preflight';
    }
  });
  afterEach(() => {
    (config.openrouter as { apiKey: string }).apiKey = origApiKey;
  });

  it('reports ok=true when every default OR primary returns 2xx on /chat/completions', async () => {
    const fetcher = vi.fn(async (..._args: unknown[]) => FAKE_OK_RESPONSE());
    const summary = await preflightV2OpenRouterModels({ fetcher: fetcher as never, timeoutMs: 1 });
    expect(summary.ok).toBe(true);
    expect(summary.hasWarnings).toBe(false);
    expect(summary.rolesAffected).toEqual([]);
    expect(summary.skipped).toBeFalsy();
    // Every probed slug should be marked OK with status 200.
    for (const m of Object.values(summary.models)) {
      expect(m.ok).toBe(true);
      expect(m.status).toBe(200);
    }
    expect(fetcher).toHaveBeenCalled();
    // Verify the probe targets `/chat/completions` and includes the
    // runtime `provider` block — i.e. it is the runtime-mirroring probe,
    // not the old `/endpoints` metadata probe.
    const calls = fetcher.mock.calls as unknown as unknown[][];
    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0]!;
    const url = firstCall[0] as string;
    expect(typeof url).toBe('string');
    expect(url).toMatch(/\/chat\/completions$/);
    const body = firstCall[1] as Record<string, unknown>;
    expect(body).toHaveProperty('provider');
    expect(body).toHaveProperty('messages');
    expect(body).toHaveProperty('max_tokens');
    const provider = body.provider as Record<string, unknown>;
    expect(provider.allow_fallbacks).toBe(true);
    expect(provider.require_parameters).toBe(true);
    expect(['allow', 'deny']).toContain(provider.data_collection);
    // Headers must match runtime (HTTP-Referer + X-Title).
    const opts = firstCall[2] as { headers?: Record<string, string> };
    expect(opts.headers).toBeTruthy();
    expect(opts.headers!['HTTP-Referer']).toBe('https://researchone.app');
    expect(opts.headers!['X-Title']).toBe('ResearchOne');
    expect(opts.headers!.Authorization).toMatch(/^Bearer /);
  });

  it('reports the affected roles when an OR primary returns 404 "No allowed providers"', async () => {
    let calls = 0;
    const fetcher = vi.fn(async (_url: string, body: Record<string, unknown>) => {
      calls += 1;
      // Fail only the slug `deepseek/deepseek-v3.2`; everything else passes.
      if ((body as { model?: string }).model === 'deepseek/deepseek-v3.2') {
        FAKE_404_NO_ALLOWED();
      }
      return FAKE_OK_RESPONSE();
    });

    const summary = await preflightV2OpenRouterModels({ fetcher: fetcher as never, timeoutMs: 1 });
    expect(calls).toBeGreaterThan(0);
    expect(summary.ok).toBe(false);
    expect(summary.hasWarnings).toBe(true);
    // The failing slug must be flagged with the actual provider
    // message exposed for the FailureCard.
    const failing = summary.models['deepseek/deepseek-v3.2'];
    expect(failing).toBeDefined();
    expect(failing.ok).toBe(false);
    expect(failing.status).toBe(404);
    expect(failing.providerMessage).toMatch(/no allowed providers/i);
    // At least one (objective, role) pair should be affected, all
    // pointing at this slug.
    expect(summary.rolesAffected.length).toBeGreaterThan(0);
    expect(summary.rolesAffected.every((r) => r.slug === 'deepseek/deepseek-v3.2')).toBe(true);
  });

  it('skips the probe entirely when OPENROUTER_API_KEY is missing — fetcher is never called', async () => {
    const orig = config.openrouter.apiKey;
    (config.openrouter as { apiKey: string }).apiKey = '';
    try {
      const fetcher = vi.fn(async () => {
        throw new Error('should not be called when API key is missing');
      });
      const summary = await preflightV2OpenRouterModels({
        fetcher: fetcher as never,
        timeoutMs: 1,
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(summary.skipped).toBe(true);
      expect(summary.ok).toBe(true);
      expect(summary.hasWarnings).toBe(false);
      expect(summary.models).toEqual({});
      expect(summary.rolesAffected).toEqual([]);
    } finally {
      (config.openrouter as { apiKey: string }).apiKey = orig;
    }
  });

  it('honors the disabled flag (used by OPENROUTER_PREFLIGHT=false) — fetcher is never called', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('should not be called when disabled');
    });
    const summary = await preflightV2OpenRouterModels({
      fetcher: fetcher as never,
      timeoutMs: 1,
      disabled: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(true);
    expect(summary.ok).toBe(true);
    expect(summary.hasWarnings).toBe(false);
  });

  it('forwards `data_collection` from config into the probe body (deny case)', async () => {
    const orig = config.openrouter.dataCollection;
    (config.openrouter as { dataCollection: string }).dataCollection = 'deny';
    try {
      const fetcher = vi.fn(async (..._args: unknown[]) => FAKE_OK_RESPONSE());
      await preflightV2OpenRouterModels({ fetcher: fetcher as never, timeoutMs: 1 });
      const calls = fetcher.mock.calls as unknown as unknown[][];
      expect(calls.length).toBeGreaterThan(0);
      const body = calls[0]![1] as Record<string, unknown>;
      const provider = body.provider as Record<string, unknown>;
      expect(provider.data_collection).toBe('deny');
    } finally {
      (config.openrouter as { dataCollection: string }).dataCollection = orig as string;
    }
  });
});
