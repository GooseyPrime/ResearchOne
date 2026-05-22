import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  Trash2,
  XCircle,
  Zap,
  ClipboardCheck,
} from 'lucide-react';
import { cancelResearchRun, deleteResearchRun, type ResearchRun } from '../../utils/api';
import { dossierReportUrlForRun, liveResearchUrl, failedRunReportUrl } from '../../utils/researchRunRoutes';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  queued: { icon: Clock, color: 'text-slate-400', label: 'Queued' },
  running: { icon: Zap, color: 'text-accent animate-pulse', label: 'Running' },
  plan_pending_confirmation: { icon: ClipboardCheck, color: 'text-amber-300', label: 'Plan review' },
  completed: { icon: CheckCircle2, color: 'text-green-400', label: 'Completed' },
  failed: { icon: AlertCircle, color: 'text-amber-400', label: 'Needs review' },
  cancelled: { icon: AlertCircle, color: 'text-slate-500', label: 'Cancelled' },
  aborted: { icon: XCircle, color: 'text-red-400', label: 'Aborted' },
};

const LIVE_STATUSES = new Set(['queued', 'running', 'plan_pending_confirmation']);

export default function ResearchRunRow({
  run,
  onRunsChanged,
  onRemoved,
  onResumeRun,
}: {
  run: ResearchRun;
  onRunsChanged: () => void;
  onRemoved?: (id: string) => void;
  /** When set, Resume/Review plan invokes this (e.g. attach + navigate in-page). */
  onResumeRun?: (run: ResearchRun) => void;
}) {
  const navigate = useNavigate();
  const [showError, setShowError] = useState(false);
  const [busy, setBusy] = useState(false);

  const cfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.failed;
  const Icon = cfg.icon;
  const isLive = LIVE_STATUSES.has(run.status);
  const isPlanGate = run.status === 'plan_pending_confirmation';

  const latestEvent =
    Array.isArray(run.progress_events) && run.progress_events.length > 0
      ? run.progress_events[run.progress_events.length - 1]
      : null;

  const resumeTarget = liveResearchUrl(run.id, {
    engineVersion: run.engine_version,
    focusPlan: isPlanGate,
  });

  const handleRowActivate = () => {
    if (run.status === 'completed') {
      navigate(dossierReportUrlForRun(run.id));
      return;
    }
    if (isLive) {
      if (onResumeRun) {
        onResumeRun(run);
      } else {
        navigate(resumeTarget);
      }
      return;
    }
    if (run.status === 'failed') {
      navigate(failedRunReportUrl(run.id));
    }
  };

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Cancel this run?')) return;
    setBusy(true);
    try {
      await cancelResearchRun(run.id);
      onRunsChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Remove this run from the list?')) return;
    setBusy(true);
    try {
      await deleteResearchRun(run.id);
      onRemoved?.(run.id);
      onRunsChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 space-y-2">
      <div
        className={clsx(
          'flex items-center justify-between gap-2 transition-all',
          (run.status === 'completed' || isLive || run.status === 'failed') &&
            'hover:border-accent/30 cursor-pointer'
        )}
        onClick={handleRowActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleRowActivate();
          }
        }}
        role={
          run.status === 'completed' || isLive || run.status === 'failed' ? 'button' : undefined
        }
        tabIndex={run.status === 'completed' || isLive || run.status === 'failed' ? 0 : undefined}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon size={14} className={cfg.color} />
          <div className="min-w-0">
            <div className="text-sm text-white truncate">{run.title || run.query}</div>
            <div className="text-xs text-slate-500 flex flex-wrap gap-2">
              <span className={cfg.color}>{cfg.label}</span>
              {run.progress_percent != null && isLive ? (
                <span>{Math.round(run.progress_percent)}%</span>
              ) : null}
              {run.created_at ? (
                <span>{formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {isPlanGate ? (
            <Link
              to={resumeTarget}
              className="btn-secondary text-xs py-1 px-2"
              onClick={(e) => {
                if (onResumeRun) {
                  e.preventDefault();
                  onResumeRun(run);
                }
              }}
            >
              Review plan
            </Link>
          ) : isLive ? (
            <Link
              to={resumeTarget}
              className="btn-secondary text-xs py-1 px-2"
              onClick={(e) => {
                if (onResumeRun) {
                  e.preventDefault();
                  onResumeRun(run);
                }
              }}
            >
              Resume
            </Link>
          ) : null}
          {(run.status === 'queued' || run.status === 'running' || isPlanGate) && (
            <button
              type="button"
              className="p-1.5 rounded hover:bg-surface-100 text-slate-400 hover:text-amber-300"
              title="Cancel run"
              disabled={busy}
              onClick={handleCancel}
            >
              <Ban size={14} />
            </button>
          )}
          {!isLive && run.status !== 'running' && (
            <button
              type="button"
              className="p-1.5 rounded hover:bg-surface-100 text-slate-400 hover:text-red-400"
              title="Remove from list"
              disabled={busy}
              onClick={handleDelete}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {run.error_message && (
        <div>
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-300"
            onClick={() => setShowError((v) => !v)}
          >
            {showError ? 'Hide error' : 'Show error'}
          </button>
          {showError ? (
            <p className="text-xs text-red-300/90 mt-1 whitespace-pre-wrap">{run.error_message}</p>
          ) : null}
        </div>
      )}
      {latestEvent?.message && isLive ? (
        <p className="text-xs text-slate-500 truncate">{latestEvent.message}</p>
      ) : null}
    </div>
  );
}
