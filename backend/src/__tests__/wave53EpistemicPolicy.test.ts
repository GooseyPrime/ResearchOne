import { describe, it, expect } from 'vitest';
import {
  aggregateSourceClassBreakdown,
  buildReasonerSystemPrompt,
  buildSkepticSystemPrompt,
  resolveSourceClassForChunk,
  type SourceClassMap,
} from '../services/planning/wave53EpistemicPolicy';
import { REASONER_CONSENSUS_CONSTRAINT } from '../services/reasoning/reasoningModelPolicy';

describe('wave53EpistemicPolicy', () => {
  it('buildReasonerSystemPrompt appends the consensus constraint body', () => {
    const prompt = buildReasonerSystemPrompt(true);
    expect(prompt.length).toBeGreaterThan(REASONER_CONSENSUS_CONSTRAINT.length);
    expect(prompt).toContain(REASONER_CONSENSUS_CONSTRAINT);
    expect(prompt).toMatch(/consensus/i);
    expect(prompt).toMatch(/Wave\s+5\.3|EPISTEMIC\s+CONSTRAINT/i);
  });

  it('buildSkepticSystemPrompt differs by dominant source class overlays', () => {
    const held = buildSkepticSystemPrompt(['consensus_held']);
    const contested = buildSkepticSystemPrompt(['actively_contested']);
    expect(held).toContain('SOURCE-CLASS OVERLAY (consensus_held)');
    expect(contested).toContain('SOURCE-CLASS OVERLAY (actively_contested)');
    expect(held).not.toContain('SOURCE-CLASS OVERLAY (actively_contested)');
    expect(contested).not.toContain('SOURCE-CLASS OVERLAY (consensus_held)');
  });

  it('buildSkepticSystemPrompt stacks overlays when multiple classes are dominant', () => {
    const both = buildSkepticSystemPrompt(['suppressed_and_recovered', 'consensus_collapsed']);
    expect(both).toContain('SOURCE-CLASS OVERLAY (suppressed_and_recovered)');
    expect(both).toContain('SOURCE-CLASS OVERLAY (consensus_collapsed)');
  });

  it('aggregateSourceClassBreakdown counts non-null chunk classifications only', () => {
    const breakdown = aggregateSourceClassBreakdown(
      new Map([
        ['a', 'consensus_held'],
        ['b', 'consensus_held'],
        ['c', null],
        ['d', 'actively_contested'],
      ]),
    );
    expect(breakdown.consensus_held).toBe(2);
    expect(breakdown.actively_contested).toBe(1);
    expect(breakdown.suppressed_and_recovered).toBe(0);
    expect(breakdown.consensus_collapsed).toBe(0);
  });

  it('resolveSourceClassForChunk prefers chunk map then canonical URL', () => {
    const maps: SourceClassMap = {
      byChunkId: new Map([['c1', null]]),
      bySourceUrl: new Map([['https://example.com', 'consensus_collapsed']]),
    };
    expect(resolveSourceClassForChunk('c1', maps, 'https://example.com')).toBeNull();
    maps.byChunkId.delete('c1');
    expect(resolveSourceClassForChunk('c1', maps, 'https://example.com')).toBe('consensus_collapsed');
    expect(resolveSourceClassForChunk('missing', maps, null)).toBeNull();
  });
});
