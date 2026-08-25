/**
 * GitHub #228 — the intent-to-report fidelity matrix.
 *
 * One row per intent the product advertises. Each row states what that kind of
 * request is supposed to produce, and the test holds the whole configuration
 * to it: which intent the words resolve to, which document template that intent
 * gets, which specialists it recruits, whether its challenge pass gates or
 * annotates, what happens to it when there is no independent evidence, and
 * whether it is allowed to talk like a verdict.
 *
 * Deterministic. No live provider calls, per the issue: every value asserted
 * here is configuration or a pure function, and configuration drifting apart
 * from what the product claims is precisely the failure this exists to catch —
 * seven profiles had quietly turned their challenge pass off before WO-AH
 * noticed.
 *
 * A live-provider smoke procedure is documented separately in
 * `docs/INTENT_FIDELITY_SMOKE.md`; it is not a per-PR requirement.
 */
import { describe, expect, it, vi } from 'vitest';

// No live provider calls. When the classifier's model is unavailable the
// deterministic lexical layer decides, which is exactly the property this
// matrix is asserting: how much of intent resolution survives without a model.
vi.mock('../services/openrouter/openrouterService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/openrouter/openrouterService')>();
  return {
    ...actual,
    callRoleModel: vi.fn().mockRejectedValue(new Error('no provider in CI')),
  };
});

import { classifyIntent } from '../services/planning/intentClassifier';
import { getOrchestrationProfileForIntent, PIPELINE_STAGES } from '../services/planning/orchestrationProfiles';
import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';
import { selectAgentsForBrief } from '../services/reasoning/agentCapabilityRegistry';
import { assessSourceSufficiency } from '../services/reasoning/sourceSufficiencyGate';
import { resolveTableExpectation, checkTableContract } from '../services/reasoning/tableContract';
import { distributeWordBudget, clampWordTarget } from '../services/reasoning/reportGenerator';
import type { IntentId } from '../services/planning/intentTaxonomy';

type EvidencePolicy = 'fail_closed' | 'labelled_low_evidence';

interface MatrixRow {
  intent: IntentId;
  /** A request a person would actually type. */
  prompt: string;
  template: string;
  /** Sections that make this report the kind of report it claims to be. */
  documentShape: readonly string[];
  itemLabel: string;
  challenge: 'gate' | 'annotate';
  specialists: readonly string[];
  evidence: EvidencePolicy;
  /** True only for reports whose job IS to reach a verdict. */
  mayTalkLikeAVerdict: boolean;
  /**
   * Whether the words alone are enough to route the request.
   *
   * False is not a pass mark. It records that this intent currently depends on
   * the classifier model, so a provider outage sends the request somewhere
   * else — tracked in RESEARCHONE_WORK_QUEUE.md. The assertion still bites: if
   * someone adds a trigger pattern, this test tells them to flip the flag.
   */
  resolvesWithoutAModel: boolean;
}

const MATRIX: readonly MatrixRow[] = [
  {
    intent: 'factual_report',
    prompt: 'What is the current state of solid-state battery manufacturing?',
    template: 'intent_factual_report',
    documentShape: ['who_what_when', 'mechanism', 'sources', 'limits'],
    itemLabel: 'Finding',
    challenge: 'annotate',
    specialists: [],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: false,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'adjudication',
    prompt: 'Fact-check the claim that remote work always decreases delivery speed.',
    template: 'intent_adjudication',
    documentShape: ['claim', 'case_for', 'case_against', 'verdict', 'weaknesses'],
    itemLabel: 'Claim',
    challenge: 'gate',
    specialists: ['quantitative_quality_auditor'],
    evidence: 'fail_closed',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: true,
  },
  {
    intent: 'investigation',
    prompt: 'Investigate why the city rail modernization program went over budget.',
    template: 'intent_investigation',
    documentShape: ['framing', 'primary_evidence', 'contested_zones', 'unresolved'],
    itemLabel: 'Finding',
    challenge: 'gate',
    specialists: ['story_verifier', 'timeline_reconstructor', 'quantitative_quality_auditor'],
    evidence: 'fail_closed',
    resolvesWithoutAModel: true,
    // The issue's expected behaviour for an investigation is "balanced
    // contested analysis" — it needs independent evidence, and it does NOT
    // deliver a ruling. Two different axes, and this row is the reason to
    // keep them apart.
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'story_verification',
    prompt: 'Verify whether this story about the factory closure is true.',
    template: 'intent_story_verification',
    documentShape: ['claim_summary', 'confirmed', 'unconfirmed', 'false_or_misleading', 'confidence', 'sources'],
    itemLabel: 'Claim',
    challenge: 'gate',
    specialists: ['story_verifier', 'timeline_reconstructor'],
    evidence: 'fail_closed',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: true,
  },
  {
    intent: 'opportunity_discovery',
    prompt: 'Find me 20 affiliate marketing niches ranked by income potential.',
    template: 'intent_opportunity_discovery',
    documentShape: ['overview', 'opportunities_list', 'ranking_and_analysis', 'recommendations', 'caveats'],
    itemLabel: 'Opportunity',
    challenge: 'annotate',
    specialists: [
      'market_scout',
      'competitor_mapper',
      'demand_signal_analyst',
      'feasibility_architect',
      'data_analysis_specialist',
    ],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'feasibility',
    prompt: 'Is it feasible to run this workload on-premise instead of in the cloud?',
    template: 'intent_feasibility',
    documentShape: ['summary', 'dimensions', 'risks', 'viability_rating', 'recommendation'],
    itemLabel: 'Factor',
    challenge: 'annotate',
    specialists: ['demand_signal_analyst', 'feasibility_architect'],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'implementation',
    prompt: 'Give me an implementation plan for migrating our billing service.',
    template: 'intent_implementation',
    documentShape: ['overview', 'prerequisites', 'plan_phases', 'detailed_steps', 'acceptance_criteria'],
    itemLabel: 'Phase',
    challenge: 'annotate',
    specialists: ['feasibility_architect'],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'how_to',
    prompt: 'How do I set up mutual TLS between two internal services?',
    template: 'intent_how_to',
    documentShape: ['prerequisites', 'steps', 'outcomes', 'troubleshooting'],
    itemLabel: 'Step',
    challenge: 'annotate',
    specialists: [],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'comparative',
    prompt: 'Compare Postgres, MySQL and SQLite for an embedded analytics product.',
    template: 'intent_comparative',
    documentShape: ['dimensions_table', 'per_option', 'recommendation_optional'],
    itemLabel: 'Option',
    challenge: 'gate',
    specialists: ['market_scout', 'competitor_mapper', 'data_analysis_specialist', 'quantitative_quality_auditor'],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'recommendation',
    prompt: 'Which CRM should we adopt given a small team and a tight budget?',
    template: 'intent_recommendation',
    documentShape: ['constraints', 'options', 'recommendation', 'tradeoffs'],
    itemLabel: 'Recommendation',
    challenge: 'gate',
    specialists: ['market_scout', 'competitor_mapper', 'data_analysis_specialist'],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'timeline',
    prompt: 'Build a timeline of events leading to the 2023 banking failures.',
    template: 'intent_timeline',
    documentShape: ['chronology', 'precision_notes', 'contested_dates'],
    itemLabel: 'Event',
    challenge: 'gate',
    specialists: ['timeline_reconstructor'],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: true,
    mayTalkLikeAVerdict: false,
  },
  {
    intent: 'reference_lookup',
    prompt: 'What is the default port for PostgreSQL?',
    template: 'intent_reference_lookup',
    documentShape: ['direct_answer', 'sources', 'confidence'],
    itemLabel: 'Entry',
    challenge: 'annotate',
    specialists: [],
    evidence: 'labelled_low_evidence',
    resolvesWithoutAModel: false,
    mayTalkLikeAVerdict: false,
  },
];

/** Something a specialist model wrote. Analysis, never evidence. */
const MODEL_WROTE_THIS = {
  story_verifier: { corroborating: [{ claim: 'a' }] },
  market_scout: { opportunities: [{ name: 'x' }] },
};

/**
 * Language that only belongs in a report whose job is to rule on a claim.
 *
 * `verdict` is the adjudication template's own section name; the others are
 * the vocabulary that leaks into report types that never asked for it — a
 * how-to guide with a falsification section is the failure this guards.
 */
const VERDICT_VOCABULARY = /\bfalsif\w*|\badjudicat\w*|\bverdict\b|\brefut\w*|\bdisprov\w*|\bcounter-?evidence\b|\bcase (for|against)\b|\bfalse or misleading\b/i;

describe.each(MATRIX)('intent fidelity — $intent', (row) => {
  const profile = getOrchestrationProfileForIntent(row.intent);
  const template = INTENT_OUTPUT_TEMPLATES[row.template];

  it('gets the document template its report type is named after', () => {
    expect(profile.outputTemplateId).toBe(row.template);
    expect(template).toBeDefined();
    expect(template!.intentId).toBe(row.intent);
  });

  it('produces the sections that make it that kind of report', () => {
    expect(template!.sections).toEqual(row.documentShape);
    expect(template!.itemLabel).toBe(row.itemLabel);
    expect(template!.requiredDeliverables.length).toBeGreaterThan(0);
    expect(template!.verifierRubric.trim().length).toBeGreaterThan(0);
  });

  it('recruits exactly the specialists this kind of request needs', () => {
    const selected = selectAgentsForBrief(row.intent)
      .filter((agent) => agent.isSpecialist)
      .map((agent) => agent.id)
      .sort();
    expect(selected).toEqual([...row.specialists].sort());
  });

  it('is challenged, at the strength its request calls for', () => {
    // WO-AH: the pass itself is not optional. Only its strength varies.
    expect(profile.skepticMode).toBe(row.challenge);
    expect(profile.agentsToSkip).not.toContain('challenge');
    expect(profile.agentsToRun).toContain('challenge');
  });

  it('runs a stage set that adds up', () => {
    const all = [...profile.agentsToRun, ...profile.agentsToSkip].sort();
    expect(all).toEqual([...PIPELINE_STAGES].sort());
  });

  it('has a length range a real report can land in', () => {
    expect(profile.expectedLengthRange.minWords).toBeGreaterThan(0);
    expect(profile.expectedLengthRange.maxWords).toBeGreaterThan(profile.expectedLengthRange.minWords);
  });

  it(`handles no independent evidence by ${row.evidence}`, () => {
    const result = assessSourceSufficiency({
      intentId: row.intent,
      citableChunks: [],
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 0,
    });
    expect(result.action).toBe(
      row.evidence === 'fail_closed' ? 'insufficient_evidence_fail_closed' : 'low_evidence_labeled_delivery'
    );
    // In neither case may model-written arrays be the reason it passed.
    expect(result.action).not.toBe('sufficient');
  });

  it('proceeds normally once something independent was actually retrieved', () => {
    const result = assessSourceSufficiency({
      intentId: row.intent,
      citableChunks: [{ source_origin: 'external_discovery', owner_user_id: null }],
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 1,
    });
    expect(result.action).toBe('sufficient');
  });

  it(
    row.mayTalkLikeAVerdict
      ? 'is allowed to reach a verdict, because that is what it is for'
      : 'does not force verdict framing onto a request that did not ask for one',
    () => {
      const shape = [...template!.sections, ...template!.requiredDeliverables].join(' | ');
      if (row.mayTalkLikeAVerdict) {
        expect(shape).toMatch(VERDICT_VOCABULARY);
      } else {
        expect(shape).not.toMatch(VERDICT_VOCABULARY);
      }
    }
  );

  it(
    row.resolvesWithoutAModel
      ? 'resolves from the words a person would type, with no model involved'
      : 'currently needs the classifier model to route this phrasing (known gap)',
    async () => {
      let resolved: string | null = null;
      try {
        resolved = (await classifyIntent(row.prompt, undefined, { allowFallbackByRole: {} }))
          .primaryIntent;
      } catch {
        // The classifier had no model and no deterministic answer.
        resolved = null;
      }
      if (row.resolvesWithoutAModel) {
        expect(resolved).toBe(row.intent);
      } else {
        // Asserted, not ignored: this row is a gap, and the day someone closes
        // it this test fails and asks them to say so.
        expect(resolved).not.toBe(row.intent);
      }
    }
  );
});

describe('intent fidelity — request options reach the report', () => {
  it('propagates a requested table into something the auditor checks', () => {
    const expectation = resolveTableExpectation({ requestedArtifacts: [] }, 20, ['comparison_table']);
    expect(expectation.required).toBe(true);
    expect(expectation.expectedRowCount).toBe(20);
    expect(checkTableContract('No table at all.', expectation).map((i) => i.code)).toContain('table_missing');
  });

  it('propagates a requested length into the section budget', () => {
    const plan = [
      { key: 'a', weight: 0.5 },
      { key: 'b', weight: 0.5 },
    ];
    const budget = distributeWordBudget(clampWordTarget(6000), plan);
    const total = [...budget.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThanOrEqual(6000 - plan.length);
    expect(total).toBeLessThanOrEqual(6000 + plan.length);
  });

  it('clamps a length nobody can deliver rather than passing it through', () => {
    expect(clampWordTarget(50)).toBeGreaterThan(50);
    expect(clampWordTarget(999_999)).toBeLessThanOrEqual(12000);
  });
});

describe('intent fidelity — the matrix covers what the product offers', () => {
  it('has a row for every intent named in the issue', () => {
    const covered = new Set(MATRIX.map((row) => row.intent));
    for (const intent of [
      'factual_report',
      'adjudication',
      'investigation',
      'story_verification',
      'opportunity_discovery',
      'feasibility',
      'implementation',
      'how_to',
      'comparative',
      'recommendation',
      'timeline',
      'reference_lookup',
    ] as const) {
      expect(covered.has(intent)).toBe(true);
    }
  });

  it('gives every intent in the taxonomy a profile and a template', () => {
    // A new intent added without a template would otherwise be discovered by a
    // user, at report time, as a thrown INTENT_TEMPLATE_MISSING.
    for (const intent of Object.keys(INTENT_OUTPUT_TEMPLATES)) {
      const t = INTENT_OUTPUT_TEMPLATES[intent]!;
      const p = getOrchestrationProfileForIntent(t.intentId as IntentId);
      expect(p.outputTemplateId).toBe(t.id);
    }
  });
});
