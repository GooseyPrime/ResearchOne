import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRunPlanForGate } from '../utils/api';
import type { PlanGateSnapshot } from '../components/research/PlanConfirmationPanel';
import { getAdaptiveRefetchIntervalMs } from '../utils/apiRateLimit';

/** REST hydrate for `plan_pending_confirmation` when socket was missed or on refresh. */
export function usePlanGateHydration({
  trackingRunId,
  runStatus,
  setPlanGateLocal,
}: {
  trackingRunId: string | null;
  runStatus: string | undefined;
  planGateLocal?: PlanGateSnapshot | null;
  setPlanGateLocal: Dispatch<SetStateAction<PlanGateSnapshot | null>>;
}) {
  const needsGatePlanPoll =
    Boolean(trackingRunId) && runStatus === 'plan_pending_confirmation';

  const { data: gatePlanResponse } = useQuery({
    queryKey: ['run-plan-gate', trackingRunId],
    queryFn: () => getRunPlanForGate(trackingRunId!),
    enabled: needsGatePlanPoll,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(12_000),
  });

  useEffect(() => {
    if (!trackingRunId || !gatePlanResponse?.plan?.planId) return;
    if (gatePlanResponse.runStatus !== 'plan_pending_confirmation') {
      setPlanGateLocal((prev) => (prev?.runId === trackingRunId ? null : prev));
      return;
    }
    const p = gatePlanResponse.plan;
    const planId = p.planId;
    if (!planId) return;
    setPlanGateLocal((prev) => {
      const basePayload = (p.planPayload ?? {}) as Record<string, unknown>;
      if (!prev || prev.runId !== trackingRunId) {
        return {
          runId: trackingRunId,
          planId,
          planPayload: basePayload,
          refinementRounds: p.refinementRounds ?? 0,
        };
      }
      const pr = p.refinementRounds ?? 0;
      if (pr > prev.refinementRounds) {
        return { ...prev, planPayload: basePayload, refinementRounds: pr, planId };
      }
      return prev;
    });
  }, [gatePlanResponse, trackingRunId, setPlanGateLocal]);

  return { gatePlanResponse, needsGatePlanPoll };
}
