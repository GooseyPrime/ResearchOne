import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { listMonitorEventsApi, type MonitorEventRow } from '../../utils/api';

function payloadSnippet(ev: MonitorEventRow): string {
  if (!ev.payload || typeof ev.payload !== 'object') return '';
  const p = ev.payload;
  const keys = ['webhook_event_id', 'revision_request_id', 'error', 'reason'];
  const parts: string[] = [];
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'string' && v) parts.push(`${k}: ${v}`);
  }
  return parts.join(' · ');
}

export default function MonitorEventsPanel({ monitorId }: { monitorId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['monitor-events', monitorId],
    queryFn: () => listMonitorEventsApi(monitorId),
    enabled: Boolean(monitorId),
  });

  const events = data?.events ?? [];

  return (
    <div className="mt-3 rounded-md border border-slate-800/80 bg-surface-300/40 p-3 text-xs space-y-2">
      <div className="font-semibold text-slate-400 uppercase tracking-wide">Recent events</div>
      {isLoading ? (
        <p className="text-slate-500">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-slate-500">No events yet.</p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {[...events].reverse().map((ev) => {
            const extra = payloadSnippet(ev);
            return (
              <li key={ev.id} className="border-b border-slate-800/50 pb-2 last:border-0">
                <div className="flex justify-between gap-2 text-slate-300">
                  <span className="font-mono text-accent">{ev.event_kind}</span>
                  <span className="text-slate-500 shrink-0">
                    {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                  </span>
                </div>
                {ev.revision_id ? (
                  <div className="text-slate-500 mt-0.5">revision {ev.revision_id}</div>
                ) : null}
                {extra ? <div className="text-slate-500 mt-0.5 break-all">{extra}</div> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
