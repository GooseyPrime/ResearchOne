/**
 * RJ-018 items 1 and 6. A report was shown under the title of an old section
 * ("the first heading of the removed layout"), and a run under the planning
 * step's own sentence about the request. A title a customer sees comes from the
 * report's real title, from the short plain title the planning step writes, or
 * from the request.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  looksLikePlanningAnalysis,
  isSectionNameTitle,
  plainRunTitle,
  readerReportTitle,
  titleFromRequest,
} from '../services/research/titleShaping';
import { presentForReader } from '../services/formatting/reportPresentation';
import { exportTitleBlock } from '../services/formatting/exportOrchestrator';
import { looksLikeStructuralLabel } from '../services/reasoning/reportGenerator';

const OLD_SECTION_NAMES = ['Fram' + 'ing', 'Primary Evidence', 'Contested Zones', 'Unresolved', 'Unresolved Questions', 'Recommended Next Queries', 'Evidence Ledger', 'Contradiction Analysis', 'Falsification Criteria', 'Research Question and Scope'];
const REQUEST = 'What security measures protect the 2026 presidential election? Include paper ballots and audits.';
const ANALYSIS = 'The query requires investigating dual dimensions: (1) concrete security measures being implemented for the 2026 election and (2) their assessed effectiveness.';

describe('a report title is never an old section name', () => {
  it.each(OLD_SECTION_NAMES)('%s is read as a section name, not a title', (name) => {
    expect(isSectionNameTitle(name)).toBe(true);
    expect(isSectionNameTitle(`**${name}**`.replace(/\*/g, ''))).toBe(true);
    expect(readerReportTitle(name, REQUEST)).toBe('What security measures protect the 2026 presidential election?');
    expect(readerReportTitle(`# ${name}`.replace('# ', ''), REQUEST)).not.toBe(name);
  });

  it('a real title is shown as stored', () => {
    expect(readerReportTitle('Election security for the 2026 presidential election', REQUEST)).toBe('Election security for the 2026 presidential election');
    expect(readerReportTitle('Framing effects in survey research', REQUEST)).toBe('Framing effects in survey research');
  });

  it('with no request to fall back on, the stored words are kept rather than nothing', () => {
    expect(readerReportTitle('Primary Evidence', null)).toBe('Primary Evidence');
    expect(readerReportTitle('', REQUEST)).toBe('What security measures protect the 2026 presidential election?');
    expect(readerReportTitle(null, null)).toBeNull();
  });

  it('the report, the report list, a dossier card and an export all show the request-based title', () => {
    const report = presentForReader({ id: 'a250679b', title: OLD_SECTION_NAMES[0], query: REQUEST, sections: [{ title: OLD_SECTION_NAMES[0], content: 'Text.', section_order: 1 }] });
    expect(report.title).toBe('What security measures protect the 2026 presidential election?');
    // The section keeps its own heading mapping; only the report's title falls back on the request.
    expect(report.sections[0].title).toBe(OLD_SECTION_NAMES[0]);

    const list = presentForReader([{ id: 'r1', title: 'Contested Zones', query: REQUEST }]);
    expect(list[0].title).toBe('What security measures protect the 2026 presidential election?');

    const cards = presentForReader({ rows: [{ reportTitle: 'Primary Evidence', displayTitle: null, requestQuery: REQUEST }] }, { title: 'not-report' });
    expect(cards.rows[0].reportTitle).toBe('What security measures protect the 2026 presidential election?');

    expect(exportTitleBlock(OLD_SECTION_NAMES[0], REQUEST)).toBe('---\ntitle: "What security measures protect the 2026 presidential election?"\n---\n\n');
    expect(exportTitleBlock('Election security in 2026', REQUEST)).toBe('---\ntitle: "Election security in 2026"\n---\n\n');
  });
});

describe('the two lists of section names agree', () => {
  it('every name the report writer refuses as a title is refused on reading too', () => {
    const refused = ['Dimensions Table', 'Dimension Table', 'Comparison Table', 'Ranking Table', 'Summary Table', 'Data Table', 'Recommendation', 'Overview', 'Introduction', 'Findings', 'Analysis', 'Conclusion', 'Results', 'Executive Summary', 'Methodology', 'Background', 'Appendix', 'References', 'Bibliography', ...OLD_SECTION_NAMES.slice(0, 5)];
    for (const name of refused) {
      expect(looksLikeStructuralLabel(name), name).toBe(true);
      expect(isSectionNameTitle(name), name).toBe(true);
    }
    expect(isSectionNameTitle('Recommendation Framework for small clinics')).toBe(false);
  });
});

describe("a run's title is a short plain title of the question", () => {
  it("recognises the planning step's sentence about the request", () => {
    expect(looksLikePlanningAnalysis(ANALYSIS)).toBe(true);
    expect(looksLikePlanningAnalysis('The query requires investigating dual dimensions')).toBe(true);
    expect(looksLikePlanningAnalysis('This request asks whether remote work lowers productivity')).toBe(true);
    expect(looksLikePlanningAnalysis("The user's question spans regulation and enforcement")).toBe(true);
    for (const plain of ['Election security for the 2026 presidential election', 'The question of Scottish independence', 'Requests for asylum in 2024', 'The Query Language Handbook: a review', null, '']) {
      expect(looksLikePlanningAnalysis(plain), String(plain)).toBe(false);
    }
  });

  it("uses the planning step's short title when it is one", () => {
    expect(plainRunTitle('Election security for the 2026 presidential election', REQUEST)).toBe('Election security for the 2026 presidential election');
    expect(plainRunTitle('"Election security in 2026."', REQUEST)).toBe('Election security in 2026');
  });

  it('uses the request when there is no plain title', () => {
    for (const notATitle of [undefined, null, '', '   ', ANALYSIS, 'Overview', 'Primary Evidence', 'x'.repeat(140)]) {
      expect(plainRunTitle(notATitle, REQUEST), String(notATitle)).toBe('What security measures protect the 2026 presidential election?');
    }
    expect(plainRunTitle(ANALYSIS, null)).toBeNull();
  });

  it('a title made from a long structured request is its opening heading or first sentence, cut to title length', () => {
    expect(titleFromRequest('# Research Objective: Rank the 20 best affiliate programs\n\n## Scope\nUS only.')).toBe('Research Objective: Rank the 20 best affiliate programs');
    const long = titleFromRequest(`${'Compare the long-run costs of nuclear and solar power across forty countries and '.repeat(4)}.`);
    expect(long?.length).toBeLessThanOrEqual(120);
    expect(titleFromRequest('   ')).toBeNull();
  });

  it('a run already stored under the analysis sentence is sent under a title of its request', () => {
    const run = presentForReader({ id: '6622a18a', title: REQUEST.slice(0, 200), query: REQUEST, display_title: ANALYSIS }, { title: 'not-report' });
    expect(run.display_title).toBe('What security measures protect the 2026 presidential election?');
    // What the person typed is never rewritten.
    expect(run.query).toBe(REQUEST);
    expect(run.title).toBe(REQUEST.slice(0, 200));

    const cards = presentForReader({ rows: [{ displayTitle: ANALYSIS, reportTitle: null, requestQuery: REQUEST }] }, { title: 'not-report' });
    expect(cards.rows[0].displayTitle).toBe('What security measures protect the 2026 presidential election?');

    // With no request on the row there is no title to make: null, so the page falls back further.
    expect(presentForReader({ display_title: ANALYSIS }, { title: 'not-report' }).display_title).toBeNull();
    expect(presentForReader({ display_title: 'Election security in 2026', query: REQUEST }, { title: 'not-report' }).display_title).toBe('Election security in 2026');
  });
});

describe('a title made from a request', () => {
  const cases = (JSON.parse(readFileSync(join(__dirname, 'fixtures', 'reportLabelCases.json'), 'utf8')) as { requestTitles: Array<{ request: string; title: string | null }> }).requestTitles;

  it.each(cases.map((entry) => [entry.title ?? '(none)', entry] as const))('%s', (_title, entry) => {
    // The page makes the same title from the same request (frontend/src/utils/plainTitles.ts).
    expect(titleFromRequest(entry.request)).toBe(entry.title);
  });
});
