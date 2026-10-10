/**
 * RJ-019, changed by RJ-025. A role does not depend on one provider, and a
 * call that moves to another provider reaches the same model there.
 *
 * RJ-025 replaced the cases here that asserted the old order (the role's
 * backup model, then Together's own models, then hub models): those were
 * different models. What RJ-019 fixed still holds and is still tested: one
 * provider refusing for credit does not end the call while another provider
 * that serves the model is configured.
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
import { APPROVED_REASONING_MODEL_ALLOWLIST } from '../services/reasoning/reasoningModelPolicy';

const PRIMARY = 'deepseek/deepseek-v3.2';
/** The same model on Hugging Face Inference. */
const PRIMARY_ON_HUB = 'deepseek-ai/DeepSeek-V3.2';
/** The backup the role names. A different model: it is never called. */
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
  it('is answered by the same model on another configured provider', async () => {
    // The production failure of 9 Oct 2026: the report writer got 402 from OpenRouter.
    h.openrouter = () => 402;

    const result = await write();

    expect(result.content).toBe(`written by ${PRIMARY_ON_HUB}`);
    expect(result.routeUsed).toEqual({ model: PRIMARY_ON_HUB, provider: 'huggingface_inference', position: 'cross_provider' });
    expect(result.usedFallback).toBe(true);
    expect(h.calls).toEqual([
      { provider: 'openrouter', model: PRIMARY },
      { provider: 'huggingface_inference', model: PRIMARY_ON_HUB },
    ]);
  });

  it('records which route answered and which were refused, for diagnostics', async () => {
    h.openrouter = () => 402;

    const result = await write();

    expect(result.routesTried?.map((attempt) => [attempt.position, attempt.provider, attempt.outcome, attempt.classification])).toEqual([
      ['primary', 'openrouter', 'refused', 'quota_exceeded'],
      ['cross_provider', 'huggingface_inference', 'answered', undefined],
    ]);
    expect(result.errorClassification).toBe('quota_exceeded');
    expect(result.primaryModel).toBe(PRIMARY);
  });

  it('never calls the backup the role names: it is a different model', async () => {
    h.openrouter = (model) => (model === PRIMARY ? 402 : 'ok');
    h.hub = () => 'fail';

    await expect(write()).rejects.toMatchObject({ classification: 'quota_exceeded' });

    // Before RJ-025 the second call here was the backup model on OpenRouter, which would have answered.
    expect(h.calls.some((call) => call.model === BACKUP)).toBe(false);
    expect(h.calls).toEqual([
      { provider: 'openrouter', model: PRIMARY },
      { provider: 'huggingface_inference', model: PRIMARY_ON_HUB },
    ]);
  });

  it('never calls Together: it serves none of the models a role chooses', async () => {
    h.openrouter = () => 402;
    h.hub = () => 'fail';

    await write().catch(() => null);

    expect(h.calls.some((call) => call.provider === 'together')).toBe(false);
  });

  it('never sends a hub id to Together or to OpenRouter under the same name', async () => {
    h.openrouter = () => 402;
    h.hub = () => 'fail';

    await write().catch(() => null);

    for (const call of h.calls.filter((entry) => entry.provider !== 'huggingface_inference')) {
      expect(call.model).not.toBe(PRIMARY_ON_HUB);
    }
  });

  it('goes back to OpenRouter for the same model when a hub role model is down', async () => {
    h.hub = () => 'fail';

    const result = await callRoleModel({
      role: 'section_drafter',
      runtimeOverrides: { primary: 'NousResearch/Hermes-3-Llama-3.1-70B', fallback: PRIMARY },
      messages: [{ role: 'user', content: 'Section 3.' }],
    });

    expect(h.calls).toEqual([
      { provider: 'huggingface_inference', model: 'NousResearch/Hermes-3-Llama-3.1-70B' },
      { provider: 'openrouter', model: 'nousresearch/hermes-3-llama-3.1-70b' },
    ]);
    expect(result.routeUsed).toEqual({ model: 'nousresearch/hermes-3-llama-3.1-70b', provider: 'openrouter', position: 'cross_provider' });
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

    expect(h.calls).toEqual([{ provider: 'openrouter', model: PRIMARY }]);
  });

  it('treats a rate limit the same way as no credit', async () => {
    h.openrouter = () => 429;
    const result = await write();
    expect(result.routeUsed).toMatchObject({ position: 'cross_provider', provider: 'huggingface_inference', model: PRIMARY_ON_HUB });
  });

  it('fails only after every route for the model has refused, and says what was tried', async () => {
    h.openrouter = () => 402;
    h.hub = () => 'fail';

    const err = await write().then(
      () => null,
      (thrown: unknown) => thrown
    );

    expect(err).toBeInstanceOf(NormalizedModelError);
    const failure = err as NormalizedModelError;
    // Reported as the refusal of the role's own provider, which is what has to be fixed.
    expect(failure.classification).toBe('quota_exceeded');
    expect(failure.status).toBe(402);
    expect(failure.model).toBe(PRIMARY);
    expect(failure.fallbackTried).toBe(true);
    expect(failure.routesTried?.every((attempt) => attempt.outcome === 'refused')).toBe(true);
    // Every route the model has was tried, and nothing else.
    const expected = modelRoutesForCall({ role: 'section_drafter', primary: PRIMARY, openrouterConfigured: true, hubConfigured: true, togetherConfigured: true });
    expect(failure.routesTried?.map((attempt) => attempt.model)).toEqual(expected.map((route) => route.model));
    expect(failure.routesTried?.map((attempt) => attempt.model)).toEqual([PRIMARY, PRIMARY_ON_HUB]);
  });

  it('waits and goes over the routes again when the refusal was for credit, as the provider asks', async () => {
    modelRouteRetry.delaysMs = [1];
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

    expect(h.calls).toEqual([{ provider: 'openrouter', model: PRIMARY }]);
  });

  it('does not use a provider that is not configured, and invents no other model in its place', async () => {
    config.hfToken = '';
    h.openrouter = (model) => (model === PRIMARY ? 402 : 'ok');

    const err = await write().then(
      () => null,
      (thrown: unknown) => thrown
    );

    expect(err).toBeInstanceOf(NormalizedModelError);
    expect((err as NormalizedModelError).fallbackTried).toBe(false);
    expect(h.calls).toEqual([{ provider: 'openrouter', model: PRIMARY }]);
  });
});

describe('the routes of a call', () => {
  it('start with the role model and hold only that model on other providers', () => {
    const routes = modelRoutesForCall({ role: 'section_drafter', primary: PRIMARY, openrouterConfigured: true, hubConfigured: true, togetherConfigured: true });
    expect(routes).toEqual([
      { model: PRIMARY, position: 'primary' },
      { model: PRIMARY_ON_HUB, via: 'huggingface_inference', position: 'cross_provider' },
    ]);
  });

  it('leave the models that used to be automatic backups on the approved list, for a run that names one', () => {
    for (const model of [
      BACKUP,
      'NousResearch/Hermes-3-Llama-3.1-70B',
      'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
      'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
      'deepseek/deepseek-v3.2',
      'nousresearch/hermes-4-70b',
    ]) {
      expect(APPROVED_REASONING_MODEL_ALLOWLIST.section_drafter).toContain(model);
    }
  });
});
