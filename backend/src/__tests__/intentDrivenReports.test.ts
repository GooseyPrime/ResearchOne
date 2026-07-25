/**
 * Regression fixtures for Rule 37: Intent-Driven Report Contracts.
 *
 * These tests verify that:
 * 1. Discovery/opportunity intents are NOT classified as adjudicative.
 * 2. DESCRIPTIVE_SECTION_PLAN does not contain falsification or contradiction sections.
 * 3. generateIterativeReport uses DESCRIPTIVE_SECTION_PLAN for non-adjudicative intents
 *    and SECTION_PLAN (10 sections) for adjudicative intents and undefined (backward compat).
 *
 * If any of these tests fail WITHOUT the Stage A fix applied, the root-cause cascade
 * problem (Rule 37) is confirmed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const callRoleModelMock = vi.fn();

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: callRoleModelMock,
  SYSTEM_PROMPTS: {
    outline_architect: 'outline',
    section_drafter: 'draft',
    internal_challenger: 'challenge',
    coherence_refiner: 'refine',
  },
}));

describe('Intent-Driven Report Contracts (Rule 37)', () => {
  beforeEach(() => {
    callRoleModelMock.mockReset();
  });

  it('ADJUDICATIVE_SECTION_INTENTS does NOT include opportunity_discovery', async () => {
    const { ADJUDICATIVE_SECTION_INTENTS } = await import(
      '../services/reasoning/reportGenerator'
    );
    expect(ADJUDICATIVE_SECTION_INTENTS.has('opportunity_discovery')).toBe(false);
  });

  it('ADJUDICATIVE_SECTION_INTENTS does NOT include feasibility', async () => {
    const { ADJUDICATIVE_SECTION_INTENTS } = await import(
      '../services/reasoning/reportGenerator'
    );
    expect(ADJUDICATIVE_SECTION_INTENTS.has('feasibility')).toBe(false);
  });

  it('ADJUDICATIVE_SECTION_INTENTS does NOT include implementation', async () => {
    const { ADJUDICATIVE_SECTION_INTENTS } = await import(
      '../services/reasoning/reportGenerator'
    );
    expect(ADJUDICATIVE_SECTION_INTENTS.has('implementation')).toBe(false);
  });

  it('ADJUDICATIVE_SECTION_INTENTS DOES include adjudication', async () => {
    const { ADJUDICATIVE_SECTION_INTENTS } = await import(
      '../services/reasoning/reportGenerator'
    );
    expect(ADJUDICATIVE_SECTION_INTENTS.has('adjudication')).toBe(true);
  });

  it('ADJUDICATIVE_SECTION_INTENTS DOES include story_verification', async () => {
    const { ADJUDICATIVE_SECTION_INTENTS } = await import(
      '../services/reasoning/reportGenerator'
    );
    expect(ADJUDICATIVE_SECTION_INTENTS.has('story_verification')).toBe(true);
  });

  it('DESCRIPTIVE_SECTION_PLAN does not contain falsification_criteria section', async () => {
    const { DESCRIPTIVE_SECTION_PLAN } = await import(
      '../services/reasoning/reportGenerator'
    );
    const keys = DESCRIPTIVE_SECTION_PLAN.map((s) => s.key);
    expect(keys).not.toContain('falsification_criteria');
  });

  it('DESCRIPTIVE_SECTION_PLAN does not contain contradiction_analysis section', async () => {
    const { DESCRIPTIVE_SECTION_PLAN } = await import(
      '../services/reasoning/reportGenerator'
    );
    const keys = DESCRIPTIVE_SECTION_PLAN.map((s) => s.key);
    expect(keys).not.toContain('contradiction_analysis');
  });

  it('generateIterativeReport with intentId=opportunity_discovery uses DESCRIPTIVE_SECTION_PLAN (6 sections)', async () => {
    const { DESCRIPTIVE_SECTION_PLAN, generateIterativeReport } = await import(
      '../services/reasoning/reportGenerator'
    );
    const planSectionCount = DESCRIPTIVE_SECTION_PLAN.length;

    // outline + planSectionCount section drafts + 1 challenger + 1 refiner
    callRoleModelMock.mockResolvedValueOnce({ content: JSON.stringify({ outline: [] }) });
    for (let i = 0; i < planSectionCount; i++) {
      callRoleModelMock.mockResolvedValueOnce({ content: `Section ${i + 1} body` });
    }
    callRoleModelMock.mockResolvedValueOnce({ content: 'challenge' });
    callRoleModelMock.mockResolvedValueOnce({ content: '## Final\nRefined' });

    const progress = vi.fn();
    const result = await generateIterativeReport({
      query: 'Find ten underserved SaaS opportunities buildable in 24 hours',
      plan: {},
      evidenceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      intentId: 'opportunity_discovery',
      onSectionProgress: progress,
    });

    expect(progress).toHaveBeenCalledTimes(planSectionCount);
    expect(result.sections).toHaveLength(planSectionCount);
    // Confirm none of the sections are falsification_criteria
    const sectionKeys = result.sections.map((s) => s.key);
    expect(sectionKeys).not.toContain('falsification_criteria');
    expect(sectionKeys).not.toContain('contradiction_analysis');
  });

  it('generateIterativeReport with intentId=adjudication uses SECTION_PLAN (10 sections)', async () => {
    const { SECTION_PLAN, generateIterativeReport } = await import(
      '../services/reasoning/reportGenerator'
    );
    expect(SECTION_PLAN.length).toBe(10);

    callRoleModelMock.mockResolvedValueOnce({ content: JSON.stringify({ outline: [] }) });
    for (let i = 0; i < 10; i++) {
      callRoleModelMock.mockResolvedValueOnce({ content: `Section ${i + 1} body` });
    }
    callRoleModelMock.mockResolvedValueOnce({ content: 'challenge' });
    callRoleModelMock.mockResolvedValueOnce({ content: '## Final\nRefined' });

    const progress = vi.fn();
    const result = await generateIterativeReport({
      query: 'Is the claim X supported by evidence Y?',
      plan: {},
      evidenceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      intentId: 'adjudication',
      onSectionProgress: progress,
    });

    expect(progress).toHaveBeenCalledTimes(10);
    expect(result.sections).toHaveLength(10);
    const sectionKeys = result.sections.map((s) => s.key);
    expect(sectionKeys).toContain('falsification_criteria');
  });

  it('generateIterativeReport with intentId=undefined (legacy) defaults to SECTION_PLAN (10 sections)', async () => {
    const { generateIterativeReport } = await import(
      '../services/reasoning/reportGenerator'
    );

    callRoleModelMock.mockResolvedValueOnce({ content: JSON.stringify({ outline: [] }) });
    for (let i = 0; i < 10; i++) {
      callRoleModelMock.mockResolvedValueOnce({ content: `Section ${i + 1} body` });
    }
    callRoleModelMock.mockResolvedValueOnce({ content: 'challenge' });
    callRoleModelMock.mockResolvedValueOnce({ content: '## Final\nRefined' });

    const progress = vi.fn();
    const result = await generateIterativeReport({
      query: 'Legacy query without intentId',
      plan: {},
      evidenceContext: 'evidence',
      retrieverAnalysis: 'analysis',
      reasoningChains: 'reasoning',
      challenges: 'challenges',
      // intentId deliberately omitted
      onSectionProgress: progress,
    });

    expect(progress).toHaveBeenCalledTimes(10);
    expect(result.sections).toHaveLength(10);
  });
});
