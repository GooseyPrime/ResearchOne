import { describe, expect, it } from 'vitest';

import { INTENT_TAXONOMY } from '../services/planning/intentTaxonomy';
import { ORCHESTRATION_PROFILES } from '../services/planning/orchestrationProfiles';

describe('orchestration profile taxonomy parity', () => {
  it('every IntentId has a production OrchestrationProfile', () => {
    for (const id of Object.keys(INTENT_TAXONOMY)) {
      expect(ORCHESTRATION_PROFILES[id as keyof typeof ORCHESTRATION_PROFILES]).toBeDefined();
    }
  });

  it('defaultOrchestrationProfile matches the intent id (no wave5 placeholders)', () => {
    for (const [id, def] of Object.entries(INTENT_TAXONOMY)) {
      expect(def.defaultOrchestrationProfile).toBe(id);
      expect(def.defaultOrchestrationProfile.includes('wave5_placeholder')).toBe(false);
    }
  });

  it('profiles expose concrete skeptic and steelman modes', () => {
    for (const [id, profile] of Object.entries(ORCHESTRATION_PROFILES)) {
      expect(['off', 'annotate', 'gate']).toContain(profile.skepticMode);
      expect(['off', 'standard', 'per_option', 'as_product', 'symmetric']).toContain(profile.steelmanMode);
      expect(profile.displayName.length).toBeGreaterThan(0);
      expect(profile.outputTemplateId).toContain(id === 'legacy' ? 'legacy' : id.replace(/_/g, '_'));
    }
  });
});
