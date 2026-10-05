import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ callRoleModel: vi.fn() }));

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: mocks.callRoleModel,
  getSystemPrompt: () => 'system',
}));
vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>();
  return { ...actual, config: { ...actual.config, openrouter: { ...actual.config.openrouter, apiKey: 'test-key' } } };
});

import { runWithFlags } from '../config';
import { refinePlan } from '../services/planning/planRefinementService';
import { parsePlanGeneratorJson } from '../services/planning/planJson';
import { defaultResearchBrief } from '../services/planning/researchBrief';
import { PLAN_LENGTH_FIT_INSTRUCTION } from '../services/planning/prompts';
import { PLANNER_WORD_CEILING, resolveReportWordTarget } from '../services/reasoning/reportGenerator';
import { referenceDetails, type LockedSourceRow } from '../services/reasoning/researchOrchestrator';

const BOTH_ON = { BASELINE_LAYER_ENABLED: true, CITATION_LOCK_ENABLED: true };

function currentPlan() {
  return parsePlanGeneratorJson('{}', 'reference_lookup', 0.8, defaultResearchBrief('reference_lookup', 0.8, 'classified'));
}

function refineTo(intent: string, estimatedLength: { minWords: number; maxWords: number }) {
  const plan = currentPlan();
  mocks.callRoleModel.mockResolvedValue({
    content: JSON.stringify({
      revisedPlan: { ...plan, intent: { ...plan.intent, id: intent }, outputShape: { ...plan.outputShape, estimatedLength } },
      diffSummary: 'changed',
      intentChange: { detected: true, from: 'reference_lookup', to: intent, rationale: 'asked' },
    }),
  });
  return refinePlan({ currentPlan: plan, refinementInstruction: 'Make this a factual report', query: 'What year?', llmOpts: { allowFallbackByRole: {} } });
}

const systemPromptSent = (): string => (mocks.callRoleModel.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages[0].content;

describe('revising a plan under the switches of its run', () => {
  beforeEach(() => mocks.callRoleModel.mockReset());

  it('sizes a revised plan to the question when the Layer 1 switch is on for the run', async () => {
    const out = await runWithFlags(BOTH_ON, () => refineTo('factual_report', { minWords: 60, maxWords: 150 }));
    expect(systemPromptSent()).toContain(PLAN_LENGTH_FIT_INSTRUCTION);
    expect(systemPromptSent()).toContain('If the report type changes, size estimatedLength again for the new type.');
    // The length the planner chose is kept, not replaced by the report type's standard range.
    expect(out.revisedPlan.outputShape.estimatedLength).toEqual({ minWords: 60, maxWords: 150 });
    expect(resolveReportWordTarget({ estimatedLength: out.revisedPlan.outputShape.estimatedLength })).toEqual({ target: 105, source: 'planner' });
  });

  it('revises a plan as before when the switch is off', async () => {
    const out = await refineTo('factual_report', { minWords: 60, maxWords: 150 });
    expect(systemPromptSent()).not.toContain(PLAN_LENGTH_FIT_INSTRUCTION);
    // With the switch off the report type's standard range is used, as it was.
    expect(out.revisedPlan.outputShape.estimatedLength.maxWords).toBeGreaterThan(150);
  });
});

describe('a report nobody chose a length for', () => {
  it('is never sized above the top of the range for a full report', () => {
    expect(PLANNER_WORD_CEILING).toBe(5000);
    expect(resolveReportWordTarget({ estimatedLength: { minWords: 6500, maxWords: 8000 } })).toEqual({ target: 5000, source: 'planner' });
    expect(resolveReportWordTarget({ estimatedLength: { minWords: 1500, maxWords: 3000 } })).toEqual({ target: 2250, source: 'planner' });
  });

  it('leaves a length the user chose alone', () => {
    expect(resolveReportWordTarget({ userTarget: 9000, estimatedLength: { minWords: 100, maxWords: 200 } })).toEqual({ target: 9000, source: 'user' });
  });
});

describe('reference details of a retrieved source', () => {
  const row = (over: Partial<LockedSourceRow>): LockedSourceRow => ({
    id: 'chunk-1',
    source_id: 'source-1',
    authors: null,
    publication: null,
    url: null,
    original_filename: null,
    retrieval_timestamp: null,
    provider: null,
    ...over,
  });

  it('adds authors, kind and the day it was read from the stored record', () => {
    expect(
      referenceDetails(
        { title: 'A study', publisher: null, date: '2016-04-01', url: 'https://doi.org/10.1/x' },
        row({ authors: ['Lovering, Jessica R.', ' '], publication: 'Energy Policy', provider: 'crossref', kind: 'journal article', retrieval_timestamp: new Date('2026-10-04T20:46:00Z') })
      )
    ).toEqual({
      title: 'A study',
      publisher: 'Energy Policy',
      date: '2016-04-01',
      url: 'https://doi.org/10.1/x',
      authors: ['Lovering, Jessica R.'],
      kind: 'journal article',
      accessed: '2026-10-04',
    });
  });

  it('leaves missing details missing', () => {
    const details = referenceDetails({ title: 'A page', url: 'https://example.org/a' }, row({ url: 'https://example.org/a' }));
    expect(details.authors).toBeNull();
    expect(details.publisher).toBeNull();
    expect(details.accessed).toBeNull();
    expect(details.kind).toBe('web page');
    expect(referenceDetails({ title: 'A page' }, undefined)).toEqual({ title: 'A page' });
    expect(referenceDetails(undefined, undefined)).toEqual({ title: 'Untitled source' });
  });

  it('calls a stored file with no address an uploaded document', () => {
    expect(referenceDetails({ title: 'Board minutes' }, row({ original_filename: 'minutes.pdf' })).kind).toBe('uploaded document');
  });
});
