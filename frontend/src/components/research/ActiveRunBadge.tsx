import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { getResearchRuns, type ResearchRun } from '../../utils/api';
import { getAdaptiveRefetchIntervalMs } from '../../utils/apiRateLimit';
import { liveResearchUrl } from '../../utils/researchRunRoutes';

function stageLabel(stage?: string): string {
  if (!stage) return 'running';
  if (stage === 'plan_pending_confirmation') return 'plan review';
  return stage.replace(/_/g, ' ');
}

export default function ActiveRunBadge() {
  const { activeRun } = useStore();
  const { data: runs = [] } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    enabled: Boolean(activeRun?.runId),
    staleTime: 5_000,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(8_000),
  });

  if (!activeRun?.runId) return null;

  const row = runs.find((r) => r.id === activeRun.runId);
  const href = liveResearchUrl(activeRun.runId, {
    engineVersion: row?.engine_version,
    focusPlan: row?.status === 'plan_pending_confirmation',
  });

  const isWarning = activeRun.eventType === 'run_failed' || activeRun.stage === 'failed';
  const isPlanReview =
    row?.status === 'plan_pending_confirmation' || activeRun.stage === 'plan_pending_confirmation';

  return (
    <Link
      to={href}
      className={
        isWarning
          ? 'flex items-center gap-2 bg-amber-900/20 border border-amber-700/40 rounded-full px-3 py-1 hover:border-amber-600/60 transition-colors'
          : isPlanReview
            ? 'flex items-center gap-2 bg-amber-950/30 border border-amber-700/35 rounded-full px-3 py-1 hover:border-amber-600/50 transition-colors'
            : 'flex items-center gap-2 bg-accent/10 border border-accent/30 rounded-full px-3 py-1 hover:border-accent/50 transition-colors'
      }
      title="Open active research run"
    >
      {isWarning ? (
        <AlertTriangle size={12} className="text-amber-400" />
      ) : (
        <Activity size={12} className={isPlanReview ? 'text-amber-300' : 'text-accent animate-pulse'} />
      )}
      <span
        className={
          isWarning
            ? 'text-xs text-amber-300 font-medium truncate max-w-48'
            : isPlanReview
              ? 'text-xs text-amber-200 font-medium truncate max-w-48'
              : 'text-xs text-accent font-medium truncate max-w-48'
        }
      >
        {stageLabel(activeRun.stage)}: {Math.max(0, Math.round(activeRun.percent ?? 0))}%
      </span>
    </Link>
  );
}
