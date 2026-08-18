import { describe, it, expect } from 'vitest';

import {
  deriveContractWordTarget,
  deriveItemLabel,
  expandSectionPlanForContract,
  findRepeatedArtifact,
  MAX_EXPANDED_SECTIONS,
} from '../services/reasoning/contractOutline';
import {
  extractOpportunityObjectsFromMarkdown,
  isItemSectionHeading,
} from '../services/reasoning/researchOrchestrator';
import {
  buildTableHeaderDirective,
  composeItemHeading,
  resolveTableSectionKey,
  contractRequestsTable,
  DESCRIPTIVE_SECTION_PLAN,
  extractItemName,
  formatSectionsForRefiner,
  parseRefinedSections,
  sectionExpectsTable,
} from '../services/reasoning/reportGenerator';
import { INTENT_OUTPUT_TEMPLATES } from '../services/formatting/templates/intentOutputTemplates';
import { appendContractRequiredSections } from '../services/reasoning/contractOutline';
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
    expect(result.plan.some((s) => s.key === 'opportunities_list')).toBe(false);
    // Ordinals travel as DATA, not encoded in a title string that would later
    // have to be parsed back out of whatever the model wrote.
    const itemSections = result.plan.filter((s) => typeof s.itemOrdinal === 'number');
    expect(itemSections).toHaveLength(20);
    expect(itemSections.map((s) => s.itemOrdinal)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
    expect(itemSections.every((s) => s.itemLastOrdinal === undefined)).toBe(true);
    // Framing sections carry no ordinal.
    expect(result.plan.filter((s) => s.itemOrdinal === undefined)).toHaveLength(4);
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

  it('composes headings from pipeline data, never from model prose', () => {
    // With a name from the drafter.
    expect(
      composeItemHeading({ ordinal: 7, label: 'Opportunity', itemName: 'Home Fitness Equipment' })
    ).toBe('7. Home Fitness Equipment');
    // Without one, the report type's label carries the heading.
    expect(composeItemHeading({ ordinal: 7, label: 'Opportunity', itemName: null })).toBe(
      '7. Opportunity'
    );
    expect(composeItemHeading({ ordinal: 7, label: 'Opportunity', itemName: '   ' })).toBe(
      '7. Opportunity'
    );
    // Grouped sections read as a range.
    expect(composeItemHeading({ ordinal: 3, label: 'Option', lastOrdinal: 5 })).toBe('3–5. Options');
  });

  it('every composed heading is recognised by the delivered-item counter', () => {
    const { plan } = expandSectionPlanForContract({
      basePlan: OPPORTUNITY_PLAN,
      artifacts: TWENTY_OPPORTUNITIES,
    });
    const composed = plan
      .filter((s) => typeof s.itemOrdinal === 'number')
      .map((s) =>
        composeItemHeading({
          ordinal: s.itemOrdinal!,
          label: 'Opportunity',
          itemName: `Concrete Thing ${s.itemOrdinal}`,
          lastOrdinal: s.itemLastOrdinal,
        })
      );
    expect(composed).toHaveLength(20);
    const planned = new Set(composed.map((t) => t.toLowerCase()));
    for (const heading of composed) {
      expect(isItemSectionHeading(heading, planned)).toBe(true);
    }
  });

  it('strips the item-name marker so it never reaches the reader', () => {
    const { itemName, content } = extractItemName(
      'ITEM NAME: Home Fitness Equipment\n\nThe body starts here.'
    );
    expect(itemName).toBe('Home Fitness Equipment');
    expect(content).toBe('The body starts here.');
    expect(content).not.toContain('ITEM NAME');
  });

  it('tolerates a decorated or missing item-name marker', () => {
    expect(extractItemName('**ITEM NAME:** Pet Supplies\nBody.').itemName).toBe('Pet Supplies');
    expect(extractItemName('Item_Name : Pet Supplies\nBody.').itemName).toBe('Pet Supplies');
    // Absent marker: body is untouched and the label fallback applies.
    const none = extractItemName('Body with no marker.');
    expect(none.itemName).toBeNull();
    expect(none.content).toBe('Body with no marker.');
    // Absurdly long names are rejected but still stripped from the body.
    const long = extractItemName(`ITEM NAME: ${'x'.repeat(200)}\nBody.`);
    expect(long.itemName).toBeNull();
    expect(long.content).toBe('Body.');
  });

  it('takes the item label from the report type, never from the brief prose', () => {
    // Run c50162a9 planned "Modeling 1..20" for a list of market opportunities
    // because the description happened to end in a gerund. The label no longer
    // depends on the wording of the request at all.
    const gerund = { description: 'opportunities ranked by revenue modeling' };
    const adjective = { description: 'opportunities with financial modeling' };
    for (const artifact of [gerund, adjective, { description: 'anything at all' }, null]) {
      expect(deriveItemLabel(artifact, 'opportunity_discovery')).toBe('Opportunity');
    }
    expect(deriveItemLabel({ description: 'opportunities' }, 'comparative')).toBe('Option');
    expect(deriveItemLabel(null, 'implementation')).toBe('Phase');
    expect(deriveItemLabel(null, 'timeline')).toBe('Event');
  });

  it('gives every report type its own item label', () => {
    const labels = Object.values(INTENT_OUTPUT_TEMPLATES).map((t) => t.itemLabel);
    expect(labels.every((label) => typeof label === 'string' && label.length > 0)).toBe(true);
    // Unknown intents fall back to the legacy template rather than throwing.
    expect(deriveItemLabel(null, 'no_such_intent')).toBe('Item');
    expect(deriveItemLabel(null, undefined)).toBe('Item');
  });

  it('matches planned titles exactly when the pipeline composed them', () => {
    const planned = new Set(['7. home fitness equipment', '8. pet supplies']);
    expect(isItemSectionHeading('7. Home Fitness Equipment', planned)).toBe(true);
    expect(isItemSectionHeading('**8. Pet Supplies**', planned)).toBe(true);
    // Not planned: not an item, even though it is a numbered heading.
    expect(isItemSectionHeading('9. Something Else', planned)).toBe(false);
    // A planned title wins even if it reads like a framing section.
    expect(isItemSectionHeading('3. Summary', new Set(['3. summary']))).toBe(true);
  });

  it('falls back structurally, with no domain vocabulary, for legacy reports', () => {
    // No planned titles: reports this pipeline did not assemble.
    for (const heading of ['1. Developer Tools', '7. Home Fitness Equipment', '20. Pet Supplies']) {
      expect(isItemSectionHeading(heading)).toBe(true);
    }
    for (const heading of ['1. Executive Summary', '10. Recommendations', 'Limitations']) {
      expect(isItemSectionHeading(heading)).toBe(false);
    }
  });

  it('will not count a stray numbered section as a missing item (false pass)', () => {
    // Codex P1: with no planned titles, a report that omitted item 4 but carried
    // "## 4. Risk Assessment" would have that counted in its place and could
    // satisfy the exact-count check. A real enumerated list runs 1..N with no
    // gaps or repeats; a stray numbered section breaks the sequence.
    const complete = [
      '## 1. Alpha',
      'Body with rationale and description.',
      '## 2. Beta',
      'Body with rationale and description.',
      '## 3. Gamma',
      'Body with rationale and description.',
    ].join('\n');
    expect(extractOpportunityObjectsFromMarkdown(complete)).toHaveLength(3);

    // Same count, but the ordinals repeat — item 3 was never written and a
    // second "4" stands in for it.
    const gapped = [
      '## 1. Alpha',
      'Body with rationale and description.',
      '## 2. Beta',
      'Body with rationale and description.',
      '## 4. Risk Assessment',
      'Body with rationale and description.',
    ].join('\n');
    expect(extractOpportunityObjectsFromMarkdown(gapped)).toHaveLength(0);
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

describe('PR #209 review — Codex and Copilot findings', () => {
  const EXPANDED_PLAN = [
    { title: 'Overview', key: 'overview', weight: 1 },
    { title: '1. Opportunity', key: 'items_1', weight: 1, itemOrdinal: 1 },
    { title: '2. Opportunity', key: 'items_2', weight: 1, itemOrdinal: 2 },
    { title: 'Master Portfolio Table', key: 'contract_master_portfolio_table', weight: 1 },
    { title: 'Caveats', key: 'caveats', weight: 1 },
  ];

  it('gives the exact table schema to exactly one section', () => {
    // Codex P1: sectionExpectsTable is true for EVERY section once the contract
    // wants a table, so the exact header + row count reached all ~24 drafters
    // and each would emit the whole 20-row portfolio table.
    expect(resolveTableSectionKey(EXPANDED_PLAN, true)).toBe('contract_master_portfolio_table');
    // Never an item section — those describe one item, not the whole portfolio.
    expect(resolveTableSectionKey(EXPANDED_PLAN, true)).not.toMatch(/^items_/);
    // No table requested: no section carries the directive.
    expect(resolveTableSectionKey(EXPANDED_PLAN, false)).toBeNull();
  });

  it('falls back to the first section after the items when none reads as tabular', () => {
    const plan = [
      { title: 'Overview', key: 'overview', weight: 1 },
      { title: '1. Opportunity', key: 'items_1', weight: 1, itemOrdinal: 1 },
      { title: 'Ranking and Analysis', key: 'ranking', weight: 1 },
      { title: 'Caveats', key: 'caveats', weight: 1 },
    ];
    expect(resolveTableSectionKey(plan, true)).toBe('ranking');
  });

  it('reserves word budget for contract sections before capping expansion', () => {
    // Codex P2: contract sections used to be appended AFTER the cap, so the
    // plan's own floor-pinned minimum could exceed the stated target.
    const base = [
      { title: 'Overview', key: 'overview', weight: 1 },
      { title: 'Opportunities', key: 'opportunities_list', weight: 1 },
      { title: 'Caveats', key: 'caveats', weight: 1 },
    ];
    const withContract = appendContractRequiredSections({
      plan: base,
      artifacts: [
        { description: 'ranked list of market opportunities', exactCount: 20 },
        { description: 'Cross-Opportunity Analysis' },
        { description: 'Final Winner selection' },
      ],
    });
    const expanded = expandSectionPlanForContract({
      basePlan: withContract.plan,
      artifacts: [{ description: 'ranked list of market opportunities', exactCount: 20 }],
      explicitWordTarget: 800,
      perSectionFloor: 80,
    });
    expect(expanded.plan.length * 80).toBeLessThanOrEqual(800);
  });
});

describe('refiner reassembly — structure is owned by code, not the model', () => {
  const DRAFTED = [
    { title: '1. Home Fitness Equipment', key: 'items_1', content: 'Body one.' },
    { title: '2. Pet Supplies', key: 'items_2', content: 'Body two.' },
    { title: 'Recommendations', key: 'recommendations', content: 'Body three.' },
  ];

  it('routes refined bodies back by key', () => {
    const blocks = formatSectionsForRefiner(DRAFTED);
    expect(blocks[0]).toContain('<<<SECTION key="items_1">>>');
    expect(blocks[0]).toContain('<<<END SECTION>>>');
    // No headings are handed to the refiner, so it cannot rewrite one.
    expect(blocks.join('\n')).not.toContain('## ');

    const parsed = parseRefinedSections(
      '<<<SECTION key="items_1">>>\nTightened one.\n<<<END SECTION>>>\n' +
        '<<<SECTION key="recommendations">>>\nTightened three.\n<<<END SECTION>>>'
    );
    expect(parsed.get('items_1')).toBe('Tightened one.');
    expect(parsed.get('recommendations')).toBe('Tightened three.');
    // A section the refiner did not return simply keeps its drafted body.
    expect(parsed.has('items_2')).toBe(false);
  });

  it('drops empty blocks so a refiner cannot blank delivered work', () => {
    const parsed = parseRefinedSections(
      '<<<SECTION key="items_1">>>\n\n<<<END SECTION>>>\n' +
        '<<<SECTION key="">>>\nOrphan.\n<<<END SECTION>>>'
    );
    expect(parsed.size).toBe(0);
  });

  it('strips a heading the refiner emitted despite being told not to', () => {
    const parsed = parseRefinedSections(
      '<<<SECTION key="items_1">>>\n## 1. Renamed By Model\nTightened one.\n<<<END SECTION>>>'
    );
    // The heading is discarded; only the body survives, and the real heading is
    // prepended by the assembler.
    expect(parsed.get('items_1')).toBe('Tightened one.');
  });

  it('recovers a final block whose closing delimiter was truncated', () => {
    const parsed = parseRefinedSections('<<<SECTION key="items_2">>>\nTightened two.');
    expect(parsed.get('items_2')).toBe('Tightened two.');
  });

  it('yields nothing usable from a free-form response, so drafts are kept', () => {
    expect(parseRefinedSections('Here is the revised report.\n\n## 1. Whatever\nBody.').size).toBe(0);
  });
});

describe('run c50162a9 — contract-required sections and table headers', () => {
  const PLAN = [
    { title: 'Overview', key: 'overview', weight: 1 },
    { title: 'Ranking and Analysis', key: 'ranking_and_analysis', weight: 1 },
    { title: 'Caveats', key: 'caveats', weight: 1 },
  ];

  it('adds a drafting slot for each named deliverable the plan lacks', () => {
    const { plan, added } = appendContractRequiredSections({
      plan: PLAN,
      artifacts: [
        { description: 'ranked list of market opportunities', exactCount: 20 },
        { description: 'Cross-Opportunity Analysis' },
        { description: 'Final Winner selection' },
      ],
    });
    expect(added).toEqual(['Cross-Opportunity Analysis', 'Final Winner selection']);
    // Inserted before the trailing caveats section, not after it.
    expect(plan[plan.length - 1]?.key).toBe('caveats');
    expect(plan.map((s) => s.title)).toEqual([
      'Overview',
      'Ranking and Analysis',
      'Cross-Opportunity Analysis',
      'Final Winner selection',
      'Caveats',
    ]);
  });

  it('does not duplicate a deliverable an existing section already covers', () => {
    const { added } = appendContractRequiredSections({
      plan: PLAN,
      artifacts: [{ description: 'a detailed ranking and analysis' }],
    });
    expect(added).toEqual([]);
  });

  it('still adds a deliverable that only partly overlaps an existing section', () => {
    // "Ranking and Analysis" does not cover a per-option ranking rationale.
    const { added } = appendContractRequiredSections({
      plan: PLAN,
      artifacts: [{ description: 'ranking rationale for each option' }],
    });
    expect(added).toEqual(['Ranking rationale for each option']);
  });

  it('skips the counted artifact, which already has its own item sections', () => {
    const repeated = { description: 'market opportunities', exactCount: 20 };
    const { added } = appendContractRequiredSections({
      plan: PLAN,
      artifacts: [repeated],
      repeatedArtifact: repeated,
    });
    expect(added).toEqual([]);
  });

  it('hands the drafter a literal header row, not a column count', () => {
    const directive = buildTableHeaderDirective({
      fields: ['monthly_revenue', 'competition level'],
      itemLabel: 'Opportunity',
      rowCount: 20,
    });
    expect(directive).toContain('| # | Opportunity | Monthly Revenue | Competition Level |');
    expect(directive).toContain('| --- | --- | --- | --- |');
    expect(directive).toContain('exactly 20 data rows');
    expect(directive).toContain('exactly 4 cells');
  });

  it('emits nothing when the contract names no per-item fields', () => {
    expect(buildTableHeaderDirective({ fields: [], itemLabel: 'Opportunity' })).toBe('');
  });

  it('keeps adjudication vocabulary out of the descriptive section plan', () => {
    const titles = DESCRIPTIVE_SECTION_PLAN.map((s) => s.title.toLowerCase());
    expect(titles.some((t) => t.includes('evidence'))).toBe(false);
    expect(titles.some((t) => t.includes('falsification'))).toBe(false);
    expect(titles.some((t) => t.includes('contradiction'))).toBe(false);
    // The key is load-bearing for revision insertion order and must not move.
    expect(DESCRIPTIVE_SECTION_PLAN.some((s) => s.key === 'evidence_ledger')).toBe(true);
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

  it('refuses to overwrite a section the repair did not target', () => {
    // Codex P2: every returned block was accepted, so an unrequested section
    // could clobber work that had already passed.
    const plan = planTargetedRepair({
      markdown: REPORT,
      revisionInstructions: ['Master Portfolio Table contains unsupported commission rates.'],
      missingRequirements: [],
    });
    const merged = applyTargetedRepair(
      REPORT,
      '## Master Portfolio Table\nFixed table.\n\n## Executive Summary\nHIJACKED.',
      plan
    );
    expect(merged).toContain('Fixed table.');
    expect(merged).toContain('Summary body.');
    expect(merged).not.toContain('HIJACKED');
  });

  it('leaves untouched sections byte-identical when splicing', () => {
    // Copilot: the previous implementation rebuilt every block and re-joined,
    // normalising whitespace across the whole report for a one-section change.
    const spaced = '# Portfolio\n\n\n## Executive Summary\nSummary body.\n\n\n## Master Portfolio Table\nOld table.\n';
    const plan = planTargetedRepair({
      markdown: spaced,
      revisionInstructions: ['Master Portfolio Table contains unsupported commission rates.'],
      missingRequirements: [],
    });
    const merged = applyTargetedRepair(spaced, '## Master Portfolio Table\nNew table.', plan);
    // The untouched region, including its unusual triple newlines, survives.
    expect(merged).toContain('# Portfolio\n\n\n## Executive Summary\nSummary body.\n\n\n');
    expect(merged).toContain('New table.');
    expect(merged).not.toContain('Old table.');
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
