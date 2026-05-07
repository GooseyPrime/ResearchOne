import { describe, expect, it } from 'vitest';
import {
  composePrompt,
  getAllModeAgentPairs,
  STANDARD_RESEARCH_PREAMBLE,
  REASONING_FIRST_PREAMBLE_V2,
} from '../services/agents/promptComposer';
import { REASONING_FIRST_PREAMBLE } from '../constants/prompts';
import { MODE_OVERLAYS, type ResearchMode, type AgentRole } from '../constants/modeOverlays';

describe('promptComposer', () => {
  describe('composePrompt', () => {
    it('v1_standard uses STANDARD_RESEARCH_PREAMBLE', () => {
      const prompt = composePrompt('planner', 'GENERAL_EPISTEMIC_RESEARCH', 'v1_standard');
      expect(prompt).toContain('STANDARD RESEARCH METHODOLOGY');
      expect(prompt).not.toContain('REASONING-FIRST EPISTEMIC POLICY');
    });

    it('v2_deep uses REASONING_FIRST_PREAMBLE', () => {
      const prompt = composePrompt('planner', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      expect(prompt).toContain('REASONING-FIRST EPISTEMIC POLICY');
    });

    it('includes mode overlay when defined', () => {
      const prompt = composePrompt('skeptic', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      expect(prompt).toContain('MODE-SPECIFIC DIRECTIVES');
      expect(prompt).toContain('structured comparison');
    });

    it('ADVERSARIAL_TWIN skeptic has full-attack overlay', () => {
      const prompt = composePrompt('skeptic', 'ADVERSARIAL_TWIN', 'v2_deep');
      expect(prompt).toContain('adversarial analysis');
      expect(prompt).toContain('full-attack critique');
    });

    it('ADVERSARIAL_TWIN synthesizer writes contradictions only', () => {
      const prompt = composePrompt('synthesizer', 'ADVERSARIAL_TWIN', 'v2_deep');
      expect(prompt).toContain('Contradictions and Gaps');
      expect(prompt).toContain('Do not produce a full research report');
    });

    it('REASONING_FIRST_PREAMBLE_V2 is identical to REASONING_FIRST_PREAMBLE (immutable)', () => {
      expect(REASONING_FIRST_PREAMBLE_V2).toBe(REASONING_FIRST_PREAMBLE);
    });
  });

  describe('mode overlays coverage', () => {
    const modes: ResearchMode[] = [
      'GENERAL_EPISTEMIC_RESEARCH',
      'INVESTIGATIVE_SYNTHESIS',
      'NOVEL_APPLICATION_DISCOVERY',
      'PATENT_GAP_ANALYSIS',
      'ANOMALY_CORRELATION',
    ];

    const agents: AgentRole[] = [
      'planner', 'retriever', 'reasoner', 'skeptic',
      'synthesizer', 'verifier', 'plain_language_synthesizer', 'outline_architect',
    ];

    for (const mode of modes) {
      for (const agent of agents) {
        it(`${mode} x ${agent} has an overlay`, () => {
          const overlay = MODE_OVERLAYS[mode]?.[agent];
          expect(overlay).toBeTruthy();
        });
      }
    }

    it('ADVERSARIAL_TWIN has skeptic and synthesizer overlays', () => {
      expect(MODE_OVERLAYS.ADVERSARIAL_TWIN.skeptic).toBeTruthy();
      expect(MODE_OVERLAYS.ADVERSARIAL_TWIN.synthesizer).toBeTruthy();
    });
  });

  describe('getAllModeAgentPairs', () => {
    it('returns at least 40 + 2 pairs (5 modes x 8 agents + ADVERSARIAL_TWIN)', () => {
      const pairs = getAllModeAgentPairs();
      expect(pairs.length).toBeGreaterThanOrEqual(42);
    });
  });

  describe('doctrine additions', () => {
    it('retriever overlay includes scite institutional-status guidance', () => {
      const prompt = composePrompt('retriever', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      expect(prompt).toContain('institutional-status metadata');
      expect(prompt).toContain('Never silently demote');
    });

    it('skeptic overlay includes structured comparison directive', () => {
      const prompt = composePrompt('skeptic', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      expect(prompt).toContain('retracted or contrasted source is a puzzle');
      expect(prompt).toContain('Premature collapse to consensus is failure');
    });

    it('verifier overlay includes retracted-source rule', () => {
      const prompt = composePrompt('verifier', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      expect(prompt).toContain('structural-mechanism comparison section');
      expect(prompt).toContain('pass verification regardless of the contested status');
    });
  });
});
