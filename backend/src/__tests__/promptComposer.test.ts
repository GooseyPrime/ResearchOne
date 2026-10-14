import { describe, expect, it } from 'vitest';
import {
  composePrompt,
  getAllModeAgentPairs,
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
      const prompt = composePrompt('double_check', 'INVESTIGATIVE_SYNTHESIS', 'v2_deep');
      expect(prompt).toContain('MODE-SPECIFIC DIRECTIVES');
      expect(prompt).toContain('structured comparison');
    });

    it('ADVERSARIAL_TWIN double-check has full-attack overlay', () => {
      const prompt = composePrompt('double_check', 'ADVERSARIAL_TWIN', 'v2_deep');
      expect(prompt).toContain('adversarial analysis');
      expect(prompt).toContain('full-attack critique');
    });

    it('ADVERSARIAL_TWIN synthesizer writes the Double-check section only, under plain headings', () => {
      const prompt = composePrompt('synthesizer', 'ADVERSARIAL_TWIN', 'v2_deep');
      expect(prompt).toContain('You are writing the Double-check section for an existing document, and nothing else.');
      expect(prompt).toContain('Do not produce a full research report');
      expect(prompt).toContain('Where the document conflicts with itself or with its sources');
      expect(prompt).toContain('Statements with no support');
      expect(prompt).toContain('Each item must cite the source passage');
      expect(MODE_OVERLAYS.ADVERSARIAL_TWIN.synthesizer).not.toMatch(/Contradictions and Gaps|unsupported claims|falsif|verdict/i);
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
      'planner', 'retriever', 'reasoner', 'double_check',
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

    it('ADVERSARIAL_TWIN has double-check and synthesizer overlays', () => {
      expect(MODE_OVERLAYS.ADVERSARIAL_TWIN.double_check).toBeTruthy();
      expect(MODE_OVERLAYS.ADVERSARIAL_TWIN.synthesizer).toBeTruthy();
    });
  });

  describe('getAllModeAgentPairs', () => {
    it('returns at least 40 + 2 pairs (5 modes x 8 agents + ADVERSARIAL_TWIN)', () => {
      const pairs = getAllModeAgentPairs();
      expect(pairs.length).toBeGreaterThanOrEqual(42);
    });
  });

  // The citation-status doctrine is for the investigative objectives. General
  // research, the standard objective, handles a retracted source neutrally (14 Oct 2026).
  describe('doctrine additions', () => {
    it('retriever overlay includes scite institutional-status guidance', () => {
      const prompt = composePrompt('retriever', 'INVESTIGATIVE_SYNTHESIS', 'v2_deep');
      expect(prompt).toContain('institutional-status metadata');
      expect(prompt).toContain('Never silently demote');
    });

    it('double-check overlay includes structured comparison directive', () => {
      const prompt = composePrompt('double_check', 'INVESTIGATIVE_SYNTHESIS', 'v2_deep');
      expect(prompt).toContain('retracted or contrasted source is a puzzle');
      expect(prompt).toContain('Premature collapse to consensus is failure');
    });

    it('verifier overlay includes retracted-source rule', () => {
      const prompt = composePrompt('verifier', 'INVESTIGATIVE_SYNTHESIS', 'v2_deep');
      expect(prompt).toContain('structural-mechanism comparison section');
      expect(prompt).toContain('pass verification regardless of the contested status');
    });

    it('general research handles a retracted source neutrally and asks for no comparison section', () => {
      const retriever = composePrompt('retriever', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      const check = composePrompt('double_check', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      const verifier = composePrompt('verifier', 'GENERAL_EPISTEMIC_RESEARCH', 'v2_deep');
      expect(retriever).toContain('Do not silently drop such a chunk');
      expect(retriever).not.toMatch(/paradigm-defense|political pressure/);
      expect(check).not.toMatch(/Premature collapse to consensus|premise attacks/);
      expect(verifier).toContain('it must say so where it cites that source');
      expect(verifier).not.toContain('structural-mechanism comparison section');
    });
  });
;
});
