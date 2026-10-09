/** @vitest-environment jsdom */
/**
 * RJ-018 items 3 and 5, on the run page.
 *
 *  3. The page printed "PIPELINE_PROGRESS" and "RUN_STATUS" as headings and the
 *     steps as "PLANNER, SLEUTH, RETRIEVER, …".
 *  5. After the plan was confirmed the trace showed "Starting 0%" twice, below
 *     later steps, and the progress bar fell back to 0%.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchProgressEvent, ResearchRun } from '../../utils/api';

type Handler = (payload: unknown) => void;
const handlers: Record<string, Handler[]> = {};

vi.mock('../../utils/socket', () => ({
  subscribeToJob: vi.fn(),
  getSocket: () => ({
    on: (evt: string, fn: Handler) => {
      (handlers[evt] ||= []).push(fn);
    },
    off: (evt: string, fn: Handler) => {
      handlers[evt] = (handlers[evt] || []).filter((h) => h !== fn);
    },
  }),
}));

const getResearchRun = vi.fn();
const getResearchRuns = vi.fn();
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getResearchRun: (...a: unknown[]) => getResearchRun(...a),
  getResearchRuns: (...a: unknown[]) => getResearchRuns(...a),
}));

vi.mock('../../components/research/RunPlanGate', () => ({ default: () => null }));

import { LiveRunPanel } from '../../components/r1-dashboard/LiveRunPanel';
import { DOUBLE_CHECK, RUN_STEPS, RUN_STEP_ORDER, customerOption, customerOptionHelp, customerOptionsIn, runStep } from '../../content/customerOptions';
import { pipelineStages, protocolLabels } from '../../content/researchoneUiData';
import { isWorkerNotice, traceProgress, tracePercents } from '../../utils/traceEventWindow';

const RUN_ID = '6622a18a-03f0-4317-a839-ddf2b73132cd';

function emit(payload: unknown) {
  (handlers['research:progress'] || []).forEach((h) => h(payload));
}

function evt(stage: string, percent: number, iso: string, message = stage): ResearchProgressEvent {
  return { runId: RUN_ID, stage, percent, message, timestamp: iso, eventType: 'progress' };
}

/** What the run row holds after the plan is confirmed and the run has picked up again. */
const BEFORE_PLAN = [
  evt('starting', 1, '2026-10-09T13:14:00.000Z', 'Starting the run'),
  evt('plan_generation', 2, '2026-10-09T13:14:01.000Z', 'Drafting the plan'),
  evt('plan_pending_confirmation', 4, '2026-10-09T13:14:20.000Z', 'Plan ready'),
];
const AFTER_CONFIRM = [
  evt('starting', 1, '2026-10-09T13:16:00.000Z', 'Starting the run'),
  evt('planning', 5, '2026-10-09T13:16:00.400Z', 'Turning the plan into searches'),
  evt('discovery', 12, '2026-10-09T13:16:00.900Z', 'Search round 1'),
];

function runRow(over: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: RUN_ID,
    run_ref: 'R1-20261009-0915-ABCDE-1',
    display_title: 'Election security for the 2026 presidential election',
    title: 'What security measures protect the 2026 election?',
    query: 'What security measures protect the 2026 election?',
    status: 'running',
    created_at: '2026-10-09T13:13:00.000Z',
    progress_stage: 'discovery',
    progress_percent: 12,
    progress_message: 'Search round 1',
    progress_updated_at: '2026-10-09T13:16:00.900Z',
    progress_events: [...BEFORE_PLAN, ...AFTER_CONFIRM],
    ...over,
  } as ResearchRun;
}

async function mountReady(over: Partial<ResearchRun> = {}) {
  getResearchRun.mockResolvedValue(runRow(over));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/app/run/${RUN_ID}`]}>
        <Routes>
          <Route path="/app/run/:runId" element={<LiveRunPanel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
  return utils;
}

beforeEach(() => {
  getResearchRuns.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  vi.clearAllMocks();
});

describe('the run page uses plain headings and plain step names', () => {
  it('heads its two panels "Progress" and "Run status", each described in the registry', async () => {
    await mountReady();
    const progress = customerOption('run_page_field', 'progress');
    const status = customerOption('run_page_field', 'run_status');
    expect(progress.name).toBe('Progress');
    expect(status.name).toBe('Run status');
    expect(screen.getByRole('heading', { name: 'Progress' })).toHaveAttribute('title', customerOptionHelp(progress));
    expect(screen.getByRole('heading', { name: 'Run status' })).toHaveAttribute('title', customerOptionHelp(status));
  });

  it('prints no raw label and no slang step name anywhere', async () => {
    await mountReady();
    const text = document.body.textContent ?? '';
    // On main: "PIPELINE_PROGRESS", "RUN_STATUS" and a step row of role nicknames.
    expect(text).not.toMatch(/PIPELINE_PROGRESS|RUN_STATUS|[A-Z]{3,}_[A-Z]{3,}/);
    expect(text).not.toMatch(/sleuth/i);
    expect(text).not.toMatch(/\b(Planner|Retriever|Quantitative|Reasoner|Verifier|Formatter|Synthesizer)\b/i);
  });

  it('names the nine steps from the registry, each with its description and example on hover', async () => {
    await mountReady();
    const steps = within(screen.getByTestId('run-steps')).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent?.replace(/^\d+/, ''))).toEqual(RUN_STEPS.map((step) => step.name));
    steps.forEach((step, index) => expect(step).toHaveAttribute('title', customerOptionHelp(RUN_STEPS[index])));
    expect(RUN_STEPS.map((step) => step.name)).toEqual(['Plan', 'Search sources', 'Read sources', 'Check figures', 'Weigh evidence', 'Double-check', 'Write', 'Check citations', 'Finish']);
  });

  it('says what the step the run is on does, with an example, without hovering', async () => {
    await mountReady();
    const search = runStep('sleuth');
    const help = screen.getByTestId('run-step-help');
    expect(help).toHaveTextContent(search.name);
    expect(help).toHaveTextContent(search.description);
    expect(help).toHaveTextContent(`Example: ${search.example}`);
    expect(within(screen.getByTestId('run-steps')).getByText(search.name).closest('li')).toHaveAttribute('aria-current', 'step');
  });
});

describe('the step names are in the registry, and the registry is the only place they are written', () => {
  it('every step has a name, a description and an example', () => {
    expect(RUN_STEP_ORDER).toHaveLength(9);
    expect(customerOptionsIn('run_step').map((option) => option.id)).toEqual(RUN_STEP_ORDER.filter((id) => id !== 'double_check'));
    for (const step of RUN_STEPS) {
      expect(step.name.length, step.id).toBeGreaterThan(1);
      expect(step.description.length, step.id).toBeGreaterThan(15);
      expect(step.example.length, step.id).toBeGreaterThan(3);
      expect(step.name, step.id).not.toMatch(/sleuth|planner|retriever|reasoner|verifier|formatter|synthesi[sz]er|quantitative/i);
    }
    expect(runStep('double_check')).toBe(DOUBLE_CHECK);
  });

  it('the pipeline diagram, the methodology page and the marquee read their step names from it', () => {
    expect(pipelineStages.map((stage) => stage.id)).toEqual([...RUN_STEP_ORDER]);
    expect(pipelineStages.map((stage) => stage.name)).toEqual(RUN_STEPS.map((step) => step.name));
    expect(pipelineStages.map((stage) => stage.description)).toEqual(RUN_STEPS.map((step) => step.description));
    expect(protocolLabels).toEqual(RUN_STEPS.map((step) => step.name));
  });
});

describe('progress never moves backwards', () => {
  it('the bar and the step stay at the furthest point when the run picks up after its plan', async () => {
    await mountReady();
    // The run restarted its count at 1% when it picked up; the furthest point it has reached is 12%.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
    const status = screen.getByRole('heading', { name: 'Run status' }).closest('.r1-panel') as HTMLElement;
    expect(within(status).getByText('Searching sources')).toBeInTheDocument();
  });

  it("the worker's notice is not a step: it adds no row, and does not pull the bar back to 0%", async () => {
    await mountReady();
    const rowsBefore = screen.getAllByText(/^\d+%$/).length;
    // What a page received on 9 Oct 2026: the notice, twice (the run's channel
    // and the all-pages broadcast), with no time and no percentage.
    act(() => {
      emit({ stage: 'started', runId: RUN_ID });
      emit({ stage: 'started', runId: RUN_ID });
    });
    // On main: two more rows, "Starting 0%", sorted last by the browser's clock; the bar at 0%.
    expect(screen.getAllByText(/^\d+%$/).length).toBe(rowsBefore);
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
    // The notice as the server sends it from now on.
    act(() => emit({ stage: 'started', runId: RUN_ID, timestamp: '2026-10-09T13:20:00.000Z', eventType: 'worker_notice' }));
    expect(screen.getAllByText(/^\d+%$/).length).toBe(rowsBefore);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
  });

  it('a late event that reports less does not move the bar or the step back', async () => {
    await mountReady();
    act(() => emit(evt('starting', 1, '2026-10-09T13:21:00.000Z', 'Starting the run again')));
    await waitFor(() => expect(screen.getByText('Starting the run again')).toBeInTheDocument());
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
    const status = screen.getByRole('heading', { name: 'Run status' }).closest('.r1-panel') as HTMLElement;
    expect(within(status).getByText('Searching sources')).toBeInTheDocument();
    // No row of the trace shows less than the row above it.
    const percents = screen.getAllByText(/^\d+%$/).map((node) => Number(node.textContent?.replace('%', '')));
    const trace = percents.slice(1, -1);
    expect([...trace].sort((a, b) => a - b)).toEqual(trace);
    act(() => emit(evt('retriever', 30, '2026-10-09T13:22:00.000Z', 'Gathering')));
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30'));
  });
});

describe('the rule behind the bar', () => {
  it('is the furthest point of this attempt', () => {
    expect(traceProgress([...BEFORE_PLAN, ...AFTER_CONFIRM])).toEqual({ percent: 12, stage: 'discovery' });
    expect(traceProgress(BEFORE_PLAN)).toEqual({ percent: 4, stage: 'plan_pending_confirmation' });
    expect(traceProgress([...BEFORE_PLAN, AFTER_CONFIRM[0]])).toEqual({ percent: 4, stage: 'plan_pending_confirmation' });
    expect(traceProgress([])).toEqual({ percent: 0, stage: null });
  });

  it('uses the run row when it is ahead of the events on a page that has just opened', () => {
    expect(traceProgress([], { progress_percent: 42, progress_stage: 'reasoner' })).toEqual({ percent: 42, stage: 'reasoner' });
    expect(traceProgress(AFTER_CONFIRM, { progress_percent: 1, progress_stage: 'starting' })).toEqual({ percent: 12, stage: 'discovery' });
  });

  it('begins again only when the run really stopped and was started again', () => {
    const failed: ResearchProgressEvent = { ...evt('failed', 60, '2026-10-09T13:30:00.000Z'), eventType: 'run_failed' };
    const resumed: ResearchProgressEvent = { ...evt('starting', 1, '2026-10-09T13:31:00.000Z'), eventType: 'run_resumed' };
    const again = evt('planning', 5, '2026-10-09T13:31:05.000Z');
    expect(traceProgress([evt('reasoner', 60, '2026-10-09T13:29:00.000Z'), failed, resumed, again])).toEqual({ percent: 5, stage: 'planning' });
    expect(tracePercents([evt('reasoner', 60, '2026-10-09T13:29:00.000Z'), failed, resumed, again])).toEqual([60, 60, 1, 5]);
  });

  it('prints a row percentage that never falls within an attempt', () => {
    expect(tracePercents([...BEFORE_PLAN, ...AFTER_CONFIRM])).toEqual([1, 2, 4, 4, 5, 12]);
  });

  it("knows the worker's notice from a step", () => {
    expect(isWorkerNotice({ stage: 'started', runId: RUN_ID })).toBe(true);
    expect(isWorkerNotice({ stage: 'started', runId: RUN_ID, timestamp: '2026-10-09T13:20:00.000Z', eventType: 'worker_notice' } as unknown as Parameters<typeof isWorkerNotice>[0])).toBe(true);
    expect(isWorkerNotice(BEFORE_PLAN[0])).toBe(false);
    expect(isWorkerNotice({ stage: 'started', percent: 1, message: 'Starting' })).toBe(false);
    expect(isWorkerNotice(null)).toBe(false);
  });
});
