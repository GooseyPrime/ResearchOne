import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '../utils/socket';
import { liveResearchUrl } from '../utils/researchRunRoutes';
import { useStore } from '../store/useStore';
import type { ResearchRun } from '../utils/api';

type PlanReadyPayload = {
  runId: string;
  planId: string;
  planPayload?: unknown;
  refinementRounds?: number;
};

/**
 * When the user is away from research pages, surface plan-ready with a deep link CTA.
 */
export function useGlobalPlanReadyNotify(runs: ResearchRun[] | undefined) {
  const location = useLocation();
  const qc = useQueryClient();
  const addNotification = useStore((s) => s.addNotification);

  useEffect(() => {
    const socket = getSocket();

    const onPlanReady = (payload: PlanReadyPayload) => {
      if (!payload?.runId || !payload.planId) return;
      void qc.invalidateQueries({ queryKey: ['research-runs'] });

      const path = location.pathname;
      if (path.startsWith('/app/research')) return;

      const row = runs?.find((r) => r.id === payload.runId);
      addNotification('info', 'Research plan is ready — review and confirm to continue.', {
        label: 'Review plan',
        to: liveResearchUrl(payload.runId, {
          engineVersion: row?.engine_version,
          focusPlan: true,
        }),
      });
    };

    socket.on('research:plan_ready_for_confirmation', onPlanReady);
    return () => {
      socket.off('research:plan_ready_for_confirmation', onPlanReady);
    };
  }, [location.pathname, runs, qc, addNotification]);
}
