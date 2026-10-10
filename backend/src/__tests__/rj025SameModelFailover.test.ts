/**
 * RJ-025. A call that moves to another provider reaches the same model there.
 *
 * Brandon's rule: "There should be NO BACKUPS that are trained differently
 * because of a provider difference." Before this, a refused call moved on to
 * whatever each provider had: Claude Haiku or Sonnet for every role, five
 * Together models, three hub models, an NVIDIA model picked by size, and two
 * more OpenRouter models. Each of those is a different model, trained
 * differently. Now every route of a call is the model the role chose.
 *
 * Only the outside world is replaced here: the HTTP client and the Hugging
 * Face client. No request leaves the test process. The routing, the provider
 * table and the record of what was tried are the shipped code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Provider = 'openrouter' | 'anthropic' | 'together' | 'nvidia' | 'huggingface_inference';
interface Sent {
  provider: Provider;
  model: string;
}
type Answer = 'ok' | number | { status: number; message: string };

const h = vi.hoisted(() => ({
  sent: [] as Sent[],
  answers: {
    openrouter: (() => 'ok') as (model: string, nth: number) => Answer,
    anthropic: (() => 'ok') as (model: string, nth: number) => Answer,
    together: (() => 'ok') as (model: string, nth: number) => Answer,
    nvidia: (() => 'ok') as (model: string, nth: number) => Answer,
  },
  hub: (() => 'ok') as (model: string) => 'ok' | 'fail',
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
  const post = vi.fn(async (url: string, body: { model: string }) => {
    const provider = url.includes('api.anthropic.com')
      ? 'anthropic'
      : url.includes('nvidia')
        ? 'nvidia'
        : url.includes('together')
          ? 'together'
          : 'openrouter';
    h.sent.push({ provider, model: body.model });
    const nth = h.sent.filter((sent) => sent.provider === provider && sent.model === body.model).length;
    const answer = h.answers[provider](body.model, nth);
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
      h.sent.push({ provider: 'huggingface_inference', model: payload.model });
      if (h.hub(payload.model) === 'fail') throw new Error('503 Service Unavailable from the inference provider');
      return { choices: [{ message: { content: `written by ${payload.model}` } }], usage: { prompt_tokens: 3, completion_tokens: 5 } };
    }
  },
}));

vi.mock('../services/telemetry', () => ({ emitCallTelemetry: vi.fn() }));

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

import { config } from '../config';
import { RESEARCH_ENGINE_VERSION } from '../config/researchEngine';
import { ENSEMBLE_PRESETS, V2_MODE_PRESETS } from '../config/researchEnsemblePresets';
import {
  callRoleModel,
  chosenModelsForRole,
  classifyModelError,
  modelRouteRetry,
  modelRoutesForCall,
  NormalizedModelError,
  providerForChosenModel,
  type ModelCallResult,
  type ModelRole,
  type ModelRoute,
} from '../services/openrouter/openrouterService';
import {
  MODEL_PROVIDER_NAMES,
  SAME_MODEL_PROVIDER_TABLE,
  isSameModel,
  providersServingModel,
  sameModelEntryFor,
  sameModelName,
  sameModelRoutesOnOtherProviders,
  type ModelProviderName,
  type ProviderSlot,
  type SameModelEntry,
} from '../services/openrouter/providerRoutes';
import {
  APPROVED_REASONING_MODEL_ALLOWLIST,
  REASONING_MODEL_ROLES,
  RESEARCH_OBJECTIVES,
} from '../services/reasoning/reasoningModelPolicy';
import { buildResearchFailureDetails } from '../services/reasoning/researchOrchestrator';
import { decideRunStateOnFailure } from '../services/reasoning/runStateMachine';
import { CUSTOMER_FAILURE_MESSAGES, customerFailureMessage } from '../services/reasoning/customerFailureMessage';
import { runChargeDecision } from '../services/billing/runChargeDecision';
import type { AxiosError } from 'axios';

const KIMI = 'moonshotai/kimi-k2-thinking';
const KIMI_HUB = 'moonshotai/Kimi-K2-Thinking';
const QWEN = 'qwen/qwen3-235b-a22b-thinking-2507';
const QWEN_HUB = 'Qwen/Qwen3-235B-A22B-Thinking-2507';
const V32 = 'deepseek/deepseek-v3.2';
const V32_HUB = 'deepseek-ai/DeepSeek-V3.2';
const R1_0528 = 'deepseek/deepseek-r1-0528';
const R1_0528_HUB = 'deepseek-ai/DeepSeek-R1-0528';
const HERMES4 = 'nousresearch/hermes-4-70b';
const HERMES4_HUB = 'NousResearch/Hermes-4-70B';
const SONNET_45 = 'anthropic/claude-sonnet-4.5';
const SONNET_45_DIRECT = 'claude-sonnet-4-5-20250929';
const OUT_OF_CREDIT =
  'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.';

const ALL_KEYS: Record<ModelProviderName, boolean> = {
  openrouter: true,
  anthropic: true,
  together: true,
  huggingface_inference: true,
  nvidia: true,
};
const DEFAULT_ORDER: ProviderSlot[] = ['openrouter', 'anthropic', 'together', 'nvidia'];

/** Every route a role could take if every provider had a key. */
function routesWithEveryKey(role: ModelRole, primary: string, extra: Partial<Parameters<typeof modelRoutesForCall>[0]> = {}): ModelRoute[] {
  return modelRoutesForCall({
    role,
    primary,
    openrouterConfigured: true,
    hubConfigured: true,
    togetherConfigured: true,
    anthropicConfigured: true,
    nvidiaConfigured: true,
    providerOrder: DEFAULT_ORDER,
    providerOrderSet: false,
    ...extra,
  });
}

/** The provider a route goes to. */
const providerOf = (route: ModelRoute): ModelProviderName => route.via ?? providerForChosenModel(route.model);

/** The table's name for the model a route reaches. */
const modelNameOf = (route: ModelRoute): string => sameModelName({ provider: providerOf(route), model: route.model });

/** Add a row to the provider table for one test, and take it out again. */
async function withTableRow<T>(row: SameModelEntry, run: () => T | Promise<T>): Promise<T> {
  const table = SAME_MODEL_PROVIDER_TABLE as SameModelEntry[];
  table.push(row);
  try {
    return await run();
  } finally {
    table.splice(table.indexOf(row), 1);
  }
}

/** Every (role, model) a role chooses without a per-run choice: each kind of research, and the server's own setting. */
function everyRoleChoice(): Array<{ role: ModelRole; model: string; backup: string; where: string }> {
  const out: Array<{ role: ModelRole; model: string; backup: string; where: string }> = [];
  for (const role of REASONING_MODEL_ROLES) {
    for (const objective of RESEARCH_OBJECTIVES) {
      out.push({ role, model: V2_MODE_PRESETS[objective][role].primary, backup: V2_MODE_PRESETS[objective][role].fallback, where: `research:${objective}` });
      out.push({ role, model: ENSEMBLE_PRESETS[objective][role].primary, backup: ENSEMBLE_PRESETS[objective][role].fallback, where: `earlier presets:${objective}` });
    }
  }
  return out;
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

/** A call the way a research run makes it: the research engine's own model for the role. */
function researchCall(role: ModelRole, extra: Partial<Parameters<typeof callRoleModel>[0]> = {}): Promise<ModelCallResult> {
  return callRoleModel({
    role,
    engineVersion: RESEARCH_ENGINE_VERSION,
    messages: [
      { role: 'system', content: 'Do the task.' },
      { role: 'user', content: 'Section 3.' },
    ],
    ...extra,
  });
}

const sentPairs = (): Array<[Provider, string]> => h.sent.map((sent) => [sent.provider, sent.model]);

beforeEach(() => {
  h.sent.length = 0;
  h.answers.openrouter = () => 'ok';
  h.answers.anthropic = () => 'ok';
  h.answers.together = () => 'ok';
  h.answers.nvidia = () => 'ok';
  h.hub = () => 'ok';
  config.openrouter.apiKey = 'test-openrouter';
  config.anthropic.apiKey = 'test-anthropic';
  config.nvidia.apiKey = 'test-nvidia';
  config.together.apiKey = 'test-together';
  config.hfToken = 'test-hub';
  config.modelProviderOrder = [...DEFAULT_ORDER];
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

describe('the provider table', () => {
  it('holds exactly what each provider catalog showed on 10 Oct 2026 for the models the research engine uses', () => {
    const served = (provider: ModelProviderName, id: string) => sameModelEntryFor(provider, id)?.servedBy;
    expect(served('openrouter', KIMI)).toEqual({ openrouter: KIMI, huggingface_inference: KIMI_HUB });
    expect(served('openrouter', QWEN)).toEqual({ openrouter: QWEN, huggingface_inference: QWEN_HUB });
    expect(served('openrouter', R1_0528)).toEqual({ openrouter: R1_0528, huggingface_inference: R1_0528_HUB });
    expect(served('openrouter', V32)).toEqual({ openrouter: V32, huggingface_inference: V32_HUB });
    // OpenRouter lists Hermes 4 70B with no endpoint, so only Hugging Face is confirmed.
    expect(served('openrouter', HERMES4)).toEqual({ huggingface_inference: HERMES4_HUB });
    expect(sameModelEntryFor('openrouter', HERMES4)?.notConfirmed).toEqual({ openrouter: HERMES4 });
  });

  it('names no model on Together or NVIDIA: neither catalog lists a model a role chose', () => {
    for (const entry of SAME_MODEL_PROVIDER_TABLE) {
      expect(entry.servedBy.together, entry.name).toBeUndefined();
      expect(entry.servedBy.nvidia, entry.name).toBeUndefined();
    }
  });

  it('gives Anthropic an id only for a Claude model, and a Claude id to no other model', () => {
    for (const entry of SAME_MODEL_PROVIDER_TABLE) {
      const ids = [...Object.values(entry.servedBy), ...Object.values(entry.notConfirmed ?? {})];
      if (entry.claude) {
        expect(entry.name).toMatch(/^Claude /);
        for (const id of ids) expect(id).toMatch(/claude/);
      } else {
        expect(entry.servedBy.anthropic, entry.name).toBeUndefined();
        expect(entry.notConfirmed?.anthropic, entry.name).toBeUndefined();
        for (const id of ids) expect(id).not.toMatch(/claude|anthropic/i);
      }
    }
  });

  it('never lists one id under two models, so an id always means one model', () => {
    for (const provider of MODEL_PROVIDER_NAMES) {
      const ids = SAME_MODEL_PROVIDER_TABLE.flatMap((entry) => [entry.servedBy[provider], entry.notConfirmed?.[provider]]).filter(
        (id): id is string => Boolean(id)
      );
      expect(new Set(ids).size, provider).toBe(ids.length);
    }
  });

  it('never moves a call onto an id that was not confirmed', () => {
    for (const entry of SAME_MODEL_PROVIDER_TABLE) {
      for (const [provider, id] of Object.entries(entry.notConfirmed ?? {}) as Array<[ModelProviderName, string]>) {
        expect(entry.servedBy[provider], entry.name).toBeUndefined();
        const moves = MODEL_PROVIDER_NAMES.flatMap((from) =>
          entry.servedBy[from] ? sameModelRoutesOnOtherProviders({ provider: from, model: entry.servedBy[from] as string }, ALL_KEYS) : []
        );
        expect(moves.some((route) => route.provider === provider && route.model === id), entry.name).toBe(false);
      }
    }
  });

  it('keeps Anthropic out for a model that is not Claude even if a row wrongly gave it an Anthropic id', async () => {
    const wrong: SameModelEntry = {
      name: 'Not Claude',
      claude: false,
      servedBy: { openrouter: 'vendor/not-claude', anthropic: 'claude-sonnet-5-5' },
    };
    await withTableRow(wrong, () => {
      expect(providersServingModel({ provider: 'openrouter', model: 'vendor/not-claude' })).toEqual([
        { provider: 'openrouter', model: 'vendor/not-claude' },
      ]);
      expect(routesWithEveryKey('planner', 'vendor/not-claude').map(providerOf)).toEqual(['openrouter']);
    });
  });

  it('treats a model it has no row for as served by its own provider and no other', () => {
    expect(sameModelEntryFor('openrouter', 'google/gemini-2.5-pro')).toBeNull();
    expect(providersServingModel({ provider: 'openrouter', model: 'google/gemini-2.5-pro' })).toEqual([
      { provider: 'openrouter', model: 'google/gemini-2.5-pro' },
    ]);
    expect(routesWithEveryKey('section_drafter', 'google/gemini-2.5-pro')).toEqual([{ model: 'google/gemini-2.5-pro', position: 'primary' }]);
  });

  it('knows two ids are the same model only through a row', () => {
    expect(isSameModel({ provider: 'openrouter', model: V32 }, { provider: 'huggingface_inference', model: V32_HUB })).toBe(true);
    expect(isSameModel({ provider: 'openrouter', model: V32 }, { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3.1' })).toBe(false);
    expect(isSameModel({ provider: 'openrouter', model: KIMI }, { provider: 'openrouter', model: V32 })).toBe(false);
    // Same name on two providers is not enough without a row.
    expect(isSameModel({ provider: 'openrouter', model: 'openai/gpt-oss-120b' }, { provider: 'together', model: 'openai/gpt-oss-120b' })).toBe(false);
  });
});

describe('the routes of every role, with every provider configured', () => {
  it('are, for general research: the role model on OpenRouter, then the same model on Hugging Face Inference', () => {
    const chain = Object.fromEntries(
      REASONING_MODEL_ROLES.map((role) => [
        role,
        routesWithEveryKey(role, V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH[role].primary).map((route) => `${providerOf(route)}:${route.model}`),
      ])
    );
    const kimi = [`openrouter:${KIMI}`, `huggingface_inference:${KIMI_HUB}`];
    const qwen = [`openrouter:${QWEN}`, `huggingface_inference:${QWEN_HUB}`];
    const v32 = [`openrouter:${V32}`, `huggingface_inference:${V32_HUB}`];
    const hermes = [`openrouter:${HERMES4}`, `huggingface_inference:${HERMES4_HUB}`];
    expect(chain).toEqual({
      planner: kimi,
      retriever: v32,
      source_class_classifier: v32,
      reasoner: qwen,
      strongest_form: qwen,
      double_check: hermes,
      synthesizer: qwen,
      verifier: v32,
      plain_language_synthesizer: qwen,
      outline_architect: qwen,
      section_drafter: qwen,
      internal_challenger: hermes,
      coherence_refiner: qwen,
      revision_intake: v32,
      report_locator: v32,
      change_planner: qwen,
      section_rewriter: qwen,
      citation_integrity_checker: v32,
      citation_formatter: v32,
      final_revision_verifier: v32,
      contract_auditor: v32,
      market_scout: v32,
      competitor_mapper: v32,
      demand_signal_analyst: v32,
      feasibility_architect: v32,
      story_verifier: v32,
      timeline_reconstructor: v32,
      data_analysis_specialist: v32,
      quantitative_quality_auditor: v32,
    });
  });

  it('uses R1-0528 on both providers for the patent planner, the one role whose model differs by kind of research', () => {
    const routes = routesWithEveryKey('planner', V2_MODE_PRESETS.PATENT_GAP_ANALYSIS.planner.primary);
    expect(routes).toEqual([
      { model: R1_0528, position: 'primary' },
      { model: R1_0528_HUB, via: 'huggingface_inference', position: 'cross_provider' },
    ]);
  });

  const choices = everyRoleChoice();

  it('covers every role, for every kind of research', () => {
    expect(new Set(choices.map((choice) => choice.role))).toEqual(new Set(REASONING_MODEL_ROLES));
    expect(choices).toHaveLength(REASONING_MODEL_ROLES.length * RESEARCH_OBJECTIVES.length * 2);
  });

  it('contain one model only: every route of a role is the model the role chose', () => {
    for (const choice of choices) {
      const routes = routesWithEveryKey(choice.role, choice.model);
      const label = `${choice.role} (${choice.where})`;
      expect(routes[0], label).toEqual({ model: choice.model, position: 'primary' });
      const chosen = { provider: providerForChosenModel(choice.model), model: choice.model };
      for (const route of routes) {
        expect(isSameModel(chosen, { provider: providerOf(route), model: route.model }), `${label} -> ${route.model}`).toBe(true);
      }
      expect(new Set(routes.map(modelNameOf)).size, label).toBe(1);
    }
  });

  it('never include the backup a role names when it is a different model', () => {
    let differentBackups = 0;
    for (const choice of choices) {
      const chosen = { provider: providerForChosenModel(choice.model), model: choice.model };
      const backup = { provider: providerForChosenModel(choice.backup), model: choice.backup };
      if (isSameModel(chosen, backup)) continue;
      differentBackups += 1;
      const routes = routesWithEveryKey(choice.role, choice.model);
      const label = `${choice.role} (${choice.where})`;
      expect(routes.some((route) => route.model === choice.backup), label).toBe(false);
      expect(routes.some((route) => modelNameOf(route) === sameModelName(backup)), label).toBe(false);
      expect(routes.some((route) => route.position === 'backup'), label).toBe(false);
    }
    // Every backup in the presets is a different model, so this checked all of them.
    expect(differentBackups).toBe(choices.length);
  });

  it('reach Anthropic only for a role whose model is a Claude model', () => {
    let claudeRoles = 0;
    for (const choice of choices) {
      const routes = routesWithEveryKey(choice.role, choice.model);
      const isClaude = /^anthropic\/claude/.test(choice.model);
      const anthropicRoutes = routes.filter((route) => providerOf(route) === 'anthropic');
      const label = `${choice.role} (${choice.where})`;
      if (!isClaude) {
        expect(anthropicRoutes, label).toEqual([]);
        continue;
      }
      claudeRoles += 1;
      expect(anthropicRoutes.length, label).toBeLessThanOrEqual(1);
      for (const route of anthropicRoutes) expect(route.model, label).toMatch(/^claude-/);
    }
    expect(claudeRoles).toBeGreaterThan(0);
    // No role of the research engine's own presets chooses a Claude model, so none of them reaches Anthropic.
    for (const role of REASONING_MODEL_ROLES) {
      for (const objective of RESEARCH_OBJECTIVES) {
        const routes = routesWithEveryKey(role, V2_MODE_PRESETS[objective][role].primary);
        expect(routes.some((route) => providerOf(route) === 'anthropic'), `${role} ${objective}`).toBe(false);
      }
    }
  });

  it('send a Claude role to Anthropic with the same Claude model, and a retired Claude model nowhere else', () => {
    expect(routesWithEveryKey('synthesizer', SONNET_45)).toEqual([
      { model: SONNET_45, position: 'primary' },
      { model: SONNET_45_DIRECT, via: 'anthropic', position: 'cross_provider' },
    ]);
    expect(routesWithEveryKey('planner', 'anthropic/claude-opus-4.7')).toEqual([
      { model: 'anthropic/claude-opus-4.7', position: 'primary' },
      { model: 'claude-opus-4-7', via: 'anthropic', position: 'cross_provider' },
    ]);
    // Anthropic retired Claude Sonnet 4 on 15 Jun 2026: it is not replaced by a newer Claude.
    expect(routesWithEveryKey('verifier', 'anthropic/claude-sonnet-4')).toEqual([{ model: 'anthropic/claude-sonnet-4', position: 'primary' }]);
  });

  it('never reach Together or NVIDIA, and never one of the models the old backup lists held', () => {
    const oldBackups = [
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'deepseek-ai/DeepSeek-V4.1-Flash',
      'zai-org/GLM-5.3-Flash',
      'Qwen/Qwen3.8-Flash',
      'openai/gpt-oss-120b',
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
      'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
      'deepseek-ai/deepseek-v4.1-flash',
      'moonshotai/kimi-k3',
    ];
    for (const choice of choices) {
      const routes = routesWithEveryKey(choice.role, choice.model);
      const label = `${choice.role} (${choice.where})`;
      expect(routes.some((route) => providerOf(route) === 'together' || providerOf(route) === 'nvidia'), label).toBe(false);
      for (const route of routes.slice(1)) expect(oldBackups, label).not.toContain(route.model);
    }
  });

  it('hold only providers that have a key', () => {
    const routes = modelRoutesForCall({ role: 'planner', primary: KIMI, openrouterConfigured: true, hubConfigured: false, togetherConfigured: true, anthropicConfigured: true, nvidiaConfigured: true });
    expect(routes).toEqual([{ model: KIMI, position: 'primary' }]);
  });
});

describe('a model on the allowlist stays selectable for one run', () => {
  it('removed nothing from the allowlist: every id a saved run may name is still approved', () => {
    const allowed = APPROVED_REASONING_MODEL_ALLOWLIST.section_drafter;
    for (const id of [
      'deepseek/deepseek-chat-v3.1',
      'nousresearch/hermes-3-llama-3.1-70b',
      'NousResearch/Hermes-3-Llama-3.1-70B',
      'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
      'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
      'deepseek-ai/DeepSeek-V3.1',
      'deepseek-ai/DeepSeek-V3',
      'google/gemini-2.5-flash',
      'openai/o3-mini',
    ]) {
      expect(allowed, id).toContain(id);
    }
    for (const choice of everyRoleChoice()) {
      expect(APPROVED_REASONING_MODEL_ALLOWLIST[choice.role], choice.backup).toContain(choice.backup);
    }
  });

  it('is called as the role model when a run chooses it, with its own same-model routes', async () => {
    // DeepSeek V3.1 is the preset backup of the short-answer roles. Chosen for a run, it is the model.
    h.answers.openrouter = () => 402;

    const result = await researchCall('retriever', { runtimeOverrides: { primary: 'deepseek/deepseek-chat-v3.1' } });

    expect(sentPairs()).toEqual([
      ['openrouter', 'deepseek/deepseek-chat-v3.1'],
      ['huggingface_inference', 'deepseek-ai/DeepSeek-V3.1'],
    ]);
    expect(result.routeUsed).toEqual({ model: 'deepseek-ai/DeepSeek-V3.1', provider: 'huggingface_inference', position: 'cross_provider' });
  });
});

describe('the order providers are tried in', () => {
  const everywhere: SameModelEntry = {
    name: 'Test Claude Everywhere',
    claude: true,
    servedBy: {
      openrouter: 'anthropic/claude-test',
      anthropic: 'claude-test',
      together: 'anthropic/Claude-Test-Together',
      huggingface_inference: 'anthropic-hub/Claude-Test',
      nvidia: 'anthropic/claude-test-nim',
    },
  };

  it('follows MODEL_PROVIDER_ORDER after the role model, with Together before Hugging Face in their shared place', async () => {
    await withTableRow(everywhere, () => {
      expect(routesWithEveryKey('planner', 'anthropic/claude-test').map((route) => [providerOf(route), route.position])).toEqual([
        ['openrouter', 'primary'],
        ['anthropic', 'cross_provider'],
        ['together', 'cross_provider'],
        ['huggingface_inference', 'cross_provider'],
        ['nvidia', 'cross_provider'],
      ]);
      const reordered = routesWithEveryKey('planner', 'anthropic/claude-test', { providerOrder: ['openrouter', 'nvidia', 'together', 'anthropic'] });
      expect(reordered.map(providerOf)).toEqual(['openrouter', 'nvidia', 'together', 'huggingface_inference', 'anthropic']);
      // Each route carries the id the table gives the model on that provider.
      expect(reordered.map((route) => route.model)).toEqual([
        'anthropic/claude-test',
        'anthropic/claude-test-nim',
        'anthropic/Claude-Test-Together',
        'anthropic-hub/Claude-Test',
        'claude-test',
      ]);
    });
  });

  it('keeps the role model first while the setting is unset, whatever the order says', () => {
    const routes = routesWithEveryKey('planner', KIMI, { providerOrder: ['together', 'anthropic', 'openrouter', 'nvidia'], providerOrderSet: false });
    expect(routes).toEqual([
      { model: KIMI, position: 'primary' },
      { model: KIMI_HUB, via: 'huggingface_inference', position: 'cross_provider' },
    ]);
  });

  it('tries a provider the server setting places ahead first, with the same model, then the role model', async () => {
    const routes = routesWithEveryKey('planner', KIMI, { providerOrder: ['together', 'anthropic', 'openrouter', 'nvidia'], providerOrderSet: true });
    expect(routes).toEqual([
      { model: KIMI_HUB, via: 'huggingface_inference', position: 'preferred' },
      { model: KIMI, position: 'primary' },
    ]);

    config.modelProviderOrder = ['together', 'anthropic', 'openrouter', 'nvidia'];
    config.modelProviderOrderSet = true;
    const first = await researchCall('planner');
    expect(sentPairs()).toEqual([['huggingface_inference', KIMI_HUB]]);
    // Nothing was refused to reach it, so it is not counted as a move.
    expect(first.usedFallback).toBe(false);

    h.sent.length = 0;
    h.hub = () => 'fail';
    const second = await researchCall('planner');
    expect(sentPairs()).toEqual([
      ['huggingface_inference', KIMI_HUB],
      ['openrouter', KIMI],
    ]);
    expect(second.routeUsed).toEqual({ model: KIMI, provider: 'openrouter', position: 'primary' });
  });

  it('goes back to OpenRouter for the same model when the role model is a hub id', () => {
    expect(routesWithEveryKey('double_check', 'NousResearch/Hermes-3-Llama-3.1-70B')).toEqual([
      { model: 'NousResearch/Hermes-3-Llama-3.1-70B', position: 'primary' },
      { model: 'nousresearch/hermes-3-llama-3.1-70b', via: 'openrouter', position: 'cross_provider' },
    ]);
  });
});

describe('a call whose provider refuses', () => {
  it('is answered by the same model on Hugging Face Inference when OpenRouter is out of credit', async () => {
    h.answers.openrouter = () => ({ status: 402, message: OUT_OF_CREDIT });

    const result = await researchCall('section_drafter');

    expect(sentPairs()).toEqual([
      ['openrouter', QWEN],
      ['huggingface_inference', QWEN_HUB],
    ]);
    expect(result.content).toBe(`written by ${QWEN_HUB}`);
    expect(result.routeUsed).toEqual({ model: QWEN_HUB, provider: 'huggingface_inference', position: 'cross_provider' });
    expect(result.usedFallback).toBe(true);
    expect(result.primaryModel).toBe(QWEN);
    expect(result.routesTried?.map((attempt) => [attempt.position, attempt.provider, attempt.outcome, attempt.classification ?? null])).toEqual([
      ['primary', 'openrouter', 'refused', 'quota_exceeded'],
      ['cross_provider', 'huggingface_inference', 'answered', null],
    ]);
  });

  it('never asks for the preset backup model, on any provider, for any role', async () => {
    h.answers.openrouter = () => 402;
    h.hub = () => 'fail';
    for (const role of REASONING_MODEL_ROLES) {
      h.sent.length = 0;
      const preset = V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH[role];
      await researchCall(role).catch(() => null);
      const chosen = { provider: 'openrouter' as const, model: preset.primary };
      expect(h.sent.length, role).toBeGreaterThan(0);
      for (const sent of h.sent) {
        expect(sent.model, role).not.toBe(preset.fallback);
        expect(isSameModel(chosen, { provider: sent.provider, model: sent.model }), `${role} -> ${sent.provider}:${sent.model}`).toBe(true);
        expect(['openrouter', 'huggingface_inference'], role).toContain(sent.provider);
      }
    }
  });

  it('does not use a backup chosen for one run either, when it is a different model', async () => {
    h.answers.openrouter = () => 402;
    h.hub = () => 'fail';

    await expect(
      researchCall('section_drafter', {
        runtimeOverrides: { primary: V32, fallback: KIMI },
        allowFallbackByRole: { section_drafter: true },
      })
    ).rejects.toBeInstanceOf(NormalizedModelError);

    expect(sentPairs()).toEqual([
      ['openrouter', V32],
      ['huggingface_inference', V32_HUB],
    ]);
  });

  it('uses the server setting model the same way for a call made outside a research run', async () => {
    h.answers.openrouter = () => 402;
    const serverChoice = chosenModelsForRole('synthesizer').find((entry) => entry.usedFor.includes('server setting'))?.model;
    expect(serverChoice).toBe(SONNET_45);

    const result = await callRoleModel({ role: 'synthesizer', messages: [{ role: 'user', content: 'Write it.' }] });

    expect(sentPairs()).toEqual([
      ['openrouter', SONNET_45],
      ['anthropic', SONNET_45_DIRECT],
    ]);
    expect(result.routeUsed).toEqual({ model: SONNET_45_DIRECT, provider: 'anthropic', position: 'cross_provider' });
  });

  it('never sends a model that is not Claude to Anthropic, even when Anthropic is the only other provider with a key', async () => {
    h.answers.openrouter = () => 402;
    config.hfToken = '';
    config.together.apiKey = '';
    config.nvidia.apiKey = '';

    await expect(researchCall('planner')).rejects.toBeInstanceOf(NormalizedModelError);

    expect(sentPairs()).toEqual([['openrouter', KIMI]]);
  });

  it('does not move a request the provider called malformed', async () => {
    h.answers.openrouter = () => 400;

    await expect(researchCall('planner')).rejects.toMatchObject({ classification: 'bad_request' });

    expect(sentPairs()).toEqual([['openrouter', KIMI]]);
  });

  it('never moves a request made with the customer own key onto the server other providers', async () => {
    h.answers.openrouter = () => 402;

    await expect(researchCall('planner', { byokApiKeyOverride: 'customer-key' })).rejects.toMatchObject({ classification: 'quota_exceeded' });

    expect(sentPairs()).toEqual([['openrouter', KIMI]]);
  });
});

describe('a role whose model has one confirmed provider', () => {
  it('reads OpenRouter having no host for a model as being about OpenRouter, not about the request', () => {
    const noEndpoints = {
      isAxiosError: true,
      response: { status: 404, data: { error: { message: 'No endpoints found for nousresearch/hermes-4-70b.' } } },
    } as unknown as AxiosError;
    const unknownModel = {
      isAxiosError: true,
      response: { status: 404, data: { error: { message: 'nousresearch/hermes-9 is not a valid model ID' } } },
    } as unknown as AxiosError;
    expect(classifyModelError(noEndpoints)).toBe('provider_unavailable');
    expect(classifyModelError(unknownModel)).toBe('bad_request');
  });

  it('asks Hugging Face Inference for the same Hermes model when OpenRouter has no host for it', async () => {
    h.answers.openrouter = () => ({ status: 404, message: 'No endpoints found for nousresearch/hermes-4-70b.' });

    const result = await researchCall('double_check');

    expect(sentPairs()).toEqual([
      ['openrouter', HERMES4],
      ['huggingface_inference', HERMES4_HUB],
    ]);
    expect(result.routeUsed).toEqual({ model: HERMES4_HUB, provider: 'huggingface_inference', position: 'cross_provider' });
  });

  it('stops, with no other model asked, when that one provider refuses too', async () => {
    h.answers.openrouter = () => ({ status: 404, message: 'No endpoints found for nousresearch/hermes-4-70b.' });
    h.hub = () => 'fail';

    const failure = (await researchCall('internal_challenger').then(
      () => null,
      (err: unknown) => err
    )) as NormalizedModelError;

    expect(failure).toBeInstanceOf(NormalizedModelError);
    expect(sentPairs()).toEqual([
      ['openrouter', HERMES4],
      ['huggingface_inference', HERMES4_HUB],
    ]);
    // Hermes 3 was this role's backup and the first hub backup before RJ-025. It is a different model.
    expect(h.sent.some((sent) => /hermes-3/i.test(sent.model))).toBe(false);
  });

  it('has one route when the model is served by one provider only', async () => {
    h.answers.openrouter = () => 402;

    await expect(researchCall('section_drafter', { runtimeOverrides: { primary: 'google/gemini-2.5-pro' } })).rejects.toBeInstanceOf(
      NormalizedModelError
    );

    expect(sentPairs()).toEqual([['openrouter', 'google/gemini-2.5-pro']]);
  });
});

describe('when every route for the model has refused', () => {
  async function everyRouteRefuses(role: ModelRole = 'section_drafter'): Promise<NormalizedModelError> {
    h.answers.openrouter = () => ({ status: 402, message: OUT_OF_CREDIT });
    h.hub = () => 'fail';
    return (await researchCall(role).then(
      () => null,
      (err: unknown) => err
    )) as NormalizedModelError;
  }

  it('fails with the refusal of the role own provider and lists the routes tried, all of them the same model', async () => {
    const failure = await everyRouteRefuses();

    expect(failure).toBeInstanceOf(NormalizedModelError);
    expect(failure.classification).toBe('quota_exceeded');
    expect(failure.status).toBe(402);
    expect(failure.model).toBe(QWEN);
    expect(failure.upstream).toBe('openrouter');
    expect(failure.fallbackTried).toBe(true);
    expect(failure.routesTried?.map((attempt) => [attempt.provider, attempt.model, attempt.outcome])).toEqual([
      ['openrouter', QWEN, 'refused'],
      ['huggingface_inference', QWEN_HUB, 'refused'],
    ]);
  });

  it('tells the customer the existing sentence, with nothing about providers or models in it', async () => {
    const failure = await everyRouteRefuses();
    const message = customerFailureMessage({ classification: failure.classification, stage: 'synthesis' });

    expect(message.id).toBe('ai_service_unavailable_writing');
    expect(message.text).toBe(CUSTOMER_FAILURE_MESSAGES.ai_service_unavailable_writing);
    expect(message.text).toContain('AI service is temporarily unavailable');
    expect(message.text).not.toMatch(/openrouter|hugging|qwen|deepseek|provider|model|402|backup/i);

    const elsewhere = customerFailureMessage({ classification: failure.classification, stage: 'planning' });
    expect(elsewhere.text).toContain('AI service is temporarily unavailable');
  });

  it('keeps the run able to be run again, and takes no payment', async () => {
    const failure = await everyRouteRefuses();
    const details = buildResearchFailureDetails(failure, 'synthesis');
    const transition = decideRunStateOnFailure({ raw: details.failureMeta, classifierRetryable: details.retryable, retryAttempts: 0, retryBudget: 3 });

    expect(details.retryable).toBe(true);
    expect(transition.nextStatus).toBe('failed');
    expect(runChargeDecision({ status: transition.nextStatus, retryable: transition.failureMeta.retryable })).toBe('keep_hold_for_run_again');
  });

  it('still waits and goes over the same-model routes again when the refusal was for credit', async () => {
    modelRouteRetry.delaysMs = [1];
    h.hub = () => 'fail';
    // Refused while other requests are in flight; accepted once they settle.
    h.answers.openrouter = (_model, nth) => (nth >= 2 ? 'ok' : 402);

    const result = await researchCall('section_drafter');

    expect(sentPairs()).toEqual([
      ['openrouter', QWEN],
      ['huggingface_inference', QWEN_HUB],
      ['openrouter', QWEN],
    ]);
    expect(result.routeUsed).toEqual({ model: QWEN, provider: 'openrouter', position: 'primary' });
    expect(result.routesTried?.at(-1)).toMatchObject({ round: 2, outcome: 'answered' });
  });
});
