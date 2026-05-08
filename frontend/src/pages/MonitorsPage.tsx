import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listUserMonitors } from '../utils/api';
import MonitorEventsPanel from '../components/monitors/MonitorEventsPanel';
import { useState } from 'react';

export default function MonitorsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['user-monitors'],
    queryFn: listUserMonitors,
  });
  const monitors = data?.monitors ?? [];
  const [openEventsFor, setOpenEventsFor] = useState<string | null>(null);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Living Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Parallel-backed monitors attached to finalized reports. Manage subscriptions from each report or here.
        </p>
      </div>

      {isLoading ? (
        <div className="card h-40 animate-pulse bg-surface-200" />
      ) : monitors.length === 0 ? (
        <p className="text-slate-400 text-sm">No active monitors. Open a finalized report and subscribe under Living Report monitor.</p>
      ) : (
        <ul className="space-y-4">
          {monitors.map((m) => (
            <li key={m.id} className="card-glow p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Link to={`/app/reports/${m.report_id}`} className="text-accent hover:underline font-medium">
                    Report {m.report_id.slice(0, 8)}…
                  </Link>
                  <span className="text-slate-500 text-sm ml-2 capitalize">
                    {m.monitor_kind.replace(/_/g, ' ')} · {m.status}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setOpenEventsFor((id) => (id === m.id ? null : m.id))}
                >
                  {openEventsFor === m.id ? 'Hide events' : 'Events'}
                </button>
              </div>
              {openEventsFor === m.id ? <MonitorEventsPanel monitorId={m.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
