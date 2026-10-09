import { readerStageLabel } from '@/lib/researchone/stageLabels';
import { memo, useMemo, type LegacyRef, type Ref } from 'react';
import clsx from 'clsx';
import type { ResearchProgressEvent } from '../../utils/api';
import { plainProgressText } from '@/lib/researchone/plainWords';
import { collapseRepeatedUpdates, tracePercents } from '../../utils/traceEventWindow';
import { customerFailureText, looksLikeInternalDetail } from '../../utils/customerFailureText';

function formatShortTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function retryBadgeForEvent(evt: ResearchProgressEvent): {
  text: string;
  variant: 'retryable' | 'resumed' | 'terminal';
} | null {
  if (evt.eventType === 'run_resumed') {
    return { text: 'Running again', variant: 'resumed' };
  }
  if (evt.eventType === 'run_aborted' || evt.stage === 'aborted') {
    return { text: 'Stopped', variant: 'terminal' };
  }
  if (evt.eventType === 'run_failed' || evt.stage === 'failed') {
    const retryable = evt.failure?.retryable === true;
    return { text: retryable ? 'Can be run again' : 'Stopped', variant: retryable ? 'retryable' : 'terminal' };
  }
  if (evt.failure?.retryable === true) {
    return { text: 'Can be run again', variant: 'retryable' };
  }
  const msg = `${evt.message} ${evt.substep || ''}`.toLowerCase();
  if (/\b(retry|retried|resum|backoff)\b/.test(msg)) {
    return { text: 'Trying again', variant: 'retryable' };
  }
  return null;
}

/** "15 passages · 18 sources". The pipeline's own word for a passage is never shown. */
function countsLabel(evt: ResearchProgressEvent): string {
  const parts: string[] = [];
  if (typeof evt.chunkCount === 'number') parts.push(`${evt.chunkCount} ${evt.chunkCount === 1 ? 'passage' : 'passages'}`);
  if (typeof evt.sourceCount === 'number') parts.push(`${evt.sourceCount} ${evt.sourceCount === 1 ? 'source' : 'sources'}`);
  return parts.join(' · ');
}

export interface LiveResearchTraceLogProps {
  traceEvents: ResearchProgressEvent[];
  traceScrollRef?: Ref<HTMLDivElement | null>;
  /** Extra classes merged onto the scroll container (V2 default sizing lives here). */
  scrollClassName?: string;
  emptyMessage?: string;
  /**
   * Show what is written for whoever diagnoses a run: the model that answered,
   * token counts, internal detail and the stored error. For administrators
   * only; a customer's view leaves all of it out. Off unless asked for.
   */
  showInternals?: boolean;
}

const DEFAULT_SCROLL =
  'lg:flex-1 max-h-[28rem] lg:max-h-[80vh] lg:min-h-[40rem] overflow-y-auto rounded-lg border border-surface-100 bg-[#0b0d14] font-mono text-[11px] leading-5';

/**
 * One line of the trace. Memoised: a run in flight adds a line every few
 * seconds, and a new line must not re-render every line above it.
 */
const TraceRow = memo(function TraceRow({ evt, percent, showInternals }: { evt: ResearchProgressEvent; percent: number; showInternals: boolean }) {
  const isError =
    evt.eventType === 'run_failed' || evt.eventType === 'run_aborted' || evt.stage === 'failed' || evt.stage === 'aborted';
  const isDone = evt.eventType === 'run_completed' || evt.stage === 'done';
  const isResumed = evt.eventType === 'run_resumed';
  const isModel = showInternals && Boolean(evt.model || evt.tokenUsage);
  const retryBadge = retryBadgeForEvent(evt);
  const counts = countsLabel(evt);

  // A stopped run's line is the plain sentence. The stored error is the
  // server's record of what went wrong and is printed for administrators only.
  const storedError = evt.failure?.errorMessage;
  const message = isError
    ? customerFailureText(evt.message) ?? customerFailureText(storedError) ?? readerStageLabel(evt.stage)
    : plainProgressText(evt.message);
  const detail = evt.detail && (showInternals || !looksLikeInternalDetail(evt.detail)) ? evt.detail : null;

  return (
    <div
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
          'flex-shrink-0 w-[26ch] truncate',
          isError ? 'text-red-400' : isDone ? 'text-green-400' : isResumed ? 'text-blue-400' : 'text-indigo-400'
        )}
      >
        {readerStageLabel(evt.stage)}
      </span>

      <span className="text-slate-600 flex-shrink-0 w-[5ch] tabular-nums text-right">{percent}%</span>

      <span className="flex-1 min-w-0 text-slate-300 break-words">
        {message}
        {detail ? (
          <span className="mt-0.5 block text-[10px] text-slate-500 whitespace-pre-wrap break-words">{detail}</span>
        ) : null}
        {showInternals && evt.internalDetail ? (
          <span className="mt-0.5 block text-[10px] text-slate-500 whitespace-pre-wrap break-words">{evt.internalDetail}</span>
        ) : null}
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
        {showInternals && evt.model && <span className="ml-2 text-indigo-400/70">[{evt.model}]</span>}
        {showInternals && evt.tokenUsage && (
          <span className="ml-1 text-slate-500">
            {evt.tokenUsage.prompt}p+{evt.tokenUsage.completion}c tok
          </span>
        )}
        {counts && <span className="ml-1 text-slate-500">{counts}</span>}
        {showInternals && (evt.repeatCount ?? 1) > 1 && (
          <span className="ml-1 text-slate-600">· {evt.repeatCount} updates</span>
        )}
        {showInternals && storedError && <span className="ml-1 text-red-300/90">{storedError}</span>}
      </span>
    </div>
  );
});

export default function LiveResearchTraceLog({
  traceEvents,
  traceScrollRef,
  scrollClassName,
  emptyMessage = 'Waiting for events…',
  showInternals = false,
}: LiveResearchTraceLogProps) {
  // Repeated updates of one wait are one line that updates, not forty lines.
  const lines = useMemo(() => collapseRepeatedUpdates(traceEvents), [traceEvents]);
  // A row never shows less than the row above it (RJ-018).
  const percents = useMemo(() => tracePercents(lines), [lines]);

  return (
    <div className="lg:col-span-3 lg:flex lg:flex-col lg:min-h-0 space-y-2">
      <div className="flex items-center justify-between">
        <span className="section-title">Live research trace ({lines.length})</span>
        <span className="text-[10px] text-slate-500">Chronological · newest at bottom</span>
      </div>

      <div ref={traceScrollRef as LegacyRef<HTMLDivElement> | undefined} className={clsx(DEFAULT_SCROLL, scrollClassName)}>
        {lines.length === 0 && <p className="text-slate-500 px-3 py-3">{emptyMessage}</p>}
        {lines.map((evt, idx) => (
          <TraceRow key={`${idx}-${evt.stage}-${evt.substep ?? ''}`} evt={evt} percent={percents[idx] ?? 0} showInternals={showInternals} />
        ))}
      </div>
    </div>
  );
}
