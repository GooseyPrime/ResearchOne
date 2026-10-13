/**
 * Startup preflight (RJ-025 repair): the targets are every route each role's
 * exact model has on this server, built from the same definitions a call
 * uses, and the answers are kept for the run readiness check.
 *
 * The probe is replaced here; no request leaves the test process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { RESEARCH_ENGINE_VERSION } from '../config/researchEngine';
import { V2_MODE_PRESETS } from '../config/researchEnsemblePresets';
import {
  preflightDisabledBySetting,
  preflightModelRoutes,
  preflightRouteSets,
} from '../services/openrouter/openrouterPreflight';
import { providerForRoute, resolvePrimaryModelForCall, serverModelRoutes } from '../services/openrouter/openrouterService';
import type { ProviderHealthResult, ProviderHealthTarget } from '../services/openrouter/providerHealth';
import { isSameModel } from '../services/openrouter/providerRoutes';
import { recordRouteAnswered, recordRouteRefused, routeState } from '../services/openrouter/routeAvailability';
import { REASONING_MODEL_ROLES, RESEARCH_OBJECTIVES } from '../services/reasoning/reasoningModelPolicy';

const HERMES4 = 'nousresearch/hermes-4-70b';
const HERMES4_HUB = 'NousResearch/Hermes-4-70B';

const was = { openrouter: config.openrouter.apiKey, hf: config.hfToken, anthropic: config.anthropic.apiKey, nvidia: config.nvidia.apiKey, together: config.together.apiKey };

beforeEach(() => {
  config.openrouter.apiKey = 'test-openrouter';
  config.hfToken = 'test-hub';
  config.anthropic.apiKey = 'test-anthropic';
  config.nvidia.apiKey = 'test-nvidia';
  config.together.apiKey = 'test-together';
});

afterEach(() => {
  config.openrouter.apiKey = was.openrouter;
  config.hfToken = was.hf;
  config.anthropic.apiKey = was.anthropic;
  config.nvidia.apiKey = was.nvidia;
  config.together.apiKey = was.together;
});

/** A probe that answers from a table and records the outcome, as `probeRoute` does. */
function fakeProbe(refuse: (target: ProviderHealthTarget) => string | null) {
  const asked: ProviderHealthTarget[] = [];
  const probe = vi.fn(async (target: ProviderHealthTarget): Promise<ProviderHealthResult> => {
    asked.push(target);
    const reason = refuse(target);
    if (reason) {
      recordRouteRefused(target.provider, target.model, reason, 'probe');
      return { ...target, ok: false, status: 402, durationMs: 1, classification: reason as ProviderHealthResult['classification'] };
    }
    recordRouteAnswered(target.provider, target.model, 'probe');
    return { ...target, ok: true, status: 200, durationMs: 1 };
  });
  return { probe, asked };
}

describe('preflight targets', () => {
  it('are, for every research kind and role, the routes a call for that role would take', () => {
    for (const set of preflightRouteSets()) {
      const model = resolvePrimaryModelForCall({
        role: set.role as (typeof REASONING_MODEL_ROLES)[number],
        messages: [],
        engineVersion: RESEARCH_ENGINE_VERSION,
        researchObjective: set.objective as (typeof RESEARCH_OBJECTIVES)[number],
      });
      expect(set.model).toBe(model);
      expect(set.routes).toEqual(
        serverModelRoutes(set.role as (typeof REASONING_MODEL_ROLES)[number], model).map((route) => ({
          provider: providerForRoute(route),
          model: route.model,
        }))
      );
    }
  });

  it('never include a preset backup model or any other model', () => {
    for (const set of preflightRouteSets()) {
      const preset = V2_MODE_PRESETS[set.objective as keyof typeof V2_MODE_PRESETS][set.role as (typeof REASONING_MODEL_ROLES)[number]];
      for (const route of set.routes) {
        expect(isSameModel({ provider: set.routes[0].provider, model: set.model }, route)).toBe(true);
        if (preset.fallback && preset.fallback !== preset.primary) {
          expect(isSameModel({ provider: 'openrouter', model: preset.fallback }, route)).toBe(false);
        }
      }
    }
  });

  it('cover every research kind and every role', () => {
    expect(preflightRouteSets()).toHaveLength(RESEARCH_OBJECTIVES.length * REASONING_MODEL_ROLES.length);
  });
});

describe('preflightModelRoutes', () => {
  it('asks each distinct route once and reports ok when every role has a route that answered', async () => {
    const { probe, asked } = fakeProbe(() => null);
    const summary = await preflightModelRoutes({ probe });
    expect(summary.ok).toBe(true);
    expect(summary.hasWarnings).toBe(false);
    expect(summary.rolesWithoutRoute).toEqual([]);
    const keys = asked.map((target) => `${target.provider}|${target.model}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Only providers that serve a role's exact model are asked, whatever keys are set.
    expect(new Set(asked.map((target) => target.provider))).toEqual(new Set(['openrouter', 'huggingface_inference']));
    expect(routeState('huggingface_inference', HERMES4_HUB)).toBe('usable');
  });

  it('names the roles whose exact model has no route that answered, with each route and its reason', async () => {
    const { probe } = fakeProbe((target) =>
      target.model === HERMES4 ? 'provider_unavailable' : target.model === HERMES4_HUB ? 'quota_exceeded' : null
    );
    const summary = await preflightModelRoutes({ probe });
    expect(summary.ok).toBe(false);
    const roles = new Set(summary.rolesWithoutRoute.map((entry) => entry.role));
    expect(roles).toEqual(new Set(['double_check', 'internal_challenger']));
    for (const entry of summary.rolesWithoutRoute) {
      expect(entry.routes).toEqual([
        { provider: 'openrouter', model: HERMES4, reason: 'provider_unavailable' },
        { provider: 'huggingface_inference', model: HERMES4_HUB, reason: 'quota_exceeded' },
      ]);
    }
    expect(routeState('huggingface_inference', HERMES4_HUB)).toBe('not_usable');
  });

  it('warns but stays ok when one route of a model refuses and another answers', async () => {
    const { probe } = fakeProbe((target) => (target.provider === 'openrouter' && target.model !== HERMES4 ? 'quota_exceeded' : null));
    const summary = await preflightModelRoutes({ probe });
    expect(summary.ok).toBe(true);
    expect(summary.hasWarnings).toBe(true);
  });

  it('records a probe that threw as a route that did not answer, and never throws itself', async () => {
    const probe = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const summary = await preflightModelRoutes({ probe });
    expect(summary.ok).toBe(false);
    expect(summary.routes.every((route) => !route.ok)).toBe(true);
  });

  it('asks only the routes of providers that have a key', async () => {
    config.hfToken = '';
    const { probe, asked } = fakeProbe(() => null);
    await preflightModelRoutes({ probe });
    expect(new Set(asked.map((target) => target.provider))).toEqual(new Set(['openrouter']));
  });

  it('is skipped when turned off', async () => {
    const probe = vi.fn();
    const summary = await preflightModelRoutes({ probe, disabled: true });
    expect(summary.skipped).toBe(true);
    expect(probe).not.toHaveBeenCalled();
    expect(preflightDisabledBySetting('false')).toBe(true);
    expect(preflightDisabledBySetting('0')).toBe(true);
    expect(preflightDisabledBySetting(undefined)).toBe(false);
  });
});
