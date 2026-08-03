import { describe, expect, it } from 'vitest';

import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';
import { ORCHESTRATION_PROFILES } from '../services/planning/orchestrationProfiles';

describe('orchestration profile template parity', () => {
  it('maps each non-legacy intent to a template with the same intentId', () => {
    for (const [intentId, profile] of Object.entries(ORCHESTRATION_PROFILES)) {
      if (intentId === 'legacy') continue;

      const template = INTENT_OUTPUT_TEMPLATES[profile.outputTemplateId];
      expect(template, `missing template for ${intentId}: ${profile.outputTemplateId}`).toBeDefined();
      expect(template.intentId, `template mismatch for ${intentId}: ${profile.outputTemplateId}`).toBe(intentId);
    }
  });
});
