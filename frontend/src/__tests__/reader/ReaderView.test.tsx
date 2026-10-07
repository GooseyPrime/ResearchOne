/** @vitest-environment jsdom */
/**
 * Slice 5 acceptance: the reading page.
 * - A fixture report holding tier tags, [Chunk N] markers, internal step names,
 *   `under_review` and the old front-matter text shows none of them on the
 *   Report tab; the Evidence tab shows strength in words.
 * - Hovering a citation shows the quoted passage.
 * - A legacy fixture with unmapped [Chunk N] markers renders no "Chunk".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ReaderView from '../../components/reports/reader/ReaderView';
import { legacyNumbersFrom, linkCitations, parseReferences, sectionRole, tabsFor, type ReaderEvidence } from '../../components/reports/reader/readerModel';
import type { Report } from '../../utils/api';

afterEach(cleanup);

const section = (order: number, title: string, content: string, type = 'body') => ({ id: `s${order}`, section_type: type, title, content, section_order: order });

const report: Report = {
  id: 'r1',
  title: 'Why nuclear plants cost more in the United States',
  query: 'why',
  status: 'under_review',
  contradiction_count: 0,
  source_count: 2,
  chunk_count: 9,
  created_at: '2026-10-07T00:00:00Z',
  reader_view: true,
  sections: [
    section(0, 'Why nuclear plants cost more in the United States', ''),
    section(1, 'Summary', 'Costs rose after 1979 [1]. Korea built in pairs [2].'),
    section(2, 'How the costs grew', 'Overnight costs reached about $8,000 per kilowatt [1][2]. A later estimate agrees [1].'),
    section(3, 'References', '1. IFP. Why does construction cost so much? 2023. https://ifp.org/a\n2. Vox. Why America abandoned nuclear power. 2016. https://vox.com/b'),
    section(4, 'About this report', '2 sources were read on 6 Oct 2026.'),
    section(5, 'Challenge', 'The strongest objection is that Korean figures are unaudited [2].', 'challenge'),
  ],
};

const evidence: ReaderEvidence = {
  status: { word: 'Needs review', reason: 'The report did not deliver everything the request asked for. It has been kept for review rather than finalised.' },
  sources: [
    { id: 'src1', title: 'Why does construction cost so much?', publisher: 'IFP', authors: ['B. Potter'], date: '2023-05-01', url: 'https://ifp.org/a', kind: 'web page', notice: null },
    { id: 'src2', title: 'Why America abandoned nuclear power', publisher: 'Vox', authors: [], date: '2016-02-29', url: 'https://vox.com/b', kind: 'news article', notice: null },
  ],
  citations: [
    { sectionId: 's1', number: 1, order: 0, quote: 'costs rose sharply after 1979', sourceId: 'src1' },
    { sectionId: 's1', number: 2, order: 1, quote: 'built in pairs by a single utility', sourceId: 'src2' },
    { sectionId: 's2', number: 1, order: 2, quote: 'approximately $8,000 per kilowatt', sourceId: 'src1' },
    { sectionId: 's2', number: 2, order: 3, quote: 'a fraction of the American cost', sourceId: 'src2' },
    { sectionId: 's2', number: 1, order: 4, quote: 'a later estimate of the same order', sourceId: 'src1' },
    { sectionId: 's5', number: 2, order: 5, quote: 'figures derive from utility reports', sourceId: 'src2' },
  ],
  findings: [{ text: 'US overnight costs reached about $8,000 per kilowatt.', strength: 'Strongly supported by the sources', sourceIds: ['src1'], quotes: ['approximately $8,000 per kilowatt'] }],
};

const NEVER = /established_fact|strong_evidence|testimony|inference|speculation|under_review|chunk|quantitative_quality_auditor|This report synthesizes evidence|contradictions|falsification/i;

describe('the Report tab', () => {
  it('shows the report in order and nothing from the never-list', () => {
    render(<ReaderView report={report} evidence={evidence} method={<p>Generation trace and model names</p>} />);
    const panel = screen.getByRole('tabpanel');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(report.title);
    expect(within(panel).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual(['Summary', 'How the costs grew', 'References']);
    expect(panel.textContent).toContain('2 sources were read on 6 Oct 2026.');
    expect(document.body.textContent).not.toMatch(NEVER);
    // The Challenge and the technical record are on their own tabs.
    expect(panel.textContent).not.toContain('strongest objection');
    expect(panel.textContent).not.toContain('Generation trace');
  });

  it('says the status in words with a plain reason, never the stored value', () => {
    render(<ReaderView report={report} evidence={evidence} />);
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText(/has been kept for review/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('under_review');
  });

  it('cleans a fixture that still carries labels: no "Chunk", mapped labels become reader numbers', () => {
    const dirty: Report = {
      ...report,
      sections: [section(1, 'Summary', 'Costs rose after 1979 [Chunk 7]. Korea built in pairs (Chunk 12). An aside (Chunks 3, 4) and Chunk 9 too.')],
    };
    const legacy = legacyNumbersFrom([
      { citation_text: '[Chunk 7]', source_id: 'src1', citation_order: 0 },
      { citation_text: 'Chunk 12', source_id: 'src2', citation_order: 1 },
    ]);
    const numbered: ReaderEvidence = { ...evidence, citations: [{ sectionId: 's1', number: 1, order: 0, quote: 'q1', sourceId: 'src1' }, { sectionId: 's1', number: 2, order: 1, quote: 'q2', sourceId: 'src2' }] };
    render(<ReaderView report={dirty} evidence={numbered} legacyNumbers={legacy} />);
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).not.toMatch(/chunk/i);
    expect(within(panel).getByRole('button', { name: /Citation 1/ })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: /Citation 2/ })).toBeTruthy();
    expect(panel.textContent).toContain('An aside and too.');
  });

  it('a legacy report with unmapped labels renders no "Chunk"', () => {
    const legacyReport: Report = { ...report, sections: [section(1, 'Findings', 'The plant opened in 1932 [Chunk 4]. It closed in 1960 (Chunk 5).')] };
    render(<ReaderView report={legacyReport} />);
    expect(document.body.textContent).not.toMatch(/chunk/i);
    expect(screen.getByRole('tabpanel').textContent).toContain('The plant opened in 1932. It closed in 1960.');
  });
});

describe('citations', () => {
  it('hovering a number shows the source and the quoted passage behind that sentence', () => {
    render(<ReaderView report={report} evidence={evidence} />);
    const markers = screen.getAllByRole('button', { name: /Citation 1: Why does construction cost so much\?/ });
    // Summary [1], then the two [1] in the body: each is its own occurrence.
    expect(markers).toHaveLength(3);
    fireEvent.mouseEnter(markers[1].parentElement!);
    const card = screen.getByRole('tooltip');
    expect(card.textContent).toContain('approximately $8,000 per kilowatt');
    expect(card.textContent).toContain('IFP · 1 May 2023');
    expect(within(card).getByRole('link', { name: 'Go to reference 1' }).getAttribute('href')).toBe('#reference-1');
    fireEvent.mouseLeave(markers[1].parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    // The second [1] in the same section is the later passage, not the first again.
    fireEvent.mouseEnter(markers[2].parentElement!);
    expect(screen.getByRole('tooltip').textContent).toContain('a later estimate of the same order');
  });

  it('opens on keyboard focus and on a tap, and closes on Escape', () => {
    render(<ReaderView report={report} evidence={evidence} />);
    const marker = screen.getAllByRole('button', { name: /Citation 2/ })[0];
    fireEvent.focus(marker);
    expect(screen.getByRole('tooltip').textContent).toContain('built in pairs by a single utility');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(marker);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(marker.getAttribute('aria-expanded')).toBe('true');
  });

  it('a second tap closes the card it opened', () => {
    render(<ReaderView report={report} evidence={evidence} />);
    const marker = screen.getAllByRole('button', { name: /Citation 2/ })[0];
    fireEvent.click(marker);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(marker);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('each reference entry is the target its number links to', () => {
    render(<ReaderView report={report} evidence={evidence} />);
    expect(document.getElementById('reference-1')?.textContent).toContain('IFP. Why does construction cost so much?');
    expect(document.getElementById('reference-2')?.textContent).toContain('Vox.');
  });
});

describe('before the page data arrives', () => {
  it('shows the report text and claims no status', () => {
    render(<ReaderView report={report} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(report.title);
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.getByRole('tabpanel').textContent).toContain('Costs rose after 1979 [1].');
  });
});

describe('the page shows one view or the other', () => {
  it('the old cards are in the branch a reader-view report never renders', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const page = readFileSync(join(__dirname, '../../pages/ReportDetailPage.tsx'), 'utf8');
    const reader = page.indexOf('{readerView ? (');
    const legacy = page.indexOf(') : (', reader);
    expect(reader).toBeGreaterThan(0);
    expect(page.slice(reader, legacy)).toContain('<ReaderView');
    for (const card of ['Falsification Criteria', 'label="Report status"', 'label="Run reference"', 'Unresolved Questions', 'evidence chunks', 'contradictions found']) {
      expect(page.indexOf(card), card).toBeGreaterThan(legacy);
      expect(page.slice(reader, legacy)).not.toContain(card);
    }
    expect(page).toContain('{!readerView && generationTrace}');
  });
});

describe('the other tabs', () => {
  it('Evidence shows each finding with its strength in words, its passage and its source', () => {
    render(<ReaderView report={report} evidence={evidence} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('US overnight costs reached about $8,000 per kilowatt.');
    expect(panel.textContent).toContain('Strongly supported by the sources');
    expect(panel.textContent).toContain('approximately $8,000 per kilowatt');
    expect(panel.textContent).toContain('Why does construction cost so much?');
    expect(panel.textContent).not.toMatch(/strong_evidence|tier/i);
  });

  it('Evidence lists each cited passage with its source when the run stored no findings', () => {
    render(<ReaderView report={report} evidence={{ ...evidence, findings: [] }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('Each passage this report cites');
    expect(panel.textContent).toContain('costs rose sharply after 1979');
    expect(panel.textContent).toContain('Why America abandoned nuclear power');
  });

  it('Sources lists every source with its details and kind in words', () => {
    render(<ReaderView report={report} evidence={evidence} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Sources' }));
    const items = within(screen.getByRole('tabpanel')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('B. Potter · IFP · 1 May 2023');
    expect(items[1].textContent).toContain('news article');
  });

  it('How this was researched holds the technical record; Challenge holds the Challenge section', () => {
    render(<ReaderView report={report} evidence={evidence} method={<p>Generation trace and model names</p>} />);
    fireEvent.click(screen.getByRole('tab', { name: 'How this was researched' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('Generation trace and model names');
    fireEvent.click(screen.getByRole('tab', { name: 'Challenge' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('strongest objection');
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /Citation 2/ })).toBeTruthy();
  });

  it('a report with no Challenge section has no Challenge tab', () => {
    const plain = { ...report, sections: report.sections!.slice(0, 5) };
    render(<ReaderView report={plain} evidence={evidence} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Report', 'Evidence', 'Sources', 'How this was researched']);
  });
});

describe('the model', () => {
  it('sorts sections onto tabs', () => {
    const roles = report.sections!.map((entry) => sectionRole(entry, report.title));
    expect(roles).toEqual(['title', 'report', 'report', 'references', 'about', 'challenge']);
    expect(tabsFor(report.sections!, report.title)).toContain('challenge');
  });

  it('reads the reference list, joining a wrapped entry', () => {
    expect(parseReferences('1. A. Title.\n   continued\n[2] B. Other.')).toEqual([{ number: 1, text: 'A. Title. continued' }, { number: 2, text: 'B. Other.' }]);
  });

  it('links grouped numbers, leaves code and unknown numbers alone', () => {
    const linked = linkCitations('Both agree [1, 2]. Code `[1]` stays. Unknown [9].', 's1', evidence.citations);
    expect(linked).toBe('Both agree [1](#cite-0)[2](#cite-1). Code `[1]` stays. Unknown [9].');
  });
});
