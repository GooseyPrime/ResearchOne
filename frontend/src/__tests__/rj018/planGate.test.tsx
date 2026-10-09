/** @vitest-environment jsdom */
/**
 * RJ-018 items 4 and 5, at the plan.
 *
 *  4. "Review plan" did nothing; the plan appeared about a minute later, after
 *     a reload, with no sign that it was loading.
 *  5. "Confirm & run" could be sent twice.
 */
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchRun } from '../../utils/api';

type Handler = (payload: unknown) => void;
const handlers: Record<string, Handler[]> = {};
const socketConnected = { value: true };

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

const getRunPlanForGate = vi.fn();
const confirmRunPlanAtGate = vi.fn();
vi.mock('../../utils/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getRunPlanForGate: (...a: unknown[]) => getRunPlanForGate(...a),
  confirmRunPlanAtGate: (...a: unknown[]) => confirmRunPlanAtGate(...a),
}));

const account = vi.hoisted(() => ({ settled: true }));
vi.mock('../../hooks/useBillingSubscription', () => ({
  useBillingSubscriptionQuery: () => ({ data: account.settled ? { tier: 'pro' } : undefined, isLoading: !account.settled, isError: false, authReady: true }),
  effectiveEntitlementTier: () => 'pro',
}));
vi.mock('../../hooks/usePlanPreferences', () => ({
  PLAN_PREFERENCES_QUERY_KEY: ['plan-preferences'],
  usePlanPreferencesQuery: () => ({ data: null, isLoading: false }),
}));
const addNotification = vi.fn();
vi.mock('../../store/useStore', () => ({ useStore: () => ({ addNotification }) }));

import RunPlanGate, { ACCOUNT_WAIT_MS } from '../../components/research/RunPlanGate';
import PlanConfirmationPanel from '../../components/research/PlanConfirmationPanel';
import { PLAN_ALREADY_CONFIRMED_MESSAGE, PLAN_CONFIRM_IN_FLIGHT_MESSAGE, confirmPlanOnce } from '../../utils/planConfirm';
import PlanReviewBanner from '../../components/layout/PlanReviewBanner';
import { PLAN_FIRST_LOAD_POLL_MS, PLAN_LOADED_POLL_MS, planGatePollIntervalMs } from '../../hooks/usePlanGateHydration';
import { setSocketHealthProvider } from '../../utils/apiRateLimit';
import { customerOption } from '../../content/customerOptions';

const RUN_ID = '6622a18a-03f0-4317-a839-ddf2b73132cd';
const PLAN = {
  intent: { id: 'investigation', confidence: 0.92 },
  orchestrationProfile: { doubleCheckMode: 'gate', strongestFormMode: 'standard' },
  topicAnalysis: { summary: 'You want to know how the 2026 election is protected.', competenceAssessment: 'There is plenty of published material on this.' },
};
const gateResponse = { runStatus: 'plan_pending_confirmation', plan: { planId: 'plan-1', planPayload: PLAN, refinementRounds: 0 } };
const CONFIRM = customerOption('plan_field', 'confirm').name;

function emit(event: string, payload: unknown) {
  (handlers[event] || []).forEach((h) => h(payload));
}

const refetchedRun = vi.fn();
/** Lets a test hold the run's fresh fetch open, to see what the page shows meanwhile. */
const runFetch: { wait: Promise<void>; release: () => void } = { wait: Promise.resolve(), release: () => undefined };

function mount(status: string, path = `/app/run/${RUN_ID}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // The run row the page already holds, with a fetcher so a fresh look can be counted.
  qc.setQueryDefaults(['research-run', RUN_ID], {
    queryFn: async () => {
      refetchedRun();
      await runFetch.wait;
      return { id: RUN_ID, status } as ResearchRun;
    },
  });
  qc.setQueryData(['research-run', RUN_ID], { id: RUN_ID, status } as ResearchRun);
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/app/run/:runId"
            element={
              <div>
                <Link to={`/app/run/${RUN_ID}#plan`}>Review plan</Link>
                <RunPlanGate runId={RUN_ID} runStatus={status} />
              </div>
            }
          />
          <Route path="/app/research" element={<div>Request page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { qc, ...view };
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  runFetch.wait = Promise.resolve();
  account.settled = true;
  socketConnected.value = true;
  setSocketHealthProvider(() => socketConnected.value);
  getRunPlanForGate.mockReset().mockResolvedValue(gateResponse);
  confirmRunPlanAtGate.mockReset().mockResolvedValue({ ok: true, runId: RUN_ID, planId: 'plan-1', status: 'resume_queued' });
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('the plan shows that it is loading', () => {
  it('says so, with a spinner, while the plan is being fetched', async () => {
    getRunPlanForGate.mockReturnValue(new Promise(() => undefined));
    mount('plan_pending_confirmation');
    const loading = screen.getByTestId('plan-loading');
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveTextContent('Loading your research plan…');
    // On main: a line of text with no spinner.
    expect(loading.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('shows nothing for a run that is not waiting at its plan', () => {
    mount('running');
    expect(document.getElementById('plan')).toBeNull();
  });
});

describe('the plan appears without a reload', () => {
  it('asks for the plan every two seconds until it is on screen, however healthy the live connection is', () => {
    // On main: 12 seconds, six times over while the connection was healthy — 72 seconds.
    expect(PLAN_FIRST_LOAD_POLL_MS).toBe(2_000);
    expect(planGatePollIntervalMs(false)).toBe(2_000);
    socketConnected.value = false;
    expect(planGatePollIntervalMs(false)).toBe(2_000);
    expect(planGatePollIntervalMs(true)).toBe(PLAN_LOADED_POLL_MS);
    socketConnected.value = true;
    expect(planGatePollIntervalMs(true)).toBeGreaterThan(PLAN_LOADED_POLL_MS);
  });

  it('asks again when the first answer came back without the plan', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getRunPlanForGate.mockResolvedValueOnce({ runStatus: 'plan_pending_confirmation', plan: null }).mockResolvedValue(gateResponse);
    mount('plan_pending_confirmation');
    await waitFor(() => expect(getRunPlanForGate).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAN_FIRST_LOAD_POLL_MS + 100);
    });
    // On main the next request was 72 seconds away, so only a reload showed the plan.
    await waitFor(() => expect(getRunPlanForGate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: CONFIRM })).toBeInTheDocument());
  });

  it("shows the plan the moment the server says it is ready, before any request comes back", async () => {
    getRunPlanForGate.mockReturnValue(new Promise(() => undefined));
    mount('plan_pending_confirmation');
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument();
    act(() => emit('research:plan_ready_for_confirmation', { runId: RUN_ID, planId: 'plan-1', planPayload: PLAN, refinementRounds: 0 }));
    // On main the gate did not listen for this, and the loading line stayed.
    expect(await screen.findByRole('button', { name: CONFIRM })).toBeInTheDocument();
    expect(screen.queryByTestId('plan-loading')).toBeNull();
  });

  it("ignores another run's plan", () => {
    getRunPlanForGate.mockReturnValue(new Promise(() => undefined));
    mount('plan_pending_confirmation');
    act(() => emit('research:plan_ready_for_confirmation', { runId: 'another-run', planId: 'plan-9', planPayload: PLAN }));
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument();
  });

  it('draws the panel once, after the account details that change its height have arrived', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    account.settled = false;
    mount('plan_pending_confirmation');
    await waitFor(() => expect(getRunPlanForGate).toHaveBeenCalled());
    // The plan has arrived; the row that offers to save its settings has not been decided yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByRole('button', { name: CONFIRM })).toBeNull();
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument();
    // But never for longer than this.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_WAIT_MS + 100);
    });
    expect(screen.getByRole('button', { name: CONFIRM })).toBeInTheDocument();
  });
});

describe('"Review plan" takes you to the plan', () => {
  it('the banner links to the plan of the run that is waiting', () => {
    render(
      <MemoryRouter>
        <PlanReviewBanner runs={[{ id: RUN_ID, status: 'plan_pending_confirmation' } as ResearchRun]} />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: 'Review plan' })).toHaveAttribute('href', `/app/run/${RUN_ID}#plan`);
  });

  it('scrolls to the plan and puts the keyboard on it, each time it is pressed, with the address unchanged', async () => {
    mount('plan_pending_confirmation');
    await screen.findByRole('button', { name: CONFIRM });
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: 'Review plan' }));
    // On main: nothing. The link only added "#plan" to the address.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(document.activeElement).toBe(document.getElementById('plan'));

    const calls = scrollIntoView.mock.calls.length;
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(screen.getByRole('link', { name: 'Review plan' }));
    await waitFor(() => expect(scrollIntoView.mock.calls.length).toBeGreaterThan(calls));
    expect(document.activeElement).toBe(document.getElementById('plan'));
  });

  it('opening a page at the plan scrolls to it once it has loaded', async () => {
    mount('plan_pending_confirmation', `/app/run/${RUN_ID}#plan`);
    await screen.findByRole('button', { name: CONFIRM });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(document.activeElement).toBe(document.getElementById('plan'));
  });

  it('looks at the run again, and shows the loading state while it does, when the page still thinks the run is working', async () => {
    runFetch.wait = new Promise<void>((resolve) => {
      runFetch.release = resolve;
    });
    mount('running');
    expect(document.getElementById('plan')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Review plan' }));
    // The banner knew the plan was ready before this page did. On main nothing happened until the next poll or a reload.
    await waitFor(() => expect(screen.getByTestId('plan-loading')).toBeInTheDocument());
    expect(refetchedRun).toHaveBeenCalled();
    // The fresh look says the run is still working: the loading line goes away again.
    await act(async () => {
      runFetch.release();
    });
    await waitFor(() => expect(document.getElementById('plan')).toBeNull());
  });
});

describe('one confirmation starts one run', () => {
  function panel(onNotify = vi.fn(), onAfterConfirm = vi.fn()) {
    render(
      <MemoryRouter>
        <PlanConfirmationPanel
          snapshot={{ runId: RUN_ID, planId: 'plan-1', refinementRounds: 0, planPayload: PLAN }}
          // A parent that has not drawn again yet: the button is still enabled for the second press.
          busy={false}
          onBusy={vi.fn()}
          onAfterConfirm={onAfterConfirm}
          onAfterCancel={vi.fn()}
          onNotify={onNotify}
          planPrefs={null}
        />
      </MemoryRouter>
    );
    return { onNotify, onAfterConfirm };
  }

  it('two presses in quick succession send one request, and the second is told so in plain words', async () => {
    let finish: (value: unknown) => void = () => undefined;
    confirmRunPlanAtGate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onNotify, onAfterConfirm } = panel();
    const button = screen.getByRole('button', { name: CONFIRM });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: /Starting the research|Confirm/ }));
    // On main: two requests.
    expect(confirmRunPlanAtGate).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith('info', PLAN_CONFIRM_IN_FLIGHT_MESSAGE);
    await act(async () => {
      finish({ ok: true, runId: RUN_ID, planId: 'plan-1', status: 'resume_queued' });
    });
    expect(onAfterConfirm).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith('success', 'Plan confirmed. The research is starting.');
  });

  it('the button is disabled and says what is happening while the request is in flight', async () => {
    let finish: (value: unknown) => void = () => undefined;
    confirmRunPlanAtGate.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mount('plan_pending_confirmation');
    const button = await screen.findByRole('button', { name: CONFIRM });
    fireEvent.click(button);
    const sending = await screen.findByRole('button', { name: 'Starting the research…' });
    expect(sending).toBeDisabled();
    expect(sending).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(sending);
    expect(confirmRunPlanAtGate).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ ok: true, runId: RUN_ID, planId: 'plan-1', status: 'resume_queued' });
    });
    // Until the run reports that it has started, the page says the plan is confirmed — not that a plan is loading.
    expect(await screen.findByText('Plan confirmed. Starting the research…')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-loading')).toBeNull();
  });

  it("one run's confirmation is not shown on another run", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const gate = (id: string) => (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <RunPlanGate runId={id} runStatus="plan_pending_confirmation" />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(gate(RUN_ID));
    fireEvent.click(await screen.findByRole('button', { name: CONFIRM }));
    expect(await screen.findByText('Plan confirmed. Starting the research…')).toBeInTheDocument();
    // The page moves to another run that is also waiting at its plan; the component is reused.
    view.rerender(gate('another-run'));
    expect(screen.queryByText('Plan confirmed. Starting the research…')).toBeNull();
    expect(await screen.findByRole('button', { name: CONFIRM })).toBeInTheDocument();
  });

  it('a confirmation the server had already received is reported as that, not as an error', async () => {
    confirmRunPlanAtGate.mockResolvedValue({ ok: true, runId: RUN_ID, planId: 'plan-1', status: 'already_confirmed', alreadyConfirmed: true, message: PLAN_ALREADY_CONFIRMED_MESSAGE });
    const { onNotify, onAfterConfirm } = panel();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(onAfterConfirm).toHaveBeenCalledTimes(1));
    expect(onNotify).toHaveBeenCalledWith('info', 'This plan is already confirmed. The research has started, so there is nothing more to do.');
    expect(onNotify).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('a confirmation that failed can be sent again', async () => {
    confirmRunPlanAtGate.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ok: true, runId: RUN_ID, planId: 'plan-1', status: 'resume_queued' });
    const { onNotify, onAfterConfirm } = panel();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('error', expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    await waitFor(() => expect(onAfterConfirm).toHaveBeenCalledTimes(1));
    expect(confirmRunPlanAtGate).toHaveBeenCalledTimes(2);
  });

  it('the rule itself: the second caller sends nothing', async () => {
    const sent = { current: false };
    let finish: (value: { alreadyConfirmed?: boolean }) => void = () => undefined;
    const send = vi.fn(() => new Promise<{ alreadyConfirmed?: boolean }>((resolve) => { finish = resolve; }));
    const first = confirmPlanOnce(sent, send);
    await expect(confirmPlanOnce(sent, send)).resolves.toEqual({ outcome: 'in_flight', message: PLAN_CONFIRM_IN_FLIGHT_MESSAGE });
    finish({});
    await expect(first).resolves.toEqual({ outcome: 'confirmed' });
    expect(send).toHaveBeenCalledTimes(1);
    // Confirmed: a later press still sends nothing.
    await expect(confirmPlanOnce(sent, send)).resolves.toMatchObject({ outcome: 'in_flight' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
