import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', () => ({
  queryOne: vi.fn(),
}));

import {
  RUN_ADDON_KEYS,
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


  it('parseAddonsFromStartRequest reads JSON array from multipart', () => {
    const keys = parseAddonsFromStartRequest(
      { addons: '["parallel_extract","smart_citations"]' },
      true,
    );
    expect(keys).toEqual(['parallel_extract', 'smart_citations']);
  });

  it('parseAddonsFromStartRequest reads addons array from JSON body', () => {
    const keys = parseAddonsFromStartRequest(
      { addons: ['parallel_search', 'unknown'] },
      false,
    );
    expect(keys).toEqual(['parallel_search']);
  });
});

describe("Devil's Advocate add-on is gone (WO-AH)", () => {
  it('is not a purchasable run add-on any more', () => {
    expect(RUN_ADDON_KEYS).not.toContain('adversarial_twin');
  });

  it('drops the key from a historical run rather than throwing', () => {
    // Runs bought before the removal still carry it in `selected_addons`.
    expect(normalizeRunAddonKeys(['adversarial_twin', 'parallel_search'])).toEqual([
      'parallel_search',
    ]);
  });
});
