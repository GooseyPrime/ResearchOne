import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { callRoleModel } from '../services/openrouter/openrouterService';

/**
 * Locks in the contract added on 2026-04-28-PM (post the "No allowed
 * providers are available" outage): every OpenRouter chat-completions
 * call MUST send a `provider` block that:
 *   - allows fallbacks (`allow_fallbacks: true`)
 *   - permits routing to providers that train on prompts (`data_collection: 'allow'`)
 *     by default, with an opt-out via OPENROUTER_DATA_COLLECTION=deny
 *   - requires upstreams to support the requested parameters
 *
 * Without this block, OpenRouter applies the *account's* default
 * provider filter, which on a typical account excludes most uncensored
 * upstream providers and gives us a 404 with no actionable cause.
 */

vi.mock('axios');
const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn>; isAxiosError: typeof axios.isAxiosError };

describe('OpenRouter request body — provider block', () => {
  beforeEach(() => {
    mockedAxios.post = vi.fn(async () => ({
      data: {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    }));
    mockedAxios.isAxiosError = ((_e: unknown) => false) as typeof axios.isAxiosError;
  });

  it('always sends provider.allow_fallbacks=true and require_parameters=true on V2 OpenRouter calls', async () => {
    await callRoleModel({
      role: 'planner',
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
      ],
    });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const call = mockedAxios.post.mock.calls[0];
    const url = call[0] as string;
    const body = call[1] as Record<string, unknown>;
    expect(url).toMatch(/\/chat\/completions$/);
    expect(body).toHaveProperty('provider');
    const provider = body.provider as Record<string, unknown>;
    expect(provider.allow_fallbacks).toBe(true);
    expect(provider.require_parameters).toBe(true);
    expect(['allow', 'deny']).toContain(provider.data_collection);
  });

  it('uses an OpenRouter slug for the V2 planner default (not a single-provider HF slug)', async () => {
    await callRoleModel({
      role: 'planner',
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
      ],
    });
    const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    const model = body.model as string;
    // Sanity guard: post-2026-04-28-PM, V2 default planner is on the
    // multi-provider DeepSeek / Kimi / Qwen Thinking line, never a
    // single-provider Hermes / Dolphin / Euryale slug.
    expect(model).not.toMatch(/^nousresearch\/hermes-/);
    expect(model).not.toMatch(/^cognitivecomputations\//);
    expect(model).not.toMatch(/^sao10k\//);
    // The planner default is verified-multi-provider on OpenRouter.
    expect([
      'deepseek/deepseek-v3.2',
      'deepseek/deepseek-chat-v3.1',
      'deepseek/deepseek-r1-0528',
      'moonshotai/kimi-k2-thinking',
      'qwen/qwen3-235b-a22b-thinking-2507',
    ]).toContain(model);
  });

  /**
   * Regression guard for the PR #41 review (Copilot 3+4):
   * `qwen/qwen3-235b-a22b-thinking-2507` is a lowercase OpenRouter slug
   * whose namespace prefix overlaps with the HF `Qwen/` org. A previous
   * revision of `isHfRepoModel` listed lowercase `qwen/` as an HF prefix,
   * which silently misrouted this slug through HF Inference (where it
   * does not exist). The contract this test locks in: if the V2 reasoner
   * is wired to a `qwen/` OpenRouter slug, `callRoleModel` MUST POST to
   * the OpenRouter chat-completions endpoint, not to HF Inference.
   */
  it('routes lowercase qwen/ OpenRouter slugs through OpenRouter, not HF', async () => {
    await callRoleModel({
      role: 'reasoner',
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      runtimeOverrides: {
        primary: 'qwen/qwen3-235b-a22b-thinking-2507',
        fallback: 'qwen/qwen3-235b-a22b-thinking-2507',
      },
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q' },
      ],
    });
    expect(mockedAxios.post).toHaveBeenCalled();
    const url = mockedAxios.post.mock.calls[0][0] as string;
    // Must hit OpenRouter, not the HF Inference Providers API.
    expect(url).toMatch(/openrouter\.ai\/api\/v1\/chat\/completions$/);
    expect(url).not.toMatch(/api-inference\.huggingface\.co/);
    const body = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.model).toBe('qwen/qwen3-235b-a22b-thinking-2507');
    // And the runtime provider block is present.
    expect(body).toHaveProperty('provider');
  });
});
