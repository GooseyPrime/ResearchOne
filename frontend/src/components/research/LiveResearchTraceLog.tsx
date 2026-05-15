import type { LegacyRef, Ref } from 'react';
import clsx from 'clsx';
import type { ResearchProgressEvent } from '../../utils/api';

function formatShortTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function retryBadgeForEvent(evt: ResearchProgressEvent): {
  text: string;
  variant: 'retryable' | 'resumed' | 'terminal';
} | null {
  if (evt.eventType === 'run_resumed') {
    return { text: 'Resumed', variant: 'resumed' };
  }
  if (evt.eventType === 'run_aborted' || evt.stage === 'aborted') {
    return { text: 'Aborted', variant: 'terminal' };
  }
  if (evt.eventType === 'run_failed' || evt.stage === 'failed') {
    const retryable = evt.failure?.retryable === true;
    return { text: retryable ? 'Retryable' : 'Stopped', variant: retryable ? 'retryable' : 'terminal' };
  }
  if (evt.failure?.retryable === true) {
    return { text: 'Retryable', variant: 'retryable' };
  }
  const msg = `${evt.message} ${evt.substep || ''}`.toLowerCase();
  if (/\b(retry|retried|resum|backoff)\b/.test(msg)) {
    return { text: 'Retry', variant: 'retryable' };
  }
  return null;
}

export interface LiveResearchTraceLogProps {
  traceEvents: ResearchProgressEvent[];
  traceScrollRef?: Ref<HTMLDivElement | null>;
  /** Extra classes merged onto the scroll container (V2 default sizing lives here). */
  scrollClassName?: string;
  emptyMessage?: string;
}

const DEFAULT_SCROLL =
  'lg:flex-1 max-h-[28rem] lg:max-h-[80vh] lg:min-h-[40rem] overflow-y-auto rounded-lg border border-surface-100 bg-[#0b0d14] font-mono text-[11px] leading-5';

export default function LiveResearchTraceLog({
  traceEvents,
  traceScrollRef,
  scrollClassName,
  emptyMessage = 'Waiting for events…',
}: LiveResearchTraceLogProps) {
  return (
    <div className="lg:col-span-3 lg:flex lg:flex-col lg:min-h-0 space-y-2">
      <div className="flex items-center justify-between">
        <span className="section-title">Live research trace ({traceEvents.length})</span>
        <span className="text-[10px] text-slate-500">Chronological · newest at bottom</span>
      </div>

      <div ref={traceScrollRef as LegacyRef<HTMLDivElement> | undefined} className={clsx(DEFAULT_SCROLL, scrollClassName)}>
        {traceEvents.length === 0 && <p className="text-slate-500 px-3 py-3">{emptyMessage}</p>}
        {traceEvents.map((evt, idx) => {
          const isError =
            evt.eventType === 'run_failed' || evt.eventType === 'run_aborted' || evt.stage === 'failed' || evt.stage === 'aborted';
          const isDone = evt.eventType === 'run_completed' || evt.stage === 'done';
          const isResumed = evt.eventType === 'run_resumed';
          const isModel = Boolean(evt.model || evt.tokenUsage);
          const rowKey = `${evt.timestamp ?? idx}-${evt.stage}-${idx}`;
          const retryBadge = retryBadgeForEvent(evt);

          return (
            <div
              key={rowKey}
              className={clsx(
                'flex gap-2 px-3 py-1 border-b border-surface-100/20 last:border-0',
                isError && 'bg-red-950/20',
                isDone && 'bg-green-950/15',
                isResumed && 'bg-blue-950/15',
                isModel && !isError && !isDone && 'bg-indigo-950/10'
              )}
            >
              <span className="text-slate-600 tabular-nums flex-shrink-0 select-none w-[7ch]">
                {formatShortTime(evt.timestamp)}
              </span>

              <span
                className={clsx(
                  'flex-shrink-0 w-[12ch] truncate',
                  isError ? 'text-red-400' : isDone ? 'text-green-400' : isResumed ? 'text-blue-400' : 'text-indigo-400'
                )}
              >
                {evt.stage.replace(/_/g, ' ')}
              </span>

              <span className="text-slate-600 flex-shrink-0 w-[5ch] tabular-nums text-right">{evt.percent}%</span>

              <span className="flex-1 min-w-0 text-slate-300 break-words">
                {evt.message}
                {retryBadge && (
                  <span
                    className={clsx(
                      'ml-2 inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium uppercase tracking-wide',
                      retryBadge.variant === 'resumed' && 'bg-blue-950/60 text-blue-300',
                      retryBadge.variant === 'retryable' && 'bg-amber-950/60 text-amber-200',
                      retryBadge.variant === 'terminal' && 'bg-slate-800 text-slate-400'
                    )}
                  >
                    {retryBadge.text}
                  </span>
                )}
                {evt.model && <span className="ml-2 text-indigo-400/70">[{evt.model}]</span>}
                {evt.tokenUsage && (
                  <span className="ml-1 text-slate-500">
                    {evt.tokenUsage.prompt}p+{evt.tokenUsage.completion}c tok
                  </span>
                )}
                {(evt.chunkCount != null || evt.sourceCount != null) && (
                  <span className="ml-1 text-slate-500">
                    {typeof evt.chunkCount === 'number' ? `${evt.chunkCount} chunks` : ''}
                    {typeof evt.chunkCount === 'number' && typeof evt.sourceCount === 'number' ? ' · ' : ''}
                    {typeof evt.sourceCount === 'number' ? `${evt.sourceCount} sources` : ''}
                  </span>
                )}
                {evt.failure?.errorMessage && <span className="ml-1 text-red-300/90">{evt.failure.errorMessage}</span>}
                {evt.substep && <span className="ml-1 text-slate-500">({evt.substep})</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
