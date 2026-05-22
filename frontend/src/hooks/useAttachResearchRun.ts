import { useCallback } from 'react';
import { getResearchRun, type ResearchProgressEvent, type ResearchRun } from '../utils/api';
import { subscribeToJob } from '../utils/socket';
import type { PlanGateSnapshot } from '../components/research/PlanConfirmationPanel';
import type { RunSummaryData } from '../components/research/RunSummaryReport';

function normalizeProgressEvent(evt: ResearchProgressEvent): ResearchProgressEvent {
  return {
    ...evt,
    stage: evt.stage || 'planning',
    percent: Number.isFinite(evt.percent) ? evt.percent : 0,
    message: evt.message || evt.stage || 'Update',
    timestamp: evt.timestamp || new Date().toISOString(),
  };
}

function eventsFromRunRow(run: ResearchRun): ResearchProgressEvent[] {
  const raw = run.progress_events;
  if (!Array.isArray(raw) || raw.length === 0) {
    const fallback: ResearchProgressEvent = {
      runId: run.id,
      stage: run.progress_stage || run.status || 'planning',
      percent: run.progress_percent ?? 0,
      message: run.progress_message || 'Resuming run…',
      timestamp: run.progress_updated_at || new Date().toISOString(),
    };
    return [fallback];
  }
  return raw.map((e) =>
    normalizeProgressEvent({
      ...e,
      runId: e.runId || run.id,
    })
  );
}

export type AttachResearchRunArgs = {
  runId: string;
  runRow?: ResearchRun | null;
  setTrackingRunId: (id: string | null) => void;
  lastKnownRunIdRef: React.MutableRefObject<string | null>;
  setProgress: (evt: ResearchProgressEvent | null) => void;
  setActiveRun: (evt: ResearchProgressEvent | null) => void;
  setTraceEvents: React.Dispatch<React.SetStateAction<ResearchProgressEvent[]>>;
  setFailure: (f: null) => void;
  setRunSummary: (s: RunSummaryData | null) => void;
  runSummaryReceivedRef: React.MutableRefObject<boolean>;
  setPlanGateLocal: React.Dispatch<React.SetStateAction<PlanGateSnapshot | null>>;
  setPlanGateBusy: (v: boolean) => void;
};

export type AttachResearchRunResult = {
  /** True when progress/trace were hydrated from API or run row (not loading placeholder). */
  hydratedFromApi: boolean;
};

/** Hydrate client tracking state from API + subscribe to job room. */
export function useAttachResearchRun() {
  const attachRun = useCallback(async (args: AttachResearchRunArgs): Promise<AttachResearchRunResult> => {
    const {
      runId,
      runRow,
      setTrackingRunId,
      lastKnownRunIdRef,
      setProgress,
      setActiveRun,
      setTraceEvents,
      setFailure,
      setRunSummary,
      runSummaryReceivedRef,
      setPlanGateLocal,
      setPlanGateBusy,
    } = args;

    setTrackingRunId(runId);
    lastKnownRunIdRef.current = runId;
    setFailure(null);
    setRunSummary(null);
    runSummaryReceivedRef.current = false;
    setPlanGateBusy(false);
    subscribeToJob(runId);

    let run = runRow ?? null;
    if (!run || run.id !== runId) {
      try {
        run = await getResearchRun(runId);
      } catch {
        run = null;
      }
    }

    if (run) {
      const events = eventsFromRunRow(run);
      const latest = events[events.length - 1] ?? null;
      if (latest) {
        setProgress(latest);
        setActiveRun(latest);
      }
      setTraceEvents(events.slice(-150));

      if (run.status !== 'plan_pending_confirmation') {
        setPlanGateLocal(null);
      }
      return { hydratedFromApi: true };
    }

    const queuedEvt: ResearchProgressEvent = {
      runId,
      stage: 'planning',
      percent: 0,
      message: 'Loading run…',
      timestamp: new Date().toISOString(),
    };
    setProgress(queuedEvt);
    setActiveRun(queuedEvt);
    setTraceEvents([queuedEvt]);
    return { hydratedFromApi: false };
  }, []);

  return { attachRun };
}
