import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { useDossiers } from '../hooks/useDossiers';
import { extractApiError, type DossierListRow } from '../utils/api';
import DossierStatusBadge from '../components/dossiers/DossierStatusBadge';
import IntentBadge from '../components/dossiers/IntentBadge';

export default function DossiersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading, isError, error } = useDossiers({
    page: 1,
    pageSize: 50,
    status: status || undefined,
  });

  const rows = useMemo(() => {
    const r = data?.rows ?? [];
    if (!search.trim()) return r;
    const q = search.toLowerCase();
    return r.filter(
      (row) =>
        row.requestQuery.toLowerCase().includes(q) ||
        (row.reportTitle?.toLowerCase().includes(q) ?? false),
    );
  }, [data?.rows, search]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FolderOpen className="text-accent" size={24} />
            Dossiers
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Each dossier bundles your request, plan, linked report, and run statistics. Open a row for
            details.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder="Search by query or report title"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search dossiers"
          />
        </div>
        <select
          className="input sm:max-w-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by run status"
        >
          <option value="">All run statuses</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3 text-sm text-red-200">
          {extractApiError(error)}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={`dossier-skel-${i}`} className="card p-5 animate-pulse h-36" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center text-slate-400 text-sm">No dossiers match your filters.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((row) => (
            <DossierListCard key={row.dossierId} row={row} onOpen={() => navigate(`/app/dossiers/${row.dossierId}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DossierListCard({ row, onOpen }: { row: DossierListRow; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        'card p-5 text-left w-full hover:border-accent/30 transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-slate-500">
            {row.dossierCreatedAt
              ? formatDistanceToNow(new Date(row.dossierCreatedAt), { addSuffix: true })
              : '—'}
          </p>
          <p className="text-sm text-white font-medium line-clamp-2">{row.requestQuery || '—'}</p>
          {row.reportTitle && <p className="text-xs text-slate-400 line-clamp-1">Report: {row.reportTitle}</p>}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <DossierStatusBadge status={row.runStatus} />
          <IntentBadge intent={row.planIntent} />
        </div>
      </div>
    </button>
  );
}
