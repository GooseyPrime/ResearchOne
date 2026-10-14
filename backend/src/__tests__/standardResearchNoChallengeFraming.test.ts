/**
 * Standard research is not run through challenge-only framing (14 Oct 2026).
 *
 * Double-check runs on every report (WO-AH). On a fact-check, investigation or
 * story verification it challenges the findings; on every other run it tests
 * them against the sources. Before this change the Double-check call, the
 * strongest-form pass and the discovery planners of a standard run were all
 * written under the challenge framing: the adversarial prefix and the
 * reasoning-first preamble. Each check below fails on that code.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REASONING_FIRST_PREAMBLE, STANDARD_RESEARCH_PREAMBLE, withPreamble, withStandardPreamble } from '../constants/prompts';
import { applySystemAugmentations, STANDARD_SYSTEM_PROMPTS, SYSTEM_PROMPTS } from '../services/openrouter/openrouterService';
import { CHALLENGE_PASS_SYSTEM_PREFIX } from '../services/reasoning/reasoningModelPolicy';
import { buildDoubleCheckSystemPrompt } from '../services/planning/wave53EpistemicPolicy';
import { discoveryPreamble } from '../services/discovery/discoveryOrchestrator';

const ORCHESTRATOR = readFileSync(join(__dirname, '../services/reasoning/researchOrchestrator.ts'), 'utf8');

function systemOf(options: Parameters<typeof applySystemAugmentations>[0]): string {
  return applySystemAugmentations(options).find((message) => message.role === 'system')?.content ?? '';
}

describe('Double-check on a standard run', () => {
  it('gets the standard prompt, which tests findings and does not attack them', () => {
    const standard = buildDoubleCheckSystemPrompt([], false);
    expect(standard).toContain(STANDARD_RESEARCH_PREAMBLE);
    expect(standard).not.toContain(REASONING_FIRST_PREAMBLE);
    expect(standard).not.toMatch(/\battack\b/i);
    expect(buildDoubleCheckSystemPrompt([])).toBe(standard);
  });

  it('keeps the challenge prompt for a fact-check, an investigation or a story verification', () => {
    const challenge = buildDoubleCheckSystemPrompt([], true);
    expect(challenge).toContain(REASONING_FIRST_PREAMBLE);
    expect(challenge).toMatch(/attack the conclusions/);
    expect(challenge.startsWith(SYSTEM_PROMPTS.double_check.trim())).toBe(true);
  });

  it('is not given the adversarial prefix; a challenge run still is', () => {
    const messages = [{ role: 'system' as const, content: STANDARD_SYSTEM_PROMPTS.double_check }, { role: 'user' as const, content: 'q' }];
    expect(systemOf({ role: 'double_check', messages, isAdjudicative: false, baselineLayer: true })).not.toContain(CHALLENGE_PASS_SYSTEM_PREFIX);
    expect(systemOf({ role: 'double_check', messages, isAdjudicative: true, baselineLayer: false })).toContain(CHALLENGE_PASS_SYSTEM_PREFIX);
  });

  it('both Double-check calls in the pipeline pass whether the run is a challenge run', () => {
    const calls = ORCHESTRATOR.split("role: 'double_check',").slice(1).map((after) => after.slice(0, 600));
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toContain('isAdjudicative,');
      expect(call).toContain('baselineLayer: !isAdjudicative,');
    }
    expect(ORCHESTRATOR).toContain('buildDoubleCheckSystemPrompt(wave53DominantSourceClasses, isAdjudicative)');
  });

  it('the strongest-form restatement uses the standard preamble on a standard run', () => {
    expect(STANDARD_SYSTEM_PROMPTS.strongest_form).toContain(STANDARD_RESEARCH_PREAMBLE);
    expect(STANDARD_SYSTEM_PROMPTS.strongest_form).not.toContain(REASONING_FIRST_PREAMBLE);
    expect(SYSTEM_PROMPTS.strongest_form).toContain(REASONING_FIRST_PREAMBLE);
    expect(ORCHESTRATOR).toMatch(/runStrongestFormPass\(\{[\s\S]{0,300}isAdjudicative,/);
  });
});

describe('discovery planning on a standard run', () => {
  it('is written under the standard preamble; a challenge run keeps the challenge one', () => {
    expect(discoveryPreamble(false)).toBe(withStandardPreamble);
    expect(discoveryPreamble(true)).toBe(withPreamble);
    const source = readFileSync(join(__dirname, '../services/discovery/discoveryOrchestrator.ts'), 'utf8');
    expect(source).not.toMatch(/content: withPreamble\(/);
  });
});

describe('the plan screen for a reference lookup', () => {
  it('does not say writing is skipped, and does not list the source analyst, whose step does not run', async () => {
    const { buildCanonicalExecutionPlan } = await import('../services/planning/executionPlan');
    const { getOrchestrationProfileForIntent } = await import('../services/planning/orchestrationProfiles');
    const lookup = buildCanonicalExecutionPlan({ profile: getOrchestrationProfileForIntent('reference_lookup') });
    expect(lookup.skipReasons.synthesis).toBeUndefined();
    expect(lookup.corePipelineStages).toContain('synthesis');
    expect(lookup.coreAgentRoles).toEqual(['planner', 'retriever', 'synthesizer', 'verifier']);
    const factual = buildCanonicalExecutionPlan({ profile: getOrchestrationProfileForIntent('factual_report') });
    expect(factual.coreAgentRoles).toEqual(['planner', 'retriever', 'reasoner', 'synthesizer', 'verifier']);
  });
});
