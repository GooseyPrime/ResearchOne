import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Search, Download, LayoutGrid, Table2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { useDossiers, useDossierTimeline } from '../hooks/useDossiers';
import { extractApiError, type DossierListRow } from '../utils/api';
import DossierStatusBadge from '../components/dossiers/DossierStatusBadge';
import IntentBadge from '../components/dossiers/IntentBadge';
import DossiersTimelineTable, { timelineRowsToCsv } from '../components/dossiers/DossiersTimelineTable';

type ViewMode = 'cards' | 'timeline';

const PAGE_SIZE = 20;

export default function DossiersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');

  const { data, isLoading, isError, error } = useDossiers({
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    sortBy: 'last_activity_at',
  });

  const timelineQuery = useDossierTimeline({
    page,
    pageSize: PAGE_SIZE,
    enabled: viewMode === 'timeline',
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

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleExportCsv = () => {
    const exportRows = timelineQuery.data?.rows ?? [];
    const csv = timelineRowsToCsv(exportRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dossier-timeline-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6 bg-r1-canvas min-h-full">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <span className="r1-tag r1-tag-cyan mb-3 inline-flex">DOSSIERS</span>
          <h1 className="text-2xl sm:text-3xl font-bold text-r1-heading flex items-center gap-3">
            <FolderOpen className="text-r1-cyan" size={24} />
            Dossiers
          </h1>
          <p className="text-r1-muted text-sm mt-2">
            Each dossier bundles your request, plan, linked report, and run statistics. Sorted by most recent activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-indigo-900/40 overflow-hidden">
            <button
              type="button"
              className={clsx(
                'px-3 py-1.5 text-xs inline-flex items-center gap-1.5',
                viewMode === 'cards' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-slate-900/50',
              )}
              onClick={() => setViewMode('cards')}
            >
              <LayoutGrid size={14} />
              Cards
            </button>
            <button
              type="button"
              className={clsx(
                'px-3 py-1.5 text-xs inline-flex items-center gap-1.5 border-l border-indigo-900/40',
                viewMode === 'timeline' ? 'bg-accent/15 text-accent' : 'text-slate-400 hover:bg-slate-900/50',
              )}
              onClick={() => setViewMode('timeline')}
            >
              <Table2 size={14} />
              Timeline
            </button>
          </div>
          {viewMode === 'timeline' ? (
            <button
              type="button"
              className="btn-ghost text-xs inline-flex items-center gap-1.5 border border-indigo-900/40"
              onClick={handleExportCsv}
              disabled={!timelineQuery.data?.rows?.length}
            >
              <Download size={14} />
              Export CSV
            </button>
          ) : null}
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
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
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

      {(isError || (viewMode === 'timeline' && timelineQuery.isError)) && (
        <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3 text-sm text-red-200">
          {extractApiError(viewMode === 'timeline' ? timelineQuery.error : error)}
        </div>
      )}

      {viewMode === 'cards' ? (
        isLoading ? (
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
        )
      ) : timelineQuery.isLoading ? (
        <div className="card p-10 animate-pulse h-48" />
      ) : (
        <DossiersTimelineTable rows={timelineQuery.data?.rows ?? []} />
      )}

      {viewMode === 'cards' && total > PAGE_SIZE ? (
        <PaginationBar page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      ) : null}
      {viewMode === 'timeline' && (timelineQuery.data?.total ?? 0) > PAGE_SIZE ? (
        <PaginationBar
          page={page}
          totalPages={Math.max(1, Math.ceil((timelineQuery.data?.total ?? 0) / PAGE_SIZE))}
          total={timelineQuery.data?.total ?? 0}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
      <span>
        Page {page} of {totalPages} · {total} total
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-ghost text-xs px-3 py-1"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-ghost text-xs px-3 py-1"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function DossierListCard({ row, onOpen }: { row: DossierListRow; onOpen: () => void }) {
  const activityAt = row.lastActivityAt ?? row.dossierCreatedAt;
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
          <div className="flex flex-wrap items-center gap-2">
            {row.versionNumber != null && row.versionNumber > 1 ? (
              <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-slate-800 text-slate-300">
                v{row.versionNumber}
              </span>
            ) : null}
            {row.isSpinoff ? (
              <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-purple-900/40 text-purple-300">
                Spinoff
              </span>
            ) : null}
            {row.isRevised ? (
              <span className="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-accent/15 text-accent">
                Revised
              </span>
            ) : null}
            {row.engineVersion ? (
              <span className="text-[10px] uppercase tracking-wide text-slate-500">{row.engineVersion}</span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {activityAt ? formatDistanceToNow(new Date(activityAt), { addSuffix: true }) : '—'}
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
