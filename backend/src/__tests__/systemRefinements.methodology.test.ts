import { describe, expect, it } from 'vitest';

import {
  defaultResearchBrief,
  resolveMethodologyFromIntent,
  resolveObjectiveFromIntent,
} from '../services/planning/researchBrief';
import { ADJUDICATIVE_SECTION_INTENTS } from '../services/reasoning/reportGenerator';

describe('system refinements methodology separation', () => {
  it('resolves opportunity_discovery to standard methodology', () => {
    expect(resolveMethodologyFromIntent('opportunity_discovery')).toBe('standard');
  });

  it('resolves adjudication to policyone methodology', () => {
    expect(resolveMethodologyFromIntent('adjudication')).toBe('policyone');
  });

  it('resolves investigation to policyone methodology', () => {
    expect(resolveMethodologyFromIntent('investigation')).toBe('policyone');
  });

  it('resolves factual_report to standard methodology', () => {
    expect(resolveMethodologyFromIntent('factual_report')).toBe('standard');
  });

  it('resolves opportunity_discovery objective to NOVEL_APPLICATION_DISCOVERY', () => {
    expect(resolveObjectiveFromIntent('opportunity_discovery')).toBe('NOVEL_APPLICATION_DISCOVERY');
  });

  it('resolves investigation objective to INVESTIGATIVE_SYNTHESIS', () => {
    expect(resolveObjectiveFromIntent('investigation')).toBe('INVESTIGATIVE_SYNTHESIS');
  });

  it('resolves factual_report objective to GENERAL_EPISTEMIC_RESEARCH', () => {
    expect(resolveObjectiveFromIntent('factual_report')).toBe('GENERAL_EPISTEMIC_RESEARCH');
  });

  it('keeps opportunity discovery default brief on standard methodology', () => {
    expect(defaultResearchBrief('opportunity_discovery', 0.75, 'classifier fallback').resolvedMethodology).toBe('standard');
  });
});

describe('ADJUDICATIVE_SECTION_INTENTS contract', () => {
  it('contains adjudicative intents', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('adjudication')).toBe(true);
    expect(ADJUDICATIVE_SECTION_INTENTS.has('investigation')).toBe(true);
    expect(ADJUDICATIVE_SECTION_INTENTS.has('story_verification')).toBe(true);
  });

  it('does not contain non-adjudicative intents', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('opportunity_discovery')).toBe(false);
    expect(ADJUDICATIVE_SECTION_INTENTS.has('feasibility')).toBe(false);
    expect(ADJUDICATIVE_SECTION_INTENTS.has('implementation')).toBe(false);
    expect(ADJUDICATIVE_SECTION_INTENTS.has('factual_report')).toBe(false);
  });
});
