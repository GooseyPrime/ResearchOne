/** @vitest-environment jsdom */
/**
 * Slice 5, item 8: reader-facing app text says "findings", not "claims", and
 * shows no grade label, tier number or raw stage id. This is the gate: it
 * fails on a reader-facing string that uses one of those words.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { scanReaderWording } from './readerWordingScan';
import { SampleReportView } from '../../components/r1-reports/SampleReportView';
import ComparisonTable from '../../components/landing/ComparisonTable';
import { READER_STAGE_WORDS, readerStageLabel } from '../../lib/researchone/stageLabels';
import { sampleReaderEvidence, sampleReaderReport } from '../../content/sampleReaderReport';

afterEach(cleanup);

const SRC = join(__dirname, '../..');

/**
 * Text that uses one of the words in a sense the rule is not about. Each entry
 * is a file and the phrase that makes it an exception; anything else in that
 * file is still checked.
 */
const ALLOWED: Array<{ file: string; phrase: RegExp; why: string }> = [
  { file: 'pages/TermsPage.tsx', phrase: /We do not claim|ALL CLAIMS ARISING|against any claims/, why: 'legal wording: a claim in law, not a finding of a report' },
  { file: 'pages/ResearchV2GuidePage.tsx', phrase: /patent claims/, why: 'a patent claim is the legal term for what a patent protects' },
];

describe('the reader-wording gate', () => {
  it('finds no reader-facing string in the app that says claim, a tier number, a grade label or a raw status', () => {
    const hits = scanReaderWording(SRC).filter((hit) => !ALLOWED.some((allowed) => allowed.file === hit.file && allowed.phrase.test(hit.text)));
    expect(hits.map((hit) => `${hit.file}:${hit.line} [${hit.word}] ${hit.text}`)).toEqual([]);
  });

  it('every allowed exception is still there, so the list cannot hide a deleted file or a fixed line', () => {
    const hits = scanReaderWording(SRC);
    for (const allowed of ALLOWED) {
      expect(hits.some((hit) => hit.file === allowed.file && allowed.phrase.test(hit.text)), `${allowed.file}: ${allowed.why}`).toBe(true);
    }
  });

  it('fails on a reader-facing string containing "claims", and passes over identifiers and keys', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wording-'));
    mkdirSync(join(dir, 'components'));
    writeFileSync(
      join(dir, 'components/Bad.tsx'),
      [
        'export function Bad({ stats }: { stats: { claim_count: number } }) {',
        '  const key = "claims";',
        '  const label = "Claims";',
        '  return (',
        '    <div className="claims-table flex gap-2" data-testid="claims" title="Every claim has a source">',
        '      <p>Unsupported claims are flagged. {stats.claim_count}</p>',
        '      <span>{key === "claims" ? label : "Tier 2 lead"}</span>',
        '      <b>{`Status: ${"under_review"} for this report`}</b>',
        '    </div>',
        '  );',
        '}',
      ].join('\n')
    );
    const hits = scanReaderWording(dir);
    expect(hits.map((hit) => `${hit.line} ${hit.word} ${hit.text}`)).toEqual([
      '3 claim Claims',
      '5 claim Every claim has a source',
      '6 claim Unsupported claims are flagged.',
      '7 tier number Tier 2 lead',
    ]);
    // Not flagged: the lowercase key "claims", `claim_count`, the class name, the test id.
    expect(hits.some((hit) => hit.line === 2)).toBe(false);
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
      expect(words).not.toMatch(/_|\b(retriever|sleuth|synthesizer|epistemic|skeptic|reasoner|verifier|planner)\b/i);
      expect(words).toMatch(/^[A-Z]/);
    }
    expect(readerStageLabel('retriever_analysis')).toBe('Reading the passages');
    expect(readerStageLabel('synthesis')).toBe('Writing the report');
    expect(readerStageLabel('discovery')).toBe('Searching sources');
    expect(readerStageLabel('some_new_stage')).toBe('Working');
    expect(readerStageLabel(null)).toBe('Working');
  });
});
