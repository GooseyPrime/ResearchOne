import { describe, expect, it } from 'vitest';
import { mergePlanPayloadWithCanonicalProfile } from '../../services/planning/orchestrationRuntime';
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
