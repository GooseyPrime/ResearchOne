/**
 * RecentRuns - List of recent research runs from Emma backend
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Clock, ChevronRight, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import type { RunStatus } from '@/lib/researchone/types';
import { evidenceTierMeta } from '@/content/researchoneUiData';
import { getResearchRuns } from '@/utils/api';
import { isInFlightApiStatus, mapApiRunToVaultRun } from '@/lib/researchone/runMappers';

const statusConfig: Record<RunStatus, { icon: typeof CheckCircle; color: string; label: string }> = {
  queued: { icon: Clock, color: 'text-r1-muted', label: 'Queued' },
  running: { icon: Loader2, color: 'text-r1-cyan', label: 'Running' },
  complete: { icon: CheckCircle, color: 'text-r1-green', label: 'Complete' },
  failed: { icon: XCircle, color: 'text-r1-skeptic', label: 'Failed' },
  cancelled: { icon: AlertCircle, color: 'text-r1-amber', label: 'Cancelled' },
};

function runHref(runId: string, apiStatus: string): string {
  return isInFlightApiStatus(apiStatus) ? `/app/run/${runId}` : '/app/dossiers';
}

export function RecentRuns() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['research-runs', 'recent'],
    queryFn: () => getResearchRuns(),
  });

  const runs = (data ?? []).slice(0, 8).map(mapApiRunToVaultRun);
  const apiStatusById = new Map((data ?? []).map((row) => [row.id, row.status]));

  if (isLoading) {
    return (
      <div className="r1-panel p-8 text-center">
        <Loader2 className="w-6 h-6 text-r1-cyan animate-spin mx-auto" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="r1-panel p-8 text-center">
        <p className="text-r1-muted text-sm">Unable to load recent runs.</p>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div data-ev-id="ev_7175445cfc" className="r1-panel p-8 text-center">
        <div data-ev-id="ev_ad24132d27" className="r1-mono-label text-[11px] text-r1-dim mb-2">
          NO_RECENT_RUNS
        </div>
        <p data-ev-id="ev_96ad61c3fe" className="text-r1-muted">
          Start your first research to see results here.
        </p>
      </div>
    );
  }

  return (
    <div data-ev-id="ev_a9cbe33dc4" className="r1-panel">
      <div data-ev-id="ev_ec3b2e04f1" className="flex items-center justify-between p-4 border-b border-r1-border">
        <span data-ev-id="ev_7b3df42b7d" className="r1-mono-label text-[10px]">
          RECENT_RUNS
        </span>
        <Link
          to="/app/dossiers"
          className="text-xs text-r1-muted hover:text-r1-cyan transition-colors flex items-center gap-1"
        >
          View all
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <div data-ev-id="ev_8b43780922" className="divide-y divide-r1-border">
        {runs.map((run, index) => {
          const status = statusConfig[run.status];
          const StatusIcon = status.icon;
          const tierMeta = evidenceTierMeta[run.evidenceTier];
          const apiStatus = apiStatusById.get(run.id) ?? run.status;

          return (
            <motion.div
              key={run.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className="p-4 hover:bg-r1-panel-lift transition-colors"
            >
              <Link to={runHref(run.id, apiStatus)} className="block">
                <div data-ev-id="ev_4a1a78886d" className="flex items-start gap-4">
                  <div data-ev-id="ev_01c881d9da" className={`flex-shrink-0 mt-1 ${status.color}`}>
                    <StatusIcon className={`w-4 h-4 ${run.status === 'running' ? 'animate-spin' : ''}`} />
                  </div>

                  <div data-ev-id="ev_cc18836fbb" className="flex-1 min-w-0">
                    <div data-ev-id="ev_11df843385" className="flex items-center gap-2 flex-wrap mb-1">
                      <span
                        data-ev-id="ev_3733080d30"
                        className={`r1-tag text-[9px] ${
                          tierMeta.color === 'cyan'
                            ? 'r1-tag-cyan'
                            : tierMeta.color === 'green'
                              ? 'r1-tag-green'
                              : tierMeta.color === 'amber'
                                ? 'r1-tag-amber'
                                : ''
                        }`}
                      >
                        {tierMeta.label.toUpperCase()}
                      </span>
                      <span data-ev-id="ev_4870d2aab3" className="r1-mono-label text-[9px] text-r1-dim">
                        {run.mode.toUpperCase()}
                      </span>
                    </div>
                    <p data-ev-id="ev_0e8e8e8e8e" className="text-sm text-r1-heading line-clamp-2">
                      {run.query}
                    </p>
                    <div data-ev-id="ev_progress" className="mt-2 flex items-center gap-3 text-xs text-r1-dim">
                      <span>{status.label}</span>
                      {run.status === 'running' && <span>{run.progress}%</span>}
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-r1-muted flex-shrink-0 mt-1" />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default RecentRuns;
