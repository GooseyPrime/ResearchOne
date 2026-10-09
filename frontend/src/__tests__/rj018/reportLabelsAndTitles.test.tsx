/** @vitest-environment jsdom */
/**
 * RJ-018 items 1, 2, 6 and 8, on the page.
 *
 *  1. A report was shown under the name of an old section, and one heading was
 *     printed twice.
 *  2. Dossier cards quoted old report text with its labels:
 *     "(established_fact, Chunk 17)", "(inference, Challenger Findings)".
 *  6. A run was named after the planning step's sentence about the request.
 *  8. Dossier cards carried "V2" and "SPINOFF".
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DossierListRow, Report, ReportSection } from '../../utils/api';
import { hasReportLabels, stripReportLabels } from '../../lib/researchone/reportLabels';
import { isSectionNameTitle, looksLikePlanningAnalysis, reportDisplayTitle, titleFromRequest } from '../../utils/plainTitles';
import { isReferenceTitle, runDisplayTitle } from '../../utils/runDisplayTitle';
import { buildReaderMarkdown, shownReportSections, withoutRepeatedHeading } from '../../components/reports/reader/readerModel';
import ReaderView from '../../components/reports/reader/ReaderView';
import { DossierListCard } from '../../pages/DossiersPage';
import { timelineRowsToCsv } from '../../components/dossiers/DossiersTimelineTable';
import { customerOption, customerOptionHelp } from '../../content/customerOptions';

interface Fixture {
  labels: Array<{ name: string; input: string; report: string; preview: string }>;
  kept: string[];
  requestTitles: Array<{ request: string; title: string | null }>;
}
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', '..', 'backend', 'src', '__tests__', 'fixtures', 'reportLabelCases.json'), 'utf8')
) as Fixture;

const OLD_SECTION = 'Fram' + 'ing';
const REQUEST = 'What security measures protect the 2026 presidential election? Include paper ballots and audits.';
const ANALYSIS = 'The query requires investigating dual dimensions: (1) concrete security measures being implemented for the 2026 election and (2) their assessed effectiveness.';

afterEach(() => cleanup());

describe('labels inside old report text', () => {
  it.each(FIXTURE.labels.map((entry) => [entry.name, entry] as const))('%s is removed from what a card shows', (_name, entry) => {
    expect(stripReportLabels(entry.input)).toBe(entry.preview);
    expect(hasReportLabels(stripReportLabels(entry.input))).toBe(false);
  });

  it.each(FIXTURE.kept)('keeps an ordinary parenthesis: %s', (sentence) => {
    expect(stripReportLabels(sentence)).toBe(sentence);
    expect(hasReportLabels(sentence)).toBe(false);
  });

  it('finds each label Brandon was shown, and is safe on nothing', () => {
    for (const label of ['(established_fact, Chunk 17)', '(strong_evidence, Chunks 2, 12, 15)', '(inference, Challenger Findings)', '(speculation, Critical Notes)', '(preserved contradiction, Reasoning Output)']) {
      expect(hasReportLabels(`A sentence ${label}.`), label).toBe(true);
      expect(stripReportLabels(`A sentence ${label}.`), label).toBe('A sentence.');
    }
    expect(stripReportLabels(null)).toBe('');
    expect(stripReportLabels(undefined)).toBe('');
    expect(stripReportLabels('')).toBe('');
  });
});

describe('titles', () => {
  it.each(FIXTURE.requestTitles.map((entry) => [entry.title ?? '(none)', entry] as const))('a title made from a request: %s', (_title, entry) => {
    expect(titleFromRequest(entry.request)).toBe(entry.title);
  });

  it('a report stored under an old section name is shown under a title of its request', () => {
    for (const name of [OLD_SECTION, 'Primary Evidence', 'Contested Zones', 'Unresolved', 'Recommended Next Queries', 'Background', '**Summary**']) {
      expect(isSectionNameTitle(name), name).toBe(true);
      expect(reportDisplayTitle(name, REQUEST), name).toBe('What security measures protect the 2026 presidential election?');
    }
    expect(reportDisplayTitle('Election security in 2026', REQUEST)).toBe('Election security in 2026');
    expect(reportDisplayTitle('Framing effects in survey research', REQUEST)).toBe('Framing effects in survey research');
    // Nothing to fall back on: the stored words rather than an empty heading.
    expect(reportDisplayTitle('Primary Evidence', null)).toBe('Primary Evidence');
  });

  it("a run is never named after the planning step's sentence about the request", () => {
    expect(looksLikePlanningAnalysis(ANALYSIS)).toBe(true);
    expect(looksLikePlanningAnalysis('Election security for the 2026 presidential election')).toBe(false);
    expect(looksLikePlanningAnalysis('The question of Scottish independence')).toBe(false);
    // On main this returned the analysis sentence.
    expect(runDisplayTitle({ display_title: ANALYSIS, query: REQUEST, run_ref: 'R1-X' })).toBe('What security measures protect the 2026 presidential election?');
    expect(runDisplayTitle({ display_title: 'Election security for the 2026 presidential election', query: REQUEST })).toBe('Election security for the 2026 presidential election');
    expect(runDisplayTitle({ display_title: ANALYSIS, report_title: 'Election security in 2026', query: REQUEST })).toBe('Election security in 2026');
    expect(runDisplayTitle({ display_title: null, report_title: OLD_SECTION, query: REQUEST })).toBe('What security measures protect the 2026 presidential election?');
    expect(runDisplayTitle({ display_title: ANALYSIS, run_ref: 'R1-X' })).toBe('R1-X');
    expect(isReferenceTitle({ display_title: ANALYSIS, run_ref: 'R1-X' })).toBe(true);
    expect(isReferenceTitle({ display_title: ANALYSIS, query: REQUEST })).toBe(false);
  });
});

describe('a heading stored twice prints once', () => {
  const section = (order: number, title: string, content: string): ReportSection =>
    ({ id: `s${order}`, report_id: 'r1', section_type: 'body', title, content, section_order: order }) as ReportSection;

  /** Report a250679b as the server sends it today: the first section's old name already mapped. */
  const stored = [
    section(0, 'Background', ''),
    section(1, 'Background', '## Framing\n\n**Background**\n\nThe election is run by the states.'),
    section(2, 'What the sources show', 'Audits are required in 38 states.'),
    section(3, 'References', '1. CISA. Election security.'),
  ];
  const report = { id: 'r1', title: OLD_SECTION, query: REQUEST, status: 'finalized', sections: stored, contradiction_count: 0, source_count: 1, chunk_count: 1, created_at: '2026-01-01T00:00:00Z' } as unknown as Report;

  it('drops a heading with nothing under it, and a first line that repeats the heading', () => {
    const shown = shownReportSections(stored, OLD_SECTION);
    expect(shown.map((entry) => [entry.section.id, entry.showHeading])).toEqual([['s1', true], ['s2', true]]);
    expect(withoutRepeatedHeading('Background', stored[1].content)).toBe('The election is run by the states.');
  });

  it('prints one heading for two sections in a row that carry the same one', () => {
    const twice = [section(0, 'Background', 'First part.'), section(1, OLD_SECTION, 'Second part.'), section(2, 'Open questions', 'None.')];
    expect(shownReportSections(twice, 'A real title').map((entry) => entry.showHeading)).toEqual([true, false, true]);
  });

  it('keeps a heading-only section whose name appears nowhere else (a heading over the sections after it)', () => {
    const grouped = [section(0, 'Part one', ''), section(1, 'Costs', 'Text.')];
    expect(shownReportSections(grouped, 'A real title').map((entry) => entry.section.title)).toEqual(['Part one', 'Costs']);
  });

  it('the report page shows the request-based title and the heading once', () => {
    render(<ReaderView report={report} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What security measures protect the 2026 presidential election?');
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe(OLD_SECTION);
    // On main: the title was the old section name, and "Background" was a heading twice.
    expect(screen.getAllByRole('heading', { name: 'Background' })).toHaveLength(1);
    expect(document.body.textContent?.match(/Background/g)).toHaveLength(1);
    expect(document.body.textContent).not.toContain(OLD_SECTION);
  });

  it('the downloaded Markdown has the same title and one heading', () => {
    const markdown = buildReaderMarkdown(report);
    expect(markdown.startsWith('# What security measures protect the 2026 presidential election?\n')).toBe(true);
    expect(markdown.match(/^## Background$/gm)).toHaveLength(1);
    expect(markdown).not.toContain(OLD_SECTION);
    expect(markdown).toContain('## References');
  });
});

describe('a dossier card', () => {
  const row = (over: Partial<DossierListRow> = {}): DossierListRow =>
    ({
      dossierId: 'd1',
      runId: 'run-1',
      runStatus: 'completed',
      gateStatus: null,
      requestQuery: 'Follow up on turnout (established_fact, Chunk 17). It may repeat (speculation, Critical Notes). See Recommended Next Queries.',
      displayTitle: ANALYSIS,
      reportTitle: null,
      runRef: 'R1-20261009-0915-ABCDE-1',
      planIntent: 'investigation',
      dossierCreatedAt: '2026-10-09T13:15:00Z',
      lastActivityAt: '2026-10-09T13:15:00Z',
      versionNumber: 2,
      isSpinoff: true,
      isRevised: true,
      engineVersion: 'v2',
      ...over,
    }) as DossierListRow;

  it('shows no grade, passage or working-note label, and no old section name', () => {
    render(<DossierListCard row={row()} onOpen={vi.fn()} />);
    const text = document.body.textContent ?? '';
    // On main the preview printed the request as stored.
    expect(text).not.toMatch(/established_fact|speculation|Chunk \d|Critical Notes|Recommended Next Queries/);
    expect(screen.getByTestId('dossier-request-preview')).toHaveTextContent('Follow up on turnout. It may repeat. See Further questions.');
  });

  it('is headed by a plain title, never the planning sentence', () => {
    render(<DossierListCard row={row({ requestQuery: REQUEST })} onOpen={vi.fn()} />);
    expect(document.body.textContent).not.toContain('The query requires');
    expect(screen.getAllByText('What security measures protect the 2026 presidential election?').length).toBeGreaterThan(0);
  });

  it('carries plain labels from the registry, each with its description and example, and no engine code', () => {
    render(<DossierListCard row={row()} onOpen={vi.fn()} />);
    const badges = screen.getByTestId('dossier-badges');
    const followUp = customerOption('dossier_badge', 'spinoff');
    const revised = customerOption('dossier_badge', 'revised');
    const version = customerOption('dossier_badge', 'version');
    expect(followUp.name).toBe('Follow-up research');
    expect(within(badges).getByText(followUp.name)).toHaveAttribute('title', customerOptionHelp(followUp));
    expect(within(badges).getByText(revised.name)).toHaveAttribute('title', customerOptionHelp(revised));
    expect(within(badges).getByText(`${version.name} 2`)).toHaveAttribute('title', customerOptionHelp(version));
    // On main: "v2" (printed in capitals as V2, twice: the engine code and the version) and "Spinoff".
    expect(badges.textContent).not.toMatch(/\bv2\b|spinoff/i);
  });

  it('the timeline download writes the event in words and no engine code', () => {
    const csv = timelineRowsToCsv([
      { occurredAt: '2026-10-09T13:15:00Z', eventType: 'research_spinoff', dossierId: 'd1', query: 'Turnout (strong_evidence, Chunks 2, 12, 15)', revisionNumber: null, engineVersion: 'v2', runStatus: 'completed', reportId: 'r1', runId: 'run-1' },
    ] as Parameters<typeof timelineRowsToCsv>[0]);
    expect(csv).toContain('Follow-up research');
    expect(csv).not.toMatch(/v2|engineVersion|research_spinoff|strong_evidence|Chunks/);
  });
});
