import { describe, expect, it } from 'vitest';
import { parsePlanGeneratorJson, parsePlanRefinementJson } from '../services/planning/planJson';
import { defaultResearchBrief } from '../services/planning/researchBrief';
import { ADJUDICATIVE_SECTION_INTENTS } from '../services/reasoning/reportGenerator';

/** How the worker decides a run takes the challenge-style path (researchOrchestrator, stage 1). */
function runsAsChallenge(plan: { intent: { id: string }; researchBrief?: { resolvedMethodology?: string } }): boolean {
  return plan.researchBrief?.resolvedMethodology === 'policyone' || ADJUDICATIVE_SECTION_INTENTS.has(plan.intent.id);
}

function planFor(intent: 'investigation' | 'survey') {
  return parsePlanGeneratorJson('{}', intent, 0.95, defaultResearchBrief(intent, 0.95, 'classified'));
}

function refine(current: ReturnType<typeof planFor>, to: string, echoBrief: boolean) {
  const revisedPlan: Record<string, unknown> = { ...current, intent: { ...current.intent, id: to, displayLabel: to } };
  if (!echoBrief) delete revisedPlan.researchBrief;
  return parsePlanRefinementJson(
    JSON.stringify({ revisedPlan, diffSummary: 'changed the report type', intentChange: { detected: true, from: current.intent.id, to, rationale: 'user asked' } }),
    current
  ).revisedPlan;
}

describe('changing the report type at the plan screen', () => {
  it('starts from a plan that runs as a challenge', () => {
    expect(runsAsChallenge(planFor('investigation'))).toBe(true);
  });

  it.each([true, false])('an Investigation changed to a Survey no longer runs as a challenge (model echoes the brief: %s)', (echoBrief) => {
    const revised = refine(planFor('investigation'), 'survey', echoBrief);
    expect(revised.intent.id).toBe('survey');
    expect(revised.researchBrief?.primaryIntent).toBe('survey');
    expect(revised.researchBrief?.resolvedMethodology).toBe('standard');
    expect(revised.resolvedMethodology).toBe('standard');
    expect(revised.researchBrief?.epistemicPosture).toBe(planFor('survey').researchBrief?.epistemicPosture);
    expect(runsAsChallenge(revised)).toBe(false);
  });

  it('a Survey changed to an Investigation runs as a challenge', () => {
    const revised = refine(planFor('survey'), 'investigation', true);
    expect(revised.researchBrief?.primaryIntent).toBe('investigation');
    expect(revised.researchBrief?.resolvedMethodology).toBe('policyone');
    expect(runsAsChallenge(revised)).toBe(true);
  });

  it('keeps a challenge method the user asked for by name, whatever the report type becomes', () => {
    const current = planFor('investigation');
    const asked = { ...current, researchBrief: { ...current.researchBrief!, requestedMethodology: 'policyone' as const, methodologyResolutionSource: 'user' as const } };
    const revised = refine(asked, 'survey', true);
    expect(revised.researchBrief?.resolvedMethodology).toBe('policyone');
  });

  it('changes nothing about the method when the report type stays the same', () => {
    const current = planFor('investigation');
    const revised = refine(current, 'investigation', true);
    expect(revised.researchBrief?.resolvedMethodology).toBe('policyone');
    expect(revised.researchBrief?.primaryIntent).toBe('investigation');
  });
});
