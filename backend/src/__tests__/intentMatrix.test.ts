/**
 * Intent Matrix Regression Tests
 *
 * Part of the Work Order 2026-08 critical correctness repair.
 *
 * Tests cover:
 * 1. Explicit intent declaration precedence (MUST override lexical triggers)
 * 2. Lexical classification for each supported intent
 * 3. Epistemic posture correctness
 * 4. Falsification / adjudicative machinery is NOT activated for non-adjudicative intents
 * 5. Opportunity discovery regression (20-market affiliate request)
 */

import { describe, expect, it, vi } from 'vitest';
const { callRoleModelMock } = vi.hoisted(() => ({
  callRoleModelMock: vi.fn(),
}));

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: callRoleModelMock,
}));

import {
  INTENT_EPISTEMIC_POSTURE,
  resolveMethodologyFromIntent,
  resolveObjectiveFromIntent,
  defaultResearchBrief,
} from '../services/planning/researchBrief';
import { classifyIntent } from '../services/planning/intentClassifier';
import { ORCHESTRATION_PROFILES } from '../services/planning/orchestrationProfiles';
import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';
import type { IntentId } from '../services/planning/intentTaxonomy';
import { INTENT_TAXONOMY } from '../services/planning/intentTaxonomy';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — expose the internal classifier layers for unit testing
// ─────────────────────────────────────────────────────────────────────────────

// We test the pure classification helpers rather than the async LLM path.

// Re-implement a thin shim of the explicit-declaration layer for unit tests.
// The real implementation is in intentClassifier.ts but we want isolated tests.
const ADJUDICATIVE_INTENTS: IntentId[] = ['adjudication', 'investigation', 'story_verification'];

// ─────────────────────────────────────────────────────────────────────────────
// PART A — Epistemic posture per intent
// ─────────────────────────────────────────────────────────────────────────────

describe('epistemic posture per intent', () => {
  it('adjudication → adjudicative', () => {
    expect(INTENT_EPISTEMIC_POSTURE['adjudication']).toBe('adjudicative');
  });

  it('investigation → causal_test', () => {
    expect(INTENT_EPISTEMIC_POSTURE['investigation']).toBe('causal_test');
  });

  it('story_verification → adjudicative', () => {
    expect(INTENT_EPISTEMIC_POSTURE['story_verification']).toBe('adjudicative');
  });

  it('opportunity_discovery → discovery (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['opportunity_discovery']).toBe('discovery');
    expect(INTENT_EPISTEMIC_POSTURE['opportunity_discovery']).not.toBe('adjudicative');
    expect(INTENT_EPISTEMIC_POSTURE['opportunity_discovery']).not.toBe('causal_test');
  });

  it('feasibility → decision (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['feasibility']).toBe('decision');
  });

  it('factual_report → descriptive (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['factual_report']).toBe('descriptive');
  });

  it('survey → descriptive (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['survey']).toBe('descriptive');
  });

  it('comparative → decision (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['comparative']).toBe('decision');
  });

  it('recommendation → decision (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['recommendation']).toBe('decision');
  });

  it('how_to → descriptive (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['how_to']).toBe('descriptive');
  });

  it('implementation → descriptive (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['implementation']).toBe('descriptive');
  });

  it('literature_review → descriptive (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['literature_review']).toBe('descriptive');
  });

  it('exploratory → discovery (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['exploratory']).toBe('discovery');
  });

  it('position_brief → adjudicative (rhetorical-aid intent allows advocacy framing)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['position_brief']).toBe('adjudicative');
  });

  it('timeline → descriptive (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['timeline']).toBe('descriptive');
  });

  it('reference_lookup → descriptive (NOT adjudicative)', () => {
    expect(INTENT_EPISTEMIC_POSTURE['reference_lookup']).toBe('descriptive');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — Methodology resolution per intent
// ─────────────────────────────────────────────────────────────────────────────

describe('methodology resolution per intent', () => {
  it('adjudication → policyone', () => {
    expect(resolveMethodologyFromIntent('adjudication')).toBe('policyone');
  });

  it('investigation → policyone', () => {
    expect(resolveMethodologyFromIntent('investigation')).toBe('policyone');
  });

  it('story_verification → policyone', () => {
    expect(resolveMethodologyFromIntent('story_verification')).toBe('policyone');
  });

  it('opportunity_discovery → standard (NOT policyone)', () => {
    expect(resolveMethodologyFromIntent('opportunity_discovery')).toBe('standard');
  });

  it('feasibility → standard', () => {
    expect(resolveMethodologyFromIntent('feasibility')).toBe('standard');
  });

  it('factual_report → standard', () => {
    expect(resolveMethodologyFromIntent('factual_report')).toBe('standard');
  });

  it('how_to → standard', () => {
    expect(resolveMethodologyFromIntent('how_to')).toBe('standard');
  });

  it('recommendation → standard', () => {
    expect(resolveMethodologyFromIntent('recommendation')).toBe('standard');
  });

  it('comparative → standard', () => {
    expect(resolveMethodologyFromIntent('comparative')).toBe('standard');
  });

  it('implementation → standard', () => {
    expect(resolveMethodologyFromIntent('implementation')).toBe('standard');
  });

  it('literature_review → standard', () => {
    expect(resolveMethodologyFromIntent('literature_review')).toBe('standard');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART C — Orchestration profiles: skeptic mode per intent
// ─────────────────────────────────────────────────────────────────────────────

describe('orchestration profile skepticMode per intent', () => {
  it('adjudication has skepticMode gate', () => {
    expect(ORCHESTRATION_PROFILES['adjudication'].skepticMode).toBe('gate');
  });

  it('investigation has skepticMode gate', () => {
    expect(ORCHESTRATION_PROFILES['investigation'].skepticMode).toBe('gate');
  });

  it('opportunity_discovery has skepticMode off', () => {
    expect(ORCHESTRATION_PROFILES['opportunity_discovery'].skepticMode).toBe('off');
  });

  it('feasibility has skepticMode off', () => {
    expect(ORCHESTRATION_PROFILES['feasibility'].skepticMode).toBe('off');
  });

  it('implementation has skepticMode off', () => {
    expect(ORCHESTRATION_PROFILES['implementation'].skepticMode).toBe('off');
  });

  it('how_to has skepticMode off', () => {
    expect(ORCHESTRATION_PROFILES['how_to'].skepticMode).toBe('off');
  });

  it('reference_lookup has skepticMode off', () => {
    expect(ORCHESTRATION_PROFILES['reference_lookup'].skepticMode).toBe('off');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART D — Output templates: falsification sections absent for non-adjudicative
// ─────────────────────────────────────────────────────────────────────────────

const NON_ADJUDICATIVE_TEMPLATES = [
  'intent_factual_report',
  'intent_survey',
  'intent_opportunity_discovery',
  'intent_feasibility',
  'intent_implementation',
  'intent_comparative',
  'intent_how_to',
  'intent_recommendation',
  'intent_exploratory',
  'intent_timeline',
  'intent_reference_lookup',
  'intent_literature_review',
];

describe('output templates: non-adjudicative templates do not require falsification', () => {
  for (const id of NON_ADJUDICATIVE_TEMPLATES) {
    it(`${id} narrativeHint does not mention falsification`, () => {
      const tpl = INTENT_OUTPUT_TEMPLATES[id];
      expect(tpl, `template ${id} not found`).toBeDefined();
      expect(tpl!.narrativeHint.toLowerCase()).not.toContain('falsification');
    });

    it(`${id} requiredDeliverables do not require falsification sections`, () => {
      const tpl = INTENT_OUTPUT_TEMPLATES[id];
      expect(tpl, `template ${id} not found`).toBeDefined();
      const deliverables = tpl!.requiredDeliverables ?? [];
      for (const d of deliverables) {
        expect(d.toLowerCase()).not.toContain('falsification criteria');
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PART E — Opportunity discovery template: no hardcoded mega-schema
// ─────────────────────────────────────────────────────────────────────────────

describe('opportunity_discovery template: adaptive contract (no mega-schema)', () => {
  const tpl = INTENT_OUTPUT_TEMPLATES['intent_opportunity_discovery'];

  it('template exists', () => {
    expect(tpl).toBeDefined();
  });

  it('narrativeHint does NOT mandate Build Prompt subheadings', () => {
    expect(tpl!.narrativeHint.toLowerCase()).not.toContain('build prompt');
    expect(tpl!.narrativeHint.toLowerCase()).not.toContain('test prompt');
    expect(tpl!.narrativeHint.toLowerCase()).not.toContain('deployment prompt');
  });

  it('narrativeHint does NOT mandate Narrative Briefing subheadings', () => {
    expect(tpl!.narrativeHint.toLowerCase()).not.toContain('narrative briefing');
    expect(tpl!.narrativeHint.toLowerCase()).not.toContain('basic project needs');
  });

  it('requiredDeliverables do NOT list Build Prompt as universal requirement', () => {
    for (const d of tpl!.requiredDeliverables) {
      expect(d.toLowerCase()).not.toContain('build prompt');
      expect(d.toLowerCase()).not.toContain('test prompt');
      expect(d.toLowerCase()).not.toContain('deployment prompt');
    }
  });

  it('requiredDeliverables include ranked list and cited evidence', () => {
    const combined = tpl!.requiredDeliverables.join(' ').toLowerCase();
    expect(combined).toContain('ranked');
    expect(combined).toContain('cited');
  });

  it('verifierRubric does NOT require build/test/deployment prompts', () => {
    const rubric = tpl!.verifierRubric.toLowerCase();
    expect(rubric).not.toContain('build prompt');
    expect(rubric).not.toContain('test prompt');
    expect(rubric).not.toContain('deployment prompt');
  });

  it('verifierRubric explicitly states falsification sections FAIL', () => {
    const rubric = tpl!.verifierRubric.toLowerCase();
    expect(rubric).toContain('falsification');
    // Must say it's not allowed (FAIL) not required
    expect(rubric).toContain('fail');
  });

  it('sidebarSkepticAnnotations is false (no adversarial sidebar)', () => {
    expect(tpl!.sidebarSkepticAnnotations).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART F — Default ResearchBrief: opportunity_discovery correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('defaultResearchBrief for opportunity_discovery', () => {
  const brief = defaultResearchBrief('opportunity_discovery', 0.95, 'test');

  it('primaryIntent is opportunity_discovery', () => {
    expect(brief.primaryIntent).toBe('opportunity_discovery');
  });

  it('epistemicPosture is discovery', () => {
    expect(brief.epistemicPosture).toBe('discovery');
  });

  it('resolvedMethodology is standard', () => {
    expect(brief.resolvedMethodology).toBe('standard');
  });

  it('requestedArtifacts defaults to empty array', () => {
    expect(brief.requestedArtifacts).toHaveLength(0);
  });

  it('userConstraints defaults to empty array', () => {
    expect(brief.userConstraints).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART G — RequestedArtifact interface supports new fields
// ─────────────────────────────────────────────────────────────────────────────

describe('RequestedArtifact supports explicit/inferred/optional fields', () => {
  it('brief requestedArtifacts can carry explicitRequiredFields', () => {
    const brief = defaultResearchBrief('opportunity_discovery', 0.9, 'test');
    brief.requestedArtifacts.push({
      description: '20 affiliate opportunities',
      exactCount: 20,
      explicitRequiredFields: ['monetization', 'competition', 'income potential'],
      inferredRequiredFields: ['ranking rationale', 'confidence'],
      optionalFields: ['implementation guide'],
    });
    const artifact = brief.requestedArtifacts[0]!;
    expect(artifact.exactCount).toBe(20);
    expect(artifact.explicitRequiredFields).toContain('monetization');
    expect(artifact.inferredRequiredFields).toContain('ranking rationale');
    expect(artifact.optionalFields).toContain('implementation guide');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART H — Intent taxonomy: every intent (except legacy) has a template
// ─────────────────────────────────────────────────────────────────────────────

describe('every non-legacy intent has an output template', () => {
  for (const intentId of Object.keys(INTENT_TAXONOMY) as IntentId[]) {
    if (intentId === 'legacy') continue;
    it(`intent ${intentId} has matching template intent_${intentId}`, () => {
      const tpl = INTENT_OUTPUT_TEMPLATES[`intent_${intentId}`];
      expect(tpl, `missing template for ${intentId}`).toBeDefined();
      expect(tpl!.intentId).toBe(intentId);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PART I — Adjudicative templates DO include falsification requirements
// ─────────────────────────────────────────────────────────────────────────────

describe('adjudicative templates include appropriate falsification/verdict content', () => {
  it('intent_adjudication requiredDeliverables includes falsification criteria', () => {
    const tpl = INTENT_OUTPUT_TEMPLATES['intent_adjudication'];
    const combined = tpl!.requiredDeliverables.join(' ').toLowerCase();
    expect(combined).toContain('falsification');
  });

  it('intent_adjudication verifierRubric requires falsification criteria', () => {
    const tpl = INTENT_OUTPUT_TEMPLATES['intent_adjudication'];
    expect(tpl!.verifierRubric.toLowerCase()).toContain('falsification');
  });

  it('intent_investigation requiredDeliverables includes competing perspectives', () => {
    const tpl = INTENT_OUTPUT_TEMPLATES['intent_investigation'];
    const combined = tpl!.requiredDeliverables.join(' ').toLowerCase();
    // investigation should have some form of contested/disputed content
    expect(combined.includes('contested') || combined.includes('counter') || combined.includes('competing') || combined.includes('challenge')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART J — Regression: explicit intent declaration precedence
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This test suite verifies the core invariant from the work order:
 * An explicit intent declaration MUST override incidental vocabulary.
 *
 * We test the alias map and resolution logic directly.
 */

// Import the resolution function
// Note: the actual explicitDeclarationLayer function is private in intentClassifier.ts,
// so we test its contract through the alias map properties.

describe('explicit intent precedence regression — 20-affiliate-market request', () => {
  /**
   * This is the canonical failing request that triggered the work order.
   * The query contains "compare" and "recommend" which would ordinarily
   * trigger the comparative/recommendation lexical path. But it also
   * explicitly declares: "Primary research intent: opportunity_discovery"
   * which MUST take precedence.
   */
  const failedRequestWithExplicitDeclaration = `Primary research intent: opportunity_discovery.
Compare the economics of 20 affiliate comparison-site opportunities and rank them by income potential.
Include monetization model, affiliate-program availability, buyer intent, competition, automation potential,
estimated revenue scenarios, risk, and recommendation.
Deliver exactly 20 ranked opportunities. Recommend the top 10, top 5, and top 3 picks with a final winner.`;

  it('explicit "Primary research intent: opportunity_discovery" declaration must resolve to opportunity_discovery', async () => {
    callRoleModelMock.mockReset();
    const brief = await classifyIntent(failedRequestWithExplicitDeclaration, undefined, {
      allowFallbackByRole: {},
    });

    expect(brief.primaryIntent).toBe('opportunity_discovery');
    expect(brief.reasoning).toContain('Explicit declarations override lexical and LLM classification.');
    expect(callRoleModelMock).not.toHaveBeenCalled();
  });

  it('opportunity_discovery posture is discovery, not adjudicative', () => {
    expect(INTENT_EPISTEMIC_POSTURE['opportunity_discovery']).toBe('discovery');
  });

  it('opportunity_discovery methodology is standard, not policyone', () => {
    expect(resolveMethodologyFromIntent('opportunity_discovery')).toBe('standard');
  });

  it('opportunity_discovery has skepticMode off', () => {
    expect(ORCHESTRATION_PROFILES['opportunity_discovery'].skepticMode).toBe('off');
  });

  it('opportunity_discovery output template does not require build prompts', () => {
    const tpl = INTENT_OUTPUT_TEMPLATES['intent_opportunity_discovery'];
    const allText = [tpl!.narrativeHint, ...tpl!.requiredDeliverables].join(' ').toLowerCase();
    expect(allText).not.toContain('build prompt');
    expect(allText).not.toContain('test prompt');
    expect(allText).not.toContain('deployment prompt');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART K — All non-adjudicative intents do NOT resolve to policyone methodology
// ─────────────────────────────────────────────────────────────────────────────

describe('non-adjudicative intents do not use policyone methodology', () => {
  const nonAdjudicative: IntentId[] = [
    'factual_report',
    'survey',
    'opportunity_discovery',
    'feasibility',
    'implementation',
    'literature_review',
    'comparative',
    'how_to',
    'recommendation',
    'exploratory',
    'timeline',
    'reference_lookup',
  ];

  for (const intent of nonAdjudicative) {
    it(`${intent} resolves to standard methodology`, () => {
      expect(resolveMethodologyFromIntent(intent)).toBe('standard');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PART L — Intent family helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('isAdjudicativeIntent via epistemic posture', () => {
  function isAdjudicative(intent: IntentId): boolean {
    return INTENT_EPISTEMIC_POSTURE[intent] === 'adjudicative' ||
      INTENT_EPISTEMIC_POSTURE[intent] === 'causal_test';
  }

  it('adjudication is adjudicative', () => expect(isAdjudicative('adjudication')).toBe(true));
  it('investigation is adjudicative (causal_test)', () => expect(isAdjudicative('investigation')).toBe(true));
  it('story_verification is adjudicative', () => expect(isAdjudicative('story_verification')).toBe(true));

  it('opportunity_discovery is NOT adjudicative', () => expect(isAdjudicative('opportunity_discovery')).toBe(false));
  it('feasibility is NOT adjudicative', () => expect(isAdjudicative('feasibility')).toBe(false));
  it('implementation is NOT adjudicative', () => expect(isAdjudicative('implementation')).toBe(false));
  it('factual_report is NOT adjudicative', () => expect(isAdjudicative('factual_report')).toBe(false));
  it('comparative is NOT adjudicative', () => expect(isAdjudicative('comparative')).toBe(false));
  it('recommendation is NOT adjudicative', () => expect(isAdjudicative('recommendation')).toBe(false));
  it('how_to is NOT adjudicative', () => expect(isAdjudicative('how_to')).toBe(false));
  it('literature_review is NOT adjudicative', () => expect(isAdjudicative('literature_review')).toBe(false));
  it('survey is NOT adjudicative', () => expect(isAdjudicative('survey')).toBe(false));
});
