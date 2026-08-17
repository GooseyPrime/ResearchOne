import { describe, it, expect } from 'vitest';

import {
  deriveContractWordTarget,
  deriveItemLabel,
  expandSectionPlanForContract,
  findRepeatedArtifact,
  MAX_EXPANDED_SECTIONS,
} from '../services/reasoning/contractOutline';
import {
  ITEM_SECTION_HEADING,
  isItemSectionHeading,
} from '../services/reasoning/researchOrchestrator';
import {
  contractRequestsTable,
  sectionExpectsTable,
} from '../services/reasoning/reportGenerator';
import {
  applyTargetedRepair,
  extractMissingSectionTitles,
  planTargetedRepair,
} from '../services/reasoning/targetedRepair';

/**
 * WO-AC — regression suite for run `e5aac059`.
 *
 * That run delivered 8/20 opportunities with no per-item detail and no winner
 * blueprint, because `intent_opportunity_discovery` declares five fixed
 * sections and the request needed ~107 blocks. Verification then burned 39% of
 * a 36-minute run rewriting the whole report twice.
 */

const OPPORTUNITY_PLAN = [
  { title: 'Overview', key: 'overview', weight: 0.6 },
  { title: 'Opportunities List', key: 'opportunities_list', weight: 1.6 },
  { title: 'Ranking And Analysis', key: 'ranking_and_analysis', weight: 1.2 },
  { title: 'Recommendations', key: 'recommendations', weight: 1.0 },
  { title: 'Caveats', key: 'caveats', weight: 0.5 },
];

// Mirrors the PRODUCTION `RequestedArtifact` shape: `description`, no `type`.
// The original fixture invented `type`, which hid a bug where every real brief
// fell back to "Item" headings (Codex review, PR #205).
const TWENTY_OPPORTUNITIES = [
  {
    description: 'ranked list of market opportunities',
    exactCount: 20,
    explicitRequiredFields: ['narrative briefing', 'basic project needs', 'build prompt', 'test prompt', 'deployment prompt'],
  },
];

describe('R1 — contract-driven outline expansion', () => {
  it('gives each requested item its own drafting section', () => {
    const result = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: TWENTY_OPPORTUNITIES,
    });
    expect(result.expanded).toBe(true);
    expect(result.itemCount).toBe(20);
    expect(result.itemsPerSection).toBe(1);
    // 5 base sections - 1 list section + 20 item sections = 24
    expect(result.plan).toHaveLength(24);
    // Label comes from `description`, not an invented `type` field, and the
    // ordinal leads so it survives the coherence refiner's retitling.
    expect(result.plan.some((s) => s.title === '1. Opportunity')).toBe(true);
    expect(result.plan.some((s) => s.title === '20. Opportunity')).toBe(true);
    expect(result.plan.some((s) => s.title.endsWith(' Item'))).toBe(false);
    expect(result.plan.some((s) => s.key === 'opportunities_list')).toBe(false);
    // The result must advertise its own item titles; the auditor keys on these.
    expect(result.expandedTitles).toHaveLength(20);
    expect(result.expandedTitles).toContain('1. opportunity');
  });

  it('preserves surrounding sections and their order', () => {
    const { plan } = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: TWENTY_OPPORTUNITIES,
    });
    expect(plan[0]?.key).toBe('overview');
    expect(plan[plan.length - 1]?.key).toBe('caveats');
    expect(plan[plan.length - 2]?.key).toBe('recommendations');
    expect(plan[plan.length - 3]?.key).toBe('ranking_and_analysis');
  });

  it('produces unique section keys', () => {
    const { plan } = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: TWENTY_OPPORTUNITIES,
    });
    expect(new Set(plan.map((s) => s.key)).size).toBe(plan.length);
  });

  it('groups items rather than exploding the plan past the cap', () => {
    const result = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: [{ type: 'opportunity', exactCount: 120 }],
    });
    const itemSections = result.plan.filter((s) => s.key.startsWith('opportunities_list'));
    expect(itemSections.length).toBeLessThanOrEqual(MAX_EXPANDED_SECTIONS);
    expect(result.itemsPerSection).toBeGreaterThan(1);
    // Every item is still covered.
    expect(itemSections.length * result.itemsPerSection).toBeGreaterThanOrEqual(120);
  });

  it('leaves the plan alone when no repeated artifact was requested', () => {
    const result = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: [{ type: 'summary', description: 'a short narrative' }],
    });
    expect(result.expanded).toBe(false);
    expect(result.plan).toHaveLength(OPPORTUNITY_PLAN.length);
  });

  it('does not expand for trivially small counts', () => {
    const result = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: [{ type: 'option', exactCount: 2 }],
    });
    expect(result.expanded).toBe(false);
  });

  it('picks the artifact carrying the most required fields', () => {
    const artifact = findRepeatedArtifact([
      { type: 'note', exactCount: 5 },
      { type: 'opportunity', exactCount: 20, explicitRequiredFields: ['a', 'b', 'c'] },
    ]);
    expect(artifact?.type).toBe('opportunity');
  });
});

describe('R2 — word budget scales with the contract', () => {
  it('grows the target for a large structured deliverable', () => {
    const target = deriveContractWordTarget({
      itemCount: 20,
      requiredFieldsPerItem: 5,
      baselineWords: 3000,
    });
    expect(target).not.toBeNull();
    expect(target!).toBeGreaterThan(3000);
  });

  it('never overrides an explicit user target', () => {
    expect(
      deriveContractWordTarget({
        explicitTarget: 1500,
        itemCount: 20,
        requiredFieldsPerItem: 5,
        baselineWords: 3000,
      })
    ).toBeNull();
  });

  it('leaves small requests on the baseline', () => {
    expect(
      deriveContractWordTarget({ itemCount: 1, requiredFieldsPerItem: 0, baselineWords: 3000 })
    ).toBeNull();
  });

  it('never shrinks below the baseline', () => {
    const target = deriveContractWordTarget({
      itemCount: 3,
      requiredFieldsPerItem: 0,
      baselineWords: 3000,
    });
    expect(target!).toBeGreaterThanOrEqual(3000);
  });
});

describe('PR #205 review — label derivation and budget bounds', () => {
  it('derives a singular label from the production description field', () => {
    expect(deriveItemLabel({ description: 'ranked list of market opportunities' })).toBe('Opportunity');
    expect(deriveItemLabel({ description: '20 comparison-site verticals' })).toBe('Vertical');
    expect(deriveItemLabel({ description: 'set of options' })).toBe('Option');
  });

  it('falls back to the intent, then to Item, never to an invented type', () => {
    expect(deriveItemLabel({ description: '' }, 'opportunity_discovery')).toBe('Opportunity');
    expect(deriveItemLabel({ description: '' }, 'comparative')).toBe('Option');
    expect(deriveItemLabel(null)).toBe('Item');
  });

  it('every generated heading is recognised by the delivered-item counter', () => {
    const { plan } = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: TWENTY_OPPORTUNITIES,
    });
    const itemSections = plan.filter((s) => /\d/.test(s.title));
    expect(itemSections).toHaveLength(20);
    for (const section of itemSections) {
      // Assert against the predicate the auditor actually calls, not one of the
      // regexes behind it — the point of the check is that planned headings are
      // countable, by whichever rule matches.
      expect(isItemSectionHeading(section.title)).toBe(true);
    }
  });

  it('does not derive a gerund label from an activity phrase', () => {
    // Run c50162a9 planned "Modeling 1..20" for a list of market opportunities
    // because the description ended in a gerund.
    expect(deriveItemLabel({ description: 'opportunities ranked by revenue modeling' })).toBe('Opportunity');
    expect(deriveItemLabel({ description: 'markets sized by forecasting' })).toBe('Market');
    expect(deriveItemLabel({ description: 'opportunities with financial modeling' })).toBe('Opportunity');
    // Short-stemmed words that merely end this way stay eligible as nouns.
    expect(deriveItemLabel({ description: 'set of rings' })).toBe('Ring');
    expect(deriveItemLabel({ description: 'collection of seeds' })).toBe('Seed');
    // -ly is not treated as a verb ending, so real nouns survive.
    expect(deriveItemLabel({ description: 'list of supply' })).toBe('Supply');
  });

  it('does not mangle words that only look plural', () => {
    expect(deriveItemLabel({ description: 'set of competitive analysis' })).toBe('Analysis');
    expect(deriveItemLabel({ description: 'list of each business' })).toBe('Business');
  });

  it('never counts a numbered framing section as a delivered item', () => {
    for (const heading of [
      '1. Executive Summary',
      '8. Cross-Opportunity Analysis',
      '9. Final Winner',
      '10. Recommendations',
      'Limitations',
    ]) {
      expect(isItemSectionHeading(heading)).toBe(false);
    }
  });

  it('counts the numbered headings a refiner actually writes', () => {
    for (const heading of ['1. Developer Tools', '7. Home Fitness Equipment', '20. Pet Supplies']) {
      expect(isItemSectionHeading(heading)).toBe(true);
    }
  });

  it('honours planned titles even when they look like framing sections', () => {
    const planned = new Set(['3. summary']);
    expect(isItemSectionHeading('3. Summary', planned)).toBe(true);
    expect(isItemSectionHeading('3. Summary')).toBe(false);
  });

  it('recognises every label variant the expander can emit', () => {
    for (const heading of ['Opportunity 1', 'Vertical 12', 'Option 3', 'Item 7', 'Niche 20']) {
      expect(ITEM_SECTION_HEADING.test(heading)).toBe(true);
    }
    expect(ITEM_SECTION_HEADING.test('Executive Summary')).toBe(false);
  });

  it('does not blow an explicit short word target', () => {
    // 800 words / 80-word floor = 10 sections total, minus 4 non-item sections.
    const result = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: TWENTY_OPPORTUNITIES,
      explicitWordTarget: 800,
      perSectionFloor: 80,
    });
    expect(result.plan.length * 80).toBeLessThanOrEqual(800);
    expect(result.itemsPerSection).toBeGreaterThan(1);
  });

  it('leaves expansion unbounded when no explicit target was given', () => {
    const result = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: TWENTY_OPPORTUNITIES,
      perSectionFloor: 80,
    });
    expect(result.itemsPerSection).toBe(1);
  });
});

describe('R5 — table rules are scoped to sections that need them (PR #205 review)', () => {
  it('includes rules for obviously tabular sections', () => {
    for (const title of ['Master Portfolio Table', 'Dimensions Matrix', 'Comparison of Options']) {
      expect(sectionExpectsTable({ title, key: 'x', contractWantsTable: false })).toBe(true);
    }
  });

  it('omits rules for prose sections when the contract wants no table', () => {
    for (const title of ['Executive Summary', 'Caveats', 'Narrative Briefing']) {
      expect(sectionExpectsTable({ title, key: 'caveats', contractWantsTable: false })).toBe(false);
    }
  });

  it('includes rules on every section when the contract asks for a table', () => {
    // With outline expansion a section named "Opportunity 7" may legitimately
    // carry the portfolio table, so a table-bearing contract opts all in.
    expect(
      sectionExpectsTable({ title: 'Opportunity 7', key: 'opp_7', contractWantsTable: true })
    ).toBe(true);
  });

  it('detects a table request from artifacts or formats', () => {
    expect(contractRequestsTable([{ type: 'table', description: 'master portfolio' }], [])).toBe(true);
    expect(contractRequestsTable([], ['comparison table'])).toBe(true);
    expect(contractRequestsTable([{ type: 'summary' }], ['prose'])).toBe(false);
  });
});

describe('R3 — targeted repair', () => {
  const REPORT = [
    '# Portfolio',
    '',
    '## Executive Summary',
    'Summary body.',
    '',
    '## Master Portfolio Table',
    '| Rank | Vertical |',
    '| --- | --- |',
    '| 1 | SaaS |',
  ].join('\n');

  const MISSING = [
    'Final Winner market selection',
    'Recommended Initial Site Scope for the winning market',
    '30-Day Validation Plan with measurable go/no-go criteria',
    'exact_count_mismatch:8/20',
    'required_fields_missing_in_opportunities',
  ];

  it('extracts readable section titles and drops machine codes', () => {
    const titles = extractMissingSectionTitles(MISSING);
    expect(titles).toContain('Final Winner market selection');
    expect(titles.some((t) => t.startsWith('Recommended Initial Site Scope'))).toBe(true);
    expect(titles.some((t) => t.includes('exact_count_mismatch'))).toBe(false);
    expect(titles.some((t) => t.includes('required_fields_missing'))).toBe(false);
  });

  it('chooses append mode and does NOT resend the whole report', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Provide the Final Winner market selection.'],
      missingRequirements: MISSING,
    });
    expect(plan.mode).toBe('append_missing');
    expect(plan.userPrompt).toMatch(/Write ONLY the missing sections/);
    expect(plan.userPrompt).toMatch(/APPENDED/);
    expect(plan.missingSections.length).toBeGreaterThan(0);
  });

  it('does not ask for sections the report already contains', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Provide the Executive Summary.'],
      missingRequirements: ['Executive Summary'],
    });
    expect(plan.missingSections).not.toContain('Executive Summary');
  });

  it('writes absent sections first, even alongside a content finding', () => {
    // Run c50162a9: the verifier names an `unsupported_claims` criterion on
    // nearly every run, which used to escalate a two-missing-section defect
    // into two whole-report rewrites totalling 11m44s.
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: [
        'Remove unsupported claims about commission rates.',
        'Provide the Final Winner market selection.',
      ],
      missingRequirements: ['Final Winner market selection'],
    });
    expect(plan.mode).toBe('append_missing');
    expect(plan.missingSections).toContain('Final Winner market selection');
    // The append prompt must not carry the rewrite instruction, or the model is
    // told to remove claims from content it has been forbidden to reproduce.
    expect(plan.userPrompt).not.toMatch(/Remove unsupported claims/);
  });

  it('rewrites only the sections a content finding names', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Master Portfolio Table contains unsupported commission rates.'],
      missingRequirements: [],
    });
    expect(plan.mode).toBe('rewrite_sections');
    expect(plan.targetedSections).toEqual(['Master Portfolio Table']);
    expect(plan.userPrompt).toContain('## Master Portfolio Table');
    expect(plan.userPrompt).not.toContain('## Executive Summary');
  });

  it('splices a scoped rewrite back without touching other sections', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Master Portfolio Table contains unsupported commission rates.'],
      missingRequirements: [],
    });
    const merged = applyTargetedRepair(
      REPORT,
      '## Master Portfolio Table\n| Rank | Vertical |\n| --- | --- |\n| 1 | SaaS (unverified estimate) |',
      plan
    );
    expect(merged).toContain('## Executive Summary\nSummary body.');
    expect(merged).toContain('(unverified estimate)');
    expect(merged).toContain('# Portfolio');
    // Exactly one Master Portfolio Table — replaced, not appended.
    expect(merged.match(/## Master Portfolio Table/g)).toHaveLength(1);
  });

  it('keeps the original when a scoped rewrite returns unspliceable output', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Master Portfolio Table contains unsupported commission rates.'],
      missingRequirements: [],
    });
    expect(applyTargetedRepair(REPORT, 'Here is my revision, no headings.', plan)).toBe(REPORT);
  });

  it('falls back to a whole-report pass when a finding names no section', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['The report contains unsupported claims throughout.'],
      missingRequirements: [],
    });
    expect(plan.mode).toBe('rewrite_whole');
  });

  it('appends repair output without destroying existing sections', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Provide the Final Winner market selection.'],
      missingRequirements: MISSING,
    });
    const merged = applyTargetedRepair(REPORT, '## Final Winner market selection\nSaaS Tools.', plan);
    expect(merged).toContain('## Executive Summary');
    expect(merged).toContain('## Master Portfolio Table');
    expect(merged).toContain('## Final Winner market selection');
  });

  it('leaves the report untouched when repair returns nothing', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Provide the Final Winner market selection.'],
      missingRequirements: MISSING,
    });
    expect(applyTargetedRepair(REPORT, '   ', plan)).toBe(REPORT);
  });

  it('replaces wholesale in rewrite mode', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Remove unsupported claims.'],
      missingRequirements: [],
    });
    expect(applyTargetedRepair(REPORT, '# New report', plan)).toBe('# New report');
  });
});
