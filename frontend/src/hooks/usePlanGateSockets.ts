import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../utils/socket';
import type { PlanGateSnapshot } from '../components/research/PlanConfirmationPanel';
import { liveResearchUrl } from '../utils/researchRunRoutes';
import { useStore } from '../store/useStore';

type PlanReadyPayload = {
  runId: string;
  planId: string;
  planPayload: unknown;
  refinementRounds?: number;
};

/**
 * Registers Wave 5.1 plan gate socket listeners for the active research page.
 */
export function usePlanGateSockets({
  trackingRunId,
  engineVersionHint,
  setPlanGateLocal,
  setPlanGateBusy,
  onDetachAfterCancel,
}: {
  trackingRunId: string | null;
  /** Engine version for review-plan links (from tracked run row when known). */
  engineVersionHint?: string | null;
  setPlanGateLocal: React.Dispatch<React.SetStateAction<PlanGateSnapshot | null>>;
  setPlanGateBusy: React.Dispatch<React.SetStateAction<boolean>>;
  onDetachAfterCancel?: () => void;
}) {
  const qc = useQueryClient();
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    const socket = getSocket();

    const onPlanReady = (payload: PlanReadyPayload) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (payload.runId === trackingRunId && payload.planId) {
        setPlanGateLocal({
          runId: payload.runId,
          planId: payload.planId,
          planPayload: (payload.planPayload ?? {}) as Record<string, unknown>,
          refinementRounds: Number(payload.refinementRounds ?? 0),
        });
        addNotification('info', 'Research plan is ready — review and confirm to continue.', {
          label: 'Review plan',
          to: liveResearchUrl(payload.runId, {
            engineVersion: engineVersionHint,
            focusPlan: true,
          }),
        });
      }
    };

    const onPlanRefined = (payload: {
      runId: string;
      revisedPlan?: Record<string, unknown>;
      refinementRounds?: number;
    }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (payload.runId !== trackingRunId) return;
      setPlanGateLocal((prev) => {
        if (!prev || prev.runId !== payload.runId) return prev;
        return {
          ...prev,
          planPayload: (payload.revisedPlan ?? prev.planPayload) as Record<string, unknown>,
          refinementRounds: Number(payload.refinementRounds ?? prev.refinementRounds),
        };
      });
    };

    const onPlanConfirmed = (payload: { runId: string }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      void qc.invalidateQueries({ queryKey: ['research-run', payload.runId] }, { cancelRefetch: false });
      if (payload.runId === trackingRunId) {
        setPlanGateLocal(null);
        setPlanGateBusy(false);
      }
    };

    const onPlanCancelled = (payload: { runId: string }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (payload.runId === trackingRunId) {
        setPlanGateLocal(null);
        setPlanGateBusy(false);
        onDetachAfterCancel?.();
        addNotification('info', 'Research run cancelled at the plan gate.');
      }
    };

    socket.on('research:plan_ready_for_confirmation', onPlanReady);
    socket.on('research:plan_refined', onPlanRefined);
    socket.on('research:plan_confirmed', onPlanConfirmed);
    socket.on('research:plan_cancelled', onPlanCancelled);

    return () => {
      socket.off('research:plan_ready_for_confirmation', onPlanReady);
      socket.off('research:plan_refined', onPlanRefined);
      socket.off('research:plan_confirmed', onPlanConfirmed);
      socket.off('research:plan_cancelled', onPlanCancelled);
    };
  }, [
    trackingRunId,
    engineVersionHint,
    qc,
    setPlanGateLocal,
    setPlanGateBusy,
    onDetachAfterCancel,
    addNotification,
  ]);
}
