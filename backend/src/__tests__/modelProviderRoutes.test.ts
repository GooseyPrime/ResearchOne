/**
 * RJ-021, changed by RJ-025. Anthropic (called directly) and NVIDIA NIM as
 * providers, and one setting for the order.
 *
 * RJ-021 gave every role a Claude model on Anthropic and a model on NVIDIA
 * picked by size. RJ-025 took that away: a call moves to another provider
 * only for the same model, and to Anthropic only when the role's model is a
 * Claude model. The cases here that asserted "every role has a model on each
 * added provider" were replaced. What is still tested: how each provider is
 * called, how its refusals are read, the order setting, what a customer is
 * told, and what a call costs.
 *
 * NVIDIA and Together serve none of the models a role chooses today, so the
 * cases about how they are called add a row to the provider table for the
 * length of one test.
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
type Answer = 'ok' | number | { status: number; message: string } | { stopReason: string; text?: string; inputTokens?: number };

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
          usage: { input_tokens: typeof answer === 'object' ? (answer.inputTokens ?? 1200) : 1200, output_tokens: 300 },
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
  DEFAULT_MODEL_PROVIDER_ORDER,
  SAME_MODEL_PROVIDER_TABLE,
  parseModelProviderOrder,
  type SameModelEntry,
} from '../services/openrouter/providerRoutes';
import { REASONING_MODEL_ROLES } from '../services/reasoning/reasoningModelPolicy';
import { buildResearchFailureDetails } from '../services/reasoning/researchOrchestrator';
import { decideRunStateOnFailure } from '../services/reasoning/runStateMachine';
import { customerFailureMessage, runRowForCustomer } from '../services/reasoning/customerFailureMessage';
import { runChargeDecision } from '../services/billing/runChargeDecision';

/** A Claude model a role may choose. Anthropic serves the same model as `CLAUDE_DIRECT`. */
const CLAUDE = 'anthropic/claude-sonnet-4.5';
const CLAUDE_DIRECT = 'claude-sonnet-4-5-20250929';
/** A model that is not Claude. Hugging Face Inference serves the same model as `OPEN_ON_HUB`. */
const OPEN = 'deepseek/deepseek-v3.2';
const OPEN_ON_HUB = 'deepseek-ai/DeepSeek-V3.2';
/** The backup the role names. A different model: it is never called. */
const BACKUP = 'moonshotai/kimi-k2-thinking';
const OUT_OF_CREDIT =
  'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.';
const ANTHROPIC_OUT_OF_CREDIT =
  'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';

/** A Claude model that, for a test, every provider serves. */
const EVERYWHERE = 'anthropic/claude-test';
const EVERYWHERE_ROW: SameModelEntry = {
  name: 'Claude Test',
  claude: true,
  servedBy: {
    openrouter: EVERYWHERE,
    anthropic: 'claude-test',
    together: 'anthropic/Claude-Test-Together',
    huggingface_inference: 'NousResearch/Claude-Test-Hub',
    nvidia: 'anthropic/claude-test-nim',
  },
};
/** Claude Haiku 5.5 is priced by prompt length. No role chooses it, so the costing case adds it for one test. */
const HAIKU_ROW: SameModelEntry = {
  name: 'Claude Haiku 5.5',
  claude: true,
  servedBy: { openrouter: 'anthropic/claude-haiku-5.5', anthropic: 'claude-haiku-5-5' },
};

const table = SAME_MODEL_PROVIDER_TABLE as SameModelEntry[];
const addedRows: SameModelEntry[] = [];
function addTableRow(row: SameModelEntry): void {
  table.push(row);
  addedRows.push(row);
}

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

function call(
  role: ModelRole = 'section_drafter',
  primary: string = CLAUDE,
  extra: { byokApiKeyOverride?: string } = {}
): Promise<ModelCallResult> {
  return callRoleModel({
    role,
    runtimeOverrides: { primary, fallback: BACKUP },
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
  for (const row of addedRows.splice(0)) table.splice(table.indexOf(row), 1);
  config.openrouter.apiKey = was.openrouterKey;
  config.anthropic.apiKey = was.anthropicKey;
  config.nvidia.apiKey = was.nvidiaKey;
  config.together.apiKey = was.togetherKey;
  config.hfToken = was.hfToken;
  config.modelProviderOrder = [...was.order];
  config.modelProviderOrderSet = was.orderSet;
  modelRouteRetry.delaysMs = [...was.delays];
});

describe('a Claude role call when OpenRouter refuses for credit (402)', () => {
  it('is answered by Anthropic with the same Claude model, and the role backup is not called', async () => {
    h.openrouter = () => ({ status: 402, message: OUT_OF_CREDIT });

    const result = await call('section_drafter');

    expect(h.sent.map((request) => [request.provider, request.model])).toEqual([
      ['openrouter', CLAUDE],
      ['anthropic', CLAUDE_DIRECT],
    ]);
    expect(result.content).toBe(`written by ${CLAUDE_DIRECT}`);
    expect(result.routeUsed).toEqual({ model: CLAUDE_DIRECT, provider: 'anthropic', position: 'cross_provider' });
    expect(result.usedFallback).toBe(true);
    expect(result.primaryModel).toBe(CLAUDE);
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
      ['anthropic', 'answered', null, null],
    ]);
    // Cost tracking is given the same record, with Anthropic's published price for the model.
    expect(h.emitted).toHaveLength(1);
    const emitted = h.emitted[0] as ModelCallResult;
    expect(emitted.routeUsed?.provider).toBe('anthropic');
    expect(emitted.model).toBe(CLAUDE_DIRECT);
    expect(emitted.listPrice?.inputPricePer1mUsd).toBeCloseTo(3, 9);
    expect(emitted.listPrice?.outputPricePer1mUsd).toBeCloseTo(15, 9);
  });

  it('uses the same Claude model whatever the role: there is no model picked by the size of the task any more', async () => {
    h.openrouter = () => 402;

    const planned = await call('planner');
    const written = await call('synthesizer');

    expect(planned.routeUsed?.model).toBe(CLAUDE_DIRECT);
    expect(written.routeUsed?.model).toBe(CLAUDE_DIRECT);
  });

  it('does not move to another provider when OpenRouter called the request itself malformed', async () => {
    h.openrouter = () => 400;

    await expect(call()).rejects.toBeInstanceOf(NormalizedModelError);
    expect(providersCalled()).toEqual(['openrouter']);
  });
});

describe('a role whose model is not Claude', () => {
  it.each(REASONING_MODEL_ROLES.map((role) => [role]))('%s is never sent to Anthropic, NVIDIA or Together', async (role) => {
    h.openrouter = () => 402;

    const result = await call(role, OPEN);

    expect(h.sent.map((request) => [request.provider, request.model])).toEqual([
      ['openrouter', OPEN],
      ['huggingface_inference', OPEN_ON_HUB],
    ]);
    expect(result.routeUsed?.provider).toBe('huggingface_inference');
  });

  it('fails when its own provider and the one other provider that serves the model both refuse, with Anthropic, NVIDIA and Together idle', async () => {
    h.openrouter = () => 402;
    h.hub = () => 'fail';

    await expect(call('section_drafter', OPEN)).rejects.toBeInstanceOf(NormalizedModelError);

    expect(providersCalled()).toEqual(['openrouter', 'huggingface_inference']);
  });
});

describe('how NVIDIA and Together are called, for a model they serve', () => {
  beforeEach(() => {
    addTableRow(EVERYWHERE_ROW);
    h.openrouter = () => 402;
    h.anthropic = () => 529;
  });

  it('calls Together at its own address, with its own key and the id the table gives the model there', async () => {
    const result = await call('section_drafter', EVERYWHERE);

    expect(result.routeUsed).toEqual({ model: 'anthropic/Claude-Test-Together', provider: 'together', position: 'cross_provider' });
    const request = h.sent.find((sent) => sent.provider === 'together');
    expect(request?.url).toBe('https://api.together.xyz/v1/chat/completions');
    expect(request?.headers.Authorization).toBe('Bearer test-together');
    expect(request?.body.model).toBe('anthropic/Claude-Test-Together');
  });

  it('goes on to Hugging Face Inference, then NVIDIA, each with its own id for the model', async () => {
    h.together = () => 503;
    h.hub = () => 'fail';

    const result = await call('section_drafter', EVERYWHERE);

    expect(h.sent.map((request) => [request.provider, request.model])).toEqual([
      ['openrouter', EVERYWHERE],
      ['anthropic', 'claude-test'],
      ['together', 'anthropic/Claude-Test-Together'],
      ['huggingface_inference', 'NousResearch/Claude-Test-Hub'],
      ['nvidia', 'anthropic/claude-test-nim'],
    ]);
    expect(result.routeUsed).toEqual({ model: 'anthropic/claude-test-nim', provider: 'nvidia', position: 'cross_provider' });
    const request = h.sent[h.sent.length - 1];
    expect(request.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer test-nvidia');
    expect(result.listPrice).toEqual({ inputPricePer1mUsd: 0, outputPricePer1mUsd: 0 });
  });

  it('goes straight to NVIDIA when it is the only other provider with a key', async () => {
    config.anthropic.apiKey = '';
    config.together.apiKey = '';
    config.hfToken = '';

    const result = await call('planner', EVERYWHERE);

    expect(providersCalled()).toEqual(['openrouter', 'nvidia']);
    expect(result.routeUsed?.model).toBe('anthropic/claude-test-nim');
  });

  it('uses the NVIDIA address from NVIDIA_BASE_URL when one is set', async () => {
    config.anthropic.apiKey = '';
    config.together.apiKey = '';
    config.hfToken = '';
    const before = config.nvidia.baseUrl;
    config.nvidia.baseUrl = 'https://nvidia-nim.example.test/v1/';
    try {
      await call('section_drafter', EVERYWHERE);
      expect(h.sent[h.sent.length - 1].url).toBe('https://nvidia-nim.example.test/v1/chat/completions');
    } finally {
      config.nvidia.baseUrl = before;
    }
  });

  it('fails only when every provider refused, and reports the refusal of the role own provider with all routes listed', async () => {
    h.anthropic = () => ({ status: 400, message: ANTHROPIC_OUT_OF_CREDIT });
    h.hub = () => 'fail';
    h.together = () => 429;
    h.nvidia = () => 429;

    const failure = await call('section_drafter', EVERYWHERE).then(
      () => null,
      (err: unknown) => err
    );

    expect(failure).toBeInstanceOf(NormalizedModelError);
    const normalized = failure as NormalizedModelError;
    expect(normalized.upstream).toBe('openrouter');
    expect(normalized.classification).toBe('quota_exceeded');
    expect(normalized.routesTried?.map((attempt) => attempt.provider)).toEqual([
      'openrouter',
      'anthropic',
      'together',
      'huggingface_inference',
      'nvidia',
    ]);
    expect(normalized.routesTried?.every((attempt) => attempt.outcome === 'refused')).toBe(true);
  });
});

describe('a refusal from Anthropic', () => {
  beforeEach(() => {
    addTableRow(EVERYWHERE_ROW);
    h.openrouter = () => 402;
  });

  it('moves on when Anthropic is out of credit, which it reports as a 400 about the credit balance', async () => {
    h.anthropic = () => ({ status: 400, message: ANTHROPIC_OUT_OF_CREDIT });

    const result = await call('section_drafter', EVERYWHERE);

    expect(result.routeUsed?.provider).toBe('together');
    const refusal = result.routesTried?.find((attempt) => attempt.provider === 'anthropic');
    expect(refusal).toMatchObject({ outcome: 'refused', classification: 'quota_exceeded', status: 400 });
  });

  it('moves on when Anthropic is rate limited (429)', async () => {
    h.anthropic = () => 429;

    const result = await call('section_drafter', EVERYWHERE);

    expect(result.routeUsed?.provider).not.toBe('anthropic');
    expect(result.routesTried?.find((attempt) => attempt.provider === 'anthropic')?.classification).toBe('rate_limited');
  });

  it('never puts a declined answer into a report: a model that declines counts as a refused route', async () => {
    h.anthropic = () => ({ stopReason: 'refusal', text: 'I cannot help with that.' });

    const result = await call('double_check', EVERYWHERE);

    expect(result.content).not.toContain('cannot help');
    expect(result.routeUsed?.provider).not.toBe('anthropic');
    expect(result.routesTried?.find((attempt) => attempt.provider === 'anthropic')?.outcome).toBe('refused');
  });

  it('sends the request once more without a temperature when the model takes none', async () => {
    h.anthropic = (request) =>
      'temperature' in request.body ? { status: 400, message: '`temperature` is not supported by this model.' } : 'ok';

    const result = await call('section_drafter', CLAUDE);

    const requests = h.sent.filter((sent) => sent.provider === 'anthropic');
    expect(requests).toHaveLength(2);
    expect(requests[0].body.temperature).toBeTypeOf('number');
    expect('temperature' in requests[1].body).toBe(false);
    expect(result.routeUsed?.provider).toBe('anthropic');
  });

  it('costs each request of a continued answer at its own price step, not all of them at the highest', async () => {
    addTableRow(HAIKU_ROW);
    let nth = 0;
    h.anthropic = () => {
      nth += 1;
      return nth === 1
        ? { stopReason: 'max_tokens', text: 'first half, ', inputTokens: 95_000 }
        : { stopReason: 'end_turn', text: 'second half', inputTokens: 105_000 };
    };

    const result = await call('planner', 'anthropic/claude-haiku-5.5');

    expect(result.model).toBe('claude-haiku-5-5');
    expect(result.content).toBe('first half, second half');
    expect(result.promptTokens).toBe(200_000);
    expect(result.completionTokens).toBe(600);
    // 95,000 tokens at 0.10 and 105,000 at 0.50 per million; 300 output tokens at 0.50 and 300 at 2.50.
    const inputCost = (result.promptTokens / 1_000_000) * (result.listPrice?.inputPricePer1mUsd ?? 0);
    const outputCost = (result.completionTokens / 1_000_000) * (result.listPrice?.outputPricePer1mUsd ?? 0);
    expect(inputCost).toBeCloseTo(0.0095 + 0.0525, 9);
    expect(outputCost).toBeCloseTo(0.00015 + 0.00075, 9);
  });
});

describe('the order providers are tried in', () => {
  const everything = {
    role: 'section_drafter' as const,
    primary: EVERYWHERE,
    openrouterConfigured: true,
    hubConfigured: true,
    togetherConfigured: true,
    anthropicConfigured: true,
    nvidiaConfigured: true,
  };
  const providers = (routes: ReturnType<typeof modelRoutesForCall>): string[] => routes.map((route) => route.via ?? 'openrouter');

  beforeEach(() => {
    addTableRow(EVERYWHERE_ROW);
  });

  it('is OpenRouter, Anthropic, Together, NVIDIA by default, with Hugging Face Inference after Together', () => {
    expect(DEFAULT_MODEL_PROVIDER_ORDER).toEqual(['openrouter', 'anthropic', 'together', 'nvidia']);
    expect(parseModelProviderOrder(undefined).order).toEqual(['openrouter', 'anthropic', 'together', 'nvidia']);
    expect(providers(modelRoutesForCall(everything))).toEqual(['openrouter', 'anthropic', 'together', 'huggingface_inference', 'nvidia']);
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

  it('changes which provider is tried after the role model', () => {
    const routes = modelRoutesForCall({ ...everything, providerOrder: ['openrouter', 'nvidia', 'together', 'anthropic'] });
    expect(providers(routes)).toEqual(['openrouter', 'nvidia', 'together', 'huggingface_inference', 'anthropic']);
  });

  it('puts the providers the setting places ahead before the role model, each with the same model, and never twice', () => {
    const routes = modelRoutesForCall({
      ...everything,
      providerOrder: ['together', 'anthropic', 'openrouter', 'nvidia'],
      providerOrderSet: true,
    });
    expect(routes.map((route) => [route.via ?? 'openrouter', route.position])).toEqual([
      ['together', 'preferred'],
      ['huggingface_inference', 'preferred'],
      ['anthropic', 'preferred'],
      ['openrouter', 'primary'],
      ['nvidia', 'cross_provider'],
    ]);
    expect(new Set(routes.map((route) => `${route.via ?? ''}:${route.model}`)).size).toBe(routes.length);
  });

  it('keeps the role model first while the setting is unset, whatever the default order says', () => {
    const routes = modelRoutesForCall({ ...everything, providerOrder: ['anthropic', 'openrouter', 'together', 'nvidia'], providerOrderSet: false });
    expect(routes[0]).toEqual({ model: EVERYWHERE, position: 'primary' });
    expect(routes.some((route) => route.position === 'preferred')).toBe(false);
  });

  it('puts Anthropic ahead of a Claude role model when the server setting says so, and still goes on to the role model', async () => {
    config.modelProviderOrder = ['anthropic', 'openrouter', 'together', 'nvidia'];
    config.modelProviderOrderSet = true;

    const first = await call('section_drafter', CLAUDE);
    expect(providersCalled()).toEqual(['anthropic']);
    expect(first.routeUsed).toEqual({ model: CLAUDE_DIRECT, provider: 'anthropic', position: 'preferred' });
    // Nothing was refused to reach it, so it is not counted as a fallback.
    expect(first.usedFallback).toBe(false);

    h.sent.length = 0;
    h.anthropic = () => 529;
    const second = await call('section_drafter', CLAUDE);
    expect(h.sent.map((request) => [request.provider, request.model])).toEqual([
      ['anthropic', CLAUDE_DIRECT],
      ['openrouter', CLAUDE],
    ]);
    expect(second.routeUsed?.position).toBe('primary');
  });

  it('does not put Anthropic ahead of a role whose model is not Claude, whatever the setting says', async () => {
    config.modelProviderOrder = ['anthropic', 'openrouter', 'together', 'nvidia'];
    config.modelProviderOrderSet = true;

    await call('section_drafter', OPEN);

    expect(h.sent.map((request) => [request.provider, request.model])).toEqual([['openrouter', OPEN]]);
  });
});

describe('a request made with the customer own OpenRouter key', () => {
  it('is never moved onto the server Anthropic or NVIDIA accounts', async () => {
    addTableRow(EVERYWHERE_ROW);
    h.openrouter = () => 402;

    await expect(call('section_drafter', EVERYWHERE, { byokApiKeyOverride: 'customer-key' })).rejects.toBeInstanceOf(NormalizedModelError);

    expect(providersCalled()).toEqual(['openrouter']);
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
    addTableRow(EVERYWHERE_ROW);
    h.openrouter = () => ({ status: 402, message: OUT_OF_CREDIT });
    h.anthropic = () => ({ status: 400, message: ANTHROPIC_OUT_OF_CREDIT });
    h.hub = () => 'fail';
    h.together = () => 429;
    h.nvidia = () => 429;
    return (await call('section_drafter', EVERYWHERE).then(
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
      model_log: [{ role: 'section_drafter', model: CLAUDE_DIRECT }],
    });
    const text = JSON.stringify(sent, (key, value: unknown) => (key === 'status' || key === 'customerMessageId' ? undefined : value));

    for (const pattern of NOT_FOR_CUSTOMERS) expect(text).not.toMatch(pattern);
    expect(text).toContain(message.text);
    expect(message.text).toMatch(/AI service is temporarily unavailable/);
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
