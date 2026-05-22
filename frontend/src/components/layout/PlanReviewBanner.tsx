import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getResearchRuns, type ResearchRun } from '../../utils/api';
import { getAdaptiveRefetchIntervalMs } from '../../utils/apiRateLimit';
import { liveResearchUrl } from '../../utils/researchRunRoutes';

/**
 * Global amber banner when any run is waiting at the plan confirmation gate.
 */
export default function PlanReviewBanner() {
  const { data: runs = [] } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    refetchInterval: () => getAdaptiveRefetchIntervalMs(8_000),
  });

  const pending = runs.filter((r) => r.status === 'plan_pending_confirmation');
  if (pending.length === 0) return null;

  const top = pending[0];
  const more = pending.length > 1 ? ` (+${pending.length - 1} more)` : '';

  return (
    <div className="border-b border-amber-700/40 bg-amber-950/35 px-4 py-2">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2 text-amber-100 min-w-0">
          <ClipboardCheck size={16} className="shrink-0 text-amber-300" />
          <span className="truncate">
            <span className="font-medium">Research plan ready</span>
            <span className="text-amber-200/80 ml-2 hidden sm:inline">
              Confirm or refine before the pipeline continues{more}.
            </span>
          </span>
        </div>
        <Link
          to={liveResearchUrl(top.id, { engineVersion: top.engine_version, focusPlan: true })}
          className="btn-secondary text-xs py-1 px-3 shrink-0"
        >
          Review plan
        </Link>
      </div>
    </div>
  );
}
