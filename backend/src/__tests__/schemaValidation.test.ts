import { describe, expect, it } from 'vitest';
import { validateAgentOutput, AGENT_OUTPUT_SCHEMAS } from '../schemas/agentOutputSchemas';

describe('agent output schema validation', () => {
  it('has schemas for all 8 core agents', () => {
    const expected = [
      'planner', 'retriever', 'reasoner', 'skeptic',
      'synthesizer', 'verifier', 'plain_language_synthesizer', 'outline_architect',
    ];
    for (const role of expected) {
      expect(AGENT_OUTPUT_SCHEMAS[role]).toBeDefined();
    }
  });

  describe('planner schema', () => {
    it('accepts valid output', () => {
      const result = validateAgentOutput('planner', {
        research_questions: ['What is X?'],
        search_strategy: 'broad search',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects empty research_questions', () => {
      const result = validateAgentOutput('planner', {
        research_questions: [],
        search_strategy: 'broad',
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('verifier schema', () => {
    it('accepts pass verdict', () => {
      const result = validateAgentOutput('verifier', {
        verdict: 'pass',
        findings: [{ check: 'completeness', result: 'pass', detail: 'All sections present' }],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts fail verdict with contested source flag', () => {
      const result = validateAgentOutput('verifier', {
        verdict: 'fail',
        findings: [{ check: 'retracted_source', result: 'fail', detail: 'Missing mechanism comparison' }],
        contested_source_analysis: false,
      });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid verdict', () => {
      const result = validateAgentOutput('verifier', {
        verdict: 'maybe',
        findings: [],
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('skeptic schema', () => {
    it('accepts output with structural comparisons', () => {
      const result = validateAgentOutput('skeptic', {
        challenges: 'The claim about X is unsupported...',
        structural_comparisons: [{
          source_claim: 'X causes Y',
          contrasting_claim: 'X has no effect on Y',
          compatibility: 'incompatible',
          reasoning: 'Different experimental conditions',
        }],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('unknown role', () => {
    it('returns valid for unknown roles (no schema to enforce)', () => {
      const result = validateAgentOutput('unknown_role', { anything: true });
      expect(result.valid).toBe(true);
    });
  });
});
