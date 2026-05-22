import { useEffect, useRef } from 'react';
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
 * `runs` is read from a ref so the socket listener is not re-registered on every poll.
 */
export function useGlobalPlanReadyNotify(runs: ResearchRun[] | undefined) {
  const location = useLocation();
  const qc = useQueryClient();
  const addNotification = useStore((s) => s.addNotification);
  const runsRef = useRef<ResearchRun[]>([]);
  const pathnameRef = useRef(location.pathname);
  runsRef.current = runs ?? [];
  pathnameRef.current = location.pathname;

  useEffect(() => {
    const socket = getSocket();

    const onPlanReady = (payload: PlanReadyPayload) => {
      if (!payload?.runId || !payload.planId) return;
      void qc.invalidateQueries({ queryKey: ['research-runs'] });

      if (pathnameRef.current.startsWith('/app/research')) return;

      const row = runsRef.current.find((r) => r.id === payload.runId);
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
  }, [qc, addNotification]);
}
