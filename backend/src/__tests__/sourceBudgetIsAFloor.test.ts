/**
 * The scaled source budget has to be the effective limit (Codex P1, #229).
 *
 * `resolveSourceIngestBudget` computed a larger number for a long report, and
 * `runDiscoveryOrchestrator` then took `min(planner's request, cap)` — so a
 * planner asking for ten sources still capped a 7,000-word report at ten and
 * the helper changed nothing. My original test exercised the helper in
 * isolation, which is a test shaped like the fix rather than like the failure.
 */
import { describe, expect, it } from 'vitest';

import {
  effectiveIngestCap,
  resolveSourceIngestBudget,
  MAX_SOURCES_PER_RUN,
} from '../services/discovery/sourceBudget';
import { paidForLegacyChallengeUpgrade, applyLegacyPaidChallengeUpgrade } from '../services/reasoning/runAddons';

// `effectiveIngestCap` is the function discovery actually calls, not a copy of
// its arithmetic — a test that re-implements the expression it is checking
// passes whatever the caller does.

describe('a planner cannot ask for fewer sources than the deliverable needs', () => {
  it('keeps the scaled budget when the planner asks for less', () => {
    const budgetFloor = resolveSourceIngestBudget({ configuredCap: 10, targetWordCount: 7000 });
    expect(budgetFloor).toBeGreaterThan(10);
    // The old expression: Math.min(10 || cap, cap) === 10.
    expect(effectiveIngestCap({ budgetFloor, plannerRequest: 10 })).toBe(budgetFloor);
  });

  it('lets the planner ask for more', () => {
    const budgetFloor = resolveSourceIngestBudget({ configuredCap: 10 });
    expect(effectiveIngestCap({ budgetFloor, plannerRequest: 25 })).toBe(25);
  });

  it('still refuses to exceed the hard ceiling', () => {
    const budgetFloor = resolveSourceIngestBudget({ configuredCap: 10, requestedArtifactCount: 20 });
    expect(effectiveIngestCap({ budgetFloor, plannerRequest: 500 })).toBe(MAX_SOURCES_PER_RUN);
  });

  it('clamps a misconfigured floor to the hard ceiling', () => {
    expect(effectiveIngestCap({ budgetFloor: MAX_SOURCES_PER_RUN + 5, plannerRequest: 0 })).toBe(MAX_SOURCES_PER_RUN);
  });

  it('falls back to the floor when the planner names no number at all', () => {
    const budgetFloor = resolveSourceIngestBudget({ configuredCap: 10, targetWordCount: 4000 });
    expect(effectiveIngestCap({ budgetFloor, plannerRequest: 0 })).toBe(budgetFloor);
  });
});

/**
 * A run that already paid for the removed add-on still gets what it bought
 * (Codex P1, #229). Its wallet hold includes the surcharge and the orchestrator
 * consumes it on completion, so dropping the key as "unknown" charged five
 * dollars for a stronger pass that never ran.
 */
describe('an in-flight run keeps the challenge upgrade it paid for', () => {
  it('recognises the removed key in raw persisted add-ons', () => {
    expect(paidForLegacyChallengeUpgrade(['parallel_search', 'adversarial_twin'])).toBe(true);
    expect(paidForLegacyChallengeUpgrade(['parallel_search'])).toBe(false);
    expect(paidForLegacyChallengeUpgrade(null)).toBe(false);
  });

  it('forces the strongest challenge pass for such a run', () => {
    expect(applyLegacyPaidChallengeUpgrade({ skepticMode: 'annotate' as const }).skepticMode).toBe('gate');
  });

  it('leaves a profile that already gates alone', () => {
    const profile = { skepticMode: 'gate' as const, other: 1 };
    expect(applyLegacyPaidChallengeUpgrade(profile)).toBe(profile);
  });
});
