/**
 * RJ-024. Together backups that run, and refusals that are about settings.
 *
 * Measured on production on 10 Oct 2026:
 *   - Together answered 400 "Unable to access non-serverless model
 *     deepseek-ai/DeepSeek-V3.1 ... create and start a new dedicated endpoint"
 *     for both ids on the Together backup list, so the Together key never
 *     answered a call.
 *   - Anthropic answered 400 "This API key is not scoped to a workspace, so
 *     this request must include the anthropic-workspace-id header".
 *
 * Only the outside world is replaced here: the HTTP client and the Hugging Face
 * client. No request leaves the test process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = 'openrouter' | 'anthropic' | 'together' | 'nvidia' | 'huggingface_inference';
interface Sent {
  provider: Provider;
  model: string;
  headers: Record<string, string>;
}
type Answer = 'ok' | number | { status: number; message: string };

const h = vi.hoisted(() => ({
  sent: [] as Sent[],
  answers: {
    openrouter: (() => 'ok') as (model: string) => Answer,
    anthropic: (() => 'ok') as (model: string) => Answer,
    together: (() => 'ok') as (model: string) => Answer,
    nvidia: (() => 'ok') as (model: string) => Answer,
  },
  hub: (() => 'ok') as (model: string) => 'ok' | 'fail',
  warnings: [] as Array<{ message: string; meta: Record<string, unknown> }>,
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
  const post = vi.fn(async (url: string, body: { model: string }, options: { headers: Record<string, string> }) => {
    const provider = url.includes('api.anthropic.com')
      ? 'anthropic'
      : url.includes('nvidia')
        ? 'nvidia'
        : url.includes('together')
          ? 'together'
          : 'openrouter';
    h.sent.push({ provider, model: body.model, headers: options.headers });
    const answer = h.answers[provider](body.model);
    if (typeof answer === 'number') throw new FakeAxiosError(answer, `refused with ${answer}`, provider === 'anthropic');
    if (typeof answer === 'object') throw new FakeAxiosError(answer.status, answer.message, provider === 'anthropic');
    if (provider === 'anthropic') {
      return {
        status: 200,
        data: { content: [{ type: 'text', text: `written by ${body.model}` }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 4 } },
      };
    }
    return {
      status: 200,
      data: { choices: [{ message: { content: `written by ${body.model}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5 } },
    };
  });
  const isAxiosError = (err: unknown): boolean =>
    Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError);
  return { default: { post, isAxiosError }, isAxiosError, AxiosError: FakeAxiosError };
});

vi.mock('@huggingface/inference', () => ({
  InferenceClient: class {
    async chatCompletion(payload: { model: string }) {
      h.sent.push({ provider: 'huggingface_inference', model: payload.model, headers: {} });
      if (h.hub(payload.model) === 'fail') throw new Error('503 Service Unavailable from the inference provider');
      return { choices: [{ message: { content: `written by ${payload.model}` } }], usage: { prompt_tokens: 3, completion_tokens: 5 } };
    }
  },
}));

vi.mock('../services/telemetry', () => ({ emitCallTelemetry: vi.fn() }));

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn((message: string, meta?: Record<string, unknown>) => {
      h.warnings.push({ message, meta: meta ?? {} });
    }),
  },
}));

import { config } from '../config';
import {
  _resetRouteConfigurationWarnings,
  callRoleModel,
  modelRouteRetry,
  modelRoutesForCall,
  NormalizedModelError,
  type ModelCallResult,
  type ModelRole,
} from '../services/openrouter/openrouterService';
import {
  ANTHROPIC_DEFAULT_MODELS,
  NVIDIA_DEFAULT_MODELS,
  ROUTE_MODEL_CLASS_BY_ROLE,
  TOGETHER_BACKUP_MODELS,
  routeConfigurationReason,
  togetherModelsForRole,
} from '../services/openrouter/providerRoutes';
import { REASONING_MODEL_ROLES, crossProviderBackupModelsForRole } from '../services/reasoning/reasoningModelPolicy';
import { customerFailureMessage } from '../services/reasoning/customerFailureMessage';

const PRIMARY = 'deepseek/deepseek-v3.2';
const BACKUP = 'moonshotai/kimi-k2-thinking';
const NON_SERVERLESS = (model: string): string =>
  `Unable to access non-serverless model ${model}. Please visit https://api.together.ai/models/${model} to create and start a new dedicated endpoint for the model.`;
const NEEDS_WORKSPACE =
  'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.';

const was = {
  openrouterKey: config.openrouter.apiKey,
  anthropicKey: config.anthropic.apiKey,
  workspaceId: config.anthropic.workspaceId,
  nvidiaKey: config.nvidia.apiKey,
  togetherKey: config.together.apiKey,
  hfToken: config.hfToken,
  order: [...config.modelProviderOrder],
  orderSet: config.modelProviderOrderSet,
  delays: [...modelRouteRetry.delaysMs],
};

function call(role: ModelRole = 'section_drafter'): Promise<ModelCallResult> {
  return callRoleModel({
    role,
    runtimeOverrides: { primary: PRIMARY, fallback: BACKUP },
    messages: [
      { role: 'system', content: 'Write the section.' },
      { role: 'user', content: 'Section 3.' },
    ],
  });
}

const adminWarnings = () => h.warnings.filter((entry) => entry.meta.adminOnly === true);

beforeEach(() => {
  h.sent.length = 0;
  h.warnings.length = 0;
  h.answers.openrouter = () => 'ok';
  h.answers.anthropic = () => 'ok';
  h.answers.together = () => 'ok';
  h.answers.nvidia = () => 'ok';
  h.hub = () => 'ok';
  config.openrouter.apiKey = 'test-openrouter';
  config.anthropic.apiKey = 'test-anthropic';
  config.anthropic.workspaceId = '';
  config.nvidia.apiKey = 'test-nvidia';
  config.together.apiKey = 'test-together';
  config.hfToken = 'test-hub';
  config.modelProviderOrder = ['openrouter', 'anthropic', 'together', 'nvidia'];
  config.modelProviderOrderSet = false;
  modelRouteRetry.delaysMs = [];
  _resetRouteConfigurationWarnings();
});

afterEach(() => {
  config.openrouter.apiKey = was.openrouterKey;
  config.anthropic.apiKey = was.anthropicKey;
  config.anthropic.workspaceId = was.workspaceId;
  config.nvidia.apiKey = was.nvidiaKey;
  config.together.apiKey = was.togetherKey;
  config.hfToken = was.hfToken;
  config.modelProviderOrder = [...was.order];
  config.modelProviderOrderSet = was.orderSet;
  modelRouteRetry.delaysMs = [...was.delays];
});

describe('the Together backup list', () => {
  it('is the five serverless models, cheapest capable first', () => {
    expect([...TOGETHER_BACKUP_MODELS]).toEqual([
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'zai-org/GLM-5.3-Flash',
      'Qwen/Qwen3.8-Flash',
      'openai/gpt-oss-120b',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ]);
  });

  it('no longer holds the two ids Together refuses as non-serverless, on either list', () => {
    const hubAndGateway = crossProviderBackupModelsForRole('section_drafter', { openrouter: true, hub: true });
    for (const refused of ['deepseek-ai/DeepSeek-V3.1', 'deepseek-ai/DeepSeek-V3']) {
      expect(TOGETHER_BACKUP_MODELS).not.toContain(refused);
      expect(hubAndGateway).not.toContain(refused);
    }
  });

  it.each(REASONING_MODEL_ROLES.map((role) => [role]))('gives %s the whole list, in order, as Together routes', (role) => {
    expect(togetherModelsForRole(role)).toEqual([...TOGETHER_BACKUP_MODELS]);
    const routes = modelRoutesForCall({ role, primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: false, togetherConfigured: true });
    expect(routes.slice(2, 2 + TOGETHER_BACKUP_MODELS.length)).toEqual(
      TOGETHER_BACKUP_MODELS.map((model) => ({ model, via: 'together', position: 'cross_provider' }))
    );
  });

  it('is left out when there is no Together key, and a Hugging Face token alone does not bring it back', () => {
    const routes = modelRoutesForCall({ role: 'planner', primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: true, togetherConfigured: false });
    expect(routes.some((route) => route.via === 'together')).toBe(false);
    expect(routes.some((route) => route.model.startsWith('NousResearch/'))).toBe(true);
  });

  it('leaves out the hub models when there is a Together key and no Hugging Face token', () => {
    const routes = modelRoutesForCall({ role: 'planner', primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: false, togetherConfigured: true });
    expect(routes.filter((route) => !route.via).every((route) => !/^(NousResearch|huihui-ai)\//.test(route.model))).toBe(true);
  });

  it('gives each role this full order with every provider configured', () => {
    for (const role of REASONING_MODEL_ROLES) {
      const size = ROUTE_MODEL_CLASS_BY_ROLE[role];
      const routes = modelRoutesForCall({
        role,
        primary: PRIMARY,
        fallback: BACKUP,
        openrouterConfigured: true,
        hubConfigured: true,
        togetherConfigured: true,
        anthropicConfigured: true,
        nvidiaConfigured: true,
        providerOrder: ['openrouter', 'anthropic', 'together', 'nvidia'],
        providerOrderSet: false,
      });
      expect(routes.map((route) => `${route.via ?? 'own-or-list'}:${route.model}`), role).toEqual([
        `own-or-list:${PRIMARY}`,
        `own-or-list:${BACKUP}`,
        `anthropic:${ANTHROPIC_DEFAULT_MODELS[size]}`,
        ...TOGETHER_BACKUP_MODELS.map((model) => `together:${model}`),
        'own-or-list:NousResearch/Hermes-3-Llama-3.1-70B',
        'own-or-list:huihui-ai/Llama-3.3-70B-Instruct-abliterated',
        'own-or-list:huihui-ai/Qwen2.5-72B-Instruct-abliterated',
        `nvidia:${NVIDIA_DEFAULT_MODELS[size]}`,
        'own-or-list:nousresearch/hermes-4-70b',
      ]);
    }
  });

  it('does not change which roles may reach Anthropic: every role has exactly one Anthropic route, as before', () => {
    for (const role of REASONING_MODEL_ROLES) {
      const routes = modelRoutesForCall({ role, primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: true, togetherConfigured: true, anthropicConfigured: true, nvidiaConfigured: true });
      expect(routes.filter((route) => route.via === 'anthropic'), role).toHaveLength(1);
    }
  });
});

describe('a call that reaches Together', () => {
  it('is answered by the first serverless model, with Together\'s published price on the result', async () => {
    h.answers.openrouter = () => 402;
    config.anthropic.apiKey = '';

    const result = await call();

    expect(result.routeUsed).toEqual({ model: 'deepseek-ai/DeepSeek-V4.1-Flash', provider: 'together', position: 'cross_provider' });
    expect(result.listPrice).toEqual({ inputPricePer1mUsd: 0.3, outputPricePer1mUsd: 1.2 });
    const request = h.sent.find((sent) => sent.provider === 'together');
    expect(request?.headers.Authorization).toBe('Bearer test-together');
  });

  it('goes down the list in order when Together refuses a model', async () => {
    h.answers.openrouter = () => 402;
    config.anthropic.apiKey = '';
    h.answers.together = (model) => (model === 'openai/gpt-oss-120b' ? 'ok' : 503);

    const result = await call();

    expect(h.sent.filter((sent) => sent.provider === 'together').map((sent) => sent.model)).toEqual([
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'zai-org/GLM-5.3-Flash',
      'Qwen/Qwen3.8-Flash',
      'openai/gpt-oss-120b',
    ]);
    expect(result.routeUsed?.model).toBe('openai/gpt-oss-120b');
  });
});

describe('a 400 that is about how the route is set up', () => {
  it('reads the two messages measured on production, and nothing else, as a route configuration error', () => {
    expect(routeConfigurationReason(NON_SERVERLESS('deepseek-ai/DeepSeek-V3.1'))).toBe('model_needs_dedicated_endpoint');
    expect(routeConfigurationReason(NEEDS_WORKSPACE)).toBe('key_needs_workspace_header');
    expect(routeConfigurationReason('messages: at least one message is required')).toBeNull();
    expect(routeConfigurationReason('`temperature` is not supported by this model.')).toBeNull();
    expect(routeConfigurationReason(undefined)).toBeNull();
  });

  it('moves on to the next route when Together says a model needs a dedicated endpoint', async () => {
    h.answers.openrouter = () => 402;
    config.anthropic.apiKey = '';
    h.answers.together = (model) => (model === 'deepseek-ai/DeepSeek-V4.1-Flash' ? { status: 400, message: NON_SERVERLESS(model) } : 'ok');

    const result = await call();

    expect(result.routeUsed).toMatchObject({ provider: 'together', model: 'zai-org/GLM-5.3-Flash' });
    expect(result.routesTried?.find((attempt) => attempt.provider === 'together' && attempt.outcome === 'refused')).toMatchObject({
      classification: 'route_config_error',
      status: 400,
    });
  });

  it('moves on to the next provider when Anthropic says the key needs a workspace header', async () => {
    h.answers.openrouter = () => 402;
    h.answers.anthropic = () => ({ status: 400, message: NEEDS_WORKSPACE });

    const result = await call();

    expect(result.routeUsed?.provider).toBe('together');
    expect(result.routesTried?.find((attempt) => attempt.provider === 'anthropic')).toMatchObject({
      outcome: 'refused',
      classification: 'route_config_error',
      status: 400,
    });
  });

  it('moves to another provider when the refusal is of the role\'s own model, unlike a malformed request', async () => {
    h.answers.openrouter = (model) => ({ status: 400, message: NON_SERVERLESS(model) });

    const moved = await call();
    expect(moved.routeUsed?.provider).toBe('anthropic');

    h.sent.length = 0;
    h.answers.openrouter = () => ({ status: 400, message: 'messages: at least one message is required' });
    await expect(call()).rejects.toMatchObject({ classification: 'bad_request' });
    expect(h.sent.map((sent) => sent.provider)).toEqual(['openrouter', 'openrouter']);
  });

  it('logs one admin-only warning per process that names the provider and the reason, however many calls are refused', async () => {
    h.answers.openrouter = () => 402;
    h.answers.anthropic = () => ({ status: 400, message: NEEDS_WORKSPACE });

    await call('planner');
    await call('section_drafter');
    await call('verifier');

    const warnings = adminWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('anthropic');
    expect(warnings[0].message).toContain('key_needs_workspace_header');
    expect(warnings[0].message).toContain('ANTHROPIC_WORKSPACE_ID');
    expect(warnings[0].meta).toMatchObject({ adminOnly: true, provider: 'anthropic', reason: 'key_needs_workspace_header' });
  });

  it('logs the dedicated-endpoint warning once per model, naming Together and the model', async () => {
    h.answers.openrouter = () => 402;
    config.anthropic.apiKey = '';
    h.answers.together = (model) =>
      model === 'deepseek-ai/DeepSeek-V4.1-Flash' || model === 'zai-org/GLM-5.3-Flash' ? { status: 400, message: NON_SERVERLESS(model) } : 'ok';

    await call();
    await call();

    const warnings = adminWarnings();
    expect(warnings.map((entry) => entry.meta.model)).toEqual(['deepseek-ai/DeepSeek-V4.1-Flash', 'zai-org/GLM-5.3-Flash']);
    for (const warning of warnings) {
      expect(warning.message).toContain('together');
      expect(warning.message).toContain('model_needs_dedicated_endpoint');
      expect(warning.meta.provider).toBe('together');
    }
  });

  it('logs no admin warning for an ordinary refusal', async () => {
    h.answers.openrouter = () => 402;
    h.answers.anthropic = () => 429;

    await call();

    expect(adminWarnings()).toEqual([]);
  });

  it('never puts the warning or the reason in what a customer reads', async () => {
    h.answers.openrouter = (model) => ({ status: 400, message: NON_SERVERLESS(model) });
    h.answers.anthropic = () => ({ status: 400, message: NEEDS_WORKSPACE });
    h.answers.together = () => 503;
    h.answers.nvidia = () => 503;
    h.hub = () => 'fail';

    const failure = await call().then(
      () => null,
      (err: unknown) => err
    );

    expect(failure).toBeInstanceOf(NormalizedModelError);
    const classification = (failure as NormalizedModelError).classification;
    expect(classification).toBe('route_config_error');
    const sentence = customerFailureMessage({ classification, stage: 'synthesis' });
    expect(sentence.id).toBe('ai_service_unavailable_writing');
    expect(sentence.text).not.toMatch(/workspace|endpoint|serverless|together|anthropic/i);
  });
});

describe('ANTHROPIC_WORKSPACE_ID', () => {
  it('is sent as the anthropic-workspace-id header when set', async () => {
    h.answers.openrouter = () => 402;
    config.anthropic.workspaceId = 'wrkspc_test_0001';

    const result = await call();

    expect(result.routeUsed?.provider).toBe('anthropic');
    const request = h.sent.find((sent) => sent.provider === 'anthropic');
    expect(request?.headers['anthropic-workspace-id']).toBe('wrkspc_test_0001');
    expect(request?.headers['x-api-key']).toBe('test-anthropic');
    expect(request?.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('sends no such header when unset, so a workspace-scoped key works as before', async () => {
    h.answers.openrouter = () => 402;

    await call();

    const request = h.sent.find((sent) => sent.provider === 'anthropic');
    expect(request).toBeDefined();
    expect('anthropic-workspace-id' in (request?.headers ?? {})).toBe(false);
  });

  it('is never sent to another provider', async () => {
    h.answers.openrouter = () => 402;
    h.answers.anthropic = () => 529;
    config.anthropic.workspaceId = 'wrkspc_test_0001';

    await call();

    for (const sent of h.sent.filter((entry) => entry.provider !== 'anthropic')) {
      expect('anthropic-workspace-id' in sent.headers).toBe(false);
    }
  });
});
