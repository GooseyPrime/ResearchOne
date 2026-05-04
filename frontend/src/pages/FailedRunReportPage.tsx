import type { ReactNode } from 'react';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getResearchRun,
  getRunArtifacts,
  retryResearchRunFromFailure,
  extractApiError,
} from '../utils/api';
import {
  ArrowLeft,
  XCircle,
  AlertTriangle,
  Database,
  Brain,
  RefreshCw,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import clsx from 'clsx';

const TIER_COLORS: Record<string, string> = {
  established_fact: 'text-green-400',
  strong_evidence: 'text-blue-400',
  testimony: 'text-purple-400',
  inference: 'text-amber-400',
  speculation: 'text-red-400',
};

export default function FailedRunReportPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [retryError, setRetryError] = useState<string | null>(null);

  const { data: run, isLoading: runLoading, error: runError } = useQuery({
    queryKey: ['research-run', runId],
    queryFn: () => getResearchRun(runId!),
    enabled: Boolean(runId),
  });

  const {
    data: artifacts,
    isLoading: artifactsLoading,
    isError: artifactsError,
    error: artifactsErrorObj,
    refetch: refetchArtifacts,
  } = useQuery({
    queryKey: ['run-artifacts', runId],
    queryFn: () => getRunArtifacts(runId!),
    enabled: Boolean(runId),
    retry: 1,
  });

  const retryMutation = useMutation({
    mutationFn: () => retryResearchRunFromFailure(runId!),
    onSuccess: () => navigate('/research-v2'),
    onError: (err) => setRetryError(extractApiError(err)),
  });

  if (runLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm animate-pulse">
        Loading run data…
      </div>
    );
  }

  if (runError || !run) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 text-center space-y-3">
        <XCircle size={40} className="mx-auto text-red-400" />
        <p className="text-white">Run not found or could not be loaded.</p>
        <button type="button" className="btn-ghost text-sm" onClick={() => navigate('/reports')}>
          Back to Reports
        </button>
      </div>
    );
  }

  const isAborted = run.status === 'aborted';
  const retryable = (run.failure_meta as Record<string, unknown> | undefined)?.retryable === true;
  const sourceCount = artifacts?.sources.length ?? 0;
  const claimCount = artifacts?.claims.length ?? 0;
  const sourcesTotal = artifacts?.sourcesTotal ?? sourceCount;
  const claimsTotal = artifacts?.claimsTotal ?? claimCount;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Nav */}
      <button
        type="button"
        className="btn-ghost text-xs flex items-center gap-1.5"
        onClick={() => navigate('/reports')}
      >
        <ArrowLeft size={13} />
        Back to Reports
      </button>

      {/* Failed banner */}
      <div className="rounded-xl border border-red-800/40 bg-red-950/30 p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <XCircle size={24} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h1 className="text-lg font-bold text-white leading-snug">
                Research Run {isAborted ? 'Aborted' : 'Failed'}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                {run.completed_at && ` · completed ${format(new Date(run.completed_at), 'PPp')}`}
              </p>
            </div>
          </div>
          {retryable && (
            <div className="flex flex-col items-end gap-1.5">
              <button
                type="button"
                className="btn-ghost text-xs flex items-center gap-1.5 text-accent border border-accent/30 px-3 py-1.5 rounded-lg"
                onClick={() => { setRetryError(null); retryMutation.mutate(); }}
                disabled={retryMutation.isPending}
              >
                <RefreshCw size={12} className={retryMutation.isPending ? 'animate-spin' : ''} />
                Retry run
              </button>
              {retryError && (
                <p className="text-[10px] text-red-400 max-w-48 text-right leading-snug">{retryError}</p>
              )}
            </div>
          )}
        </div>

        {/* Original query */}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Research query</div>
          <p className="text-sm text-white leading-relaxed bg-black/20 rounded-lg p-3 border border-white/5">
            {run.query}
          </p>
        </div>

        {/* Error details */}
        {(run.failed_stage || run.error_message) && (
          <div className="space-y-2">
            {run.failed_stage && (
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
                <span className="text-xs text-slate-400">
                  Failed at stage: <span className="text-amber-400 font-mono">{run.failed_stage}</span>
                </span>
              </div>
            )}
            {run.error_message && (
              <div className="rounded-lg bg-black/30 border border-red-900/30 p-3">
                <div className="text-[10px] uppercase tracking-widest text-red-500/70 mb-1">Error</div>
                <p className="text-xs text-red-300/90 leading-relaxed font-mono whitespace-pre-wrap break-words">
                  {run.error_message}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Retry info */}
        {run.retry_attempts != null && run.retry_attempts > 0 && (
          <p className="text-xs text-slate-600">
            {run.retry_attempts} retry attempt{run.retry_attempts !== 1 ? 's' : ''} made
            {run.retry_budget != null && ` (budget: ${run.retry_budget})`}
          </p>
        )}
      </div>

      {/* Artifacts error */}
      {artifactsError && (
        <div className="rounded-lg border border-amber-800/30 bg-amber-950/20 p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-400">
            Could not load sources/claims: {extractApiError(artifactsErrorObj)}
          </p>
          <button type="button" className="btn-ghost text-xs flex-shrink-0" onClick={() => refetchArtifacts()}>
            Retry
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<Database size={16} className="text-blue-400" />}
          label="Sources found"
          value={artifactsLoading ? '…' : String(sourcesTotal)}
        />
        <StatCard
          icon={<Brain size={16} className="text-purple-400" />}
          label="Claims extracted"
          value={artifactsLoading ? '…' : String(claimsTotal)}
        />
        <StatCard
          icon={<Clock size={16} className="text-slate-400" />}
          label="Started"
          value={run.started_at ? format(new Date(run.started_at), 'PP') : 'Not started'}
        />
      </div>

      {/* Sources */}
      {sourceCount > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Database size={15} className="text-blue-400" />
            Sources Discovered ({sourceCount}{sourcesTotal > sourceCount ? ` of ${sourcesTotal}` : ''})
          </h2>
          <div className="space-y-2">
            {artifacts!.sources.map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-surface-200/50 border border-surface-100/20"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{s.title || s.url || 'Untitled'}</p>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-accent hover:underline truncate block"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.url.slice(0, 80)}
                      <ExternalLink size={9} className="inline ml-1" />
                    </a>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 flex-shrink-0">{s.source_type}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Claims */}
      {claimCount > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Brain size={15} className="text-purple-400" />
            Claims Extracted ({claimCount}{claimsTotal > claimCount ? ` of ${claimsTotal}` : ''})
          </h2>
          <div className="space-y-2">
            {artifacts!.claims.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-lg bg-surface-200/50 border border-surface-100/20 space-y-1"
              >
                <p className="text-xs text-slate-300 leading-relaxed">{c.claim_text}</p>
                {c.evidence_tier && (
                  <span className={clsx('text-[10px] font-medium', TIER_COLORS[c.evidence_tier] ?? 'text-slate-500')}>
                    {c.evidence_tier.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Checkpoints */}
      {artifacts && artifacts.checkpoints.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock size={15} className="text-slate-400" />
            Progress Checkpoints
          </h2>
          <div className="space-y-1.5">
            {artifacts.checkpoints.map((cp, i) => (
              <div
                key={i}
                className="flex items-center gap-3 text-xs py-1.5 px-3 rounded-lg bg-surface-200/30 border border-surface-100/10"
              >
                <span className="font-mono text-slate-500 flex-shrink-0">{cp.stage}</span>
                <span className="text-slate-600 flex-shrink-0">→</span>
                <span className="text-slate-400 truncate">{cp.checkpoint_key}</span>
                <span className="text-slate-600 text-[10px] ml-auto flex-shrink-0">
                  {format(new Date(cp.created_at), 'HH:mm:ss')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* No artifacts at all */}
      {!artifactsLoading && !artifactsError && sourceCount === 0 && claimCount === 0 && (
        <div className="text-center py-8 text-slate-600 text-sm">
          No sources or claims were collected before the run failed.
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon, label, value,
}: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
    </div>
  );
}
