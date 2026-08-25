import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  queryOne: vi.fn(),
}));

import {
  applyAdversarialTwinToSkepticMode,
  buildRunAddonPipelineEffects,
  normalizeRunAddonKeys,
} from '../services/reasoning/runAddons';
import {
  ORCHESTRATION_PROFILES,
  shouldRunPipelineStage,
} from '../services/planning/orchestrationProfiles';
import { parseAddonsFromStartRequest } from '../services/reasoning/parseResearchAddons';

describe('runAddons', () => {
  it('normalizes and dedupes addon keys', () => {
    expect(normalizeRunAddonKeys(['parallel_search', 'parallel_search', 'bad'])).toEqual([
      'parallel_search',
    ]);
  });

  it('buildRunAddonPipelineEffects applies parallel_search and smart_citations', () => {
    const effects = buildRunAddonPipelineEffects(['parallel_search', 'smart_citations']);
    expect(effects.maxIngestCapOverride).toBe(17);
    expect(effects.citationChunkContextLimit).toBe(40);
    expect(effects.retrievalTopK).toBe(15);
  });

  it('applyAdversarialTwinToSkepticMode un-skips challenge and enables gate', () => {
    // WO-AH changed what this add-on is FOR. `exploratory` used to skip the
    // challenge stage entirely, so buying Devil's Advocate turned the pass on.
    // Every profile now runs it, so the add-on's job is to escalate the pass
    // from `annotate` (recorded alongside the draft) to `gate` (runs before
    // synthesis and can block it) — the strongest pass available, which is what
    // the buyer was always paying for.
    const exploratory = ORCHESTRATION_PROFILES.exploratory;
    expect(shouldRunPipelineStage(exploratory, 'challenge')).toBe(true);
    expect(exploratory.skepticMode).toBe('annotate');

    const profile = applyAdversarialTwinToSkepticMode(exploratory, ['adversarial_twin']);
    expect(profile.skepticMode).toBe('gate');
    expect(shouldRunPipelineStage(profile, 'challenge')).toBe(true);
    expect(profile.agentsToSkip).not.toContain('challenge');
  });

  it('parseAddonsFromStartRequest reads JSON array from multipart', () => {
    const keys = parseAddonsFromStartRequest(
      { addons: '["parallel_extract","smart_citations"]' },
      true,
    );
    expect(keys).toEqual(['parallel_extract', 'smart_citations']);
  });

  it('parseAddonsFromStartRequest reads addons array from JSON body', () => {
    const keys = parseAddonsFromStartRequest(
      { addons: ['adversarial_twin', 'unknown'] },
      false,
    );
    expect(keys).toEqual(['adversarial_twin']);
  });
});

describe("Devil's Advocate must never become a no-op (WO-AH)", () => {
  it('escalates every profile to gate, not just ones that were off', () => {
    // The old implementation read `skepticMode === 'off' ? 'gate' : skepticMode`,
    // which returns the profile unchanged once nothing is 'off'. A $5.00 per-run
    // paid add-on would have silently stopped doing anything. TypeScript caught
    // it when 'off' left the profile type; this catches it if the expression
    // ever comes back.
    for (const [intent, profile] of Object.entries(ORCHESTRATION_PROFILES)) {
      const upgraded = applyAdversarialTwinToSkepticMode(profile, ['adversarial_twin']);
      expect(upgraded.skepticMode, `${intent} must escalate to gate`).toBe('gate');
      expect(shouldRunPipelineStage(upgraded, 'challenge'), intent).toBe(true);
    }
  });

  it('changes nothing when the add-on was not bought', () => {
    for (const profile of Object.values(ORCHESTRATION_PROFILES)) {
      expect(applyAdversarialTwinToSkepticMode(profile, [])).toBe(profile);
    }
  });
});
