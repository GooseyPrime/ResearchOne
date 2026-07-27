import { describe, expect, it } from 'vitest';
import {
  AGENT_CAPABILITY_REGISTRY,
  selectAgentsForBrief,
} from '../../services/reasoning/agentCapabilityRegistry';

describe('agentCapabilityRegistry', () => {
  it('always includes the core agents even when no intent is provided', () => {
    const ids = selectAgentsForBrief(undefined).map((agent) => agent.id);
    expect(ids).toEqual(
      expect.arrayContaining(['planner', 'retriever', 'reasoner', 'synthesizer', 'verifier'])
    );
    // REVERT-CHECK: agentCapabilityRegistry.ts — if the non-specialist branch is
    // removed from selectAgentsForBrief, these core agents disappear and this fails.
  });

  it('selects market_scout for opportunity_discovery briefs', () => {
    const ids = selectAgentsForBrief('opportunity_discovery').map((agent) => agent.id);
    expect(ids).toContain('market_scout');
    // REVERT-CHECK: agentCapabilityRegistry.ts — if market_scout loses
    // opportunity_discovery support, this selection assertion fails.
  });

  it('does not select market_scout for adjudication briefs', () => {
    const ids = selectAgentsForBrief('adjudication').map((agent) => agent.id);
    expect(ids).not.toContain('market_scout');
    // REVERT-CHECK: agentCapabilityRegistry.ts — if specialist filtering is
    // removed, market_scout incorrectly appears here and this fails.
  });

  it('does not select story_verifier for adjudication briefs (core agents only)', () => {
    const ids = selectAgentsForBrief('adjudication').map((agent) => agent.id);
    expect(ids).not.toContain('story_verifier');
    // REVERT-CHECK: agentCapabilityRegistry.ts — if adjudication is re-added to
    // story_verifier.supportedIntents, story_verifier incorrectly appears here and this fails.
  });

  it('selects story_verifier for story_verification briefs', () => {
    const ids = selectAgentsForBrief('story_verification').map((agent) => agent.id);
    expect(ids).toContain('story_verifier');
    // REVERT-CHECK: agentCapabilityRegistry.ts — if story_verifier loses
    // story_verification support, this test fails.
  });

  it('selects feasibility_architect for feasibility and implementation intents', () => {
    expect(selectAgentsForBrief('feasibility').map((agent) => agent.id)).toContain('feasibility_architect');
    expect(selectAgentsForBrief('implementation').map((agent) => agent.id)).toContain('feasibility_architect');
    // REVERT-CHECK: agentCapabilityRegistry.ts — if either supported intent is
    // removed from feasibility_architect, one of these expectations fails.
  });

  it('does not return duplicate agents when primary and secondary intents overlap', () => {
    const ids = selectAgentsForBrief('opportunity_discovery', 'comparative').map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
    // For this intent pair market_scout and competitor_mapper both match; verify they
    // appear exactly once each.
    expect(ids.filter((id) => id === 'market_scout')).toHaveLength(1);
    expect(ids.filter((id) => id === 'competitor_mapper')).toHaveLength(1);
    // REVERT-CHECK: agentCapabilityRegistry.ts — if deduplication is removed,
    // overlapping specialist matches would duplicate ids and this fails.
  });

  it('defines cost class and parallelism for every specialist agent', () => {
    const specialists = AGENT_CAPABILITY_REGISTRY.filter((agent) => agent.isSpecialist);
    expect(specialists.length).toBe(6);
    specialists.forEach((agent) => {
      expect(['low', 'medium', 'high']).toContain(agent.costClass);
      expect(typeof agent.canRunInParallel).toBe('boolean');
    });
    // REVERT-CHECK: agentCapabilityRegistry.ts — if any specialist omits
    // costClass or canRunInParallel, registry shape or these expectations fail.
  });
});
