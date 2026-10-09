/** @vitest-environment jsdom */
/**
 * The plain report is the only report (8 Oct 2026).
 *
 * These are the guards for what a customer is shown. Each one fails on the
 * layout that was removed:
 *  - the report page and a dossier's Report tab never print the old section
 *    names, the old cards, a stored status value, or a trace of the run, for a
 *    report of any age;
 *  - nothing the backend sends, and no setting, selects another layout;
 *  - challenge material is on the "Double-check" tab and nowhere else;
 *  - a run's status is in plain words wherever a customer reads it.
 *
 * The fixture is a report as the old layout stored it: its section names, the
 * heading repeated at the top of each section, the stand-in summary, the three
 * cards, the template sentence quoting the request, grade values on its
 * citations, a status of `under_review` and a run that kept its trace.
 */
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Report } from '../../utils/api';

const oldSection = (order: number, title: string, body: string, type = 'body') => ({
  id: `s${order}`,
  section_type: type,
  title,
  // The old layout stored the heading a second time, at the top of the text.
  content: `## ${title}\n\n${body}`,
  section_order: order,
});

const OLD_REPORT: Report = {
  id: 'r-old',
  title: 'Port expansion and the 2019 tender',
  query: 'Investigate whether the 2019 port tender was awarded properly and what the reco',
  status: 'under_review',
  run_id: 'run-1',
  executive_summary: '',
  falsification_criteria:
    'Evidence directly contradicting the core claims or mechanism proposed in response to the query "Investigate whether the 2019 port tender was awarded properly and what the reco" would disprove this report\'s conclusions.',
  unresolved_questions: ['Who signed the second amendment?'],
  recommended_queries: ['port tender amendment 2020'],
  contradiction_count: 0,
  source_count: 7,
  chunk_count: 26,
  created_at: '2026-10-08T22:00:00Z',
  // What the backend sent while the switch existed and was off.
  reader_view: false,
  metadata: {
    reader_front_matter: {
      overall_summary:
        'This report synthesizes evidence from 7 sources and 26 evidence chunks to evaluate the core research question. The current evidence set does not surface explicit contradiction pairs, but conclusions remain conditional on corpus coverage.',
      conclusions_nutshell: 'The current evidence set does not surface explicit contradiction pairs, but conclusions remain conditional on corpus coverage.',
      metric_glosses: [
        { label: 'Contradictions', value: '0', narrative: 'No explicit claim conflicts were detected in this run; this does not prove harmony, only that no direct contradiction pairs were extracted.' },
        { label: 'Counterevidence / Falsification', value: 'Defined', narrative: "This report's conclusions would be falsified by: Evidence directly contradicting the core claims." },
        { label: 'Evidence coverage', value: '26 chunks / 7 sources', narrative: '7 sources and 26 chunks were reviewed; broader coverage can still change the confidence profile of conclusions.' },
      ],
    },
    double_check_mode: 'gate',
    double_check_annotations: [{ claim: 'The award was proper', critique: 'A single ministry press notice supports it.' }],
    output_template_id: 'intent_investigation',
  },
  sections: [
    oldSection(1, 'Framing', 'The port authority opened the tender in March 2019 [Chunk 2].'),
    oldSection(2, 'Primary Evidence', 'The award notice names one bidder (Chunk 5).'),
    oldSection(3, 'Contested Zones', 'The ministry and the auditor give different dates [Chunk 9].'),
    oldSection(4, 'Unresolved', 'The second amendment has not been published.'),
    oldSection(5, 'Falsification Criteria', 'A published evaluation sheet scoring a second bidder higher would change the account above.', 'falsification_criteria'),
  ],
};

const RUN = {
  id: 'run-1',
  status: 'failed',
  run_ref: 'R1-ABCD-1234',
  query: OLD_REPORT.query,
  created_at: '2026-10-08T21:40:00Z',
  completed_at: '2026-10-08T22:00:00Z',
  failure_meta: { gate_status: 'completed_degraded' },
  progress_events: [
    { stage: 'retrieval', percent: 30, message: 'Retrieved 26 chunks', timestamp: '2026-10-08T21:45:00Z' },
    { stage: 'challenge', percent: 65, message: 'Arguing against the draft to find weak claims...', timestamp: '2026-10-08T21:50:00Z' },
  ],
};

const READER = {
  status: { word: 'Finished with fewer sources than planned', reason: 'This report was written from fewer sources than planned for this request.' },
  sources: [{ id: 'src1', title: 'Award notice 2019/44', publisher: 'Port Authority', authors: [], date: '2019-06-01', url: 'https://example.org/notice', kind: 'government page', notice: null }],
  citations: [{ sectionId: 's1', number: 1, order: 0, quote: 'the tender opened on 4 March 2019', sourceId: 'src1' }],
  findings: [],
  legacyLabels: { '2': 1 },
};

const CITATIONS = [{ id: 'c1', citation_text: '[Chunk 2]', source_title: 'Award notice 2019/44', source_url: 'https://example.org/notice', evidence_tier: 'strong_evidence', stance: 'supports', source_id: 'src1', citation_order: 0 }];

const state = vi.hoisted(() => ({ report: null as unknown, isAdmin: false }));

vi.mock('../../utils/api', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url === '/auth/me') return { data: { userId: 'u1', isAdmin: state.isAdmin } };
      if (url.endsWith('/citations')) return { data: CITATIONS };
      if (url.endsWith('/reader')) return { data: READER };
      return { data: null };
    }),
  },
  getReport: vi.fn(async () => state.report),
  getReportRevision: vi.fn(async () => null),
  getReportRevisions: vi.fn(async () => []),
  publishReportFeatured: vi.fn(),
  getResearchRun: vi.fn(async () => RUN),
  getRunArtifacts: vi.fn(async () => ({ progressEvents: RUN.progress_events, modelLog: [{ role: 'section_drafter', model: 'm', promptTokens: 1, completionTokens: 1 }], plan: {} })),
  extractApiError: (err: unknown) => String(err),
}));
vi.mock('../../utils/socket', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), subscribeToJob: vi.fn() }));
vi.mock('../../store/useStore', () => ({ useStore: () => ({ addNotification: vi.fn() }) }));
vi.mock('../../components/monitors/MonitorToggle', () => ({ default: () => null }));
vi.mock('../../components/reports/ReportExportButton', () => ({ default: () => null }));
vi.mock('../../components/research/AttachmentDropZone', () => ({ default: () => null }));
vi.mock('../../components/reports/ReportForkActions', () => ({ default: () => null }));

import ReportDetailPage from '../../pages/ReportDetailPage';
import DossierReportSection from '../../components/dossiers/DossierReportSection';
import { timelineRowsToCsv } from '../../components/dossiers/DossiersTimelineTable';
import DossierStatusBadge from '../../components/dossiers/DossierStatusBadge';
import DossierStatisticsSection from '../../components/dossiers/DossierStatisticsSection';
import { TAB_LABELS } from '../../components/reports/reader/readerModel';

afterEach(cleanup);
beforeEach(() => {
  state.report = OLD_REPORT;
  state.isAdmin = false;
});

/** The words of the layout that was removed, and the stored values no customer reads. */
const OLD_LAYOUT = [
  'Framing',
  'Primary Evidence',
  'Contested Zones',
  'Unresolved',
  'Falsification',
  'Contradictions',
  'evidence chunks',
  'conditional on corpus coverage',
  'synthesizes evidence',
  'No mapped citations',
  'Evidence coverage',
  'claim conflicts',
  'Counterevidence',
  'would disprove',
  'Output layout',
];
const RAW_STATUS = ['under_review', 'completed_degraded', 'contract_failed', 'verification_failed', 'plan_pending_confirmation', 'no_evidence', 'finalized', 'COMPLETED DEGRADED', 'CONTRACT FAILED'];
const RUN_TRACE = ['Generation trace', 'orchestrator', 'run summary', 'Retrieved 26 chunks', 'Arguing against the draft', 'section_drafter', 'strong_evidence', 'tier:', 'stance:', 'Chunk'];

function expectNone(text: string, where: string): void {
  for (const word of [...OLD_LAYOUT, ...RAW_STATUS, ...RUN_TRACE]) {
    expect(text.toLowerCase(), `${where}: "${word}"`).not.toContain(word.toLowerCase());
  }
}

function wrap(children: ReactNode, path = '/app/reports/r-old') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

async function openReportPage(): Promise<void> {
  render(
    wrap(
      <Routes>
        <Route path="/app/reports/:id" element={<ReportDetailPage />} />
      </Routes>
    )
  );
  await screen.findByRole('heading', { level: 1, name: OLD_REPORT.title });
  // The page's own data has arrived: the status in words, and the mapped citation.
  await screen.findByText('Finished with fewer sources than planned');
}

describe('the customer report page', () => {
  it('shows an old report under reader headings, with none of the old layout, on every tab', async () => {
    await openReportPage();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Background',
      'What the sources show',
      'Where sources disagree',
      'Open questions',
    ]);
    // The heading the old layout stored a second time is printed once.
    expect(panel.textContent?.match(/Background/g)).toHaveLength(1);
    // The report's own words are all still there.
    expect(panel.textContent).toContain('The port authority opened the tender in March 2019');
    expect(panel.textContent).toContain('The second amendment has not been published.');
    // A label the saved citations map becomes its number; one they do not is taken out.
    await waitFor(() => expect(within(panel).getByRole('button', { name: /Citation 1/ })).toBeTruthy());
    expect(panel.textContent).toContain('The award notice names one bidder.');

    expectNone(document.body.textContent ?? '', 'Report tab');
    for (const tab of screen.getAllByRole('tab')) {
      fireEvent.click(tab);
      expectNone(document.body.textContent ?? '', `${tab.textContent} tab`);
    }
  });

  it('renders no trace of the run for a customer, and none for an administrator either: the page has no such panel', async () => {
    for (const isAdmin of [false, true]) {
      state.isAdmin = isAdmin;
      await openReportPage();
      fireEvent.click(screen.getByRole('tab', { name: 'How this was researched' }));
      const panel = screen.getByRole('tabpanel');
      expect(panel.textContent).toContain('Original research request');
      await waitFor(() => expect(panel.textContent).toContain('R1-ABCD-1234'));
      expect(screen.queryByText(/generation trace/i)).toBeNull();
      expect(screen.queryByText(/events$/)).toBeNull();
      expectNone(document.body.textContent ?? '', `method tab, admin=${isAdmin}`);
      cleanup();
    }
  });

  it('puts challenge material on the Double-check tab only, in the report\'s own prose', async () => {
    await openReportPage();
    expect(TAB_LABELS.challenge).toBe('Double-check');
    const reportPanel = screen.getByRole('tabpanel');
    expect(reportPanel.textContent).not.toContain('evaluation sheet');
    fireEvent.click(screen.getByRole('tab', { name: 'Double-check' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel.textContent).toContain('A published evaluation sheet scoring a second bidder higher would change the account above.');
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('What would change these findings');
    // The template sentence that quoted the request is not challenge material and is shown nowhere.
    expect(document.body.textContent).not.toContain('Investigate whether the 2019 port tender was awarded properly and what the reco" would');
  });

  it('a report with no challenge material has no Double-check tab', async () => {
    state.report = { ...OLD_REPORT, sections: OLD_REPORT.sections!.slice(0, 4) };
    await openReportPage();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Report', 'Evidence', 'Sources', 'How this was researched']);
  });
});

describe('no setting brings the old layout back', () => {
  it.each([
    ['the backend says reader_view false', { reader_view: false }],
    ['the backend sends no reader_view at all', { reader_view: undefined }],
    ['the backend says reader_view true', { reader_view: true }],
  ])('the page is the same when %s', async (_name, patch) => {
    vi.stubEnv('VITE_READER_VIEW_ENABLED', 'false');
    vi.stubEnv('VITE_BASELINE_LAYER_ENABLED', 'false');
    vi.stubEnv('VITE_CITATION_LOCK_ENABLED', 'false');
    state.report = { ...OLD_REPORT, ...patch };
    await openReportPage();
    expect(screen.getByRole('tablist', { name: 'Report views' })).toBeTruthy();
    expect(within(screen.getByRole('tabpanel')).getAllByRole('heading', { level: 2 })[0].textContent).toBe('Background');
    expectNone(document.body.textContent ?? '', String(_name));
    vi.unstubAllEnvs();
  });
});

describe('a dossier\'s Report tab', () => {
  it('shows the same reader body: no old section names, no outline card, no side panel of notes, no stored status', () => {
    render(wrap(<DossierReportSection report={OLD_REPORT} reportLoading={false} reportError={null} fullReportHref="/app/reports/r-old" />));
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Background',
      'What the sources show',
      'Where sources disagree',
      'Open questions',
    ]);
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(document.body.textContent).not.toContain('evaluation sheet');
    expect(document.body.textContent).not.toContain('A single ministry press notice');
    expect(document.body.textContent).not.toMatch(/Challenge notes|Cross-check/);
    expectNone(document.body.textContent ?? '', 'dossier Report tab');
  });

  it('keeps an older report\'s citations as reader numbers instead of dropping them', async () => {
    render(wrap(<DossierReportSection report={OLD_REPORT} reportLoading={false} reportError={null} fullReportHref="/app/reports/r-old" />));
    await waitFor(() => expect(document.body.textContent).toContain('opened the tender in March 2019 [1]'));
    expect(document.body.textContent).not.toMatch(/Chunk \d/);
    expectNone(document.body.textContent ?? '', 'dossier Report tab with citations');
  });
});

describe('the timeline download', () => {
  it('writes each run status in plain words, never the stored value', () => {
    const csv = timelineRowsToCsv([
      { occurredAt: '2026-10-08T22:00:00Z', eventType: 'run', dossierId: 'd1', query: 'q', revisionNumber: null, engineVersion: 'v2', runStatus: 'completed_degraded', reportId: 'r1', runId: 'run-1' },
    ] as Parameters<typeof timelineRowsToCsv>[0]);
    expect(csv).toContain('Finished with fewer sources than planned');
    expectNone(csv, 'timeline download');
  });
});

describe('statuses a customer reads', () => {
  it('the dossier badge says each outcome in plain words, never the stored value', () => {
    const shown = (status: string, gateStatus?: string): string => {
      const { container } = render(<DossierStatusBadge status={status} gateStatus={gateStatus} />);
      const text = container.textContent ?? '';
      cleanup();
      return text;
    };
    expect(shown('completed')).toBe('Ready');
    expect(shown('failed', 'completed_degraded')).toBe('Finished with fewer sources than planned');
    expect(shown('failed', 'contract_failed')).toBe('Needs review: part of the request is missing');
    expect(shown('failed', 'verification_failed')).toBe('Needs review: did not pass checking');
    expect(shown('running')).toBe('In progress');
    expect(shown('plan_pending_confirmation')).toBe('Waiting for you to confirm the plan');
    for (const [status, gate] of [['failed', 'completed_degraded'], ['failed', 'contract_failed'], ['failed', 'verification_failed'], ['failed', 'no_evidence'], ['aborted', undefined], ['some_new_value', undefined]] as const) {
      const text = shown(status, gate);
      expect(text, `${status}/${gate}`).not.toMatch(/_|DEGRADED|CONTRACT|FAILED/);
      expectNone(text, `${status}/${gate}`);
    }
  });

  it('a dossier\'s statistics show a customer no steps, token counts or counts from the check of the report', async () => {
    const stats = {
      totalDurationMs: 252000,
      tokensInput: 81234,
      tokensOutput: 9021,
      sourcesCitedCount: 5,
      sourcesRetrievedCount: 7,
      strongestFormPassCount: 2,
      doubleCheckAnnotationsCount: 4,
      contradictionsCount: 0,
      agentsRan: JSON.stringify(['planner', 'retriever', 'double_check', 'section_drafter']),
      agentsSkipped: JSON.stringify(['market_scout']),
      sourceClassBreakdown: { consensus_held: 5 },
      stageDurations: { _profileDisplayName: 'Investigation' },
    } as unknown as Parameters<typeof DossierStatisticsSection>[0]['stats'];
    render(wrap(<DossierStatisticsSection stats={stats} planIntent="investigation" />));
    expect(screen.getByText('Time taken')).toBeTruthy();
    expect(screen.getByText('4 min 12 s')).toBeTruthy();
    expect(screen.getByText('Sources read')).toBeTruthy();
    const text = document.body.textContent ?? '';
    for (const technical of ['tokens', '81234', 'planner', 'section_drafter', 'double_check', 'market_scout', 'Steps that ran', 'Contradictions', 'consensus']) {
      expect(text.toLowerCase(), technical).not.toContain(technical.toLowerCase());
    }
    cleanup();
    // An administrator still has the record, under plain labels.
    state.isAdmin = true;
    render(wrap(<DossierStatisticsSection stats={stats} planIntent="investigation" />));
    await screen.findByText('Steps that ran');
    expect(screen.getByText('Points where sources conflict')).toBeTruthy();
    expect(document.body.textContent).not.toContain('Contradictions');
  });
});
