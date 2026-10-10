/**
 * RJ-024, changed by RJ-025. Refusals that are about settings.
 *
 * RJ-025 removed Together's own list of backup models (they were different
 * models from the ones the roles chose), so the cases that asserted that list
 * and each role's old order were replaced by `rj025SameModelFailover.test.ts`.
 * What RJ-024 fixed about refusals is unchanged and still tested here: a 400
 * that is about how a route is set up moves the call on and tells an
 * administrator once, and the Anthropic workspace header.
 *
 * Together serves none of the roles' models today, so the Together cases add
 * a Together id to a row of the provider table for the length of one test.
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
  SAME_MODEL_PROVIDER_TABLE,
  routeConfigurationReason,
  type SameModelEntry,
} from '../services/openrouter/providerRoutes';
import { REASONING_MODEL_ROLES } from '../services/reasoning/reasoningModelPolicy';
import { customerFailureMessage } from '../services/reasoning/customerFailureMessage';

/** A Claude model: its other route is the same model on Anthropic. */
const CLAUDE = 'anthropic/claude-sonnet-4.5';
const CLAUDE_DIRECT = 'claude-sonnet-4-5-20250929';
/** A model that is not Claude: its other route is the same model on Hugging Face Inference. */
const OPEN = 'deepseek/deepseek-v3.2';
const OPEN_ON_HUB = 'deepseek-ai/DeepSeek-V3.2';
const BACKUP = 'moonshotai/kimi-k2-thinking';
/** For the Together cases: a model that, for one test, Together and NVIDIA serve too. */
const SERVED_WIDELY = 'vendor/test-model';
const WIDELY_ROW: SameModelEntry = {
  name: 'Test Model',
  claude: false,
  servedBy: {
    openrouter: SERVED_WIDELY,
    together: 'vendor/Test-Model-Together',
    huggingface_inference: 'NousResearch/Test-Model-Hub',
    nvidia: 'vendor/test-model-nim',
  },
};
const NON_SERVERLESS = (model: string): string =>
  `Unable to access non-serverless model ${model}. Please visit https://api.together.ai/models/${model} to create and start a new dedicated endpoint for the model.`;
const NEEDS_WORKSPACE =
  'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.';

const table = SAME_MODEL_PROVIDER_TABLE as SameModelEntry[];
let rowAdded = false;
function togetherServesTheModel(): void {
  table.push(WIDELY_ROW);
  rowAdded = true;
}

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

function call(role: ModelRole = 'section_drafter', primary: string = CLAUDE): Promise<ModelCallResult> {
  return callRoleModel({
    role,
    runtimeOverrides: { primary, fallback: BACKUP },
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
  if (rowAdded) table.splice(table.indexOf(WIDELY_ROW), 1);
  rowAdded = false;
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

describe('Together and a role call (RJ-025)', () => {
  it.each(REASONING_MODEL_ROLES.map((role) => [role]))('gives %s no Together route: Together serves no model a role chose', (role) => {
    const routes = modelRoutesForCall({ role, primary: OPEN, openrouterConfigured: true, hubConfigured: true, togetherConfigured: true, anthropicConfigured: true, nvidiaConfigured: true });
    expect(routes).toEqual([
      { model: OPEN, position: 'primary' },
      { model: OPEN_ON_HUB, via: 'huggingface_inference', position: 'cross_provider' },
    ]);
  });

  it('never sends Together one of the five models its backup list used to hold', async () => {
    h.answers.openrouter = () => 402;
    h.hub = () => 'fail';

    await call('section_drafter', OPEN).catch(() => null);

    expect(h.sent.some((sent) => sent.provider === 'together')).toBe(false);
    for (const old of ['deepseek-ai/DeepSeek-V4.1-Flash', 'zai-org/GLM-5.3-Flash', 'Qwen/Qwen3.8-Flash', 'openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct-Turbo']) {
      expect(h.sent.some((sent) => sent.model === old)).toBe(false);
    }
  });

  it('is asked for a model once the table says it serves that model, with its own key and Together\'s id for it', async () => {
    togetherServesTheModel();
    h.answers.openrouter = () => 402;

    const result = await call('section_drafter', SERVED_WIDELY);

    expect(result.routeUsed).toEqual({ model: 'vendor/Test-Model-Together', provider: 'together', position: 'cross_provider' });
    const request = h.sent.find((sent) => sent.provider === 'together');
    expect(request?.headers.Authorization).toBe('Bearer test-together');
  });

  it('is left out when there is no Together key, and a Hugging Face token alone does not bring it back', () => {
    togetherServesTheModel();
    const routes = modelRoutesForCall({ role: 'planner', primary: SERVED_WIDELY, openrouterConfigured: true, hubConfigured: true, togetherConfigured: false });
    expect(routes.some((route) => route.via === 'together')).toBe(false);
    expect(routes.some((route) => route.via === 'huggingface_inference')).toBe(true);
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

  it('moves on to the next provider when Together says a model needs a dedicated endpoint', async () => {
    togetherServesTheModel();
    h.answers.openrouter = () => 402;
    h.answers.together = (model) => ({ status: 400, message: NON_SERVERLESS(model) });

    const result = await call('section_drafter', SERVED_WIDELY);

    expect(result.routeUsed).toMatchObject({ provider: 'huggingface_inference', model: 'NousResearch/Test-Model-Hub' });
    expect(result.routesTried?.find((attempt) => attempt.provider === 'together' && attempt.outcome === 'refused')).toMatchObject({
      classification: 'route_config_error',
      status: 400,
    });
  });

  it('records the refusal and has nowhere else to go when Anthropic says the key needs a workspace header', async () => {
    h.answers.openrouter = () => 402;
    h.answers.anthropic = () => ({ status: 400, message: NEEDS_WORKSPACE });

    const failure = (await call().then(
      () => null,
      (err: unknown) => err
    )) as NormalizedModelError;

    expect(failure).toBeInstanceOf(NormalizedModelError);
    // Sonnet 4.5 is served by OpenRouter and Anthropic only. No other model is asked in its place.
    expect(h.sent.map((sent) => [sent.provider, sent.model])).toEqual([
      ['openrouter', CLAUDE],
      ['anthropic', CLAUDE_DIRECT],
    ]);
    expect(failure.routesTried?.find((attempt) => attempt.provider === 'anthropic')).toMatchObject({
      outcome: 'refused',
      classification: 'route_config_error',
      status: 400,
    });
  });

  it('moves to another provider when the refusal is of the role\'s own model, unlike a malformed request', async () => {
    h.answers.openrouter = (model) => ({ status: 400, message: NON_SERVERLESS(model) });

    const moved = await call();
    expect(moved.routeUsed).toEqual({ model: CLAUDE_DIRECT, provider: 'anthropic', position: 'cross_provider' });

    h.sent.length = 0;
    h.answers.openrouter = () => ({ status: 400, message: 'messages: at least one message is required' });
    await expect(call()).rejects.toMatchObject({ classification: 'bad_request' });
    expect(h.sent.map((sent) => sent.provider)).toEqual(['openrouter']);
  });

  it('logs one admin-only warning per process that names the provider and the reason, however many calls are refused', async () => {
    h.answers.openrouter = () => 402;
    h.answers.anthropic = () => ({ status: 400, message: NEEDS_WORKSPACE });

    await call('planner').catch(() => null);
    await call('section_drafter').catch(() => null);
    await call('verifier').catch(() => null);

    const warnings = adminWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('anthropic');
    expect(warnings[0].message).toContain('key_needs_workspace_header');
    expect(warnings[0].message).toContain('ANTHROPIC_WORKSPACE_ID');
    expect(warnings[0].meta).toMatchObject({ adminOnly: true, provider: 'anthropic', reason: 'key_needs_workspace_header' });
  });

  it('logs the dedicated-endpoint warning once per model, naming Together and the model', async () => {
    togetherServesTheModel();
    h.answers.openrouter = () => 402;
    h.answers.together = (model) => ({ status: 400, message: NON_SERVERLESS(model) });

    await call('section_drafter', SERVED_WIDELY);
    await call('section_drafter', SERVED_WIDELY);

    const warnings = adminWarnings();
    expect(warnings.map((entry) => entry.meta.model)).toEqual(['vendor/Test-Model-Together']);
    for (const warning of warnings) {
      expect(warning.message).toContain('together');
      expect(warning.message).toContain('model_needs_dedicated_endpoint');
      expect(warning.meta.provider).toBe('together');
    }
  });

  it('logs no admin warning for an ordinary refusal', async () => {
    h.answers.openrouter = () => 402;
    h.answers.anthropic = () => 429;

    await call().catch(() => null);

    expect(adminWarnings()).toEqual([]);
  });

  it('never puts the warning or the reason in what a customer reads', async () => {
    h.answers.openrouter = (model) => ({ status: 400, message: NON_SERVERLESS(model) });
    h.answers.anthropic = () => ({ status: 400, message: NEEDS_WORKSPACE });

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
    config.anthropic.workspaceId = 'wrkspc_test_0001';

    await call();

    const others = h.sent.filter((entry) => entry.provider !== 'anthropic');
    expect(others.length).toBeGreaterThan(0);
    for (const sent of others) {
      expect('anthropic-workspace-id' in sent.headers).toBe(false);
    }
  });
});
