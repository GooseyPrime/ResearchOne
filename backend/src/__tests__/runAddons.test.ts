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
    const exploratory = ORCHESTRATION_PROFILES.exploratory;
    expect(shouldRunPipelineStage(exploratory, 'challenge')).toBe(false);

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
