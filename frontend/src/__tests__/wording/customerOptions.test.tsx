/** @vitest-environment jsdom */
/**
 * The registry of customer-facing names (RJ-017).
 *
 * Brandon was shown feature names with no explanation. These tests make that
 * impossible to repeat: every thing a customer can see or choose has a name, a
 * one-sentence description and an example in one file, and no screen can offer
 * an option that file does not hold.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER_OPTIONS,
  DOUBLE_CHECK,
  customerOption,
  customerOptionHelp,
  customerOptionName,
  customerOptionsIn,
  findCustomerOption,
  type OptionGroup,
} from '../../content/customerOptions';
import { RESEARCH_OBJECTIVE_OPTIONS, TIER_ALLOWED_OBJECTIVES } from '../../constants/researchObjectives';
import { INTENT_DISPLAY_LABELS } from '../../constants/intentLabels';
import { INTENT_EXAMPLES, INTENT_SHORT_DESCRIPTIONS } from '../../lib/intents';
import { INTENT_HELP_TEXT, INTENT_OVERRIDE_OPTIONS, HOW_RESEARCHONE_THINKS_SECTIONS } from '../../content/howResearchOneThinks';
import { CITATION_STYLE_OPTIONS } from '../../utils/api';
import { CHALLENGE_PERSPECTIVE_OPTIONS } from '../../utils/challengePerspective';
import { RESEARCH_RUN_ADDON_CATALOG_KEYS } from '../../utils/researchRunAddons';
import { PLAN_LABEL } from '../../lib/billing/planIntent';
import { MARKETING_FAQ_ITEMS, FAQ_PAGE_AUDIT_VERBATIM_ITEMS } from '../../content/marketingFaqItems';
import { READER_STAGE_WORDS } from '../../lib/researchone/stageLabels';
import { AGENT_DISPLAY_DESCRIPTIONS } from '../../lib/agentDisplayDescriptions';
import ResearchOutputControls from '../../components/research/ResearchOutputControls';
import ChallengePerspectiveSelector from '../../components/research/ChallengePerspectiveSelector';
import { BANNED, scanReaderWording } from './readerWordingScan';
import { hardCodedOptions, retypedNames } from './customerOptionsScan';

const SRC = join(__dirname, '..', '..');
const REGISTRY_FILE = 'content/customerOptions.ts';
const names = (group: OptionGroup): string[] => customerOptionsIn(group).map((option) => option.name);
const ids = (group: OptionGroup): string[] => customerOptionsIn(group).map((option) => option.id);

afterEach(() => cleanup());

describe('the registry of customer-facing names', () => {
  it('gives every entry a name, a one-sentence description and an example', () => {
    expect(CUSTOMER_OPTIONS.length).toBeGreaterThan(90);
    for (const option of CUSTOMER_OPTIONS) {
      const where = `${option.group}:${option.id}`;
      expect(option.name.trim().length, `${where} has no name`).toBeGreaterThan(1);
      expect(option.description.trim().length, `${where} has no description`).toBeGreaterThan(15);
      expect(option.example.trim().length, `${where} has no example`).toBeGreaterThan(3);
      // A description is one sentence that ends as one; a name is not a sentence.
      expect(option.description, `${where}: the description is a sentence`).toMatch(/^[A-Z'"].*[.]$/);
      expect(option.description.replace(/\b(e\.g|i\.e|U\.S|vs)\./g, '').match(/[.!?](\s|$)/g)?.length, `${where}: one sentence`).toBe(1);
      expect(option.name, `${where}: a name is not its id`).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
      expect(option.description, `${where}: the description says more than the name`).not.toBe(option.name);
    }
  });

  it('has one entry per id in a group', () => {
    const keys = CUSTOMER_OPTIONS.map((option) => `${option.group}:${option.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses no word a person is never shown: no role nickname, step code, tier number or grade label', () => {
    const problems: string[] = [];
    for (const option of CUSTOMER_OPTIONS) {
      for (const text of [option.name, option.description, option.example]) {
        for (const banned of BANNED) {
          if (new RegExp(banned.pattern.source, banned.pattern.flags).test(text)) problems.push(`${option.group}:${option.id} [${banned.name}] ${text}`);
        }
        if (/\b(devil['’]?s advocate|red[- ]team|adversarial|challenge pass)\b/i.test(text)) problems.push(`${option.group}:${option.id} [old name] ${text}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('fails this test when an entry loses its description or its example', () => {
    const incomplete = (option: { name: string; description: string; example: string }): boolean =>
      !option.name.trim() || !option.description.trim() || !option.example.trim();
    expect(CUSTOMER_OPTIONS.filter(incomplete)).toEqual([]);
    expect(incomplete({ name: 'Fact-check', description: '', example: "'Is it true that…'" })).toBe(true);
    expect(incomplete({ name: 'Fact-check', description: 'Tests one statement.', example: ' ' })).toBe(true);
  });
});

describe('Double-check: one name, one description, one example', () => {
  it('is written exactly as ordered', () => {
    expect(DOUBLE_CHECK.name).toBe('Double-check');
    expect(DOUBLE_CHECK.description).toBe(
      'Double-check restates each main finding in its strongest form, then tests it against other sources and the original records, and tells you whether it holds up.'
    );
    expect(DOUBLE_CHECK.example).toBe(
      "Finding: 'CISA requires paper ballots.' Double-check opens CISA's own document and finds the requirement → Holds up."
    );
  });

  it('keeps the four verdict words, each with what it means', () => {
    expect(names('verdict')).toEqual(['Holds up', 'Sources disagree', 'No original record found', 'Still an open question']);
    for (const verdict of customerOptionsIn('verdict')) expect(verdict.description.length).toBeGreaterThan(30);
  });

  it('is the name of the step on every screen that names it', () => {
    expect(READER_STAGE_WORDS.challenge).toBe('Double-check');
    expect(READER_STAGE_WORDS.double_check).toBe('Double-check');
    expect(AGENT_DISPLAY_DESCRIPTIONS.double_check).toEqual({ name: 'Double-check', description: DOUBLE_CHECK.description });
    for (const item of [...MARKETING_FAQ_ITEMS, ...FAQ_PAGE_AUDIT_VERBATIM_ITEMS].filter((entry) => /double-check/i.test(entry.question))) {
      expect(item.answer).toContain(DOUBLE_CHECK.description);
      expect(item.answer).toContain(DOUBLE_CHECK.example);
    }
    expect(HOW_RESEARCHONE_THINKS_SECTIONS.find((section) => section.id === 'reasoning-first')?.body).toContain(DOUBLE_CHECK.description);
  });

  it('is described, with its example, where a customer chooses how it is applied', () => {
    render(<ChallengePerspectiveSelector value="" onChange={vi.fn()} />);
    expect(screen.getByTestId('double-check-description')).toHaveTextContent(DOUBLE_CHECK.description);
    expect(screen.getByTestId('double-check-example')).toHaveTextContent(DOUBLE_CHECK.example);
    fireEvent.click(screen.getByRole('button', { name: /No particular viewpoint/ }));
    for (const viewpoint of CHALLENGE_PERSPECTIVE_OPTIONS) {
      const row = screen.getByRole('option', { name: new RegExp(viewpoint.label) });
      expect(row).toHaveTextContent(viewpoint.description);
      expect(row).toHaveTextContent(viewpoint.example);
    }
  });

  it("no text a person reads still uses the step's earlier public name", () => {
    const earlier = scanReaderWording(SRC).filter((hit) => hit.word === 'earlier step name');
    expect(earlier.map((hit) => `${hit.file}:${hit.line} ${hit.text}`)).toEqual([]);
    expect(BANNED.find((banned) => banned.name === 'earlier step name')?.pattern.test('The Challenge pass found nothing')).toBe(true);
  });
});

describe('a screen cannot offer an option the registry does not hold', () => {
  it('every option list the request form and plan screen read is in the registry, with all three texts', () => {
    const offered: Array<[OptionGroup, readonly string[]]> = [
      ['research_objective', ['AUTO', ...RESEARCH_OBJECTIVE_OPTIONS.map((option) => option.value)]],
      ['research_objective', Object.values(TIER_ALLOWED_OBJECTIVES).flat()],
      ['citation_style', ['automatic', ...CITATION_STYLE_OPTIONS.map((option) => option.value)]],
      ['check_viewpoint', CHALLENGE_PERSPECTIVE_OPTIONS.map((option) => option.id)],
      ['report_type', INTENT_OVERRIDE_OPTIONS.map((option) => option.id)],
      ['report_type', Object.keys(INTENT_DISPLAY_LABELS)],
      ['add_on', [...RESEARCH_RUN_ADDON_CATALOG_KEYS]],
      ['plan', Object.keys(PLAN_LABEL)],
    ];
    for (const [group, list] of offered) {
      expect(list.length).toBeGreaterThan(0);
      for (const id of list) {
        const found = findCustomerOption(group, id);
        expect(found, `${group}:${id} is offered by a screen and is not in the registry`).toBeDefined();
        expect(found?.name && found.description && found.example, `${group}:${id}`).toBeTruthy();
      }
    }
  });

  it('the labels those lists show are the registry names, not a second copy', () => {
    for (const option of RESEARCH_OBJECTIVE_OPTIONS) expect(option.label).toBe(customerOption('research_objective', option.value).name);
    for (const option of CITATION_STYLE_OPTIONS) expect(option.label).toBe(customerOption('citation_style', option.value).name);
    for (const option of CHALLENGE_PERSPECTIVE_OPTIONS) expect(option.label).toBe(customerOption('check_viewpoint', option.id).name);
    for (const option of INTENT_OVERRIDE_OPTIONS) expect(option.label).toBe(customerOption('report_type', option.id).name);
    for (const [id, label] of Object.entries(INTENT_DISPLAY_LABELS)) {
      expect(label).toBe(customerOption('report_type', id).name);
      expect(INTENT_SHORT_DESCRIPTIONS[id]).toBe(customerOption('report_type', id).description);
      expect(INTENT_EXAMPLES[id]).toBe(customerOption('report_type', id).example);
      expect(INTENT_HELP_TEXT[id]).toBe(customerOptionHelp(customerOption('report_type', id)));
    }
  });

  it('every option the output controls render is a registry name, and the chosen one is explained with its example', () => {
    render(
      <ResearchOutputControls
        objective="INVESTIGATIVE_SYNTHESIS"
        onObjectiveChange={vi.fn()}
        reportFormats={['comparison_table']}
        onReportFormatsChange={vi.fn()}
        reportLengthPreset="long"
        onReportLengthPresetChange={vi.fn()}
        reportLengthCustom={2200}
        onReportLengthCustomChange={vi.fn()}
        citationStyle="apa"
        onCitationStyleChange={vi.fn()}
      />
    );
    const known = new Set([...names('research_objective'), ...names('report_length'), ...names('citation_style'), ...names('report_format')]);
    const shown = [
      ...screen.getAllByRole('option').map((option) => option.textContent ?? ''),
      ...screen.getAllByRole('button').map((button) => button.textContent ?? ''),
    ];
    expect(shown.length).toBeGreaterThan(20);
    expect(shown.filter((text) => !known.has(text))).toEqual([]);
    expect(screen.getByTestId('objective-help')).toHaveTextContent(customerOptionHelp(customerOption('research_objective', 'INVESTIGATIVE_SYNTHESIS')));
    expect(screen.getByTestId('format-help-comparison_table')).toHaveTextContent(customerOption('report_format', 'comparison_table').example);
    expect(screen.getByTestId('length-help')).toHaveTextContent(customerOption('report_length', 'long').description);
    expect(screen.getByTestId('citation-help')).toHaveTextContent(customerOption('citation_style', 'apa').example);
  });

  it('no option is typed straight into a screen where a customer sets up research, exports a report or buys something', () => {
    const inScope = (file: string): boolean =>
      /^components\/(research|billing|monitors|addons)\//.test(file) ||
      ['components/reports/ReportExportButton.tsx', 'pages/ReportSpinoffPage.tsx', 'pages/PricingPage.tsx', 'pages/AddOnsPage.tsx', 'pages/BillingPage.tsx'].includes(file);
    expect(hardCodedOptions(SRC, inScope)).toEqual([]);
  });

  it('the scan finds an option typed into a screen, and passes one read from data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'options-'));
    const write = (file: string, body: string): void => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), body);
    };
    write(
      'components/research/Typed.tsx',
      [
        'export function Typed({ list }: { list: Array<{ id: string; name: string }> }) {',
        '  return (',
        '    <select>',
        '      <option value="">Choose…</option>',
        '      <option value="deep">Deep mode</option>',
        '      {list.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}',
        '      {list.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.id}</option>)}',
        '    </select>',
        '  );',
        '}',
      ].join('\n')
    );
    expect(hardCodedOptions(dir, () => true).map((hit) => `${hit.file}:${hit.line} ${hit.text}`)).toEqual(['components/research/Typed.tsx:5 Deep mode']);
  });

  it('no file types a registry name a second time', () => {
    // A name of four letters or fewer, or an everyday word, is not evidence of a copy.
    const distinctive = new Set(
      CUSTOMER_OPTIONS.map((option) => option.name).filter((name) => name.length > 4 && !['Timeline', 'Assumptions', 'Student'].includes(name))
    );
    expect(retypedNames(SRC, distinctive, REGISTRY_FILE).map((hit) => `${hit.file}:${hit.line} ${hit.text}`)).toEqual([]);
  });

  it('the scan finds a second copy of a name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'names-'));
    mkdirSync(join(dir, 'pages'), { recursive: true });
    writeFileSync(join(dir, 'pages', 'Copy.tsx'), "export const TITLE = 'Reverse-Citation Watch';\nexport const isIt = (x: string) => x === 'Living Reports';\n");
    expect(retypedNames(dir, new Set(['Reverse-Citation Watch', 'Living Reports']), REGISTRY_FILE).map((hit) => `${hit.file}:${hit.line}`)).toEqual(['pages/Copy.tsx:1']);
  });

  it('an id the registry does not know is never shown raw', () => {
    expect(customerOptionName('report_type', 'some_new_type')).toBe('Some new type');
    expect(customerOptionName('report_type', 'adjudication')).toBe('Fact-check');
    expect(customerOptionName('report_type', null)).toBe('');
  });
});

describe('the registry covers what the server offers', () => {
  const backend = join(SRC, '..', '..', 'backend', 'src');
  const read = (file: string): string => readFileSync(join(backend, file), 'utf8');
  const quoted = (text: string): string[] => [...text.matchAll(/'([A-Za-z0-9_-]+)'/g)].map((match) => match[1]);

  it('every report type, add-on, per-run extra, check timing and restatement style the server knows has an entry', () => {
    // The backend is in the same repository; when it is not checked out there is nothing to compare.
    if (!existsSync(backend)) return;
    const intentIds = quoted(/export type IntentId =([^;]+);/.exec(read('services/planning/intentTaxonomy.ts'))?.[1] ?? '');
    expect(intentIds.length).toBeGreaterThan(10);
    expect(intentIds.filter((id) => !ids('report_type').includes(id))).toEqual([]);

    const addonIds = [...read('services/billing/addonCatalog.ts').matchAll(/^\s+id: '([a-z_]+)',/gm)].map((match) => match[1]);
    expect(addonIds.length).toBeGreaterThan(4);
    expect(addonIds.filter((id) => !ids('add_on').includes(id))).toEqual([]);

    const runAddons = quoted(/RUN_ADDON_KEYS = \[([^\]]+)\]/.exec(read('services/reasoning/runAddons.ts'))?.[1] ?? '');
    expect(runAddons.length).toBeGreaterThan(0);
    expect(runAddons.filter((id) => !ids('add_on').includes(id))).toEqual([]);

    const profiles = read('services/planning/orchestrationProfiles.ts');
    const timings = quoted(/export type DoubleCheckMode =([^;]+);/.exec(profiles)?.[1] ?? '');
    const restatements = quoted(/export type StrongestFormMode =([^;]+);/.exec(profiles)?.[1] ?? '');
    expect(timings.sort()).toEqual(ids('check_timing').sort());
    expect(restatements.sort()).toEqual(ids('restatement_style').sort());
  });
});
