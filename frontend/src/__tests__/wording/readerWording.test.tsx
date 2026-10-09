/** @vitest-environment jsdom */
/**
 * Slice 5, item 8: reader-facing app text says "findings", not "claims", and
 * shows no grade label, tier number or raw stage id. This is the gate: it
 * fails on a reader-facing string that uses one of those words.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { scanReaderWording } from './readerWordingScan';
import { SampleReportView } from '../../components/r1-reports/SampleReportView';
import ComparisonTable from '../../components/landing/ComparisonTable';
import { READER_STAGE_WORDS, readerStageLabel } from '../../lib/researchone/stageLabels';
import { PLAIN_ROLE_WORDS, plainLabel, plainProgressText } from '../../lib/researchone/plainWords';
import { sampleReaderEvidence, sampleReaderReport } from '../../content/sampleReaderReport';

afterEach(cleanup);

const SRC = join(__dirname, '../..');

/**
 * Text that uses one of the words in a sense the rule is not about. Each entry
 * is a file and the phrase that makes it an exception; anything else in that
 * file is still checked.
 */
const ALLOWED: Array<{ file: string; phrase: RegExp; why: string }> = [
  { file: 'pages/TermsPage.tsx', phrase: /We do not claim|ALL CLAIMS ARISING|PRECEDING THE CLAIM|against any claims/, why: 'legal wording: a claim in law, not a finding of a report' },
  { file: 'pages/ResearchV2GuidePage.tsx', phrase: /patent claims/, why: 'a patent claim is the legal term for what a patent protects' },
];

/**
 * A banned phrase in a file that another change is removing at the same time
 * (RJ-012 owns the pricing, billing and add-ons pages). It is excused only
 * while it is still there; once that change lands the entry excuses nothing,
 * and the phrase cannot be written anywhere else.
 */
const OWNED_ELSEWHERE: Array<{ file: string; phrase: RegExp; why: string }> = [
  { file: 'pages/PricingPage.tsx', phrase: /Devil's Advocate Review: Included in Sovereign/, why: 'RJ-012 removes this line from the pricing page' },
];

const allowedFor = (file: string): RegExp[] => [...ALLOWED, ...OWNED_ELSEWHERE].filter((entry) => entry.file === file).map((entry) => entry.phrase);

/** A throwaway source tree, for showing what the gate does and does not flag. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wording-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
const lines = (...text: string[]): string => text.join('\n');
const found = (dir: string, allowed?: (file: string) => readonly RegExp[]): string[] => scanReaderWording(dir, allowed).map((hit) => `${hit.line} ${hit.word}`);

describe('the reader-wording gate', () => {
  it('finds no reader-facing string in the app that says claim, a tier number, a grade label, a raw status, a role nickname or a step code', () => {
    expect(scanReaderWording(SRC, allowedFor).map((hit) => `${hit.file}:${hit.line} [${hit.word}] ${hit.text}`)).toEqual([]);
  });

  it('every allowed exception is still there, so the list cannot hide a deleted file or a fixed line', () => {
    const hits = scanReaderWording(SRC);
    for (const allowed of ALLOWED) {
      expect(hits.some((hit) => hit.file === allowed.file && allowed.phrase.test(hit.text)), `${allowed.file}: ${allowed.why}`).toBe(true);
    }
  });

  it('fails on a reader-facing string containing "claims", and passes over identifiers and keys', () => {
    const dir = tree({
      'components/Bad.tsx': lines(
        'export function Bad({ stats }: { stats: { claim_count: number } }) {',
        '  const key = "claims";',
        '  const label = "Claims";',
        '  return (',
        '    <div className="claims-table flex gap-2" data-testid="claims" title="Every claim has a source">',
        '      <p>Unsupported claims are flagged. {stats.claim_count}</p>',
        '      <span>{key === "claims" ? label : "Tier 2 lead"}</span>',
        '    </div>',
        '  );',
        '}'
      ),
    });
    expect(found(dir)).toEqual(['3 claim', '5 claim', '6 claim', '7 tier number']);
  });

  it('flags a value rendered between tags exactly as written, and a custom prop that is shown', () => {
    const dir = tree({
      'components/Rendered.tsx': lines(
        'export function Rendered() {',
        '  return (',
        '    <dl>',
        "      <dd>{'claims'}</dd>",
        "      <dd>{'under_review'}</dd>",
        '      <b>{`Status: ${"under_review"} for this report`}</b>',
        '      <Fact label="Stage" value="Claims" />',
        '      <option value="claims">Findings</option>',
        '    </dl>',
        '  );',
        '}'
      ),
    });
    // Line 8: a lowercase attribute value on its own is a form value, not text.
    expect(found(dir)).toEqual(['4 claim', '5 raw status', '6 raw status', '7 claim']);
  });

  it('flags every tier form and a grade word used as a label, and leaves the same word alone in a sentence', () => {
    const dir = tree({
      'content/copy.ts': lines(
        "export const a = 'Each source carries its tier (1–4).';",
        "export const b = 'Tier 1–4 sources';",
        "export const c = { tier: 'Speculation' };",
        "export const d = 'Finding 3: mechanism unclear — Speculation';",
        "export const e = 'Testimony';",
        "export const f = 'This is an inference from the data, not speculation.';",
        "export const g = 'The Sovereign tier keeps every byte in your tenancy.';"
      ),
    });
    expect(found(dir)).toEqual(['1 tier number', '2 tier number', '3 grade label', '4 grade label', '5 grade label']);
  });

  it('excuses only the allowed phrase: a banned word beside it is still found, and so is a second use of the same word', () => {
    const dir = tree({
      'pages/Guide.tsx': lines(
        'export function Guide() {',
        '  return <p>Boundaries for new patent claims with Tier 2 support, and other claims too.</p>;',
        '}'
      ),
    });
    expect(found(dir, () => [/patent claims/])).toEqual(['2 tier number', '2 claim']);
    expect(found(dir)).toEqual(['2 claim', '2 tier number', '2 claim']);
  });
});

/** RJ-013: the words for a pipeline role or pass that no person is shown. */
/** The two retired nicknames, put together from halves so the words are not spelled in the repository (RJ-017). */
const OLD_RESTATE = `${'steel'}${'man'}`;
const OLD_CHECKER = `${'skep'}${'tic'}`;
const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const ROLE_NICKNAME = /steel[- ]?man|straw[- ]?m[ae]n|s[kc]eptic|devil['’]?s[- ]advocate|red[- ]?team|contrarian|adversar|gadfl/i;
const STEP_CODE = /\b[a-z][a-z0-9]*(_[a-z0-9]+)+\b/;

describe('the reader-wording gate: role nicknames and step codes', () => {
  it('fails on every banned nickname in text a person reads, and passes over identifiers, keys and comparisons', () => {
    const dir = tree({
      'components/Roles.tsx': lines(
        "import type { Run } from './types';",
        'export function Roles({ run, doubleCheckMode }: { run: Run; doubleCheckMode: string }) {',
        "  const strongestFormMode = run.strongest_form_mode === 'as_product' ? 'strongest_form' : 'off';",
        '  return (',
        `    <ul data-emphasis="double_check" title="${cap(OLD_RESTATE)} pass">`,
        `      <li>${cap(OLD_RESTATE)} pass: strengthening formulations before critique</li>`,
        `      <li>A ${'steel'}-${'man'} of each option, never a strawman</li>`,
        `      <li>The ${cap(OLD_CHECKER)} argues against the draft; a sceptic would too</li>`,
        "      <li>Devil's Advocate Review, with red-teaming by a contrarian</li>",
        '      <li>The adversarial pass, run by an adversary and a gadfly</li>',
        '      <li>{doubleCheckMode === "gate" ? "Double-check" : strongestFormMode}</li>',
        '    </ul>',
        '  );',
        '}'
      ),
    });
    expect(found(dir)).toEqual([
      '5 role nickname',
      '6 role nickname',
      '7 role nickname', '7 role nickname',
      '8 role nickname', '8 role nickname',
      '9 role nickname', '9 role nickname', '9 role nickname',
      '10 role nickname', '10 role nickname', '10 role nickname',
    ]);
  });

  it('fails on an internal step code written as text', () => {
    const dir = tree({
      'components/Trace.tsx': lines(
        'export function Trace({ evt }: { evt: { eventType: string } }) {',
        "  const done = evt.eventType === 'run_completed';",
        `  return <p>Reasoning across sources... (reasoner_started) {done ? "Done" : "Now at ${OLD_RESTATE}_started"}</p>;`,
        '  // Every ending a step code has, not only _started and _completed.',
        '  const more = <p>Skipped (stage_skipped), then query_done and discovery_ingest_ready; saved under discovered_by_run_id.</p>;',
        '}'
      ),
    });
    expect(found(dir)).toEqual(['3 raw step code', '3 role nickname', '5 raw step code', '5 raw step code', '5 raw step code']);
  });

  it('the one line another change is removing is the only banned phrase excused, and only in its own file', () => {
    for (const owned of OWNED_ELSEWHERE) {
      const others = scanReaderWording(SRC, (file) => (file === owned.file ? [] : allowedFor(file))).filter((hit) => hit.word === 'role nickname' || hit.word === 'raw step code');
      expect(others.every((hit) => hit.file === owned.file && owned.phrase.test(hit.text)), owned.why).toBe(true);
    }
  });

  it('no screen prints the step code that came with a progress event', () => {
    const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
    const printed = files(SRC).filter((path) => /[>(]\s*\(?\$?\{\s*\w+(\?)?\.substep\s*\}/.test(readFileSync(path, 'utf8')));
    expect(printed.map((path) => path.slice(SRC.length + 1))).toEqual([]);
  });
});

describe('plain words for what the pipeline reports', () => {
  it('the two lines from the live progress screen read in plain words, with no code after them', () => {
    expect(plainProgressText('Reasoning across sources...')).toBe('Reasoning across sources...');
    expect(plainProgressText('Reasoning across sources... (reasoner_started)')).toBe('Reasoning across sources...');
    expect(plainProgressText(`${cap(OLD_RESTATE)} pass: strengthening formulations before critique...`)).toBe('Restating each finding in its strongest form before checking it...');
    expect(plainProgressText(`${cap(OLD_RESTATE)} pass: strengthening formulations before critique...(${OLD_RESTATE}_started)`)).toBe('Restating each finding in its strongest form before checking it...');
  });

  it('a stored message from an earlier version never shows a nickname or a code', () => {
    const earlier = [
      'Worker picked up the run; preparing planner...',
      `${cap(OLD_CHECKER)} pass failed: provider timeout`,
      `Model call failed for role ${OLD_CHECKER} (${OLD_CHECKER}_started)`,
      'Challenge pass: checking the findings and noting objections...',
      "Devil's Advocate Review queued",
      'Red-team review of the adversarial twin',
      'Executing specialist: market_scout',
      `Attack the ${OLD_RESTATE}, not a strawman`,
      'A contrarian gadfly',
    ];
    for (const message of earlier) {
      const plain = plainProgressText(message);
      expect(plain, message).not.toMatch(ROLE_NICKNAME);
      expect(plain, message).not.toMatch(STEP_CODE);
      expect(plain.length, message).toBeGreaterThan(0);
    }
    expect(plainProgressText(`Model call failed for role ${OLD_CHECKER} (${OLD_CHECKER}_started)`)).toBe('Model call failed for role Double-check');
    // The step's earlier public name, in a message stored before RJ-017.
    expect(plainProgressText('Challenge pass: checking the findings and noting objections...')).toBe('Double-check: checking the findings and noting objections...');
    expect(plainProgressText('Challenge pass skipped for this run')).not.toMatch(/challenge pass/i);
    expect(plainProgressText('Executing specialist: market_scout')).toBe('Executing specialist: market scout');
    expect(plainProgressText('Devil’s Advocate Review queued')).toBe('Double-check queued');
    expect(plainProgressText(null)).toBe('');
  });

  it('a role, a cost phase and a saved checkpoint are named in plain words, never by id', () => {
    // One step to a customer, named Double-check; its two parts each have a model.
    expect(plainLabel('strongest_form')).toBe('Double-check (restating findings)');
    expect(plainLabel('double_check')).toBe('Double-check (testing findings)');
    expect(plainLabel('Double-check')).toBe('Double-check');
    expect(plainLabel('double_check_output')).toBe('Double-check (testing findings): saved result');
    // A row written before migration 061 ran is still never shown by its old name.
    expect(plainLabel(OLD_CHECKER)).toBe('Double-check');
    expect(plainLabel(cap(OLD_CHECKER))).toBe('Double-check');
    expect(plainLabel(`${OLD_CHECKER}_output`)).not.toMatch(ROLE_NICKNAME);
    expect(plainLabel('retriever_analysis')).toBe('Reading the passages');
    expect(plainLabel('some_new_role')).toBe('Some new role');
    expect(plainLabel('adversarial_twin')).toBe('Double-check');
    expect(plainLabel(undefined)).toBe('');
    for (const [role, words] of Object.entries(PLAIN_ROLE_WORDS)) {
      expect(plainLabel(role)).toBe(words);
      expect(words, role).not.toMatch(ROLE_NICKNAME);
      expect(words, role).not.toMatch(/_/);
    }
  });
});

describe('the public sample report', () => {
  it('is a section 2a report shown with the reading page: no table of claims, no grade tags', () => {
    render(<SampleReportView />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(sampleReaderReport.title);
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Summary',
      'Key findings',
      'How the European Union regulates',
      'How the United States regulates',
      'Limits of this report',
      'References',
    ]);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Report', 'Evidence', 'Sources', 'How this was researched']);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\bclaims?\b/i);
    expect(text).not.toMatch(/CLAIMS_TABLE|CLAIM_[AB]|EXECUTIVE_SUMMARY|CONFIDENCE|verified|corroborated|contested|tier/i);
  });

  it('every citation number on it opens a source, and every source is cited', () => {
    render(<SampleReportView />);
    const numbers = (sampleReaderReport.sections ?? []).filter((entry) => entry.title !== 'References').flatMap((entry) => [...entry.content.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
    expect(screen.getAllByRole('button', { name: /^Citation \d+: / })).toHaveLength(numbers.length);
    expect(new Set(numbers)).toEqual(new Set([1, 2, 3, 4]));
    expect(sampleReaderEvidence.sources).toHaveLength(4);
    for (const number of [1, 2, 3, 4]) expect(document.getElementById(`reference-${number}`)).not.toBeNull();
  });
});

describe('the landing comparison table', () => {
  it('says findings, not claims', () => {
    const html = renderToStaticMarkup(<ComparisonTable />);
    expect(html).toContain('A citation for every finding');
    expect(html).toContain('Cited opposing findings');
    expect(html).not.toMatch(/\bclaims?\b/i);
  });
});

describe('the live progress view', () => {
  it('names each stage in reader words, never the stage id', () => {
    for (const [stage, words] of Object.entries(READER_STAGE_WORDS)) {
      expect(readerStageLabel(stage)).toBe(words);
      expect(words).not.toMatch(/_|\b(retriever|sleuth|synthesizer|epistemic|s[k]eptic|reasoner|verifier|planner)\b/i);
      expect(words).toMatch(/^[A-Z]/);
    }
    expect(readerStageLabel('retriever_analysis')).toBe('Reading the passages');
    expect(readerStageLabel('synthesis')).toBe('Writing the report');
    expect(readerStageLabel('discovery')).toBe('Searching sources');
    // The stage the pipeline emits with its final event.
    expect(readerStageLabel('done')).toBe('Done');
    expect(readerStageLabel('challenge')).toBe('Double-check');
    expect(readerStageLabel('double_check')).toBe('Double-check');
    expect(readerStageLabel('some_new_stage')).toBe('Working');
    expect(readerStageLabel(null)).toBe('Working');
  });
});

describe('the live run panel', () => {
  it("words the stage from what the run reported, not from the diagram's nearest box", async () => {
    const { readFileSync } = await import('node:fs');
    const panel = readFileSync(join(SRC, 'components/r1-dashboard/LiveRunPanel.tsx'), 'utf8');
    expect(panel).toContain("const stageAsReported = run.status === 'plan_pending_confirmation' ? 'plan_pending_confirmation' : latest?.stage ?? run.progress_stage ?? run.status;");
    expect(panel).toContain('<Fact label="Stage" value={readerStageLabel(stageAsReported)} />');
    // Stages the diagram folds together read differently to a person.
    expect(readerStageLabel('synthesis')).not.toBe(readerStageLabel('reasoner'));
    expect(readerStageLabel('verification')).not.toBe(readerStageLabel('reasoner'));
  });
});
