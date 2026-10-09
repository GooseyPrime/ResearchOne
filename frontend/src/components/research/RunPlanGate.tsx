import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import PlanConfirmationPanel, { type PlanGateSnapshot } from './PlanConfirmationPanel';
import { usePlanGateHydration } from '../../hooks/usePlanGateHydration';
import { PLAN_PREFERENCES_QUERY_KEY, usePlanPreferencesQuery } from '../../hooks/usePlanPreferences';
import {
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
} from '../../hooks/useBillingSubscription';
import { useStore } from '../../store/useStore';
import { getSocket } from '../../utils/socket';
import { requestPrefillUrl } from '../../utils/researchRunRoutes';

/**
 * The plan confirmation gate, wherever a run lives.
 *
 * It used to be wired up twice, once inside `ResearchStandardPage` and once
 * inside `ResearchDeepPage`, which is why the header pill had to deep-link back
 * to `/app/research?runId=…#plan` to reach it — the one case where the request
 * page was not a request page. A run now proceeds in its own workspace, so the
 * gate has to be there too, and it is defined once.
 *
 * NO ENGINE GATE (deliberately, on the operator's instruction).
 *
 * `ResearchStandardPage` passed `tierAllowsSavedProfiles={false}` and no
 * `planPrefs`; `ResearchDeepPage` passed both. My first pass reproduced that
 * split by gating on `engine_version`, on the T4 reasoning that consolidating
 * two call sites must not silently grant one of them capabilities it never had.
 *
 * That was the wrong question. The operator's answer: there is no v1 and v2 —
 * every report is orchestrated by the same agents, which decide what a request
 * needs from the request itself. A gate on `engine_version` encodes a
 * distinction the system no longer makes, so preserving it faithfully would
 * have been preserving a bug. Auto-confirm and saved profiles are account
 * capabilities, gated on the account's tier and nothing else.
 *
 * `engine_version` still exists on the row and still gates a separate DEEP
 * report quota in `checkTierAccess` / `incrementReportCount`. Removing that is
 * a pricing decision, not a refactor, and is tracked separately.
 *
 * WHAT RJ-018 CHANGED (live check of 9 Oct 2026)
 *
 *  - "Review plan" did nothing. Its link is this page's own address with
 *    `#plan` on the end, and nothing on the page acted on that: no scroll, and
 *    no fresh look at the run. This component now acts on it every time the
 *    link is pressed (see `wantsPlan`), including when the address is already
 *    showing.
 *  - The plan appeared about a minute later, after a reload. The moved gate had
 *    lost the old pages' listener for the server's "plan is ready" message, so
 *    it waited for the next poll — and the plan's own poll ran every 72 seconds
 *    while the live connection was healthy. It listens again, and asks every
 *    two seconds until the plan is on screen (`planGatePollIntervalMs`).
 *  - While the plan loads there is a visible loading state, with a spinner.
 *  - The panel is drawn once, at its final height. The row that offers to save
 *    the settings and the notes about automatic confirmation depend on account
 *    details that arrive after the plan does; when they arrived they pushed
 *    "Confirm & run" down the page, and a click aimed at where the button had
 *    just been missed it. The panel now waits (briefly, and never more than
 *    `ACCOUNT_WAIT_MS`) for those details before it is drawn.
 */
export interface RunPlanGateProps {
  runId: string;
  runStatus: string | undefined;
}

/** The longest the panel waits for account details before it is drawn without them. */
export const ACCOUNT_WAIT_MS = 2_500;

type PlanReadyPayload = {
  runId?: string;
  planId?: string;
  planPayload?: unknown;
  refinementRounds?: number;
};

const LOADING_CLASS =
  'flex items-center gap-3 rounded-xl border border-amber-700/35 bg-amber-950/20 p-4 text-sm text-amber-100/90 outline-none';

export default function RunPlanGate({ runId, runStatus }: RunPlanGateProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [snapshot, setSnapshot] = useState<PlanGateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  /** "Review plan" was pressed and the run's newest state is being fetched. */
  const [checking, setChecking] = useState(false);
  /** This page confirmed the plan and the run has not yet reported that it started. */
  // Held as the run it belongs to: this component is reused when the page moves
  // to another run, and run A's confirmation must not be shown on run B.
  const [confirmedRunId, setConfirmedRunId] = useState<string | null>(null);
  const confirmedHere = confirmedRunId === runId;
  const setConfirmedHere = (value: boolean) => setConfirmedRunId(value ? runId : null);
  const [waitedForAccount, setWaitedForAccount] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: subscriptionData, isLoading: subLoading, isError: subError, authReady } =
    useBillingSubscriptionQuery();
  const tierResolved = authReady && !subLoading && (!subError || Boolean(subscriptionData));
  const tier = tierResolved ? effectiveEntitlementTier(subscriptionData) : null;
  const planPrefsQuery = usePlanPreferencesQuery({ enabled: authReady && tierResolved });

  usePlanGateHydration({ trackingRunId: runId, runStatus, setPlanGateLocal: setSnapshot });

  const waiting = runStatus === 'plan_pending_confirmation';
  const wantsPlan = location.hash === '#plan';
  const planLoaded = Boolean(snapshot && snapshot.runId === runId);
  const accountSettled = tierResolved && !planPrefsQuery.isLoading;
  const drawPanel = planLoaded && (accountSettled || waitedForAccount);

  // The server says the plan is ready. Show it now rather than at the next poll.
  useEffect(() => {
    const socket = getSocket();
    const onPlanReady = (payload: PlanReadyPayload) => {
      if (!payload || payload.runId !== runId) return;
      const planId = payload.planId;
      if (planId && payload.planPayload && typeof payload.planPayload === 'object') {
        setSnapshot((prev) =>
          prev && prev.runId === runId && prev.planId === planId
            ? prev
            : {
                runId,
                planId,
                planPayload: payload.planPayload as Record<string, unknown>,
                refinementRounds: payload.refinementRounds ?? 0,
              }
        );
      }
      setConfirmedRunId(null);
      void qc.invalidateQueries({ queryKey: ['research-run', runId] });
      void qc.invalidateQueries({ queryKey: ['run-plan-gate', runId] });
    };
    socket.on('research:plan_ready_for_confirmation', onPlanReady);
    return () => {
      socket.off('research:plan_ready_for_confirmation', onPlanReady);
    };
  }, [runId, qc]);

  // "Review plan" was pressed (here or anywhere): look at the run again now. A
  // page that still believes the run is working would otherwise show nothing.
  useEffect(() => {
    if (!wantsPlan) return;
    let live = true;
    setChecking(true);
    void Promise.allSettled([
      qc.refetchQueries({ queryKey: ['research-run', runId] }),
      qc.invalidateQueries({ queryKey: ['run-plan-gate', runId] }),
    ]).finally(() => {
      if (live) setChecking(false);
    });
    return () => {
      live = false;
    };
    // `location.key` changes on every press, also when the address is unchanged.
  }, [wantsPlan, location.key, runId, qc]);

  // Never wait for account details longer than this; the plan matters more.
  useEffect(() => {
    if (!planLoaded || accountSettled) return;
    const timer = window.setTimeout(() => setWaitedForAccount(true), ACCOUNT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [planLoaded, accountSettled]);

  useEffect(() => {
    if (!waiting) setConfirmedRunId(null);
  }, [waiting]);

  // Another run: nothing of the last one carries over.
  useEffect(() => {
    setSnapshot((prev) => (prev && prev.runId !== runId ? null : prev));
    setBusy(false);
    setChecking(false);
    setWaitedForAccount(false);
    setConfirmedRunId((prev) => (prev === runId ? prev : null));
  }, [runId]);

  const showConfirmed = confirmedHere && waiting;
  const showLoading = !showConfirmed && ((waiting && !drawPanel) || (wantsPlan && checking && !waiting));
  const showPanel = !showConfirmed && waiting && drawPanel;
  const shown = showConfirmed ? 'confirmed' : showPanel ? 'plan' : showLoading ? 'loading' : 'none';

  // Bring the plan into view: when "Review plan" is pressed, and again when the
  // plan replaces the loading line, so the person lands on the plan itself.
  useEffect(() => {
    if (!wantsPlan || shown === 'none') return;
    const node = containerRef.current;
    if (!node) return;
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    node.focus({ preventScroll: true });
  }, [wantsPlan, location.key, shown]);

  if (shown === 'none') return null;

  if (shown === 'confirmed') {
    return (
      <div id="plan" ref={containerRef} tabIndex={-1} role="status" className={LOADING_CLASS}>
        <CheckCircle2 size={18} className="shrink-0 text-emerald-300" aria-hidden />
        <span>Plan confirmed. Starting the research…</span>
      </div>
    );
  }

  if (shown === 'loading' || !snapshot) {
    return (
      <div
        id="plan"
        ref={containerRef}
        tabIndex={-1}
        role="status"
        aria-busy="true"
        data-testid="plan-loading"
        className={LOADING_CLASS}
      >
        <Loader2 size={18} className="shrink-0 animate-spin text-amber-300" aria-hidden />
        <span>Loading your research plan…</span>
      </div>
    );
  }

  return (
    <div id="plan" ref={containerRef} tabIndex={-1} className="scroll-mt-4 outline-none">
      <PlanConfirmationPanel
        snapshot={snapshot}
        busy={busy}
        onBusy={setBusy}
        planPrefs={planPrefsQuery.data}
        tierAllowsSavedProfiles={Boolean(tier && tier !== 'free_demo')}
        onInvalidatePlanPrefs={() =>
          void qc.invalidateQueries({ queryKey: PLAN_PREFERENCES_QUERY_KEY })
        }
        onInvalidateSavedProfiles={() =>
          void qc.invalidateQueries({ queryKey: ['saved-orchestration-profiles'] })
        }
        onAfterConfirm={() => {
          setConfirmedHere(true);
          setSnapshot(null);
          setBusy(false);
          void qc.invalidateQueries({ queryKey: ['research-runs'] });
          void qc.invalidateQueries({ queryKey: ['research-run', runId] }, { cancelRefetch: false });
          void qc.invalidateQueries({ queryKey: PLAN_PREFERENCES_QUERY_KEY }, { cancelRefetch: false });
        }}
        onAfterCancel={() => {
          // What the old handler did here was `applyRequestFormFromRun(row)` —
          // it put the user's request back into the form they were looking at,
          // because cancelling a plan means "not like that, let me edit it".
          // The workspace has no form, so the equivalent is to send them to the
          // one place that does, with the request restored (Rule 44 T4).
          void qc.invalidateQueries({ queryKey: ['research-runs'] });
          navigate(requestPrefillUrl(runId), { replace: true });
        }}
        onNotify={(kind, message) => addNotification(kind, message)}
        onGatePlanMutated={() => {
          void qc.invalidateQueries({ queryKey: ['research-runs'] });
          void qc.invalidateQueries({ queryKey: ['run-plan-gate', runId] }, { cancelRefetch: false });
        }}
      />
    </div>
  );
}
