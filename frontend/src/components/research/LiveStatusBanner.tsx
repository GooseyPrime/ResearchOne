import { AlertCircle, CheckCircle2, Clock, XCircle, Zap } from 'lucide-react';
import clsx from 'clsx';
import { classifyLiveStatus, LIVE_STATUS_COPY, type TransientFailureContext } from '../../utils/researchLiveStatus';

export interface ResearchFailureBannerPayload extends TransientFailureContext {
  runId: string;
  stage: string;
  percent: number;
  message: string;
  error?: string;
  retryable?: boolean;
  failureMeta?: Record<string, unknown>;
}

export default function LiveStatusBanner({
  runStatus,
  failure,
  retryAttempts,
  progressMessage,
  progressStage,
  planGateAwaiting,
}: {
  runStatus?: string;
  failure: ResearchFailureBannerPayload | null;
  retryAttempts?: number | null;
  progressMessage?: string | null;
  progressStage?: string | null;
  planGateAwaiting?: boolean;
}) {
  const transient: TransientFailureContext | null = failure
    ? {
        terminal: failure.terminal,
        retryable: failure.retryable,
        failureMeta: failure.failureMeta,
      }
    : null;

  const live = classifyLiveStatus(runStatus, transient, {
    retryAttempts,
    progressMessage,
    progressStage,
    planGateAwaiting: planGateAwaiting === true,
  });
  const copy = LIVE_STATUS_COPY[live];
  const toneClass =
    copy.tone === 'good'
      ? 'border-green-800/40 bg-green-950/30 text-green-300'
      : copy.tone === 'warn'
        ? 'border-amber-700/40 bg-amber-950/30 text-amber-200'
        : copy.tone === 'bad'
          ? 'border-red-700/40 bg-red-950/30 text-red-200'
          : copy.tone === 'info'
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-surface-100 bg-surface-200 text-slate-400';

  const Icon =
    copy.tone === 'good'
      ? CheckCircle2
      : copy.tone === 'warn'
        ? AlertCircle
        : copy.tone === 'bad'
          ? XCircle
          : copy.tone === 'info'
            ? Zap
            : Clock;

  return (
    <div className={clsx('rounded-lg border px-3 py-2 flex items-start gap-2', toneClass)}>
      <Icon size={16} className="mt-0.5 flex-shrink-0" />
      <p className="text-xs leading-snug">{copy.label}</p>
    </div>
  );
}
