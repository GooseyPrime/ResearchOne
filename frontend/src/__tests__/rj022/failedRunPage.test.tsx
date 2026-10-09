/** @vitest-environment jsdom */
/**
 * RJ-022. Opening the failed run of 9 Oct 2026 held the browser tab still.
 *
 * Mounted with the run's real shape (`failedRunFixture.ts`), the pages
 * themselves draw in a few passes and ask for each thing once: the last three
 * tests hold that, and they pass on the code before this change too. What was
 * found, in a real browser, is work done on the text the pages print:
 *
 *   1. The analytics tag read every signed-in page looking for e-mail
 *      addresses, at a cost that grows with the square of the longest unbroken
 *      run of characters. It is now off on signed-in pages.
 *   2. Taking old report labels out of a dossier card doubled its time with
 *      every item of a "(inference, Chunk 1, Chunk 2, …" list that no bracket
 *      closed.
 *
 * The first two groups of tests fail on the code before this change.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Profiler } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RJ022_PLAIN_SENTENCE,
  RJ022_REQUEST,
  RJ022_RUN_ID,
  RJ022_STORED_ERROR,
  rj022Dossier,
  rj022DossierListRow,
  rj022FailedRun,
  rj022FailedRunForCustomer,
  rj022RunListRow,
} from './failedRunFixture';

const admin = { value: false };

vi.mock('../../utils/socket', () => ({
  subscribeToJob: vi.fn(),
  getSocket: () => ({ on: vi.fn(), off: vi.fn() }),
}));

const getResearchRun = vi.fn();
const getResearchRuns = vi.fn();
const getDossier = vi.fn();
const getDossiers = vi.fn();
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRun: (...a: unknown[]) => getResearchRun(...a),
  getResearchRuns: (...a: unknown[]) => getResearchRuns(...a),
  getDossier: (...a: unknown[]) => getDossier(...a),
  getDossiers: (...a: unknown[]) => getDossiers(...a),
  getDossierReportHistory: async () => ({ entries: [] }),
  getDossierSpinoffs: async () => ({ spinoffs: [] }),
}));
vi.mock('../../hooks/useIsAdmin', () => ({ useIsAdmin: () => admin.value }));
vi.mock('../../components/research/RunPlanGate', () => ({ default: () => null }));

import MarketingDocumentEffect from '../../components/MarketingDocumentEffect';
import { LiveRunPanel } from '../../components/r1-dashboard/LiveRunPanel';
import { GA_MEASUREMENT_ID, isSignedInAreaPath } from '../../lib/analyticsScope';
import { stripReportLabels } from '../../lib/researchone/reportLabels';
import DossierDetailPage from '../../pages/DossierDetailPage';
import DossiersPage from '../../pages/DossiersPage';

const GA_OFF = `ga-disable-${GA_MEASUREMENT_ID}`;
const flags = window as unknown as Record<string, unknown>;

/** Draws `ui` at `path` and counts how many times React commits it. */
function mount(path: string, routes: React.ReactNode) {
  const commits = { count: 0 };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MarketingDocumentEffect />
        <Profiler id="page" onRender={() => { commits.count += 1; }}>
          <Routes>{routes}</Routes>
        </Profiler>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return commits;
}

/** Long enough for a page that keeps re-drawing or re-asking to show it. */
const settle = () => new Promise((done) => setTimeout(done, 400));

beforeEach(() => {
  admin.value = false;
  delete flags[GA_OFF];
  getResearchRun.mockReset();
  getResearchRuns.mockReset().mockResolvedValue([rj022RunListRow()]);
  getDossier.mockReset().mockResolvedValue(rj022Dossier());
  getDossiers.mockReset().mockResolvedValue({ rows: [rj022DossierListRow()], total: 1, page: 1, pageSize: 20 });
});
afterEach(() => cleanup());

describe('RJ-022: the analytics tag does not run on signed-in pages', () => {
  it('names the signed-in areas', () => {
    for (const path of ['/app', '/app/dossiers', `/app/run/${RJ022_RUN_ID}`, '/account', '/account/security', '/onboarding']) {
      expect(isSignedInAreaPath(path), path).toBe(true);
    }
    for (const path of ['/', '/pricing', '/apply', '/sign-in', '/sample-report']) {
      expect(isSignedInAreaPath(path), path).toBe(false);
    }
  });

  it('is switched off when a dossier or a run is opened, and on again on a public page', () => {
    mount(`/app/dossiers/${RJ022_RUN_ID}`, <Route path="*" element={null} />);
    expect(flags[GA_OFF]).toBe(true);
    cleanup();
    mount(`/app/run/${RJ022_RUN_ID}`, <Route path="*" element={null} />);
    expect(flags[GA_OFF]).toBe(true);
    cleanup();
    mount('/pricing', <Route path="*" element={null} />);
    expect(flags[GA_OFF]).toBe(false);
  });

  it('is switched in the page itself, before the tag is configured and before the tag sees a change of address', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(script.indexOf('r1AnalyticsScope();')).toBeGreaterThan(-1);
    expect(script.indexOf(`gtag('config', '${GA_MEASUREMENT_ID}')`)).toBeGreaterThan(script.indexOf('r1AnalyticsScope();'));

    // Run the page's own script, then move between a public page and signed-in pages.
    const pushState = window.history.pushState;
    const replaceState = window.history.replaceState;
    try {
      window.history.replaceState({}, '', `/app/dossiers/${RJ022_RUN_ID}`);
      new Function(script)();
      expect(flags[GA_OFF]).toBe(true);
      window.history.pushState({}, '', '/pricing');
      expect(flags[GA_OFF]).toBe(false);
      window.history.pushState({}, '', `/app/run/${RJ022_RUN_ID}`);
      expect(flags[GA_OFF]).toBe(true);
      window.history.replaceState({}, '', '/');
      expect(flags[GA_OFF]).toBe(false);
    } finally {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.history.replaceState({}, '', '/');
    }
  });
});

describe('RJ-022: taking labels out of old report text takes time in proportion to the text', () => {
  const list = (items: number) => `(inference, ${Array.from({ length: items }, (_, i) => `Chunk ${i + 1}`).join(', ')} and others`;

  it('does not double its time with each item of a list no bracket closes', () => {
    // 26 items took 33 seconds here before the change, and twice that per further item.
    const started = performance.now();
    const out = stripReportLabels(`The audit found gaps ${list(26)}.`);
    expect(performance.now() - started).toBeLessThan(250);
    expect(out).toContain('The audit found gaps');
  });

  it('takes no longer for two more items', () => {
    // Kept short on purpose: on the code before the change each further item
    // doubled the time, and a test with a long list would never finish there.
    const started = performance.now();
    stripReportLabels(list(28));
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('still removes the labels it removed before', () => {
    expect(stripReportLabels('Turnout rose (strong_evidence, Chunks 2, 12, 15).')).toBe('Turnout rose.');
    expect(stripReportLabels('Turnout rose (inference, Chunk 2, Chunk 5).')).toBe('Turnout rose.');
    expect(stripReportLabels('Turnout rose (Chunk 2 and Chunk 5) in 2024.')).toBe('Turnout rose in 2024.');
    expect(stripReportLabels('Turnout rose (inference, Challenger Findings).')).toBe('Turnout rose.');
    expect(stripReportLabels('The office (opened in 1932) kept paper records (see Table 2).')).toBe(
      'The office (opened in 1932) kept paper records (see Table 2).'
    );
  });
});

describe('RJ-022: the failed run opens, draws a bounded number of times, and says what happened', () => {
  it('run page, as a customer is sent the run: the plain sentence and "Run it again"', async () => {
    getResearchRun.mockResolvedValue(rj022FailedRunForCustomer());
    const commits = mount(`/app/run/${RJ022_RUN_ID}`, <Route path="/app/run/:runId" element={<LiveRunPanel />} />);

    expect((await screen.findAllByText(RJ022_PLAIN_SENTENCE)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeTruthy();
    expect(screen.getAllByText('Did not finish').length).toBeGreaterThan(0);
    await settle();

    expect(commits.count).toBeLessThan(25);
    expect(getResearchRun).toHaveBeenCalledTimes(1);
    expect(getResearchRuns).toHaveBeenCalledTimes(1);
    // The trace is the run's steps, not one line per timer tick of a wait.
    expect(document.querySelectorAll('[class*="border-b"][class*="px-3"]').length).toBeLessThan(60);
    expect(document.body.textContent).not.toMatch(/status=402|quota_exceeded|section_drafter|deepseek/);
  });

  it('run page, as an administrator is sent the run (full trace, routes tried, model log): the same', async () => {
    admin.value = true;
    getResearchRun.mockResolvedValue(rj022FailedRun());
    const commits = mount(`/app/run/${RJ022_RUN_ID}`, <Route path="/app/run/:runId" element={<LiveRunPanel />} />);

    expect((await screen.findAllByText(RJ022_PLAIN_SENTENCE)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeTruthy();
    // The stored error is on the administrator's page.
    expect(screen.getByTestId('stored-error').textContent).toBe(RJ022_STORED_ERROR);
    await settle();

    expect(commits.count).toBeLessThan(25);
    expect(getResearchRun).toHaveBeenCalledTimes(1);
  });

  it('dossier list and the dossier itself: one request each, a bounded number of draws', async () => {
    const list = mount('/app/dossiers', <Route path="/app/dossiers" element={<DossiersPage />} />);
    expect(await screen.findByText('Securing election data in county and state election offices')).toBeTruthy();
    expect(screen.getByText('Did not finish')).toBeTruthy();
    await settle();
    expect(list.count).toBeLessThan(25);
    expect(getDossiers).toHaveBeenCalledTimes(1);
    cleanup();

    const detail = mount(`/app/dossiers/${RJ022_RUN_ID}`, <Route path="/app/dossiers/:id" element={<DossierDetailPage />} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Research dossier' })).toBeTruthy());
    expect(screen.getByText('Did not finish')).toBeTruthy();
    expect(screen.getAllByText((_, node) => node?.textContent === RJ022_REQUEST).length).toBeGreaterThan(0);
    await settle();
    expect(detail.count).toBeLessThan(25);
    expect(getDossier).toHaveBeenCalledTimes(1);
  });
});
