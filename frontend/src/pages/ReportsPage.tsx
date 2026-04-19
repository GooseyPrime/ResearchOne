import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Search, Filter, CheckCircle, Clock, FileText } from 'lucide-react';
import { getReports, Report } from '../utils/api';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

const STATUS_COLORS: Record<string, string> = {
  finalized: 'text-green-400 bg-green-900/20 border-green-800/30',
  generating: 'text-accent bg-accent/10 border-accent/30',
  draft: 'text-slate-400 bg-slate-800/30 border-slate-700/30',
  under_review: 'text-amber-400 bg-amber-900/20 border-amber-800/30',
  archived: 'text-slate-500 bg-slate-900/20 border-slate-800/30',
};

export default function ReportsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['reports', statusFilter, search],
    queryFn: () => getReports({ status: statusFilter || undefined, search: search || undefined }),
    refetchInterval: 10000,
  });

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
            {reports.length} report{reports.length !== 1 ? 's' : ''} in archive
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
          </select>
        </div>
      </div>

      {/* Reports grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse h-40" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {reports.map(report => (
            <ReportCard
              key={report.id}
              report={report}
              onClick={() => navigate(`/reports/${report.id}`)}
            />
          ))}
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
