/**
 * RJ-018 items 6 and 7. The plan screen printed the planning model's own
 * vocabulary under "How well we can research this" ("In-distribution for
 * investigative research … Novelty lies in future-facing assessment"), and the
 * run was named after its sentence about the request. These tests hold the
 * instruction the planning step is given, and what is done with its answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('../db/pool', () => ({ query: db.query, queryOne: db.queryOne, withTransaction: vi.fn() }));

import { planGeneratorSystemPrompt } from '../services/planning/planGenerator';
import { planRefinementSystemPrompt } from '../services/planning/planRefinementService';
import { PLAN_GENERATOR_PROMPT, PLAN_PLAIN_WORDS_INSTRUCTION } from '../services/planning/prompts';
import { parsePlanGeneratorJson, planPayloadFromUnknown, usesPlanningJargon } from '../services/planning/planJson';
import { insertGateResearchPlan } from '../services/planning/planWriteService';

/** The terms a customer was shown, and their near relatives. */
const JARGON = /\b(in[- ]distribution|out[- ]of[- ]distribution|OOD|novelty|web[- ]retrieval|retrieval research stack|research stack|corpus|epistemic)\b/i;

/** The prompt without the one line that lists the banned terms in order to ban them. */
function withoutTheBanList(prompt: string): string {
  return prompt
    .split('\n')
    .filter((line) => !line.startsWith('- Never use these terms'))
    .join('\n');
}

describe('the instruction given to the planning step', () => {
  it('asks for a short plain title of the question, and says what a title is not', () => {
    const prompt = planGeneratorSystemPrompt();
    expect(prompt).toContain('"title": "<a short plain title of the question');
    expect(prompt).toContain(PLAN_PLAIN_WORDS_INSTRUCTION);
    expect(prompt).toMatch(/"title" names the subject of the question in 4 to 10 words/);
    expect(prompt).toMatch(/Never begin it with "The query", "The request", "The user"/);
    expect(prompt).toContain('Election security for the 2026 presidential election');
  });

  it('tells it to write for a general reader, and names the terms it must not use', () => {
    const prompt = planGeneratorSystemPrompt();
    expect(prompt).toMatch(/Write them for a general reader with no technical background/);
    const banList = prompt.split('\n').find((line) => line.startsWith('- Never use these terms')) ?? '';
    for (const term of ['in-distribution', 'out-of-distribution', 'OOD', 'novelty', 'retrieval', 'stack', 'corpus', 'epistemic', 'multi-layer', 'query']) {
      expect(banList, term).toContain(term);
    }
  });

  it('does not itself ask for those terms anywhere else', () => {
    // On main the shape asked for "whether this is in-distribution for a
    // web-retrieval research stack; flag novelty/OOD candidly".
    expect(withoutTheBanList(PLAN_GENERATOR_PROMPT)).not.toMatch(JARGON);
    expect(withoutTheBanList(planGeneratorSystemPrompt())).not.toMatch(JARGON);
    expect(PLAN_GENERATOR_PROMPT).toMatch(/"competenceAssessment": "<1-2 plain sentences/);
    expect(PLAN_GENERATOR_PROMPT).toMatch(/"summary": "<2-4 plain sentences/);
  });

  it('records difficulty as a flag, so the wording does not have to carry it', () => {
    expect(PLAN_GENERATOR_PROMPT).toContain('"hardToResearch": boolean');
    expect(PLAN_PLAIN_WORDS_INSTRUCTION).toMatch(/Set "topicAnalysis\.hardToResearch" to true when/);
  });

  it('a changed plan is written under the same instruction and keeps its title', () => {
    const prompt = planRefinementSystemPrompt();
    expect(prompt).toContain(PLAN_PLAIN_WORDS_INSTRUCTION);
    expect(prompt).toMatch(/Keep "title" as it is unless the subject of the research changes/);
  });
});

describe('what is done with the planning step’s answer', () => {
  const answer = (topic: Record<string, unknown>, title?: string): string =>
    JSON.stringify({ ...(title ? { title } : {}), intent: { id: 'investigation' }, topicAnalysis: { summary: 'You want to know how the 2026 election is protected.', ...topic } });

  it('a note in the model’s vocabulary is not shown, and its warning is kept as the flag', () => {
    const shown = 'In-distribution for investigative research. Novelty lies in future-facing assessment.';
    expect(usesPlanningJargon(shown)).toBe(true);
    const plan = parsePlanGeneratorJson(answer({ competenceAssessment: shown }), 'investigation', 0.9);
    expect(plan.topicAnalysis.competenceAssessment).toBe('');
    expect(plan.topicAnalysis.hardToResearch).toBe(false);

    const unsure = parsePlanGeneratorJson(answer({ competenceAssessment: 'Out-of-distribution for this stack; highly novel.' }), 'investigation', 0.9);
    expect(unsure.topicAnalysis.competenceAssessment).toBe('');
    expect(unsure.topicAnalysis.hardToResearch).toBe(true);
  });

  it('a plain note is shown as written, and the flag is read from the answer', () => {
    const plain = 'There is plenty of published material on this. Plans announced after this summer may not be online yet.';
    expect(usesPlanningJargon(plain)).toBe(false);
    const plan = parsePlanGeneratorJson(answer({ competenceAssessment: plain, hardToResearch: true }), 'investigation', 0.9);
    expect(plan.topicAnalysis.competenceAssessment).toBe(plain);
    expect(plan.topicAnalysis.hardToResearch).toBe(true);
  });

  it('keeps the title on the plan, through storage and back', () => {
    const plan = parsePlanGeneratorJson(answer({}, '  Election security for the\n2026 presidential election '), 'investigation', 0.9);
    expect(plan.title).toBe('Election security for the 2026 presidential election');
    expect(planPayloadFromUnknown(JSON.parse(JSON.stringify(plan)), 'investigation', 0.9).title).toBe(plan.title);
    expect(parsePlanGeneratorJson(answer({}), 'investigation', 0.9).title).toBeUndefined();
  });
});

describe('the title a run is stored under', () => {
  const REQUEST = 'What security measures protect the 2026 presidential election? Include audits.';
  const ANALYSIS = 'The query requires investigating dual dimensions: (1) concrete security measures and (2) their effectiveness.';
  const storedTitle = (): unknown => db.query.mock.calls.find(([sql]) => /SET display_title/.test(String(sql)))?.[1]?.[1];
  const plan = (title: string | undefined) => ({
    ...parsePlanGeneratorJson(JSON.stringify({ ...(title ? { title } : {}), topicAnalysis: { summary: ANALYSIS } }), 'investigation', 0.9),
  });

  beforeEach(() => {
    db.query.mockReset().mockResolvedValue([]);
    db.queryOne.mockReset().mockImplementation(async (sql: string) => (/INSERT INTO research_plans/.test(sql) ? { id: 'plan_1' } : { query: REQUEST }));
  });

  const insert = (title: string | undefined) =>
    insertGateResearchPlan({ runId: '00000000-0000-4000-8000-000000000001', orgId: null, userId: 'u1', intent: 'investigation', intentConfidence: 0.9, planPayload: plan(title), orchestrationProfile: null });

  it('is the short plain title the planning step wrote', async () => {
    await insert('Election security for the 2026 presidential election');
    expect(storedTitle()).toBe('Election security for the 2026 presidential election');
  });

  it('is made from the request when the planning step wrote none, or wrote its analysis', async () => {
    await insert(undefined);
    // On main this stored the first sentence of the analysis.
    expect(storedTitle()).toBe('What security measures protect the 2026 presidential election?');
    db.query.mockClear();
    await insert(ANALYSIS);
    expect(storedTitle()).toBe('What security measures protect the 2026 presidential election?');
  });
});
