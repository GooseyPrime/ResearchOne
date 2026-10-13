/**
 * RJ-025 repair. A key on the server is not proof a route can answer; every
 * route is the exact model the stage chose; a run whose required stage has no
 * usable route stops before any work and is not charged; a backup model sent
 * by an old form is refused; an unknown price stays unknown.
 *
 * Only the outside world is replaced: the HTTP client and the Hugging Face
 * client. No request leaves the test process. Routing, the provider table,
 * the route record, the probe and the readiness check are the shipped code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = 'openrouter' | 'anthropic' | 'together' | 'nvidia' | 'huggingface_inference';
type Answer = 'ok' | number | { status: number; message: string };

const h = vi.hoisted(() => ({
  sent: [] as Array<{ provider: Provider; model: string; maxTokens?: number; providerBlock?: unknown }>,
  answers: {
    openrouter: (() => 'ok') as (model: string) => Answer,
    anthropic: (() => 'ok') as (model: string) => Answer,
    together: (() => 'ok') as (model: string) => Answer,
    nvidia: (() => 'ok') as (model: string) => Answer,
    huggingface_inference: (() => 'ok') as (model: string) => Answer,
  },
}));

vi.mock('axios', () => {
  class FakeAxiosError extends Error {
    isAxiosError = true;
    response: { status: number; data: unknown };
    constructor(status: number, message: string) {
      super(message);
      this.response = { status, data: { error: { message } } };
    }
  }
  const post = vi.fn(async (url: string, body: { model: string; max_tokens?: number; provider?: unknown }) => {
    const provider: Provider = url.includes('api.anthropic.com')
      ? 'anthropic'
      : url.includes('nvidia')
        ? 'nvidia'
        : url.includes('together')
          ? 'together'
          : 'openrouter';
    h.sent.push({ provider, model: body.model, maxTokens: body.max_tokens, providerBlock: body.provider });
    const answer = h.answers[provider](body.model);
    if (typeof answer === 'number') throw new FakeAxiosError(answer, `refused with ${answer}`);
    if (typeof answer === 'object') throw new FakeAxiosError(answer.status, answer.message);
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
    async chatCompletion(payload: { model: string; max_tokens?: number }) {
      h.sent.push({ provider: 'huggingface_inference', model: payload.model, maxTokens: payload.max_tokens });
      const answer = h.answers.huggingface_inference(payload.model);
      if (answer !== 'ok') {
        const status = typeof answer === 'number' ? answer : answer.status;
        const message = typeof answer === 'object' ? answer.message : `Failed to perform inference: ${status}`;
        // The shape the Hugging Face client throws: the HTTP response is on the error.
        throw Object.assign(new Error(message), { name: 'ProviderApiError', httpResponse: { status, body: {} } });
      }
      return { choices: [{ message: { content: `written by ${payload.model}` } }], usage: { prompt_tokens: 3, completion_tokens: 5 } };
    }
  },
}));

vi.mock('../services/telemetry', () => ({ emitCallTelemetry: vi.fn() }));

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  adminQuery: vi.fn(async () => []),
}));

import { config } from '../config';
import { RESEARCH_ENGINE_VERSION } from '../config/researchEngine';
import {
  callRoleModel,
  classifyHfError,
  modelRouteRetry,
  NormalizedModelError,
  providerForRoute,
  serverModelRoutes,
} from '../services/openrouter/openrouterService';
import {
  assertRunModelRoutesReady,
  checkRunModelReadiness,
  ModelRoutesUnavailableError,
  NO_USABLE_MODEL_ROUTE,
  REQUIRED_RESEARCH_RUN_ROLES,
} from '../services/openrouter/modelRouteReadiness';
import { PROVIDER_HEALTH_MAX_TOKENS, probeRoute } from '../services/openrouter/providerHealth';
import { isSameModel, type ModelProviderName } from '../services/openrouter/providerRoutes';
import {
  recordRouteAnswered,
  recordRouteRefused,
  routeState,
  USABLE_FOR_MS,
} from '../services/openrouter/routeAvailability';
import { buildResearchFailureDetails } from '../services/reasoning/researchOrchestrator';
import { CUSTOMER_FAILURE_MESSAGES, customerFailureMessage } from '../services/reasoning/customerFailureMessage';
import { decideRunStateOnFailure } from '../services/reasoning/runStateMachine';
import { runChargeDecision } from '../services/billing/runChargeDecision';
import {
  OBSOLETE_BACKUP_MODEL_MESSAGE,
  ObsoleteBackupModelInputError,
  validateAndNormalizePayload,
  validatePerRunModelOverrides,
} from '../services/runtimeModelStore';
import { flattenModelOverridesForPrefill } from '../services/research/spinoffService';
import { presetsWithoutBackupModels } from '../api/routes/research';

const KIMI = 'moonshotai/kimi-k2-thinking';
const KIMI_HUB = 'moonshotai/Kimi-K2-Thinking';
const QWEN = 'qwen/qwen3-235b-a22b-thinking-2507';
const QWEN_HUB = 'Qwen/Qwen3-235B-A22B-Thinking-2507';
const V32 = 'deepseek/deepseek-v3.2';
const V32_HUB = 'deepseek-ai/DeepSeek-V3.2';
const HERMES4 = 'nousresearch/hermes-4-70b';
const HERMES4_HUB = 'NousResearch/Hermes-4-70B';

const research = { engineVersion: RESEARCH_ENGINE_VERSION, researchObjective: 'GENERAL_EPISTEMIC_RESEARCH' as const };

const was = {
  openrouterKey: config.openrouter.apiKey,
  anthropicKey: config.anthropic.apiKey,
  nvidiaKey: config.nvidia.apiKey,
  togetherKey: config.together.apiKey,
  hfToken: config.hfToken,
  retry: [...modelRouteRetry.delaysMs],
};

beforeEach(() => {
  h.sent.length = 0;
  for (const provider of Object.keys(h.answers) as Provider[]) h.answers[provider] = () => 'ok';
  config.openrouter.apiKey = 'test-openrouter';
  config.anthropic.apiKey = 'test-anthropic';
  config.nvidia.apiKey = 'test-nvidia';
  config.together.apiKey = 'test-together';
  config.hfToken = 'test-hub';
  modelRouteRetry.delaysMs = [];
});

afterEach(() => {
  config.openrouter.apiKey = was.openrouterKey;
  config.anthropic.apiKey = was.anthropicKey;
  config.nvidia.apiKey = was.nvidiaKey;
  config.together.apiKey = was.togetherKey;
  config.hfToken = was.hfToken;
  modelRouteRetry.delaysMs = was.retry;
  vi.useRealTimers();
});

const sentPairs = () => h.sent.map((sent) => [sent.provider, sent.model]);

describe('every route of a stage is the exact model it chose, on any provider that serves it', () => {
  it('maps each required stage to the same model under each provider own id', async () => {
    const readiness = await checkRunModelReadiness(research);
    for (const stage of readiness.stages) {
      expect(stage.routes.length).toBeGreaterThan(0);
      for (const route of stage.routes) {
        const chosenProvider = stage.routes[0].provider;
        expect(isSameModel({ provider: chosenProvider, model: stage.model }, { provider: route.provider, model: route.model })).toBe(true);
      }
    }
    const byRole = Object.fromEntries(readiness.stages.map((stage) => [stage.role, stage.routes.map((route) => [route.provider, route.model])]));
    expect(byRole.planner).toEqual([['openrouter', KIMI], ['huggingface_inference', KIMI_HUB]]);
    expect(byRole.reasoner).toEqual([['openrouter', QWEN], ['huggingface_inference', QWEN_HUB]]);
    expect(byRole.verifier).toEqual([['openrouter', V32], ['huggingface_inference', V32_HUB]]);
    expect(byRole.double_check).toEqual([['openrouter', HERMES4], ['huggingface_inference', HERMES4_HUB]]);
  });

  it('never probes Anthropic, Together or NVIDIA for a model they do not serve, though each has a key', async () => {
    await checkRunModelReadiness(research);
    const providers = new Set(h.sent.map((sent) => sent.provider));
    expect(providers).toEqual(new Set(['openrouter', 'huggingface_inference']));
  });

  it('checks every stage a run cannot finish without', () => {
    expect([...REQUIRED_RESEARCH_RUN_ROLES].sort()).toEqual(
      ['coherence_refiner', 'double_check', 'outline_architect', 'planner', 'reasoner', 'retriever', 'section_drafter', 'verifier'].sort()
    );
  });

  it('uses the run own model choice for a stage, and its routes, not the preset', async () => {
    const readiness = await checkRunModelReadiness({
      ...research,
      roles: ['verifier'],
      runtimeOverrideFor: (role) => (role === 'verifier' ? { primary: QWEN } : undefined),
    });
    expect(readiness.stages.map((stage) => stage.model)).toEqual([QWEN]);
    expect(readiness.stages[0].routes.map((route) => route.model)).toEqual([QWEN, QWEN_HUB]);
  });
});

describe('a key alone is not proof a route can answer', () => {
  it('probes a route nothing is known about, with the smallest request, and counts it only once it answered', async () => {
    expect(routeState('openrouter', V32)).toBe('unknown');
    const readiness = await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    expect(readiness.ready).toBe(true);
    expect(sentPairs()).toEqual([['openrouter', V32], ['huggingface_inference', V32_HUB]]);
    expect(h.sent.every((sent) => sent.maxTokens === PROVIDER_HEALTH_MAX_TOKENS)).toBe(true);
    expect(routeState('openrouter', V32)).toBe('usable');
  });

  it('asks OpenRouter with the same provider block a research call sends, so the account data policy applies', async () => {
    await probeRoute({ provider: 'openrouter', model: V32 });
    expect(h.sent[0].providerBlock).toEqual(expect.objectContaining({ data_collection: expect.any(String) }));
  });

  it('does not ask again while an answer is recent', async () => {
    await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    h.sent.length = 0;
    await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    expect(h.sent).toEqual([]);
  });

  it('asks again once the answer is too old to count', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    vi.setSystemTime(Date.now() + USABLE_FOR_MS + 1);
    h.sent.length = 0;
    await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    expect(sentPairs()).toEqual([['openrouter', V32], ['huggingface_inference', V32_HUB]]);
  });

  it('is not ready when every key is set but every route of a stage is out of credit', async () => {
    h.answers.openrouter = (model) => (model === V32 ? 402 : 'ok');
    h.answers.huggingface_inference = (model) => (model === V32_HUB ? 402 : 'ok');
    const readiness = await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    expect(readiness.ready).toBe(false);
    expect(readiness.unavailable[0].routes).toEqual([
      { provider: 'openrouter', model: V32, state: 'not_usable', reason: 'quota_exceeded' },
      { provider: 'huggingface_inference', model: V32_HUB, state: 'not_usable', reason: 'quota_exceeded' },
    ]);
  });

  it('is ready through any one provider with allowance left for the exact model', async () => {
    h.answers.openrouter = (model) => (model === V32 ? 402 : 'ok');
    const readiness = await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    expect(readiness.ready).toBe(true);
    expect(readiness.stages[0].routes.map((route) => route.state)).toEqual(['not_usable', 'usable']);
  });

  it('reads an empty Hugging Face account (402) as out of credit, not as an outage', () => {
    const err = Object.assign(new Error('You have exceeded your monthly included credits'), { httpResponse: { status: 402 } });
    expect(classifyHfError(err)).toBe('quota_exceeded');
    expect(classifyHfError(Object.assign(new Error('x'), { httpResponse: { status: 401 } }))).toBe('auth_error');
    expect(classifyHfError(Object.assign(new Error('x'), { httpResponse: { status: 429 } }))).toBe('rate_limited');
    expect(classifyHfError(new Error('503 Service Unavailable'))).toBe('provider_unavailable');
  });

  it('records a probe outcome the same way a call does', async () => {
    h.answers.huggingface_inference = () => 402;
    const result = await probeRoute({ provider: 'huggingface_inference', model: HERMES4_HUB });
    expect(result).toMatchObject({ ok: false, status: 402, classification: 'quota_exceeded' });
    expect(routeState('huggingface_inference', HERMES4_HUB)).toBe('not_usable');
  });
});

describe('a stage whose model only one provider serves (Hermes 4 70B)', () => {
  it('is not ready when Hugging Face, its only confirmed host, is out of credit, and no other model is probed', async () => {
    h.answers.openrouter = (model) => (model === HERMES4 ? { status: 404, message: `No endpoints found for ${HERMES4}.` } : 'ok');
    h.answers.huggingface_inference = (model) => (model === HERMES4_HUB ? 402 : 'ok');
    await expect(assertRunModelRoutesReady(research)).rejects.toBeInstanceOf(ModelRoutesUnavailableError);
    const asked = h.sent.filter((sent) => /hermes/i.test(sent.model)).map((sent) => [sent.provider, sent.model]);
    expect(asked).toEqual([['openrouter', HERMES4], ['huggingface_inference', HERMES4_HUB]]);
    // Only the stages' own models were ever asked: nothing in place of Hermes.
    const ownModels = new Set([KIMI, KIMI_HUB, QWEN, QWEN_HUB, V32, V32_HUB, HERMES4, HERMES4_HUB]);
    for (const sent of h.sent) expect(ownModels.has(sent.model)).toBe(true);
  });

  it('is not ready with no Hugging Face token at all', async () => {
    config.hfToken = '';
    h.answers.openrouter = (model) => (model === HERMES4 ? { status: 404, message: `No endpoints found for ${HERMES4}.` } : 'ok');
    const readiness = await checkRunModelReadiness(research);
    expect(readiness.unavailable.map((stage) => stage.role)).toEqual(['double_check']);
    expect(readiness.unavailable[0].routes).toEqual([
      { provider: 'openrouter', model: HERMES4, state: 'not_usable', reason: 'provider_unavailable' },
    ]);
  });
});

describe('a run with the caller own OpenRouter key', () => {
  it('sends no probe (it would be charged to them) and counts only an OpenRouter id the table confirms', async () => {
    const readiness = await checkRunModelReadiness({ ...research, byok: true });
    expect(h.sent).toEqual([]);
    expect(readiness.unavailable.map((stage) => stage.role)).toEqual(['double_check']);
    const verifier = readiness.stages.find((stage) => stage.role === 'verifier');
    expect(verifier?.routes).toEqual([{ provider: 'openrouter', model: V32, state: 'usable' }]);
  });
});

describe('a call skips a route refused moments ago for a reason about the account', () => {
  const call = () => callRoleModel({ role: 'verifier', ...research, messages: [{ role: 'user', content: 'Check this.' }] });

  it('goes straight to the same model on Hugging Face while OpenRouter is out of credit', async () => {
    recordRouteRefused('openrouter', V32, 'quota_exceeded', 'call');
    const result = await call();
    expect(sentPairs()).toEqual([['huggingface_inference', V32_HUB]]);
    expect(result.routeUsed).toEqual({ model: V32_HUB, provider: 'huggingface_inference', position: 'cross_provider' });
    expect(result.routesTried?.[0]).toMatchObject({ provider: 'openrouter', model: V32, outcome: 'skipped', classification: 'quota_exceeded' });
  });

  it('asks every route when all of them were refused, since the record may be out of date', async () => {
    recordRouteRefused('openrouter', V32, 'quota_exceeded', 'call');
    recordRouteRefused('huggingface_inference', V32_HUB, 'quota_exceeded', 'call');
    const result = await call();
    expect(sentPairs()).toEqual([['openrouter', V32]]);
    expect(result.routeUsed?.provider).toBe('openrouter');
    expect(routeState('openrouter', V32)).toBe('usable');
  });

  it('records a refusal so the next call does not wait on the same empty account', async () => {
    h.answers.openrouter = () => 402;
    await call();
    expect(routeState('openrouter', V32)).toBe('not_usable');
    h.sent.length = 0;
    await call();
    expect(sentPairs()).toEqual([['huggingface_inference', V32_HUB]]);
  });

  it('fails, with the same model only, when the one open route also refuses', async () => {
    recordRouteRefused('openrouter', V32, 'quota_exceeded', 'call');
    h.answers.huggingface_inference = () => 402;
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NormalizedModelError);
    expect((err as NormalizedModelError).classification).toBe('quota_exceeded');
    expect(sentPairs()).toEqual([['huggingface_inference', V32_HUB]]);
  });

  it('never records what a call made with a caller own key learned', async () => {
    h.answers.openrouter = () => 401;
    await callRoleModel({ role: 'verifier', ...research, byokApiKeyOverride: 'customer-key', messages: [{ role: 'user', content: 'x' }] }).catch(() => null);
    expect(routeState('openrouter', V32)).toBe('unknown');
  });

  it('a route that answered counts as usable for the next readiness check without another probe', async () => {
    recordRouteAnswered('openrouter', V32, 'call');
    recordRouteAnswered('huggingface_inference', V32_HUB, 'call');
    await checkRunModelReadiness({ ...research, roles: ['verifier'] });
    expect(h.sent).toEqual([]);
  });
});

describe('a required stage with no usable route: the run stops before any work, with no charge', () => {
  async function unavailableError(): Promise<ModelRoutesUnavailableError> {
    h.answers.openrouter = () => 402;
    h.answers.huggingface_inference = () => 402;
    const err = await assertRunModelRoutesReady(research).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelRoutesUnavailableError);
    return err as ModelRoutesUnavailableError;
  }

  it('stores the classification and each stage with its routes for administrators', async () => {
    const err = await unavailableError();
    const details = buildResearchFailureDetails(err, 'queued');
    expect(details.retryable).toBe(true);
    expect(details.failureMeta.classification).toBe(NO_USABLE_MODEL_ROUTE);
    const stages = details.failureMeta.unavailableStages as Array<{ role: string; routes: Array<{ provider: ModelProviderName }> }>;
    expect(stages.map((stage) => stage.role).sort()).toEqual([...REQUIRED_RESEARCH_RUN_ROLES].sort());
    expect(details.errorMessage).toContain('No usable route for the exact model');
  });

  it('shows the customer one plain sentence: not started, no other model, not charged, run again', async () => {
    const err = await unavailableError();
    const details = buildResearchFailureDetails(err, 'queued');
    const message = customerFailureMessage({ classification: String(details.failureMeta.classification), stage: 'queued' });
    expect(message.id).toBe('ai_model_unavailable');
    expect(message.text).toBe(CUSTOMER_FAILURE_MESSAGES.ai_model_unavailable);
    expect(message.text).toContain('You have not been charged.');
    expect(message.text).toContain('We do not swap in a different model.');
    expect(message.text).not.toMatch(/openrouter|hugging|hermes|deepseek|quota|402|route/i);
  });

  it('keeps the hold for a run again and never charges the stopped run', async () => {
    const err = await unavailableError();
    const details = buildResearchFailureDetails(err, 'queued');
    const transition = decideRunStateOnFailure({
      raw: details.failureMeta,
      classifierRetryable: details.retryable,
      retryAttempts: 0,
      retryBudget: 3,
    });
    expect(transition.nextStatus).toBe('failed');
    expect(transition.failureMeta.resumeAvailable).toBe(true);
    // What administrators need is kept on the stored row.
    expect(transition.failureMeta.unavailableStages).toHaveLength(REQUIRED_RESEARCH_RUN_ROLES.length);
    const decision = runChargeDecision({ status: transition.nextStatus, retryable: details.retryable });
    expect(decision).not.toBe('charge');
    expect(runChargeDecision({ status: 'aborted', retryable: false })).toBe('release_hold');
  });

  it('is checked in the orchestrator before the first stage, inside the failure path', async () => {
    const { readFileSync } = await import('fs');
    const source = readFileSync(require.resolve('../services/reasoning/researchOrchestrator.ts'), 'utf8');
    const tryStart = source.indexOf('  try {\n    // Before any work: every stage the run cannot finish without');
    const readiness = source.indexOf('await assertRunModelRoutesReady(', tryStart);
    const firstStage = source.indexOf("await progress('plan_generation'", tryStart);
    const firstModelCall = source.indexOf('await classifyIntent(', tryStart);
    expect(tryStart).toBeGreaterThan(0);
    expect(readiness).toBeGreaterThan(tryStart);
    expect(readiness).toBeLessThan(firstStage);
    expect(readiness).toBeLessThan(firstModelCall);
    // The hold is consumed only on completion.
    expect(source.indexOf('consumeHold(')).toBeGreaterThan(firstStage);
  });
});

describe('obsolete backup-model inputs are refused, not ignored', () => {
  it('refuses a per-run backup model with a plain reason', () => {
    expect(() => validatePerRunModelOverrides({ verifier: { primary: V32, fallback: HERMES4 } })).toThrow(ObsoleteBackupModelInputError);
    expect(() => validatePerRunModelOverrides({ verifier: { fallbackEnabled: true } })).toThrow(OBSOLETE_BACKUP_MODEL_MESSAGE);
    expect(() => validatePerRunModelOverrides({ verifier: { fallback: '' } })).toThrow(ObsoleteBackupModelInputError);
  });

  it('refuses a backup model in the admin settings the same way', () => {
    const err = (() => {
      try {
        validateAndNormalizePayload({ planner: { primary: KIMI, fallback: V32 } });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ObsoleteBackupModelInputError);
    expect((err as ObsoleteBackupModelInputError).status).toBe(400);
    expect((err as ObsoleteBackupModelInputError).code).toBe('obsolete_backup_model_input');
  });

  it('accepts a model choice with no backup, and keeps only the model', () => {
    expect(validatePerRunModelOverrides({ verifier: { primary: V32 } })).toEqual({ overrides: { verifier: { primary: V32 } }, embedding: undefined });
    expect(validatePerRunModelOverrides({ verifier: { primary: V32, fallback: null } })).toEqual({ overrides: { verifier: { primary: V32 } }, embedding: undefined });
  });

  it('carries only each role model from a parent run into a follow-up request', () => {
    expect(
      flattenModelOverridesForPrefill({ overrides: { verifier: { primary: V32, fallback: HERMES4, fallbackEnabled: true }, planner: { fallback: V32 } } })
    ).toEqual({ verifier: { primary: V32 } });
  });

  it('sends the request form one model per role, with no preset backup to offer', () => {
    const presets = presetsWithoutBackupModels();
    for (const roles of Object.values(presets)) {
      for (const entry of Object.values(roles)) expect(Object.keys(entry)).toEqual(['primary']);
    }
  });
});

describe('the routes a call takes are the routes the readiness check and preflight ask', () => {
  it('builds both from the same definition', () => {
    const routes = serverModelRoutes('verifier', V32).map((route) => [providerForRoute(route), route.model]);
    expect(routes).toEqual([['openrouter', V32], ['huggingface_inference', V32_HUB]]);
    config.hfToken = '';
    expect(serverModelRoutes('verifier', V32).map((route) => providerForRoute(route))).toEqual(['openrouter']);
  });
});
