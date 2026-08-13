import { describe, it, expect } from 'vitest';

import {
  deriveContractWordTarget,
  expandSectionPlanForContract,
  findRepeatedArtifact,
  MAX_EXPANDED_SECTIONS,
} from '../services/reasoning/contractOutline';
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

const TWENTY_OPPORTUNITIES = [
  {
    type: 'opportunity',
    description: 'ranked market verticals',
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
    expect(result.plan.some((s) => s.title === 'Opportunity 1')).toBe(true);
    expect(result.plan.some((s) => s.title === 'Opportunity 20')).toBe(true);
    expect(result.plan.some((s) => s.key === 'opportunities_list')).toBe(false);
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

  it('falls back to a whole-report pass when existing content is wrong', () => {
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Remove unsupported claims about commission rates.'],
      missingRequirements: ['Final Winner market selection'],
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
