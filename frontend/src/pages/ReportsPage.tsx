import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Search, Filter, CheckCircle, Clock, FileText, XCircle, AlertTriangle } from 'lucide-react';
import { getReports, getResearchRuns, Report, ResearchRun } from '../utils/api';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

const STATUS_COLORS: Record<string, string> = {
  finalized: 'text-green-400 bg-green-900/20 border-green-800/30',
  generating: 'text-accent bg-accent/10 border-accent/30',
  draft: 'text-slate-400 bg-slate-800/30 border-slate-700/30',
  under_review: 'text-amber-400 bg-amber-900/20 border-amber-800/30',
  archived: 'text-slate-500 bg-slate-900/20 border-slate-800/30',
  failed: 'text-red-400 bg-red-900/20 border-red-800/30',
  aborted: 'text-red-500 bg-red-900/20 border-red-800/30',
};

type ListItem =
  | { kind: 'report'; data: Report }
  | { kind: 'run'; data: ResearchRun };

export default function ReportsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: reports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ['reports', statusFilter, search],
    queryFn: () => getReports({ status: statusFilter || undefined, search: search || undefined }),
    refetchInterval: 10000,
  });

  // Fetch failed and aborted runs to surface them alongside reports
  const showFailed = !statusFilter || statusFilter === 'failed';
  const { data: failedRuns = [] } = useQuery({
    queryKey: ['research-runs-failed'],
    queryFn: async () => {
      const [failed, aborted] = await Promise.all([
        getResearchRuns({ status: 'failed' }),
        getResearchRuns({ status: 'aborted' }),
      ]);
      return [...failed, ...aborted];
    },
    enabled: showFailed,
    refetchInterval: 15000,
  });

  const isLoading = reportsLoading;

  // Merge and sort by created_at descending
  const items: ListItem[] = [];

  if (!statusFilter || statusFilter === 'failed') {
    for (const run of failedRuns) {
      if (search && !run.title.toLowerCase().includes(search.toLowerCase()) &&
          !run.query.toLowerCase().includes(search.toLowerCase())) continue;
      items.push({ kind: 'run', data: run });
    }
  }

  if (!statusFilter || STATUS_COLORS[statusFilter]) {
    const filtered = statusFilter === 'failed' ? [] : reports;
    for (const r of filtered) {
      items.push({ kind: 'report', data: r });
    }
  }

  items.sort((a, b) =>
    new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime()
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <BookOpen className="text-accent" size={24} />
            Report Library
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {items.length} result{items.length !== 1 ? 's' : ''}
            {failedRuns.length > 0 && (
              <span className="text-red-400 ml-1">· {failedRuns.length} failed</span>
            )}
          </p>
        </div>
      </div>

      {/* Search & filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder="Search reports..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <select
            className="input pl-9 pr-8 appearance-none min-w-36"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="finalized">Finalized</option>
            <option value="generating">Generating</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse h-40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map(item =>
            item.kind === 'report' ? (
              <ReportCard
                key={item.data.id}
                report={item.data}
                onClick={() => navigate(`/reports/${item.data.id}`)}
              />
            ) : (
              <FailedRunCard
                key={item.data.id}
                run={item.data}
                onClick={() => navigate(`/reports/run/${item.data.id}`)}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, onClick }: { report: Report; onClick: () => void }) {
  const statusClass = STATUS_COLORS[report.status] ?? STATUS_COLORS.draft;

  return (
    <div
      className="card p-5 hover:border-accent/30 cursor-pointer transition-all duration-200 group space-y-3"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm leading-snug truncate group-hover:text-accent transition-colors">
            {report.title}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
          </p>
        </div>
        <span className={clsx('badge border flex-shrink-0', statusClass)}>
          {report.status === 'finalized' ? <CheckCircle size={10} /> : <Clock size={10} />}
          {report.status}
        </span>
      </div>

      {report.executive_summary && (
        <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
          {report.executive_summary}
        </p>
      )}

      <div className="flex items-center gap-4 text-xs text-slate-500 pt-1 border-t border-indigo-900/20">
        <span className="flex items-center gap-1">
          <FileText size={10} />
          {report.source_count} sources
        </span>
        <span>{report.chunk_count} chunks</span>
        {report.contradiction_count > 0 && (
          <span className="text-amber-500">⚠ {report.contradiction_count} contradictions</span>
        )}
      </div>
    </div>
  );
}

function FailedRunCard({ run, onClick }: { run: ResearchRun; onClick: () => void }) {
  const isAborted = run.status === 'aborted';
  const label = isAborted ? 'aborted' : 'failed';
  const statusClass = isAborted ? STATUS_COLORS.aborted : STATUS_COLORS.failed;

  return (
    <div
      className="card p-5 hover:border-red-500/30 cursor-pointer transition-all duration-200 group space-y-3 border-red-900/30"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm leading-snug truncate group-hover:text-red-400 transition-colors">
            {run.title || run.query.slice(0, 80)}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
          </p>
        </div>
        <span className={clsx('badge border flex-shrink-0', statusClass)}>
          <XCircle size={10} />
          {label}
        </span>
      </div>

      {run.error_message && (
        <p className="text-xs text-red-400/80 line-clamp-2 leading-relaxed">
          {run.error_message}
        </p>
      )}

      <div className="flex items-center gap-4 text-xs text-slate-500 pt-1 border-t border-red-900/20">
        {run.failed_stage && (
          <span className="flex items-center gap-1 text-red-500/70">
            <AlertTriangle size={10} />
            failed at: {run.failed_stage}
          </span>
        )}
        {run.retry_attempts != null && run.retry_attempts > 0 && (
          <span className="text-slate-600">{run.retry_attempts} retries</span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  const navigate = useNavigate();
  return (
    <div className="text-center py-20 space-y-4">
      <BookOpen size={48} className="text-slate-600 mx-auto" />
      <h3 className="text-lg font-semibold text-slate-400">No reports yet</h3>
      <p className="text-slate-500 text-sm">Start a research run from the Research page to generate your first report.</p>
      <button type="button" className="btn-ghost text-sm text-accent mx-auto" onClick={() => navigate('/research')}>
        Go to Research
      </button>
    </div>
  );
}
