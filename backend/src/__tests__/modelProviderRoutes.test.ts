/**
 * RJ-021. Two more providers for every role, and one setting for the order.
 *
 * OpenRouter's account was empty and no report could be written. Anthropic
 * (called directly) and NVIDIA NIM are added to the routes of every role, and
 * `MODEL_PROVIDER_ORDER` decides the order they are tried in.
 *
 * Only the outside world is replaced here: the HTTP client and the Hugging Face
 * client. The routing, the order, the request sent to each provider and the
 * record of what was tried are the shipped code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = 'openrouter' | 'anthropic' | 'together' | 'nvidia' | 'huggingface_inference';

interface SentRequest {
  provider: Provider;
  model: string;
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** What a provider answers: 'ok', an HTTP status to refuse with, or a refusal with its own message. */
type Answer = 'ok' | number | { status: number; message: string } | { stopReason: string; text?: string };

const h = vi.hoisted(() => ({
  sent: [] as SentRequest[],
  openrouter: ((): Answer => 'ok') as (request: SentRequest) => Answer,
  anthropic: ((): Answer => 'ok') as (request: SentRequest) => Answer,
  together: ((): Answer => 'ok') as (request: SentRequest) => Answer,
  nvidia: ((): Answer => 'ok') as (request: SentRequest) => Answer,
  hub: ((): 'fail' | 'ok' => 'ok') as (model: string) => 'fail' | 'ok',
  emitted: [] as unknown[],
}));

vi.mock('axios', () => {
  class FakeAxiosError extends Error {
    isAxiosError = true;
    response: { status: number; data: unknown };
    constructor(status: number, message: string, anthropicShape: boolean) {
      super(message);
      this.response = {
        status,
        data: anthropicShape ? { type: 'error', error: { type: 'invalid_request_error', message } } : { error: { message } },
      };
    }
  }
  const post = vi.fn(async (url: string, body: Record<string, unknown>, options: { headers: Record<string, string> }) => {
    const provider: Provider = url.includes('api.anthropic.com')
      ? 'anthropic'
      : url.includes('nvidia')
        ? 'nvidia'
        : url.includes('together')
          ? 'together'
          : 'openrouter';
    const request: SentRequest = { provider, model: String(body.model), url, body, headers: options.headers };
    h.sent.push(request);
    const answer = h[provider as 'openrouter' | 'anthropic' | 'together' | 'nvidia'](request);
    if (typeof answer === 'number') throw new FakeAxiosError(answer, `refused with ${answer}`, provider === 'anthropic');
    if (typeof answer === 'object' && 'status' in answer) {
      throw new FakeAxiosError(answer.status, answer.message, provider === 'anthropic');
    }
    if (provider === 'anthropic') {
      const stopReason = typeof answer === 'object' ? answer.stopReason : 'end_turn';
      const text = typeof answer === 'object' ? (answer.text ?? '') : `written by ${request.model}`;
      return {
        data: {
          content: [
            { type: 'thinking', thinking: 'not part of the answer' },
            { type: 'text', text },
          ],
          stop_reason: stopReason,
          usage: { input_tokens: 1200, output_tokens: 300 },
        },
      };
    }
    return {
      data: {
        choices: [{ message: { content: `written by ${request.model}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 5 },
      },
    };
  });
  const isAxiosError = (err: unknown): boolean =>
    Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError);
  return { default: { post, isAxiosError }, isAxiosError, AxiosError: FakeAxiosError };
});

vi.mock('@huggingface/inference', () => ({
  InferenceClient: class {
    async chatCompletion(payload: { model: string }) {
      h.sent.push({ provider: 'huggingface_inference', model: payload.model, url: 'hub', body: {}, headers: {} });
      if (h.hub(payload.model) === 'fail') throw new Error('503 Service Unavailable from the inference provider');
      return { choices: [{ message: { content: `written by ${payload.model}` } }], usage: { prompt_tokens: 3, completion_tokens: 5 } };
    }
  },
}));

vi.mock('../services/telemetry', () => ({
  emitCallTelemetry: vi.fn((result: unknown) => {
    h.emitted.push(result);
  }),
}));

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

import { config } from '../config';
import {
  callRoleModel,
  modelRouteRetry,
  modelRoutesForCall,
  NormalizedModelError,
  toAnthropicRequestMessages,
  type ModelCallResult,
  type ModelRole,
} from '../services/openrouter/openrouterService';
import {
  ANTHROPIC_DEFAULT_MODELS,
  DEFAULT_MODEL_PROVIDER_ORDER,
  NVIDIA_DEFAULT_MODELS,
  ROUTE_MODEL_CLASS_BY_ROLE,
  anthropicModelsByRole,
  nvidiaModelsByRole,
  parseModelProviderOrder,
} from '../services/openrouter/providerRoutes';
import { REASONING_MODEL_ROLES } from '../services/reasoning/reasoningModelPolicy';
import { buildResearchFailureDetails } from '../services/reasoning/researchOrchestrator';
import { decideRunStateOnFailure } from '../services/reasoning/runStateMachine';
import { customerFailureMessage, runRowForCustomer } from '../services/reasoning/customerFailureMessage';
import { runChargeDecision } from '../services/billing/runChargeDecision';

const PRIMARY = 'deepseek/deepseek-v3.2';
const BACKUP = 'moonshotai/kimi-k2-thinking';
const OUT_OF_CREDIT =
  'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.';
const ANTHROPIC_OUT_OF_CREDIT =
  'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

const was = {
  openrouterKey: config.openrouter.apiKey,
  anthropicKey: config.anthropic.apiKey,
  nvidiaKey: config.nvidia.apiKey,
  togetherKey: config.together.apiKey,
  hfToken: config.hfToken,
  order: [...config.modelProviderOrder],
  orderSet: config.modelProviderOrderSet,
  delays: [...modelRouteRetry.delaysMs],
};

function call(role: ModelRole = 'section_drafter', extra: { byokApiKeyOverride?: string } = {}): Promise<ModelCallResult> {
  return callRoleModel({
    role,
    runtimeOverrides: { primary: PRIMARY, fallback: BACKUP },
    messages: [
      { role: 'system', content: 'Write the section.' },
      { role: 'user', content: 'Section 3.' },
    ],
    ...extra,
  });
}

const providersCalled = (): Provider[] => h.sent.map((request) => request.provider);

beforeEach(() => {
  h.sent.length = 0;
  h.emitted.length = 0;
  h.openrouter = () => 'ok';
  h.anthropic = () => 'ok';
  h.together = () => 'ok';
  h.nvidia = () => 'ok';
  h.hub = () => 'ok';
  config.openrouter.apiKey = 'test-openrouter';
  config.anthropic.apiKey = 'test-anthropic';
  config.nvidia.apiKey = 'test-nvidia';
  config.together.apiKey = 'test-together';
  config.hfToken = 'test-hub';
  config.modelProviderOrder = [...DEFAULT_MODEL_PROVIDER_ORDER];
  config.modelProviderOrderSet = false;
  modelRouteRetry.delaysMs = [];
});

afterEach(() => {
  config.openrouter.apiKey = was.openrouterKey;
  config.anthropic.apiKey = was.anthropicKey;
  config.nvidia.apiKey = was.nvidiaKey;
  config.together.apiKey = was.togetherKey;
  config.hfToken = was.hfToken;
  config.modelProviderOrder = [...was.order];
  config.modelProviderOrderSet = was.orderSet;
  modelRouteRetry.delaysMs = [...was.delays];
});

describe('a role call when OpenRouter refuses for credit (402)', () => {
  it('is answered by Anthropic, after the role model and its backup were both tried', async () => {
    h.openrouter = () => ({ status: 402, message: OUT_OF_CREDIT });

    const result = await call('section_drafter');

    expect(h.sent.map((request) => [request.provider, request.model])).toEqual([
      ['openrouter', PRIMARY],
      ['openrouter', BACKUP],
      ['anthropic', ANTHROPIC_DEFAULT_MODELS.strong],
    ]);
    expect(result.content).toBe(`written by ${ANTHROPIC_DEFAULT_MODELS.strong}`);
    expect(result.routeUsed).toEqual({ model: ANTHROPIC_DEFAULT_MODELS.strong, provider: 'anthropic', position: 'cross_provider' });
    expect(result.usedFallback).toBe(true);
    expect(result.primaryModel).toBe(PRIMARY);
    expect(result.promptTokens).toBe(1200);
    expect(result.completionTokens).toBe(300);
  });

  it('sends Anthropic a Messages API request: its own key header, the system prompt as its own field, user turns only', async () => {
    h.openrouter = () => 402;

    await call('section_drafter');

    const request = h.sent.find((sent) => sent.provider === 'anthropic');
    expect(request?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(request?.headers['x-api-key']).toBe('test-anthropic');
    expect(request?.headers['anthropic-version']).toBe('2023-06-01');
    expect(request?.headers.Authorization).toBeUndefined();
    expect(request?.body.system).toContain('Write the section.');
    expect(request?.body.messages).toEqual([{ role: 'user', content: 'Section 3.' }]);
    expect(request?.body.max_tokens).toBeGreaterThan(0);
  });

  it('records the route used and every refused route, for diagnostics and cost tracking', async () => {
    h.openrouter = () => 402;

    const result = await call('section_drafter');

    expect(result.routesTried?.map((attempt) => [attempt.provider, attempt.outcome, attempt.classification ?? null, attempt.status ?? null])).toEqual([
      ['openrouter', 'refused', 'quota_exceeded', 402],
      ['openrouter', 'refused', 'quota_exceeded', 402],
      ['anthropic', 'answered', null, null],
    ]);
    // Cost tracking is given the same record, with Anthropic's published price for the model.
    expect(h.emitted).toHaveLength(1);
    const emitted = h.emitted[0] as ModelCallResult;
    expect(emitted.routeUsed?.provider).toBe('anthropic');
    expect(emitted.model).toBe(ANTHROPIC_DEFAULT_MODELS.strong);
    expect(emitted.listPrice).toEqual({ inputPricePer1mUsd: 2, outputPricePer1mUsd: 10 });
  });

  it('uses the low-cost Claude model for a planning call and the strong one for writing', async () => {
    h.openrouter = () => 402;

    const planned = await call('planner');
    const written = await call('synthesizer');

    expect(planned.routeUsed?.model).toBe(ANTHROPIC_DEFAULT_MODELS.fast);
    expect(written.routeUsed?.model).toBe(ANTHROPIC_DEFAULT_MODELS.strong);
    expect(ANTHROPIC_DEFAULT_MODELS.fast).not.toBe(ANTHROPIC_DEFAULT_MODELS.strong);
  });

  it('does not move to another provider when OpenRouter called the request itself malformed', async () => {
    h.openrouter = () => 400;

    await expect(call()).rejects.toBeInstanceOf(NormalizedModelError);
    expect(providersCalled()).toEqual(['openrouter', 'openrouter']);
  });
});

describe('a role call when OpenRouter refuses and Anthropic has no key', () => {
  it('skips Anthropic and goes to the hub models (Hugging Face, then Together)', async () => {
    h.openrouter = () => 402;
    config.anthropic.apiKey = '';
    h.hub = () => 'fail';

    const result = await call();

    expect(providersCalled()).not.toContain('anthropic');
    expect(providersCalled().slice(0, 4)).toEqual(['openrouter', 'openrouter', 'huggingface_inference', 'together']);
    expect(result.routeUsed?.provider).toBe('together');
  });

  it('goes on to NVIDIA when the hub models are refused as well', async () => {
    h.openrouter = () => 402;
    config.anthropic.apiKey = '';
    h.hub = () => 'fail';
    h.together = () => 503;

    const result = await call('section_drafter');

    expect(providersCalled()).not.toContain('anthropic');
    expect(result.routeUsed).toEqual({ model: NVIDIA_DEFAULT_MODELS.strong, provider: 'nvidia', position: 'cross_provider' });
    // NVIDIA comes after every hub model and before more models on the provider that refused first.
    const nvidiaAt = providersCalled().indexOf('nvidia');
    expect(providersCalled().lastIndexOf('together')).toBeLessThan(nvidiaAt);
    expect(providersCalled().lastIndexOf('openrouter')).toBe(1);
    const request = h.sent[nvidiaAt];
    expect(request.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer test-nvidia');
    expect(result.listPrice).toEqual({ inputPricePer1mUsd: 0, outputPricePer1mUsd: 0 });
  });

  it('goes straight to NVIDIA when it is the only other provider with a key', async () => {
    h.openrouter = () => 402;
    config.anthropic.apiKey = '';
    config.together.apiKey = '';
    config.hfToken = '';

    const result = await call('planner');

    expect(providersCalled()).toEqual(['openrouter', 'openrouter', 'nvidia']);
    expect(result.routeUsed?.model).toBe(NVIDIA_DEFAULT_MODELS.fast);
  });

  it('uses the NVIDIA address from NVIDIA_BASE_URL when one is set', async () => {
    h.openrouter = () => 402;
    config.anthropic.apiKey = '';
    config.together.apiKey = '';
    config.hfToken = '';
    const before = config.nvidia.baseUrl;
    config.nvidia.baseUrl = 'https://nvidia-nim.example.test/v1/';
    try {
      await call();
      expect(h.sent[h.sent.length - 1].url).toBe('https://nvidia-nim.example.test/v1/chat/completions');
    } finally {
      config.nvidia.baseUrl = before;
    }
  });
});

describe('a refusal from one of the added providers', () => {
  it('moves on when Anthropic is out of credit, which it reports as a 400 about the credit balance', async () => {
    h.openrouter = () => 402;
    h.anthropic = () => ({ status: 400, message: ANTHROPIC_OUT_OF_CREDIT });

    const result = await call();

    expect(result.routeUsed?.provider).toBe('huggingface_inference');
    const refusal = result.routesTried?.find((attempt) => attempt.provider === 'anthropic');
    expect(refusal).toMatchObject({ outcome: 'refused', classification: 'quota_exceeded', status: 400 });
  });

  it('moves on when Anthropic is rate limited (429)', async () => {
    h.openrouter = () => 402;
    h.anthropic = () => 429;

    const result = await call();

    expect(result.routeUsed?.provider).not.toBe('anthropic');
    expect(result.routesTried?.find((attempt) => attempt.provider === 'anthropic')?.classification).toBe('rate_limited');
  });

  it('never puts a declined answer into a report: a model that declines counts as a refused route', async () => {
    h.openrouter = () => 402;
    h.anthropic = () => ({ stopReason: 'refusal', text: 'I cannot help with that.' });

    const result = await call('double_check');

    expect(result.content).not.toContain('cannot help');
    expect(result.routeUsed?.provider).not.toBe('anthropic');
    expect(result.routesTried?.find((attempt) => attempt.provider === 'anthropic')?.outcome).toBe('refused');
  });

  it('sends the request once more without a temperature when the model takes none', async () => {
    h.openrouter = () => 402;
    h.anthropic = (request) =>
      'temperature' in request.body ? { status: 400, message: '`temperature` is not supported by this model.' } : 'ok';

    const result = await call();

    const requests = h.sent.filter((sent) => sent.provider === 'anthropic');
    expect(requests).toHaveLength(2);
    expect(requests[0].body.temperature).toBeTypeOf('number');
    expect('temperature' in requests[1].body).toBe(false);
    expect(result.routeUsed?.provider).toBe('anthropic');
  });

  it('fails only when every provider refused, and reports the refusal of the role models with all routes listed', async () => {
    h.openrouter = () => 402;
    h.anthropic = () => ({ status: 400, message: ANTHROPIC_OUT_OF_CREDIT });
    h.hub = () => 'fail';
    h.together = () => 429;
    h.nvidia = () => 429;

    const failure = await call().then(
      () => null,
      (err: unknown) => err
    );

    expect(failure).toBeInstanceOf(NormalizedModelError);
    const normalized = failure as NormalizedModelError;
    expect(normalized.upstream).toBe('openrouter');
    expect(normalized.classification).toBe('quota_exceeded');
    const tried = new Set(normalized.routesTried?.map((attempt) => attempt.provider));
    expect([...tried].sort()).toEqual(['anthropic', 'huggingface_inference', 'nvidia', 'openrouter', 'together']);
    expect(normalized.routesTried?.every((attempt) => attempt.outcome === 'refused')).toBe(true);
  });
});

describe('every role has a model on each added provider', () => {
  it.each(REASONING_MODEL_ROLES.map((role) => [role]))('%s', (role) => {
    expect(ROUTE_MODEL_CLASS_BY_ROLE[role]).toMatch(/^(fast|strong)$/);
    expect(anthropicModelsByRole()[role]).toMatch(/^claude-/);
    expect(nvidiaModelsByRole()[role]).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);

    const routes = modelRoutesForCall({
      role,
      primary: PRIMARY,
      fallback: BACKUP,
      openrouterConfigured: true,
      hubConfigured: true,
      anthropicConfigured: true,
      nvidiaConfigured: true,
    });
    expect(routes.filter((route) => route.via === 'anthropic')).toEqual([
      { model: anthropicModelsByRole()[role], via: 'anthropic', position: 'cross_provider' },
    ]);
    expect(routes.filter((route) => route.via === 'nvidia')).toEqual([
      { model: nvidiaModelsByRole()[role], via: 'nvidia', position: 'cross_provider' },
    ]);
    // OpenRouter and the hub (Hugging Face, Together) still have routes for the role.
    expect(routes.some((route) => !route.via && route.position === 'cross_provider' && route.model.startsWith('deepseek-ai/'))).toBe(true);
    expect(routes[0]).toEqual({ model: PRIMARY, position: 'primary' });
    expect(routes[1]).toEqual({ model: BACKUP, position: 'backup' });
  });

  it('covers exactly the roles the engine has, no more and no fewer', () => {
    expect(Object.keys(ROUTE_MODEL_CLASS_BY_ROLE).sort()).toEqual([...REASONING_MODEL_ROLES].sort());
  });

  it('answers a call for every role on Anthropic when OpenRouter is out of credit', async () => {
    h.openrouter = () => 402;
    for (const role of REASONING_MODEL_ROLES) {
      const result = await call(role);
      expect(result.routeUsed?.provider, role).toBe('anthropic');
      expect(result.content, role).toContain('written by claude-');
    }
  });

  it('answers a call for every role on NVIDIA when it is the only provider left', async () => {
    h.openrouter = () => 402;
    config.anthropic.apiKey = '';
    config.together.apiKey = '';
    config.hfToken = '';
    for (const role of REASONING_MODEL_ROLES) {
      const result = await call(role);
      expect(result.routeUsed?.provider, role).toBe('nvidia');
    }
  });

  it('uses the model ids set on the server in place of the defaults', () => {
    const before = { ...config.anthropic.models };
    config.anthropic.models.strong = 'claude-opus-5-5';
    try {
      const routes = modelRoutesForCall({ role: 'synthesizer', primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: false, anthropicConfigured: true });
      expect(routes.find((route) => route.via === 'anthropic')?.model).toBe('claude-opus-5-5');
    } finally {
      config.anthropic.models.strong = before.strong;
    }
  });
});

describe('the order providers are tried in', () => {
  const slots = (routes: ReturnType<typeof modelRoutesForCall>): string[] => {
    const out: string[] = [];
    for (const route of routes) {
      const slot = route.via ?? (/^[a-z0-9-]+\/[a-z0-9.:-]+$/.test(route.model) ? 'openrouter' : 'together');
      if (out[out.length - 1] !== slot) out.push(slot);
    }
    return out;
  };
  const everything = { role: 'section_drafter' as const, primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: true, anthropicConfigured: true, nvidiaConfigured: true };

  it('is OpenRouter, Anthropic, Together, NVIDIA by default', () => {
    expect(DEFAULT_MODEL_PROVIDER_ORDER).toEqual(['openrouter', 'anthropic', 'together', 'nvidia']);
    expect(parseModelProviderOrder(undefined).order).toEqual(['openrouter', 'anthropic', 'together', 'nvidia']);
    // More OpenRouter models come last: the provider that has just refused is not asked again first.
    expect(slots(modelRoutesForCall(everything))).toEqual(['openrouter', 'anthropic', 'together', 'nvidia', 'openrouter']);
  });

  it('reads MODEL_PROVIDER_ORDER, whatever separates the names', () => {
    expect(parseModelProviderOrder('nvidia,together,anthropic,openrouter').order).toEqual(['nvidia', 'together', 'anthropic', 'openrouter']);
    expect(parseModelProviderOrder(' Anthropic -> OpenRouter -> NVIDIA -> Together ').order).toEqual(['anthropic', 'openrouter', 'nvidia', 'together']);
    expect(parseModelProviderOrder('anthropic openrouter').order).toEqual(['anthropic', 'openrouter', 'together', 'nvidia']);
  });

  it('never loses a provider to a typing mistake: an unknown name is ignored and a missing one keeps its default place', () => {
    const parsed = parseModelProviderOrder('nvidia, antropic, nvidia');
    expect(parsed.order).toEqual(['nvidia', 'openrouter', 'anthropic', 'together']);
    expect(parsed.unknown).toEqual(['antropic']);
  });

  it('changes which provider is tried after the role models', () => {
    const routes = modelRoutesForCall({ ...everything, providerOrder: ['openrouter', 'nvidia', 'together', 'anthropic'] });
    expect(slots(routes)).toEqual(['openrouter', 'nvidia', 'together', 'anthropic', 'openrouter']);
  });

  it('keeps the role model first while the setting is unset, whatever the default order says', () => {
    const routes = modelRoutesForCall({ ...everything, providerOrder: ['anthropic', 'openrouter', 'together', 'nvidia'], providerOrderSet: false });
    expect(routes[0]).toEqual({ model: PRIMARY, position: 'primary' });
    expect(routes.some((route) => route.position === 'preferred')).toBe(false);
  });

  it('puts a provider ahead of the role model when the server setting says so, and still falls back to the role model', async () => {
    config.modelProviderOrder = ['anthropic', 'openrouter', 'together', 'nvidia'];
    config.modelProviderOrderSet = true;

    const first = await call('section_drafter');
    expect(providersCalled()).toEqual(['anthropic']);
    expect(first.routeUsed).toEqual({ model: ANTHROPIC_DEFAULT_MODELS.strong, provider: 'anthropic', position: 'preferred' });
    // Nothing was refused to reach it, so it is not counted as a fallback.
    expect(first.usedFallback).toBe(false);

    h.sent.length = 0;
    h.anthropic = () => 529;
    const second = await call('section_drafter');
    expect(h.sent.map((request) => [request.provider, request.model])).toEqual([
      ['anthropic', ANTHROPIC_DEFAULT_MODELS.strong],
      ['openrouter', PRIMARY],
    ]);
    expect(second.routeUsed?.position).toBe('primary');
  });
});

describe('a request made with the customer own OpenRouter key', () => {
  it('is never moved onto the server Anthropic or NVIDIA accounts', async () => {
    h.openrouter = () => 402;

    await expect(call('section_drafter', { byokApiKeyOverride: 'customer-key' })).rejects.toBeInstanceOf(NormalizedModelError);

    expect(new Set(providersCalled())).toEqual(new Set(['openrouter']));
  });
});

describe('the request shape Anthropic is sent', () => {
  it('joins system messages, merges neighbouring turns from one side, and starts with the user', () => {
    expect(
      toAnthropicRequestMessages([
        { role: 'system', content: 'A' },
        { role: 'user', content: 'one' },
        { role: 'user', content: 'two' },
        { role: 'assistant', content: 'three' },
        { role: 'system', content: 'B' },
        { role: 'user', content: 'four' },
      ])
    ).toEqual({
      system: 'A\n\nB',
      messages: [
        { role: 'user', content: 'one\n\ntwo' },
        { role: 'assistant', content: 'three' },
        { role: 'user', content: 'four' },
      ],
    });
    expect(toAnthropicRequestMessages([{ role: 'system', content: 'Only instructions.' }]).messages[0].role).toBe('user');
  });
});

describe('what a customer is told and charged when every provider refused', () => {
  /** Words and shapes no customer may be shown. */
  const NOT_FOR_CUSTOMERS = [
    /role=/i,
    /model=/i,
    /status=/i,
    /classification/i,
    /section_drafter/,
    /deepseek/i,
    /kimi/i,
    /claude/i,
    /anthropic/i,
    /nvidia/i,
    /openrouter/i,
    /together/i,
    /hugging/i,
    /\b40[0-9]\b/,
    /\b429\b/,
    /quota/i,
    /credit balance/i,
    /add credits/i,
    /cross_provider/,
    /routesTried/,
  ];

  async function everyProviderRefuses(): Promise<NormalizedModelError> {
    h.openrouter = () => ({ status: 402, message: OUT_OF_CREDIT });
    h.anthropic = () => ({ status: 400, message: ANTHROPIC_OUT_OF_CREDIT });
    h.hub = () => 'fail';
    h.together = () => 429;
    h.nvidia = () => 429;
    return (await call().then(
      () => null,
      (err: unknown) => err
    )) as NormalizedModelError;
  }

  it('shows one plain sentence, with no provider wording, model id, role key or status code', async () => {
    const failure = await everyProviderRefuses();
    const details = buildResearchFailureDetails(failure, 'synthesis');
    const transition = decideRunStateOnFailure({ raw: details.failureMeta, classifierRetryable: details.retryable, retryAttempts: 0, retryBudget: 3 });
    const message = customerFailureMessage({ classification: failure.classification, stage: 'synthesis' });

    // The stored row an administrator sees keeps every detail.
    expect(details.errorMessage).toContain('status=402');
    expect(JSON.stringify(details.failureMeta)).toContain('anthropic');

    const sent = runRowForCustomer({
      id: 'run-1',
      status: transition.nextStatus,
      error_message: details.errorMessage,
      failure_meta: { ...transition.failureMeta, customerMessageId: message.id, customerMessage: message.text },
      model_log: [{ role: 'section_drafter', model: ANTHROPIC_DEFAULT_MODELS.strong }],
    });
    const text = JSON.stringify(sent, (key, value: unknown) => (key === 'status' || key === 'customerMessageId' ? undefined : value));

    for (const pattern of NOT_FOR_CUSTOMERS) expect(text).not.toMatch(pattern);
    expect(text).toContain(message.text);
    expect(message.text).toMatch(/You have not been charged/);
  });

  it('takes no payment, whichever provider refused last, and keeps the run able to be run again', async () => {
    const failure = await everyProviderRefuses();
    const details = buildResearchFailureDetails(failure, 'synthesis');
    const transition = decideRunStateOnFailure({ raw: details.failureMeta, classifierRetryable: details.retryable, retryAttempts: 0, retryBudget: 3 });

    expect(transition.nextStatus).toBe('failed');
    expect(runChargeDecision({ status: transition.nextStatus, retryable: transition.failureMeta.retryable })).toBe('keep_hold_for_run_again');
  });

  it('charges a completed run the same, whichever provider answered', () => {
    expect(runChargeDecision({ status: 'completed' })).toBe('charge');
  });
});
