import { describe, expect, it } from 'vitest';
import {
  ORCHESTRATION_PROFILES,
  type OrchestrationProfileDefinition,
} from '../services/planning/orchestrationProfiles';

/**
 * WO-AH — the challenge pass runs on every report.
 *
 * The operator's instruction: "the skeptic ... should be run on everything. we
 * need to verify that the research is correct no matter what type of request the
 * user has."
 *
 * The profiles already decided this per intent, and for seven of seventeen
 * intents the decision was not to verify at all. This is the floor. What stays
 * agent-decided is the STRENGTH: `annotate` records challenges alongside the
 * draft, `gate` runs the challenge before synthesis and can block it. `gate` is
 * the "additional adversarial pass" — the planner keeps that call.
 *
 * A rule that lives only in seventeen object literals is a rule the eighteenth
 * will break, so this asserts it over the whole registry rather than per profile.
 */
const profiles = Object.entries(ORCHESTRATION_PROFILES) as Array<
  [string, OrchestrationProfileDefinition]
>;

describe('every orchestration profile verifies', () => {
  it('has profiles to check', () => {
    expect(profiles.length).toBeGreaterThan(10);
  });

  it.each(profiles)('%s does not disable the challenge pass', (_intent, profile) => {
    expect(profile.skepticMode).not.toBe('off');
  });

  it.each(profiles)('%s runs the challenge stage', (_intent, profile) => {
    expect(profile.agentsToSkip).not.toContain('challenge');
    expect(profile.agentsToRun).toContain('challenge');
  });

  it('leaves the STRENGTH of the pass to the planner', () => {
    // The floor must not flatten the decision it is a floor under. If every
    // profile ended up on one mode, the intent taxonomy would have stopped
    // meaning anything here and this work order would have removed a capability
    // instead of raising a minimum.
    const modes = new Set(profiles.map(([, p]) => p.skepticMode));
    expect(modes.has('annotate')).toBe(true);
    expect(modes.has('gate')).toBe(true);
  });
});
