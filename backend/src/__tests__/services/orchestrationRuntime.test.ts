import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergePlanPayloadForRun, mergePlanPayloadWithCanonicalProfile } from '../../services/planning/orchestrationRuntime';
import { resolveReportWordTarget } from '../../services/reasoning/reportGenerator';
import type { PlanPayload } from '../../services/planning/planTypes';

function basePlan(intent: PlanPayload['intent']['id']): PlanPayload {
  return {
    intent: {
      id: intent,
      displayLabel: intent,
      confidence: 0.9,
      reasoning: 'test',
    },
    topicAnalysis: {
      summary: 'summary',
      isMultiLayer: true,
      isActivelyContested: false,
      competenceAssessment: 'ok',
    },
    orchestrationProfile: {
      name: 'test',
      description: 'test',
      agentsWillRun: [],
      agentsWillSkip: [],
    },
    sourceStrategy: {
      summary: 'sources',
      weightedClasses: ['general_web'],
      expectedSourceCount: { min: 1, max: 5 },
    },
    outputShape: {
      structure: 'report',
      estimatedLength: { minWords: 500, maxWords: 1500 },
      documentShape: 'doc',
    },
    estimatedCost: {
      durationSeconds: { min: 30, max: 120 },
      estimatedTokens: 1000,
      estimatedCostCents: null,
    },
  };
}

describe('orchestrationRuntime canonical execution plan', () => {
  it('uses secondary intent before specialist selection', () => {
    const merged = mergePlanPayloadWithCanonicalProfile({
      ...basePlan('comparative'),
      researchBrief: {
        primaryIntent: 'comparative',
        secondaryIntent: 'feasibility',
        requestedArtifacts: [],
        userConstraints: [],
        epistemicPosture: 'decision',
        confidence: 0.9,
        reasoning: 'composite',
        requestedMethodology: 'auto',
        resolvedMethodology: 'standard',
        methodologyResolutionSource: 'fallback',
      },
    });
    const specialists = merged.executionPlan?.specialistAgents ?? [];
    expect(specialists).toContain('feasibility_architect');
    expect(new Set(specialists).size).toBe(specialists.length);
    // REVERT-CHECK: planGenerator/planJson ordering — if researchBrief is attached
    // after canonical merge, secondary-intent specialists disappear.
  });

  it('keeps preview roster as agent roles, not pipeline stages', () => {
    const merged = mergePlanPayloadWithCanonicalProfile(basePlan('reference_lookup'));
    const runRoster = merged.orchestrationProfile.agentsWillRun;
    expect(runRoster).toContain('planner');
    expect(runRoster).not.toContain('reasoning');
    expect(runRoster).not.toContain('retrieval');
    // REVERT-CHECK: orchestrationRuntime.ts — if stage ids are mixed back into
    // agentsWillRun, reference_lookup preview falsely advertises non-agent stages.
  });
});

describe('the length the planner chose, when a confirmed plan is merged for its run', () => {
  const sized = (): PlanPayload => {
    const plan = basePlan('factual_report');
    return { ...plan, outputShape: { ...plan.outputShape, estimatedLength: { minWords: 80, maxWords: 150 } } };
  };

  it.each([
    ['no recorded switches', null],
    ['the retired switch recorded as on', { BASELINE_LAYER_ENABLED: true }],
    ['the retired switch recorded as off', { BASELINE_LAYER_ENABLED: false }],
  ] as const)('is kept for a run with %s', (_label, flags) => {
    const merged = mergePlanPayloadForRun(sized(), flags);
    expect(merged.outputShape.estimatedLength).toEqual({ minWords: 80, maxWords: 150 });
    expect(resolveReportWordTarget({ estimatedLength: merged.outputShape.estimatedLength })).toEqual({ target: 115, source: 'planner' });
  });

  it("gives way to the report type's standard range only when the plan has no usable length", () => {
    const plan = sized();
    const merged = mergePlanPayloadForRun({ ...plan, outputShape: { ...plan.outputShape, estimatedLength: { minWords: 0, maxWords: 0 } } }, null);
    expect(merged.outputShape.estimatedLength).toEqual({ minWords: 1200, maxWords: 6000 });
  });

  it('is merged that way when the run resumes after confirmation', () => {
    const orchestrator = readFileSync(join(__dirname, '../../services/reasoning/researchOrchestrator.ts'), 'utf8');
    expect(orchestrator).toContain('mergePlanPayloadForRun(rawPlan as PlanPayload, await loadRunFlags(runId))');
    expect(orchestrator).not.toContain('mergePlanPayloadWithCanonicalProfile(');
  });
});
