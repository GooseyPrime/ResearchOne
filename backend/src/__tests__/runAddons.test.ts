import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({
  queryOne: vi.fn(),
}));

import {
  applyAdversarialTwinToSkepticMode,
  buildRunAddonPipelineEffects,
  normalizeRunAddonKeys,
} from '../services/reasoning/runAddons';
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

  it('applyAdversarialTwinToSkepticMode enables gate when skeptic is off', () => {
    const profile = applyAdversarialTwinToSkepticMode({ skepticMode: 'off' }, ['adversarial_twin']);
    expect(profile.skepticMode).toBe('gate');
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
