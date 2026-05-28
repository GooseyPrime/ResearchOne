import clsx from 'clsx';
import type { ResearchProgressEvent } from '@/utils/api';

function formatShortTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export interface LiveRevisionTraceLogProps {
  traceEvents: ResearchProgressEvent[];
  latestPercent?: number;
  latestMessage?: string;
  className?: string;
}

export default function LiveRevisionTraceLog({
  traceEvents,
  latestPercent,
  latestMessage,
  className,
}: LiveRevisionTraceLogProps) {
  return (
    <div className={clsx('space-y-3', className)}>
      {(latestMessage != null || latestPercent != null) && (
        <div className="rounded-lg border border-indigo-900/40 bg-surface-900/80 p-4 space-y-2">
          <div className="flex justify-between gap-2 text-xs text-slate-400">
            <span className="text-slate-200">{latestMessage ?? 'Revision in progress'}</span>
            {latestPercent != null && (
              <span className="tabular-nums text-slate-500">{latestPercent}%</span>
            )}
          </div>
          {latestPercent != null && (
            <div className="h-1.5 bg-surface-400 rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(0, latestPercent))}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-surface-100 bg-[#0b0d14] font-mono text-[11px] leading-5 max-h-[32rem] overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2 text-[10px] text-slate-500">
          <span className="uppercase tracking-wide">Revision pipeline trace</span>
          <span>{traceEvents.length} events</span>
        </div>
        {traceEvents.length === 0 ? (
          <p className="text-slate-500">Waiting for revision pipeline events…</p>
        ) : (
          <ul className="space-y-1.5">
            {traceEvents.map((evt, idx) => (
              <li key={`${evt.timestamp ?? idx}-${evt.stage}-${idx}`} className="text-slate-300">
                <span className="text-slate-500">{formatShortTime(evt.timestamp)}</span>
                {' '}
                <span className="text-indigo-300/90 uppercase">{evt.stage}</span>
                {evt.percent != null && (
                  <span className="text-slate-500"> · {evt.percent}%</span>
                )}
                {evt.message && <span className="text-slate-400"> — {evt.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
