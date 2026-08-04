import { describe, expect, it } from 'vitest';

import {
  defaultResearchBrief,
  resolveMethodologyFromIntent,
  resolveObjectiveFromIntent,
} from '../services/planning/researchBrief';

describe('system refinements research brief defaults', () => {
  it('defaultResearchBrief for opportunity_discovery resolves to standard methodology', () => {
    expect(defaultResearchBrief('opportunity_discovery', 0.8, 'fallback').resolvedMethodology).toBe('standard');
  });

  it('defaultResearchBrief for adjudication resolves to policyone methodology', () => {
    expect(defaultResearchBrief('adjudication', 0.8, 'fallback').resolvedMethodology).toBe('policyone');
  });

  it('defaultResearchBrief for opportunity_discovery sets requestedResearchObjective AUTO', () => {
    expect(defaultResearchBrief('opportunity_discovery', 0.8, 'fallback').requestedResearchObjective).toBe('AUTO');
  });

  it('defaultResearchBrief includes requestedFormats field', () => {
    const brief = defaultResearchBrief('opportunity_discovery', 0.8, 'fallback');
    expect('requestedFormats' in brief).toBe(true);
    expect(brief.requestedFormats).toBeUndefined();
  });

  it('defaultResearchBrief includes objectiveResolutionSource field', () => {
    const brief = defaultResearchBrief('opportunity_discovery', 0.8, 'fallback');
    expect(brief.objectiveResolutionSource).toBe('fallback');
  });

  it('exports intent resolution helpers used by the brief', () => {
    expect(resolveMethodologyFromIntent('factual_report')).toBe('standard');
    expect(resolveObjectiveFromIntent('investigation')).toBe('INVESTIGATIVE_SYNTHESIS');
  });
});
