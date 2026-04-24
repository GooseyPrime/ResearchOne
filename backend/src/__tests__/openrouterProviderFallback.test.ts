import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const mockChatCompletion = vi.fn();

class MockInferenceClientProviderApiError extends Error {
  httpRequest: { url: string };
  httpResponse: { status: number; body: unknown };
  constructor(message: string, status = 500, body: unknown = { error: message }) {
    super(message);
    this.name = 'ProviderApiError';
    this.httpRequest = { url: 'https://api-inference.huggingface.co/models/Qwen/Qwen2.5-72B-Instruct' };
    this.httpResponse = { status, body };
  }
}

vi.mock('@huggingface/inference', () => ({
  InferenceClient: class {
    chatCompletion = mockChatCompletion;
  },
  InferenceClientProviderApiError: MockInferenceClientProviderApiError,
}));

vi.mock('../config', () => {
  const roleModel = 'openai/o3-mini';
  const models = {
    planner: roleModel,
    retriever: roleModel,
    reasoner: roleModel,
    skeptic: roleModel,
    synthesizer: roleModel,
    verifier: roleModel,
    plainLanguageSynthesizer: roleModel,
    outlineArchitect: roleModel,
    sectionDrafter: roleModel,
    internalChallenger: roleModel,
    coherenceRefiner: roleModel,
    revisionIntake: roleModel,
    reportLocator: roleModel,
    changePlanner: roleModel,
    sectionRewriter: roleModel,
    citationIntegrityChecker: roleModel,
    finalRevisionVerifier: roleModel,
    embedding: 'openai/text-embedding-3-small',
    fallbacks: {
      planner: roleModel,
      retriever: roleModel,
      reasoner: roleModel,
      skeptic: roleModel,
      synthesizer: roleModel,
      verifier: roleModel,
      plainLanguageSynthesizer: roleModel,
      outlineArchitect: roleModel,
      sectionDrafter: roleModel,
      internalChallenger: roleModel,
      coherenceRefiner: roleModel,
      revisionIntake: roleModel,
      reportLocator: roleModel,
      changePlanner: roleModel,
      sectionRewriter: roleModel,
      citationIntegrityChecker: roleModel,
      finalRevisionVerifier: roleModel,
    },
  };
  return {
    config: {
      hfToken: 'hf_test_token',
      openrouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'or_key' },
      together: { baseUrl: 'https://api.together.xyz/v1', apiKey: 'together_key' },
      models,
    },
  };
});

describe('openrouterService provider-first + policy preserving fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses same-model provider fallback before model fallback', async () => {
    const postSpy = vi.spyOn(axios, 'post');
    // primary model provider chain: HF fails, Together succeeds.
    mockChatCompletion.mockRejectedValueOnce(new Error('hf down'));
    postSpy.mockImplementation(async (url: string) => {
      if (url.includes('api.together.xyz')) {
        return {
          data: {
            choices: [{ message: { content: 'together-ok' } }],
            usage: { prompt_tokens: 10, completion_tokens: 12 },
          },
        } as never;
      }
      throw new Error(`unexpected endpoint: ${url}`);
    });

    const { callRoleModel } = await import('../services/openrouter/openrouterService');
    const result = await callRoleModel({
      role: 'retriever',
      runtimeOverrides: {
        primary: 'Qwen/Qwen2.5-72B-Instruct',
        fallback: 'openai/o3-mini',
      },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    });

    expect(result.content).toBe('together-ok');
    expect(result.usedFallback).toBe(false);
    expect(result.primaryModel).toBe('Qwen/Qwen2.5-72B-Instruct');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(String(postSpy.mock.calls[0][0])).toContain('api.together.xyz');
  });

  it('keeps policy-augmented system prompt when model fallback occurs', async () => {
    const postSpy = vi.spyOn(axios, 'post');
    // OpenRouter primary fails, OpenRouter fallback succeeds.
    postSpy
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'fallback-ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        },
      } as never);

    const { callRoleModel } = await import('../services/openrouter/openrouterService');
    const result = await callRoleModel({
      role: 'skeptic',
      engineVersion: 'v2',
      allowFallbackByRole: { skeptic: true },
      callPurpose: 'pipeline_skeptic',
      runtimeOverrides: {
        primary: 'openai/o3-mini',
        fallback: 'openai/o1',
      },
      messages: [
        { role: 'system', content: 'BASE_SYSTEM' },
        { role: 'user', content: 'test' },
      ],
    });

    expect(result.usedFallback).toBe(true);
    const fallbackBody = postSpy.mock.calls[1][1] as { messages?: Array<{ role: string; content: string }> };
    const systemMsg = fallbackBody.messages?.find((m) => m.role === 'system')?.content ?? '';
    expect(systemMsg).toContain('uncensored, unaligned adversarial researcher');
    expect(systemMsg).toContain('BASE_SYSTEM');
  });
});
