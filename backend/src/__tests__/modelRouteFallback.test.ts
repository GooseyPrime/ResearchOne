/**
 * RJ-019. A role does not depend on one provider.
 *
 * Production run R1-20261009-1316-KTDDV-9 reached "Writing the report" and was
 * thrown away: the section writer's model answered 402 (out of credit), its
 * backup sat on the same provider and answered 402 as well, and the call gave
 * up while two other providers were configured and idle.
 *
 * Only the outside world is replaced here: the HTTP client and the Hugging Face
 * client. The routing, the order and the record of what was tried are the
 * shipped code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** Every provider call made, in order: which provider, which model. */
  calls: [] as Array<{ provider: 'openrouter' | 'together' | 'huggingface_inference'; model: string }>,
  /** What a provider answers. Return a number to refuse with that HTTP status. */
  openrouter: (_model: string, _nth: number): number | 'ok' => 'ok',
  together: (_model: string): number | 'ok' => 'ok',
  hub: (_model: string): 'fail' | 'ok' => 'ok',
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
  const post = vi.fn(async (url: string, body: { model: string }) => {
    const provider = url.includes('together') ? 'together' : 'openrouter';
    h.calls.push({ provider, model: body.model });
    const nth = h.calls.filter((call) => call.provider === provider && call.model === body.model).length;
    const answer = provider === 'together' ? h.together(body.model) : h.openrouter(body.model, nth);
    if (answer !== 'ok') {
      throw new FakeAxiosError(
        answer,
        answer === 402
          ? 'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.'
          : `refused with ${answer}`
      );
    }
    return {
      data: {
        choices: [{ message: { content: `written by ${body.model}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 5 },
      },
    };
  });
  const isAxiosError = (err: unknown): boolean => Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError);
  return { default: { post, isAxiosError }, isAxiosError, AxiosError: FakeAxiosError };
});

vi.mock('@huggingface/inference', () => ({
  InferenceClient: class {
    async chatCompletion(payload: { model: string }) {
      h.calls.push({ provider: 'huggingface_inference', model: payload.model });
      if (h.hub(payload.model) === 'fail') throw new Error('503 Service Unavailable from the inference provider');
      return { choices: [{ message: { content: `written by ${payload.model}` } }], usage: { prompt_tokens: 3, completion_tokens: 5 } };
    }
  },
}));

vi.mock('../services/telemetry', () => ({ emitCallTelemetry: vi.fn() }));

import { config } from '../config';
import {
  callRoleModel,
  modelRouteRetry,
  modelRoutesForCall,
  NormalizedModelError,
} from '../services/openrouter/openrouterService';
import { TOGETHER_BACKUP_MODELS } from '../services/openrouter/providerRoutes';
import {
  APPROVED_REASONING_MODEL_ALLOWLIST,
  crossProviderBackupModelsForRole,
  isHfRepoModel,
} from '../services/reasoning/reasoningModelPolicy';

const PRIMARY = 'deepseek/deepseek-v3.2';
const BACKUP = 'moonshotai/kimi-k2-thinking';

const was = {
  openrouterKey: config.openrouter.apiKey,
  togetherKey: config.together.apiKey,
  hfToken: config.hfToken,
  delays: [...modelRouteRetry.delaysMs],
};

function write() {
  return callRoleModel({
    role: 'section_drafter',
    runtimeOverrides: { primary: PRIMARY, fallback: BACKUP },
    messages: [
      { role: 'system', content: 'Write the section.' },
      { role: 'user', content: 'Section 3.' },
    ],
  });
}

beforeEach(() => {
  h.calls.length = 0;
  h.openrouter = () => 'ok';
  h.together = () => 'ok';
  h.hub = () => 'ok';
  config.openrouter.apiKey = 'test-openrouter';
  config.together.apiKey = 'test-together';
  config.hfToken = 'test-hub';
  modelRouteRetry.delaysMs = [];
});

afterEach(() => {
  config.openrouter.apiKey = was.openrouterKey;
  config.together.apiKey = was.togetherKey;
  config.hfToken = was.hfToken;
  modelRouteRetry.delaysMs = [...was.delays];
});

describe('a model call that one provider refuses for credit', () => {
  it('is answered by another configured provider when the role model and its backup are both out of credit', async () => {
    h.openrouter = () => 402;

    const result = await write();

    expect(result.content).toContain('written by');
    expect(result.routeUsed?.position).toBe('cross_provider');
    expect(result.routeUsed?.provider).toBe('together');
    expect(result.usedFallback).toBe(true);
    // The order the role already had comes first, and nothing in it is skipped.
    expect(h.calls.slice(0, 2)).toEqual([
      { provider: 'openrouter', model: PRIMARY },
      { provider: 'openrouter', model: BACKUP },
    ]);
    expect(h.calls[2]).toEqual({ provider: 'together', model: TOGETHER_BACKUP_MODELS[0] });
  });

  it('records which route answered and which were refused, for diagnostics', async () => {
    h.openrouter = () => 402;

    const result = await write();

    expect(result.routesTried?.map((attempt) => [attempt.position, attempt.provider, attempt.outcome, attempt.classification])).toEqual([
      ['primary', 'openrouter', 'refused', 'quota_exceeded'],
      ['backup', 'openrouter', 'refused', 'quota_exceeded'],
      ['cross_provider', 'together', 'answered', undefined],
    ]);
    expect(result.errorClassification).toBe('quota_exceeded');
    expect(result.primaryModel).toBe(PRIMARY);
  });

  it('goes on to Hugging Face when Together is down too', async () => {
    h.openrouter = () => 402;
    h.together = () => 503;

    const result = await write();

    expect(result.routeUsed).toMatchObject({ position: 'cross_provider', provider: 'huggingface_inference' });
  });

  it('writes the report on Together when OpenRouter is out of credit and Hugging Face cannot answer', async () => {
    // The production failure of 9 Oct 2026: the report writer got 402 from OpenRouter.
    h.openrouter = () => 402;
    h.hub = () => 'fail';

    const result = await write();

    expect(result.content).toContain('written by');
    expect(result.routeUsed).toMatchObject({ position: 'cross_provider', provider: 'together' });
    const togetherCalls = h.calls.filter((call) => call.provider === 'together');
    expect(togetherCalls).toHaveLength(1);
    // The id sent to Together is one Together serves without a dedicated endpoint.
    expect(togetherCalls[0].model).toBe('deepseek-ai/DeepSeek-V4.1-Flash');
  });

  it('writes the report on Together when there is no Hugging Face token at all', async () => {
    config.hfToken = '';
    h.openrouter = () => 402;
    h.hub = () => 'fail';

    const result = await write();

    expect(result.routeUsed).toMatchObject({ position: 'cross_provider', provider: 'together' });
  });

  it('goes on to the next model when a host does not carry the one asked for', async () => {
    h.openrouter = () => 402;
    h.hub = () => 'fail';
    // Together answers 404 for a model it does not carry.
    h.together = (model) => (model === 'deepseek-ai/DeepSeek-V4.1-Flash' ? 404 : 'ok');

    const result = await write();

    expect(result.routeUsed).toMatchObject({ position: 'cross_provider', provider: 'together', model: 'zai-org/GLM-5.3-Flash' });
  });

  it('never sends a hub id to Together, and never a Together id to Hugging Face', async () => {
    h.openrouter = () => 402;
    h.hub = () => 'fail';
    h.together = () => 503;

    await write().catch(() => null);

    const sentTo = (provider: string): string[] => h.calls.filter((call) => call.provider === provider).map((call) => call.model);
    expect(sentTo('together')).toEqual([...TOGETHER_BACKUP_MODELS]);
    expect(sentTo('huggingface_inference').length).toBeGreaterThan(0);
    for (const model of sentTo('huggingface_inference')) expect(TOGETHER_BACKUP_MODELS).not.toContain(model);
  });

  it('records one refusal per request made: a Together answer implies no Hugging Face request', async () => {
    h.openrouter = () => 402;

    const result = await write();

    expect(h.calls.some((call) => call.provider === 'huggingface_inference')).toBe(false);
    expect(result.routesTried?.some((attempt) => attempt.provider === 'huggingface_inference')).toBe(false);
  });

  it('still tries other providers when the role model is out of credit and its backup is no longer carried', async () => {
    h.openrouter = (model) => (model === PRIMARY ? 402 : model === BACKUP ? 404 : 'ok');

    const result = await write();

    expect(result.routeUsed?.position).toBe('cross_provider');
  });

  it('still tries other providers when a hub role model is down, without sending its id to Together', async () => {
    h.hub = (model) => (model === 'NousResearch/Hermes-3-Llama-3.1-70B' ? 'fail' : 'ok');
    h.together = () => 404;

    const result = await callRoleModel({
      role: 'section_drafter',
      runtimeOverrides: { primary: 'NousResearch/Hermes-3-Llama-3.1-70B', fallback: 'NousResearch/Hermes-3-Llama-3.1-70B' },
      messages: [{ role: 'user', content: 'Section 3.' }],
    });

    expect(result.routeUsed?.position).toBe('cross_provider');
    expect(h.calls.some((call) => call.provider === 'together' && call.model === 'NousResearch/Hermes-3-Llama-3.1-70B')).toBe(false);
  });

  it('never moves a request made with the customer\'s own key onto the platform\'s other providers', async () => {
    h.openrouter = () => 402;

    await expect(
      callRoleModel({
        role: 'section_drafter',
        runtimeOverrides: { primary: PRIMARY, fallback: BACKUP },
        byokApiKeyOverride: 'customer-key',
        messages: [{ role: 'user', content: 'Section 3.' }],
      })
    ).rejects.toMatchObject({ classification: 'quota_exceeded' });

    expect(h.calls.every((call) => call.provider === 'openrouter')).toBe(true);
  });

  it('uses the role backup, and no other provider, when only the role model is refused', async () => {
    h.openrouter = (model) => (model === PRIMARY ? 402 : 'ok');

    const result = await write();

    expect(result.model).toBe(BACKUP);
    expect(result.routeUsed).toEqual({ model: BACKUP, provider: 'openrouter', position: 'backup' });
    expect(h.calls).toEqual([
      { provider: 'openrouter', model: PRIMARY },
      { provider: 'openrouter', model: BACKUP },
    ]);
  });

  it('treats a rate limit the same way as no credit', async () => {
    h.openrouter = () => 429;
    const result = await write();
    expect(result.routeUsed?.position).toBe('cross_provider');
  });

  it('fails only after every configured route has refused, and says what was tried', async () => {
    h.openrouter = () => 402;
    h.together = () => 402;
    h.hub = () => 'fail';

    const err = await write().then(
      () => null,
      (thrown: unknown) => thrown
    );

    expect(err).toBeInstanceOf(NormalizedModelError);
    const failure = err as NormalizedModelError;
    // Reported as the refusal of the role's own models, which is what has to be fixed.
    expect(failure.classification).toBe('quota_exceeded');
    expect(failure.status).toBe(402);
    expect(failure.model).toBe(BACKUP);
    expect(failure.fallbackTried).toBe(true);
    const providers = new Set(failure.routesTried?.map((attempt) => attempt.provider));
    expect(providers).toEqual(new Set(['openrouter', 'huggingface_inference', 'together']));
    expect(failure.routesTried?.every((attempt) => attempt.outcome === 'refused')).toBe(true);
    // Every approved backup on every configured provider was tried.
    const expected = modelRoutesForCall({ role: 'section_drafter', primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: true, togetherConfigured: true });
    expect(new Set(failure.routesTried?.map((attempt) => attempt.model))).toEqual(new Set(expected.map((route) => route.model)));
  });

  it('waits and goes over the routes again when the refusal was for credit, as the provider asks', async () => {
    modelRouteRetry.delaysMs = [1];
    h.together = () => 402;
    h.hub = () => 'fail';
    // Refused while other requests are in flight; accepted once they settle.
    h.openrouter = (model, nth) => (model === PRIMARY && nth >= 2 ? 'ok' : 402);

    const result = await write();

    expect(result.model).toBe(PRIMARY);
    expect(result.routeUsed?.position).toBe('primary');
    expect(result.routesTried?.at(-1)).toMatchObject({ round: 2, outcome: 'answered' });
  });

  it('does not send a request the provider called malformed to other providers', async () => {
    h.openrouter = () => 400;

    await expect(write()).rejects.toMatchObject({ classification: 'bad_request' });

    expect(h.calls.map((call) => call.provider)).toEqual(['openrouter', 'openrouter']);
  });

  it('does not use a provider that is not configured', async () => {
    config.together.apiKey = '';
    config.hfToken = '';
    h.openrouter = (model) => (model === PRIMARY || model === BACKUP ? 402 : 'ok');

    const result = await write();

    expect(result.routeUsed).toMatchObject({ provider: 'openrouter', position: 'cross_provider' });
    expect(h.calls.every((call) => call.provider === 'openrouter')).toBe(true);
  });

  it('reaches the backup when the role model is a hub model and Hugging Face is down', async () => {
    h.hub = () => 'fail';
    h.together = () => 503;

    const result = await callRoleModel({
      role: 'section_drafter',
      runtimeOverrides: { primary: 'NousResearch/Hermes-3-Llama-3.1-70B', fallback: PRIMARY },
      messages: [{ role: 'user', content: 'Section 3.' }],
    });

    expect(result.routeUsed).toEqual({ model: PRIMARY, provider: 'openrouter', position: 'backup' });
  });
});

describe('the cross-provider backups', () => {
  it('are all on the approved list already', () => {
    const everything = crossProviderBackupModelsForRole('section_drafter', { openrouter: true, hub: true });
    expect(everything.length).toBeGreaterThan(0);
    for (const model of everything) expect(APPROVED_REASONING_MODEL_ALLOWLIST.section_drafter).toContain(model);
  });

  it('cover both the gateway and the hub, so either can stand in for the other', () => {
    const everything = crossProviderBackupModelsForRole('section_drafter', { openrouter: true, hub: true });
    expect(everything.some((model) => isHfRepoModel(model))).toBe(true);
    expect(everything.some((model) => !isHfRepoModel(model))).toBe(true);
  });

  it('never include a refusal-aligned model, for any role, because nobody chose it', () => {
    // The instruct bases a person may opt into but the engine may not default to.
    const refusalAligned = [
      'meta-llama/Llama-3.3-70B-Instruct',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen2.5-32B-Instruct',
      'Qwen/Qwen2.5-14B-Instruct',
      'Qwen/QwQ-32B-Preview',
    ];
    for (const role of ['section_drafter', 'double_check', 'internal_challenger'] as const) {
      const backups = crossProviderBackupModelsForRole(role, { openrouter: true, hub: true });
      expect(backups.length).toBeGreaterThan(0);
      for (const model of backups) {
        expect(refusalAligned).not.toContain(model);
        expect(model).not.toMatch(/^(anthropic|openai|google|mistralai)\//);
      }
    }
  });

  it('keep the role model first and its backup second, whatever else follows', () => {
    const routes = modelRoutesForCall({ role: 'section_drafter', primary: PRIMARY, fallback: BACKUP, openrouterConfigured: true, hubConfigured: true });
    expect(routes[0]).toEqual({ model: PRIMARY, position: 'primary' });
    expect(routes[1]).toEqual({ model: BACKUP, position: 'backup' });
    expect(routes.slice(2).every((route) => route.position === 'cross_provider')).toBe(true);
    // A provider the role has not used yet is tried before the one that refused it.
    expect(isHfRepoModel(routes[2].model)).toBe(true);
    expect(new Set(routes.map((route) => route.model)).size).toBe(routes.length);
  });
});
