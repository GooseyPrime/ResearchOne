/** @vitest-environment jsdom */
/**
 * RJ-022B. The failed run of 9 Oct 2026 at its real size: 317 search results,
 * a 423 KB run row, 900 KB of diagnostics (`manySourcesFixture.ts`).
 *
 * WHAT THESE TESTS DO AND DO NOT SHOW
 *
 * The pages were opened with this fixture in Chromium against the production
 * build (see `docs/RJ-022B-failed-run-many-sources.md`). None of them held the
 * tab still, with 317 results or with 3,170: the list of results is not drawn
 * on the Dossiers page, the dossier or the run page at all, and no step of the
 * page code grows faster than the list. So the freeze seen live was NOT
 * reproduced and its cause is not established. Every bound on time, on the
 * number of draws and on the number of elements for the Dossiers page, the
 * dossier, the run page and the closed diagnostics page holds on the code
 * before this change as well. Those bounds are here to keep that true; they
 * are not evidence of a fix.
 *
 * What does fail on the code before this change (every test but those four):
 *
 *   1. The diagnostics page drew every result as soon as a section was opened:
 *      the whole stored search record as 390 KB of JSON, and all 292 results
 *      that were set aside. Both are now drawn a part at a time ("Show all 317").
 *   2. A run that cannot be run again was told "Press Run it again", and when
 *      the server refused a second attempt the page said nothing a person could
 *      act on (and the server's reason, written for whoever fixes the pipeline,
 *      was sent to customers). The page now says one plain sentence and offers
 *      "Send it as a new request" whenever a run cannot be run again. The run
 *      page tests fail before the change on that sentence and that link.
 */
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { Profiler } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchRun } from '../../utils/api';
import { RETRY_NOT_CONFIRMED } from '../../utils/customerFailureText';
import { RJ022_REQUEST, RJ022_RUN_ID, RJ022_STORED_ERROR, rj022Dossier, rj022DossierListRow, rj022FailedRun } from '../rj022/failedRunFixture';
import {
  RJ022B_ADMIN_SENTENCE,
  RJ022B_CUSTOMER_SENTENCE,
  RJ022B_OLD_REFUSAL,
  RJ022B_PLAIN_REFUSAL,
  RJ022B_READ_COUNT,
  RJ022B_SOURCE_COUNT,
  rj022bArtifacts,
  rj022bDiscoverySources,
  rj022bFailedRun,
  rj022bFailedRunForCustomer,
} from './manySourcesFixture';

const admin = { value: false };

vi.mock('../../utils/socket', () => ({
  subscribeToJob: vi.fn(),
  getSocket: () => ({ on: vi.fn(), off: vi.fn() }),
}));

const getResearchRun = vi.fn();
const getResearchRuns = vi.fn();
const getRunArtifacts = vi.fn();
const getDossier = vi.fn();
const getDossiers = vi.fn();
const retryResearchRunFromFailure = vi.fn();
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRun: (...a: unknown[]) => getResearchRun(...a),
  getResearchRuns: (...a: unknown[]) => getResearchRuns(...a),
  getRunArtifacts: (...a: unknown[]) => getRunArtifacts(...a),
  getDossier: (...a: unknown[]) => getDossier(...a),
  getDossiers: (...a: unknown[]) => getDossiers(...a),
  getDossierReportHistory: async () => ({ entries: [] }),
  getDossierSpinoffs: async () => ({ spinoffs: [] }),
  retryResearchRunFromFailure: (...a: unknown[]) => retryResearchRunFromFailure(...a),
}));
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: () => admin.value }));
vi.mock('../../components/research/RunPlanGate', () => ({ default: () => null }));

import { LiveRunPanel } from '../../components/r1-dashboard/LiveRunPanel';
import DossierDetailPage from '../../pages/DossierDetailPage';
import DossiersPage from '../../pages/DossiersPage';
import FailedRunReportPage from '../../pages/FailedRunReportPage';

/**
 * Bounds. A page with this run draws in well under a second here and in a few
 * passes; the limits leave room for a slow test machine and none for a page
 * that draws every result or draws without end.
 */
const OPEN_WITHIN_MS = 4_000;
const MAX_COMMITS = 25;
/** The run page, the dossier and the list hold a few hundred elements. 317 results drawn would be thousands. */
const MAX_ELEMENTS = 1_500;

function mount(path: string, routes: React.ReactNode) {
  const seen = { commits: 0, started: performance.now() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Profiler id="page" onRender={() => { seen.commits += 1; }}>
          <Routes>
            {routes}
            <Route path="/app/research" element={<p>New request form</p>} />
          </Routes>
        </Profiler>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...seen, get commits() { return seen.commits; }, elapsed: () => performance.now() - seen.started };
}

const settle = () => new Promise((done) => setTimeout(done, 400));
const elements = () => document.body.querySelectorAll('*').length;

/** The server's answer to a refused "run it again", as axios hands it to the page. */
function refusal(status: number, data: Record<string, unknown>): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, { status, statusText: '', data, headers: {}, config });
}

const RUN_ROUTE = <Route path="/app/run/:runId" element={<LiveRunPanel />} />;
const DIAGNOSTICS_ROUTE = <Route path="/app/reports/run/:runId" element={<FailedRunReportPage />} />;
/** Words a customer is never shown as a role, the old refusal, and the stored error's parts. */
const NOT_FOR_CUSTOMERS = /steel-?man|s[kc]eptic|devil|red[- ]?team|adversarial|orchestrator|non-recoverable|malformed|not retryable|status=402|quota_exceeded|section_drafter|deepseek/i;

beforeEach(() => {
  admin.value = false;
  getResearchRun.mockReset();
  getResearchRuns.mockReset().mockResolvedValue([]);
  getRunArtifacts.mockReset().mockResolvedValue(rj022bArtifacts());
  getDossier.mockReset().mockResolvedValue(rj022Dossier());
  getDossiers.mockReset().mockResolvedValue({ rows: [rj022DossierListRow()], total: 1, page: 1, pageSize: 20 });
  retryResearchRunFromFailure.mockReset();
});
afterEach(() => cleanup());

describe('RJ-022B: the fixture is the run as measured live', () => {
  it('has 317 search results of about 1.2 KB each, 25 of them read', () => {
    const sources = rj022bDiscoverySources();
    expect(sources).toHaveLength(RJ022B_SOURCE_COUNT);
    expect(sources.filter((s) => s.ingested)).toHaveLength(RJ022B_READ_COUNT);
    const bytes = JSON.stringify(sources).length;
    // Live: 388,940 bytes.
    expect(bytes).toBeGreaterThan(370_000);
    expect(bytes).toBeLessThan(410_000);
    for (const key of ['url', 'rank', 'score', 'title', 'snippet', 'ingested', 'provider', 'sourceQuery', 'selectionRationale']) {
      expect(sources.every((s) => key in s), key).toBe(true);
    }
    expect(sources.every((s) => s.snippet.length > 200 && s.snippet.length < 900)).toBe(true);
  });

  it('is a 423 KB run row and 900 KB of diagnostics, with no unbroken run of characters over 115', () => {
    const run = JSON.stringify(rj022bFailedRun());
    // Live: 423,098 and 902,613 bytes.
    expect(run.length).toBeGreaterThan(400_000);
    expect(run.length).toBeLessThan(450_000);
    const artifacts = JSON.stringify(rj022bArtifacts());
    expect(artifacts.length).toBeGreaterThan(850_000);
    expect(artifacts.length).toBeLessThan(950_000);
    const longest = Math.max(...run.split(/[\s"]+/).map((part) => part.length));
    expect(longest).toBeLessThanOrEqual(115);
    const row = rj022bFailedRun() as unknown as Record<string, unknown>;
    expect(Object.keys(row.discovery_summary as object).sort()).toEqual(
      ['candidatesFound', 'candidatesSelected', 'discoveryEnabled', 'durationMs', 'planDecision', 'planRationale', 'queriesExecuted', 'runId', 'sources', 'sourcesIngested', 'sourcesSkipped'].sort()
    );
    expect(row.retrieval_ids).toHaveLength(19);
    expect(row.model_log).toEqual([]);
  });
});

describe('RJ-022B: the run with 317 results opens in bounded time and says what happened', () => {
  it('run page, as its owner (an administrator) is sent the run: the plain sentence and "Send it as a new request"', async () => {
    admin.value = true;
    getResearchRun.mockResolvedValue(rj022bFailedRun());
    const page = mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    expect(await screen.findByText(RJ022B_ADMIN_SENTENCE)).toBeTruthy();
    expect(page.elapsed()).toBeLessThan(OPEN_WITHIN_MS);
    expect(screen.getAllByText('Did not finish').length).toBeGreaterThan(0);
    // The run was stored as one that cannot be run again: no button that would be refused.
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Send it as a new request' }).getAttribute('href')).toContain('/app/research');
    expect(document.body.textContent).not.toContain('Press Run it again');
    // The stored error is on the administrator's page.
    expect(screen.getByTestId('stored-error').textContent).toBe(RJ022_STORED_ERROR);
    await settle();

    expect(page.commits).toBeLessThan(MAX_COMMITS);
    expect(getResearchRun).toHaveBeenCalledTimes(1);
    // None of the 317 results is drawn on the run page.
    expect(elements()).toBeLessThan(MAX_ELEMENTS);
    expect(document.body.textContent).not.toContain(rj022bDiscoverySources()[40].url);
  });

  it('run page, as a customer is sent the run: the same, with no stored detail', async () => {
    getResearchRun.mockResolvedValue(rj022bFailedRunForCustomer());
    const page = mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    expect((await screen.findAllByText(RJ022B_CUSTOMER_SENTENCE)).length).toBeGreaterThan(0);
    expect(page.elapsed()).toBeLessThan(OPEN_WITHIN_MS);
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Send it as a new request' })).toBeTruthy();
    await settle();

    expect(page.commits).toBeLessThan(MAX_COMMITS);
    expect(elements()).toBeLessThan(MAX_ELEMENTS);
    expect(document.body.textContent).not.toMatch(NOT_FOR_CUSTOMERS);
    expect(document.body.textContent).not.toContain('Press Run it again');
  });

  it('a server older than the page still sends "Press Run it again": the page does not print it for a run that cannot be', async () => {
    const olderServerSentence =
      'The report could not be written because our AI service is temporarily unavailable. You have not been charged. Press Run it again to try again; you are only charged once, when a report is delivered.';
    getResearchRun.mockResolvedValue(
      rj022bFailedRunForCustomer({ error_message: olderServerSentence, failure_meta: { retryable: false, customerMessage: olderServerSentence } })
    );
    mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    expect(await screen.findByText(RJ022B_CUSTOMER_SENTENCE)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Send it as a new request' })).toBeTruthy();
  });

  it('Dossiers list and the dossier: one request each, a bounded number of draws', async () => {
    const list = mount('/app/dossiers', <Route path="/app/dossiers" element={<DossiersPage />} />);
    expect(await screen.findByText('Securing election data in county and state election offices')).toBeTruthy();
    expect(list.elapsed()).toBeLessThan(OPEN_WITHIN_MS);
    await settle();
    expect(list.commits).toBeLessThan(MAX_COMMITS);
    expect(getDossiers).toHaveBeenCalledTimes(1);
    cleanup();

    const detail = mount(`/app/dossiers/${RJ022_RUN_ID}`, <Route path="/app/dossiers/:id" element={<DossierDetailPage />} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Research dossier' })).toBeTruthy());
    expect(detail.elapsed()).toBeLessThan(OPEN_WITHIN_MS);
    expect(screen.getAllByText((_, node) => node?.textContent === RJ022_REQUEST).length).toBeGreaterThan(0);
    await settle();
    expect(detail.commits).toBeLessThan(MAX_COMMITS);
    expect(getDossier).toHaveBeenCalledTimes(1);
    expect(elements()).toBeLessThan(MAX_ELEMENTS);
  });
});

describe('RJ-022B: the diagnostics page draws a long list a part at a time', () => {
  async function openDiagnostics() {
    admin.value = true;
    getResearchRun.mockResolvedValue(rj022bFailedRun());
    const page = mount(`/app/reports/run/${RJ022_RUN_ID}`, DIAGNOSTICS_ROUTE);
    await screen.findByRole('heading', { name: 'Research Run Failed' });
    await screen.findByRole('button', { name: /Not used \(292\)/ });
    return page;
  }

  it('opens in bounded time with every section closed', async () => {
    const page = await openDiagnostics();
    expect(page.elapsed()).toBeLessThan(OPEN_WITHIN_MS);
    await settle();
    expect(page.commits).toBeLessThan(MAX_COMMITS);
    expect(getResearchRun).toHaveBeenCalledTimes(1);
    expect(getRunArtifacts).toHaveBeenCalledTimes(1);
  });

  it('the search section shows counts and the first 25 of 317 results, not the stored record whole', async () => {
    await openDiagnostics();
    const before = elements();
    const started = performance.now();
    fireEvent.click(screen.getByRole('button', { name: /^Discovery \(/ }));

    const summary = await screen.findByTestId('discovery-summary');
    expect(performance.now() - started).toBeLessThan(OPEN_WITHIN_MS);
    expect(summary.textContent).toContain('5 searches · 317 results found · 25 chosen to read · 292 not chosen');
    const list = screen.getByTestId('discovery-sources');
    expect(list.querySelectorAll('a[href^="https://"]')).toHaveLength(25);
    expect(within(list).getByRole('button', { name: 'Show all 317' })).toBeTruthy();
    // Before this change the section printed the record as JSON: about 390,000 characters in one block.
    expect(summary.textContent!.length).toBeLessThan(40_000);
    expect(elements() - before).toBeLessThan(600);

    // Everything is still there for whoever asks for it.
    fireEvent.click(within(list).getByRole('button', { name: 'Show all 317' }));
    expect(list.querySelectorAll('a[href^="https://"]')).toHaveLength(RJ022B_SOURCE_COUNT);
    fireEvent.click(within(list).getByRole('button', { name: 'Show the first 25' }));
    expect(list.querySelectorAll('a[href^="https://"]')).toHaveLength(25);
  });

  it('the list of results set aside shows the first 25 of 292, with "Show all 292"', async () => {
    await openDiagnostics();
    fireEvent.click(screen.getByRole('button', { name: /Not used \(292\)/ }));

    const list = await screen.findByTestId('not-used-sources');
    expect(list.querySelectorAll(':scope > div')).toHaveLength(25);
    fireEvent.click(within(list).getByRole('button', { name: 'Show all 292' }));
    expect(list.querySelectorAll(':scope > div')).toHaveLength(292);
  });

  it('a customer is shown the sources chosen by name, and none of the stored record', async () => {
    const forCustomer = rj022bArtifacts();
    const read = (forCustomer.discoverySummary!.sources as Array<{ ingested: boolean }>).filter((s) => s.ingested);
    getRunArtifacts.mockResolvedValue({
      ...forCustomer,
      discoverySummary: { ...forCustomer.discoverySummary, sources: read },
      notUsedSources: undefined,
      modelEnsemble: null,
    });
    getResearchRun.mockResolvedValue(rj022bFailedRunForCustomer());
    mount(`/app/reports/run/${RJ022_RUN_ID}`, DIAGNOSTICS_ROUTE);
    await screen.findByRole('heading', { name: 'Research Run Failed' });

    // The stored plan is the technical record: it is not offered to a customer.
    expect(screen.queryByRole('button', { name: /Research plan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Not used/ })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /^Discovery \(/ }));
    const summary = await screen.findByTestId('discovery-summary');
    expect(summary.textContent).toContain('Sources chosen to read (25)');
    expect(summary.textContent).not.toMatch(/selectionRationale|sourceQuery|ingestionJobId|planDecision|score=|rank=|Stored record/);
    // The page's own sentence and way on.
    expect(screen.getByText(RJ022B_CUSTOMER_SENTENCE)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Send it as a new request' }).getAttribute('href')).toContain('/app/research');
    expect(screen.queryByRole('button', { name: /Run it again|Retry run/ })).toBeNull();
  });
});

describe('RJ-022B: when the server refuses to run a run again', () => {
  /** A failed run the page believes can be run again; the server then says otherwise. */
  const believedRetryable = (over: Partial<ResearchRun> = {}) =>
    rj022bFailedRunForCustomer({
      error_message: 'This run could not be finished. You have not been charged. Press Run it again to try again; you are only charged once, when a report is delivered.',
      failure_meta: { retryable: true, terminal: false },
      ...over,
    });

  it('a customer reads one plain sentence and is offered "Send it as a new request"', async () => {
    getResearchRun.mockResolvedValue(believedRetryable());
    retryResearchRunFromFailure.mockRejectedValue(refusal(400, { error: RJ022B_PLAIN_REFUSAL, code: 'not_retryable', status: 'failed', retryable: false }));
    mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    fireEvent.click(await screen.findByRole('button', { name: 'Run it again' }));

    expect((await screen.findByTestId('retry-refused')).textContent).toBe(RJ022B_PLAIN_REFUSAL);
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Send it as a new request' }).getAttribute('href')).toContain('/app/research');
    expect(screen.queryByTestId('retry-refused-reason')).toBeNull();
    expect(document.body.textContent).not.toMatch(NOT_FOR_CUSTOMERS);
    expect(document.body.textContent).not.toContain('Press Run it again');
  });

  it('an older server still answers with its label and its reason: neither is printed', async () => {
    getResearchRun.mockResolvedValue(believedRetryable());
    retryResearchRunFromFailure.mockRejectedValue(refusal(400, { ...RJ022B_OLD_REFUSAL, status: 'failed', retryable: false }));
    mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    fireEvent.click(await screen.findByRole('button', { name: 'Run it again' }));

    expect((await screen.findByTestId('retry-refused')).textContent).toBe(RJ022B_PLAIN_REFUSAL);
    expect(document.body.textContent).not.toContain(RJ022B_OLD_REFUSAL.error);
    expect(document.body.textContent).not.toContain('orchestrator');
    expect(screen.getByRole('link', { name: 'Send it as a new request' })).toBeTruthy();
  });

  it.each([
    ['no answer from the server', () => new Error('Network Error')],
    ['a server error', () => refusal(500, { error: 'Internal Server Error' })],
    ['a request that timed out', () => new AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED')],
  ])('%s is not a refusal: the button stays, no new request is offered, and the run is looked at again', async (_name, failure) => {
    // The run may have been queued before the answer was lost. Sending the
    // person to a new request here could be a second run and a second charge.
    getResearchRun.mockResolvedValue(believedRetryable());
    retryResearchRunFromFailure.mockRejectedValue(failure());
    mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    fireEvent.click(await screen.findByRole('button', { name: 'Run it again' }));

    expect((await screen.findByTestId('retry-not-confirmed')).textContent).toBe(RETRY_NOT_CONFIRMED);
    expect(screen.queryByTestId('retry-refused')).toBeNull();
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Send it as a new request' })).toBeNull();
    await waitFor(() => expect(getResearchRun).toHaveBeenCalledTimes(2));
  });

  it('when the lost answer was a yes, the page finds the run started again', async () => {
    getResearchRun.mockResolvedValueOnce(believedRetryable()).mockResolvedValue(
      believedRetryable({ status: 'queued', error_message: undefined, failure_meta: undefined, progress_events: [] })
    );
    retryResearchRunFromFailure.mockRejectedValue(new Error('Network Error'));
    mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    fireEvent.click(await screen.findByRole('button', { name: 'Run it again' }));

    expect(await screen.findByText('Request accepted.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Send it as a new request' })).toBeNull();
  });

  it('diagnostics page: an answer that is not a refusal keeps "Run it again" and offers no new request', async () => {
    getResearchRun.mockResolvedValue(believedRetryable());
    retryResearchRunFromFailure.mockRejectedValue(refusal(502, {}));
    mount(`/app/reports/run/${RJ022_RUN_ID}`, DIAGNOSTICS_ROUTE);

    fireEvent.click(await screen.findByRole('button', { name: 'Run it again' }));

    expect((await screen.findByTestId('retry-not-confirmed')).textContent).toBe(RETRY_NOT_CONFIRMED);
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Send it as a new request' })).toBeNull();
    await waitFor(() => expect(getResearchRun).toHaveBeenCalledTimes(2));
  });

  it('a run stopped for good is not offered "Run it again", whatever an old flag on it says', async () => {
    // An old row keeps `resumeAvailable: true` after the run is stopped for good; the server refuses it.
    const legacy = { status: 'aborted' as const, failure_meta: { resumeAvailable: true } };
    getResearchRun.mockResolvedValue(believedRetryable(legacy));
    mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);
    expect(await screen.findByRole('link', { name: 'Send it as a new request' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
    expect(document.body.textContent).not.toContain('Press Run it again');
    cleanup();

    mount(`/app/reports/run/${RJ022_RUN_ID}`, DIAGNOSTICS_ROUTE);
    expect(await screen.findByRole('link', { name: 'Send it as a new request' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
  });

  it('nor is a failed run marked terminal, or one with no attempts left', async () => {
    for (const over of [
      { failure_meta: { retryable: true, terminal: true } },
      { failure_meta: { retryable: true }, retry_attempts: 2, retry_budget: 2 },
    ]) {
      getResearchRun.mockResolvedValue(believedRetryable(over));
      mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);
      expect(await screen.findByRole('link', { name: 'Send it as a new request' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
      cleanup();
    }
  });

  it('an administrator reads the same sentence, and the reason the server gave', async () => {
    admin.value = true;
    getResearchRun.mockResolvedValue({ ...rj022FailedRun(), failure_meta: { ...rj022FailedRun().failure_meta, retryable: true } });
    retryResearchRunFromFailure.mockRejectedValue(
      refusal(400, { error: RJ022B_PLAIN_REFUSAL, code: 'no_resume_payload', reason: 'resume_job_payload is missing — this run cannot be resumed; start a new run instead.', status: 'failed', retryable: false })
    );
    mount(`/app/run/${RJ022_RUN_ID}`, RUN_ROUTE);

    fireEvent.click(await screen.findByRole('button', { name: 'Run it again' }));

    expect((await screen.findByTestId('retry-refused')).textContent).toBe(RJ022B_PLAIN_REFUSAL);
    expect((await screen.findByTestId('retry-refused-reason')).textContent).toContain('resume_job_payload is missing');
    expect(screen.getByRole('link', { name: 'Send it as a new request' })).toBeTruthy();
  });

  it('diagnostics page: the same sentence, the same link, the reason for an administrator only', async () => {
    getResearchRun.mockResolvedValue(believedRetryable());
    retryResearchRunFromFailure.mockRejectedValue(
      refusal(409, { error: RJ022B_PLAIN_REFUSAL, code: 'reservation_no_longer_held', retryable: false })
    );
    mount(`/app/reports/run/${RJ022_RUN_ID}`, DIAGNOSTICS_ROUTE);

    fireEvent.click(await screen.findByRole('button', { name: 'Run it again' }));

    expect((await screen.findByTestId('retry-refused')).textContent).toBe(RJ022B_PLAIN_REFUSAL);
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Send it as a new request' }).getAttribute('href')).toContain('/app/research');
    expect(screen.queryByTestId('retry-refused-reason')).toBeNull();
  });
});
