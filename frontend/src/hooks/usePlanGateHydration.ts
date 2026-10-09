import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRunPlanForGate } from '../utils/api';
import type { PlanGateSnapshot } from '../components/research/PlanConfirmationPanel';
import { getAdaptiveRefetchIntervalMs } from '../utils/apiRateLimit';

/** How often the plan is asked for while a run waits at its plan and no plan has arrived yet. */
export const PLAN_FIRST_LOAD_POLL_MS = 2_000;
/** How often it is asked for again once it is on screen (a change made in another tab). */
export const PLAN_LOADED_POLL_MS = 12_000;

/**
 * How long to wait before asking for the plan again (RJ-018).
 *
 * This was one interval for both cases, lengthened six times over while the
 * live connection was healthy: 72 seconds. A first request that came back
 * without the plan (the run reaches "waiting for your go-ahead" a moment before
 * the plan can be read) therefore left "Loading research plan…" on screen for
 * over a minute, and a reload was the only thing that helped. Until the plan is
 * on screen it is asked for every two seconds; once it is, the slow, adaptive
 * interval is right again.
 */
export function planGatePollIntervalMs(planLoaded: boolean): number {
  return planLoaded ? getAdaptiveRefetchIntervalMs(PLAN_LOADED_POLL_MS) : PLAN_FIRST_LOAD_POLL_MS;
}

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

  const { data: gatePlanResponse, isError: gatePlanError } = useQuery({
    queryKey: ['run-plan-gate', trackingRunId],
    queryFn: () => getRunPlanForGate(trackingRunId!),
    enabled: needsGatePlanPoll,
    refetchInterval: (query) => planGatePollIntervalMs(Boolean(query.state.data?.plan?.planId)),
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

  return { gatePlanResponse, needsGatePlanPoll, gatePlanError };
}
