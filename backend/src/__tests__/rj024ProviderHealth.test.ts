/**
 * RJ-024. The admin-only provider health check.
 *
 * `POST /api/admin/providers/health` sends one 5-token request to each
 * provider that has a key, with its first model, and says which answered.
 *
 * The HTTP client and the Hugging Face client are replaced: no request leaves
 * the test process, and a request to an address the test does not know fails
 * the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  adminToken: 'test-admin-token-rj024-0123456789',
  hubCalls: [] as Array<Record<string, unknown>>,
  hub: (() => 'ok') as () => 'ok' | Error,
}));

vi.mock('../config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config')>();
  return { ...mod, config: { ...mod.config, admin: { ...mod.config.admin, token: ctx.adminToken, userIds: [] } } };
});

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  adminQuery: vi.fn(async () => []),
  initDb: vi.fn(),
}));

vi.mock('@huggingface/inference', () => ({
  InferenceClient: class {
    async chatCompletion(payload: Record<string, unknown>) {
      ctx.hubCalls.push(payload);
      const answer = ctx.hub();
      if (answer !== 'ok') throw answer;
      return { choices: [{ message: { content: 'ok' } }] };
    }
  },
}));

import axios, { AxiosError, type AxiosResponse } from 'axios';
import request from 'supertest';
import testApp from '../api/app';
import { config } from '../config';
import {
  PROVIDER_HEALTH_MAX_TOKENS,
  checkProviderHealth,
  providerHealthTargets,
  redactKeyLikeText,
} from '../services/openrouter/providerHealth';
import { ANTHROPIC_DEFAULT_MODELS, NVIDIA_DEFAULT_MODELS, TOGETHER_BACKUP_MODELS } from '../services/openrouter/providerRoutes';

type Provider = 'openrouter' | 'anthropic' | 'together' | 'nvidia';
interface Sent {
  provider: Provider;
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
type Answer = 'ok' | { status: number; message: string } | 'no_connection';

const KEYS = {
  openrouter: 'sk-or-v1-0123456789abcdef0123456789abcdef',
  anthropic: 'sk-ant-api03-ABCDEFGHIJKLMNOP0123456789',
  together: 'tgp_v1_0123456789abcdefghijKLMNOP',
  nvidia: 'nvapi-0123456789abcdefghijKLMNOPqrstuv',
  hub: 'hf_0123456789abcdefghijKLMNOPqrstuv',
};

const sent: Sent[] = [];
let answers: Record<Provider, Answer>;

function providerFor(url: string): Provider {
  if (url.startsWith('https://api.anthropic.com/')) return 'anthropic';
  if (url.startsWith('https://integrate.api.nvidia.com/')) return 'nvidia';
  if (url.startsWith('https://api.together.xyz/')) return 'together';
  if (url.startsWith(config.openrouter.baseUrl)) return 'openrouter';
  throw new Error(`The test made a request to an address it does not replace: ${url}`);
}

function refusal(status: number, message: string, anthropicShape: boolean): AxiosError {
  const response = {
    status,
    statusText: String(status),
    headers: {},
    config: {},
    data: anthropicShape ? { type: 'error', error: { type: 'invalid_request_error', message } } : { error: { message } },
  } as unknown as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', undefined, undefined, response);
}

const was = {
  openrouterKey: config.openrouter.apiKey,
  anthropicKey: config.anthropic.apiKey,
  workspaceId: config.anthropic.workspaceId,
  nvidiaKey: config.nvidia.apiKey,
  togetherKey: config.together.apiKey,
  hfToken: config.hfToken,
};

beforeEach(() => {
  sent.length = 0;
  ctx.hubCalls.length = 0;
  ctx.hub = () => 'ok';
  answers = { openrouter: 'ok', anthropic: 'ok', together: 'ok', nvidia: 'ok' };
  config.openrouter.apiKey = KEYS.openrouter;
  config.anthropic.apiKey = KEYS.anthropic;
  config.anthropic.workspaceId = '';
  config.together.apiKey = KEYS.together;
  config.nvidia.apiKey = KEYS.nvidia;
  config.hfToken = KEYS.hub;
  vi.spyOn(axios, 'post').mockImplementation(async (url: string, body?: unknown, options?: { headers?: unknown }) => {
    const provider = providerFor(url);
    sent.push({ provider, url, body: body as Record<string, unknown>, headers: (options?.headers ?? {}) as Record<string, string> });
    const answer = answers[provider];
    if (answer === 'no_connection') throw new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED');
    if (answer !== 'ok') throw refusal(answer.status, answer.message, provider === 'anthropic');
    return { status: 200, data: {} } as AxiosResponse;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  config.openrouter.apiKey = was.openrouterKey;
  config.anthropic.apiKey = was.anthropicKey;
  config.anthropic.workspaceId = was.workspaceId;
  config.nvidia.apiKey = was.nvidiaKey;
  config.together.apiKey = was.togetherKey;
  config.hfToken = was.hfToken;
});

const admin = () => ({ 'x-admin-token': ctx.adminToken });

describe('which providers the health check asks', () => {
  it('asks each provider that has a key, with its first model', () => {
    expect(providerHealthTargets()).toEqual([
      { provider: 'openrouter', model: 'deepseek/deepseek-v3.2' },
      { provider: 'anthropic', model: ANTHROPIC_DEFAULT_MODELS.fast },
      { provider: 'together', model: TOGETHER_BACKUP_MODELS[0] },
      { provider: 'huggingface_inference', model: 'NousResearch/Hermes-3-Llama-3.1-70B' },
      { provider: 'nvidia', model: NVIDIA_DEFAULT_MODELS.fast },
    ]);
  });

  it('leaves out a provider that has no key', async () => {
    config.anthropic.apiKey = '';
    config.hfToken = '  ';
    config.together.apiKey = '';

    const results = await checkProviderHealth();

    expect(results.map((entry) => entry.provider)).toEqual(['openrouter', 'nvidia']);
    expect(sent.map((entry) => entry.provider).sort()).toEqual(['nvidia', 'openrouter']);
    expect(ctx.hubCalls).toEqual([]);
  });

  it('asks nobody when no provider has a key', async () => {
    config.openrouter.apiKey = '';
    config.anthropic.apiKey = '';
    config.together.apiKey = '';
    config.nvidia.apiKey = '';
    config.hfToken = '';

    expect(await checkProviderHealth()).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('the request sent to each provider', () => {
  it('is one request of at most 5 tokens, to the provider\'s own address, with its own key', async () => {
    config.anthropic.workspaceId = 'wrkspc_test_0001';

    await checkProviderHealth();

    expect(PROVIDER_HEALTH_MAX_TOKENS).toBe(5);
    expect(sent).toHaveLength(4);
    for (const entry of sent) {
      expect(entry.body.max_tokens, entry.provider).toBe(5);
      expect(entry.body.messages, entry.provider).toHaveLength(1);
    }
    const by = (provider: Provider): Sent => sent.find((entry) => entry.provider === provider) as Sent;
    expect(by('together').url).toBe('https://api.together.xyz/v1/chat/completions');
    expect(by('together').body.model).toBe('deepseek-ai/DeepSeek-V4.1-Flash');
    expect(by('together').headers.Authorization).toBe(`Bearer ${KEYS.together}`);
    expect(by('nvidia').url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(by('nvidia').headers.Authorization).toBe(`Bearer ${KEYS.nvidia}`);
    expect(by('anthropic').url).toBe('https://api.anthropic.com/v1/messages');
    expect(by('anthropic').headers['x-api-key']).toBe(KEYS.anthropic);
    expect(by('anthropic').headers['anthropic-workspace-id']).toBe('wrkspc_test_0001');
    expect(by('openrouter').headers.Authorization).toBe(`Bearer ${KEYS.openrouter}`);
    expect(ctx.hubCalls).toEqual([
      expect.objectContaining({ model: 'NousResearch/Hermes-3-Llama-3.1-70B', max_tokens: 5 }),
    ]);
  });
});

describe('what the health check reports', () => {
  it('reports ok and the status for a provider that answered', async () => {
    const results = await checkProviderHealth();

    expect(results.map((entry) => [entry.provider, entry.ok, entry.status])).toEqual([
      ['openrouter', true, 200],
      ['anthropic', true, 200],
      ['together', true, 200],
      ['huggingface_inference', true, 200],
      ['nvidia', true, 200],
    ]);
    for (const entry of results) expect(entry.error).toBeUndefined();
  });

  it('reports the two refusals measured on production as route configuration errors, with the reason', async () => {
    answers.together = {
      status: 400,
      message:
        'Unable to access non-serverless model deepseek-ai/DeepSeek-V3.1. Please visit https://api.together.ai/models/deepseek-ai/DeepSeek-V3.1 to create and start a new dedicated endpoint for the model.',
    };
    answers.anthropic = {
      status: 400,
      message:
        'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.',
    };

    const results = await checkProviderHealth();
    const by = (provider: string) => results.find((entry) => entry.provider === provider);

    expect(by('together')).toMatchObject({
      ok: false,
      status: 400,
      classification: 'route_config_error',
      configurationReason: 'model_needs_dedicated_endpoint',
    });
    expect(by('together')?.error).toContain('non-serverless model');
    expect(by('anthropic')).toMatchObject({
      ok: false,
      status: 400,
      classification: 'route_config_error',
      configurationReason: 'key_needs_workspace_header',
    });
    // One provider refusing does not stop the others being asked.
    expect(by('openrouter')?.ok).toBe(true);
    expect(by('nvidia')?.ok).toBe(true);
  });

  it('reports a refusal by status and kind: no credit, a rejected key, no connection, Hugging Face down', async () => {
    answers.openrouter = { status: 402, message: 'This request would exceed your available credits.' };
    answers.nvidia = { status: 401, message: 'Unauthorized' };
    answers.together = 'no_connection';
    ctx.hub = () => new Error('503 Service Unavailable from the inference provider');

    const results = await checkProviderHealth();
    const by = (provider: string) => results.find((entry) => entry.provider === provider);

    expect(by('openrouter')).toMatchObject({ ok: false, status: 402, classification: 'quota_exceeded' });
    expect(by('nvidia')).toMatchObject({ ok: false, status: 401, classification: 'auth_error' });
    expect(by('together')).toMatchObject({ ok: false, status: null, classification: 'network_error' });
    expect(by('huggingface_inference')).toMatchObject({ ok: false, status: null, classification: 'provider_unavailable' });
    expect(by('huggingface_inference')?.error).toContain('503 Service Unavailable');
  });

  it('removes anything that looks like a key from the error text, and keeps it short', async () => {
    answers.openrouter = { status: 401, message: `Incorrect API key provided: ${KEYS.openrouter}. Header was "Bearer ${KEYS.openrouter}".` };
    answers.anthropic = { status: 401, message: `invalid x-api-key ${KEYS.anthropic} for workspace wrkspc_01ABCDEFGHJKMNPQRSTV` };
    answers.together = { status: 401, message: `Invalid key 9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a3928 ${'x'.repeat(600)}` };
    answers.nvidia = { status: 403, message: `Authorization failed for ${KEYS.nvidia}` };
    ctx.hub = () => new Error(`Invalid credentials in Authorization header: Bearer ${KEYS.hub}`);

    const results = await checkProviderHealth();
    const everything = JSON.stringify(results);

    for (const key of Object.values(KEYS)) expect(everything).not.toContain(key);
    expect(everything).not.toContain('9f8e7d6c5b4a39281706f5e4d3c2b1a0');
    expect(everything).not.toContain('wrkspc_01ABCDEFGHJKMNPQRSTV');
    for (const entry of results) {
      expect(entry.ok).toBe(false);
      expect((entry.error ?? '').length).toBeLessThanOrEqual(240);
      expect(entry.error).toContain('[removed]');
    }
    expect(results.find((entry) => entry.provider === 'openrouter')?.error).toContain('Incorrect API key provided');
  });
});

describe('redactKeyLikeText', () => {
  it('keeps an ordinary provider message readable', () => {
    const message = 'Unable to access non-serverless model deepseek-ai/DeepSeek-V3.1. Please create and start a new dedicated endpoint.';
    expect(redactKeyLikeText(message, [])).toBe(message);
  });

  it('removes a key set on this server wherever it appears, whatever it looks like', () => {
    expect(redactKeyLikeText('key was plainpw and again plainpw', ['plainpw'])).toBe('key was [removed] and again [removed]');
  });

  it('removes bearer values, prefixed keys and long opaque strings', () => {
    expect(redactKeyLikeText('Bearer abc.def-123', [])).toBe('Bearer [removed]');
    expect(redactKeyLikeText('bad key sk-proj-abcdefgh12345678', [])).toBe('bad key [removed]');
    expect(redactKeyLikeText('token hf_abcdefghijklmnop rejected', [])).toBe('token [removed] rejected');
    expect(redactKeyLikeText('id 0123456789abcdef0123456789abcdef0123 seen', [])).toBe('id [removed] seen');
  });
});

describe('POST /api/admin/providers/health', () => {
  it('refuses a caller who is not an administrator, and asks no provider', async () => {
    const none = await request(testApp).post('/api/admin/providers/health');
    const wrong = await request(testApp).post('/api/admin/providers/health').set({ 'x-admin-token': 'not-the-admin-token-0000000000000' });

    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(sent).toEqual([]);
    expect(ctx.hubCalls).toEqual([]);
  });

  it('does not run on a GET, so nothing that only reads the admin pages can start it', async () => {
    const res = await request(testApp).get('/api/admin/providers/health').set(admin());

    expect(res.status).toBe(404);
    expect(sent).toEqual([]);
  });

  it('returns provider, model, ok, status and a short error for an administrator', async () => {
    answers.together = { status: 400, message: 'Unable to access non-serverless model deepseek-ai/DeepSeek-V3.1.' };

    const res = await request(testApp).post('/api/admin/providers/health').set(admin());

    expect(res.status).toBe(200);
    expect(typeof res.body.checkedAt).toBe('string');
    expect(res.body.providers).toHaveLength(5);
    for (const entry of res.body.providers) {
      expect(Object.keys(entry)).toEqual(expect.arrayContaining(['provider', 'model', 'ok', 'status']));
    }
    expect(res.body.providers.find((entry: { provider: string }) => entry.provider === 'together')).toMatchObject({
      provider: 'together',
      model: 'deepseek-ai/DeepSeek-V4.1-Flash',
      ok: false,
      status: 400,
      error: 'Unable to access non-serverless model deepseek-ai/DeepSeek-V3.1.',
    });
    for (const key of Object.values(KEYS)) expect(JSON.stringify(res.body)).not.toContain(key);
  });

  it('asks each provider once per call, and never before it is called', async () => {
    expect(sent).toEqual([]);

    await request(testApp).post('/api/admin/providers/health').set(admin());

    expect(sent.map((entry) => entry.provider).sort()).toEqual(['anthropic', 'nvidia', 'openrouter', 'together']);
    expect(ctx.hubCalls).toHaveLength(1);
  });
});
