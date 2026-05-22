import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { PlanGateSnapshot } from '../components/research/PlanConfirmationPanel';
import type { RunSummaryData } from '../components/research/RunSummaryReport';
import type { ResearchProgressEvent } from '../utils/api';
import { useAttachResearchRun, type AttachResearchRunArgs } from './useAttachResearchRun';
import { usePlanGateHydration } from './usePlanGateHydration';
import { usePlanGateSockets } from './usePlanGateSockets';
import { useResearchRunUrlSync } from './useResearchRunUrlSync';

export type ResearchRunTrackingDeps = {
  trackingRunId: string | null;
  setTrackingRunId: (id: string | null) => void;
  lastKnownRunIdRef: MutableRefObject<string | null>;
  setProgress: (evt: ResearchProgressEvent | null) => void;
  setActiveRun: (evt: ResearchProgressEvent | null) => void;
  setTraceEvents: Dispatch<SetStateAction<ResearchProgressEvent[]>>;
  setFailure: (f: null) => void;
  setRunSummary: (s: RunSummaryData | null) => void;
  runSummaryReceivedRef: MutableRefObject<boolean>;
  setPlanGateLocal: Dispatch<SetStateAction<PlanGateSnapshot | null>>;
  setPlanGateBusy: Dispatch<SetStateAction<boolean>>;
  /** Polled or list row status for plan hydration. */
  runStatus?: string;
  engineVersionHint?: string | null;
};

/**
 * URL sync, attach/detach, plan REST hydration, and plan gate sockets for research pages.
 */
export function useResearchRunTracking(deps: ResearchRunTrackingDeps) {
  const {
    trackingRunId,
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
    runStatus,
    engineVersionHint,
  } = deps;

  usePlanGateHydration({
    trackingRunId,
    runStatus,
    setPlanGateLocal,
  });

  const { attachRun: attachRunInner } = useAttachResearchRun();

  const attachArgs = useCallback(
    (): Omit<AttachResearchRunArgs, 'runId' | 'runRow'> => ({
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
    }),
    [
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
    ]
  );

  const attachRun = useCallback(
    (opts: { runId: string; runRow?: AttachResearchRunArgs['runRow'] }) =>
      attachRunInner({ ...opts, ...attachArgs() }),
    [attachRunInner, attachArgs]
  );

  const { setUrlRunId, dismissUrlReattach } = useResearchRunUrlSync({
    trackingRunId,
    onRunIdFromUrl: (runId) => {
      void attachRun({ runId });
    },
  });

  const detachRun = useCallback(() => {
    dismissUrlReattach(trackingRunId);
    setUrlRunId(null);
    setProgress(null);
    setTrackingRunId(null);
    setActiveRun(null);
    setPlanGateLocal(null);
    setPlanGateBusy(false);
  }, [
    trackingRunId,
    dismissUrlReattach,
    setUrlRunId,
    setProgress,
    setTrackingRunId,
    setActiveRun,
    setPlanGateLocal,
    setPlanGateBusy,
  ]);

  usePlanGateSockets({
    trackingRunId,
    engineVersionHint,
    setPlanGateLocal,
    setPlanGateBusy,
    onDetachAfterCancel: detachRun,
  });

  return { attachRun, detachRun, setUrlRunId, attachArgs };
}
