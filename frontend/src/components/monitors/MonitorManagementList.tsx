import { useState, type Dispatch, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  extractApiError,
  listUserMonitors,
  type ReportMonitorKind,
  type ReportMonitorRow,
} from '../../utils/api';
import MonitorEventsPanel from './MonitorEventsPanel';

const KIND_LABEL: Record<ReportMonitorKind, string> = {
  living_report: 'Living Report',
  reverse_citation_watch: 'Reverse-Citation Watch',
};

export default function MonitorManagementList({
  monitorKind,
  emptyHint,
}: {
  monitorKind: ReportMonitorKind;
  emptyHint: string;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['billing-monitors'],
    queryFn: listUserMonitors,
  });
  const monitors = (data?.monitors ?? []).filter((m) => m.monitor_kind === monitorKind);
  const [openEventsFor, setOpenEventsFor] = useState<string | null>(null);

  if (isLoading) {
    return <div className="card h-40 animate-pulse bg-surface-200" />;
  }

  if (isError) {
    return (
      <div className="rounded-md border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-300 space-y-2">
        <p>{extractApiError(error)}</p>
        <button type="button" className="btn-ghost text-xs" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }

  if (monitors.length === 0) {
    return <p className="text-slate-400 text-sm">{emptyHint}</p>;
  }

  return (
    <ul className="space-y-4">
      {monitors.map((m) => (
        <MonitorRow
          key={m.id}
          monitor={m}
          kindLabel={KIND_LABEL[monitorKind]}
          openEventsFor={openEventsFor}
          setOpenEventsFor={setOpenEventsFor}
        />
      ))}
    </ul>
  );
}

function MonitorRow({
  monitor: m,
  kindLabel,
  openEventsFor,
  setOpenEventsFor,
}: {
  monitor: ReportMonitorRow;
  kindLabel: string;
  openEventsFor: string | null;
  setOpenEventsFor: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <li className="card-glow p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to={`/app/reports/${m.report_id}`} className="text-accent hover:underline font-medium">
            {kindLabel} · Report {m.report_id.slice(0, 8)}…
          </Link>
          <span className="text-slate-500 text-sm ml-2 capitalize">{m.status}</span>
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
  );
}
