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

describe('a plan confirmed for a run whose Layer 1 switch is on for that run alone', () => {
  const sized = (): PlanPayload => {
    const plan = basePlan('factual_report');
    return { ...plan, outputShape: { ...plan.outputShape, estimatedLength: { minWords: 80, maxWords: 150 } } };
  };

  it("keeps the planner's length when the plan is merged under the run's switches", () => {
    const merged = mergePlanPayloadForRun(sized(), { BASELINE_LAYER_ENABLED: true });
    expect(merged.outputShape.estimatedLength).toEqual({ minWords: 80, maxWords: 150 });
    expect(resolveReportWordTarget({ estimatedLength: merged.outputShape.estimatedLength })).toEqual({ target: 115, source: 'planner' });
  });

  it("takes the report type's standard range when the run has no such switch", () => {
    const merged = mergePlanPayloadForRun(sized(), null);
    expect(merged.outputShape.estimatedLength).toEqual({ minWords: 1200, maxWords: 6000 });
  });

  it('is merged that way when the run resumes after confirmation', () => {
    const orchestrator = readFileSync(join(__dirname, '../../services/reasoning/researchOrchestrator.ts'), 'utf8');
    expect(orchestrator).toContain('mergePlanPayloadForRun(rawPlan as PlanPayload, await loadRunFlags(runId))');
    expect(orchestrator).not.toContain('mergePlanPayloadWithCanonicalProfile(');
  });
});
