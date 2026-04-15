import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getReport } from '../utils/api';
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle,
  HelpCircle,
  Target,
  ArrowRight,
  BookOpen,
  Scale,
  Brain,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

const SECTION_ICONS: Record<string, React.ElementType> = {
  executive_summary: BookOpen,
  research_question: HelpCircle,
  evidence_ledger: Scale,
  reasoning: Brain,
  contradiction_analysis: AlertTriangle,
  challenges: AlertTriangle,
  synthesis: FileText,
  conclusion: CheckCircle,
  falsification_criteria: Target,
  unresolved_questions: HelpCircle,
  recommended_queries: ArrowRight,
  body: FileText,
};

const SECTION_COLORS: Record<string, string> = {
  executive_summary: 'text-accent',
  evidence_ledger: 'text-research-teal',
  contradiction_analysis: 'text-amber-400',
  challenges: 'text-red-400',
  falsification_criteria: 'text-purple-400',
  conclusion: 'text-green-400',
};

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: report, isLoading } = useQuery({
    queryKey: ['report', id],
    queryFn: () => getReport(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-8 bg-surface-200 rounded w-3/4" />
        <div className="h-4 bg-surface-200 rounded w-1/2" />
        <div className="card h-64" />
        <div className="card h-96" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 text-center">
        <p className="text-slate-400">Report not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Back */}
      <button className="btn-ghost text-sm" onClick={() => navigate('/reports')}>
        <ArrowLeft size={14} />
        Back to Reports
      </button>

      {/* Header */}
      <div className="card-glow p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-white leading-tight">{report.title}</h1>
          <span className={clsx('badge border flex-shrink-0',
            report.status === 'finalized'
              ? 'bg-green-900/20 text-green-400 border-green-800/30'
              : 'bg-accent/10 text-accent border-accent/30'
          )}>
            {report.status}
          </span>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>{formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}</span>
          <span>•</span>
          <span>{report.source_count} sources</span>
          <span>•</span>
          <span>{report.chunk_count} evidence chunks</span>
          {report.contradiction_count > 0 && (
            <>
              <span>•</span>
              <span className="text-amber-400">⚠ {report.contradiction_count} contradictions found</span>
            </>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 pt-2 border-t border-indigo-900/20">
          <MetaStat label="Evidence Chunks" value={report.chunk_count} />
          <MetaStat label="Sources" value={report.source_count} />
          <MetaStat label="Contradictions" value={report.contradiction_count} color="text-amber-400" />
          <MetaStat label="Status" value={report.status} />
        </div>
      </div>

      {/* Falsification criteria — always prominent */}
      {report.falsification_criteria && (
        <div className="card p-4 border-purple-900/40 bg-purple-900/10">
          <div className="flex items-center gap-2 mb-2">
            <Target size={14} className="text-purple-400" />
            <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Falsification Criteria</span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{report.falsification_criteria}</p>
        </div>
      )}

      {/* Sections */}
      {report.sections && report.sections.length > 0 ? (
        <div className="space-y-4">
          {report.sections.map(section => {
            const Icon = SECTION_ICONS[section.section_type] ?? FileText;
            const color = SECTION_COLORS[section.section_type] ?? 'text-slate-400';
            return (
              <div key={section.id} className="card p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <Icon size={16} className={color} />
                  <h2 className={clsx('font-semibold text-sm uppercase tracking-wide', color)}>
                    {section.title}
                  </h2>
                </div>
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReportContent content={section.content} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* No parsed sections — render raw */
        report.executive_summary && (
          <div className="card p-6">
            <ReportContent content={report.executive_summary} />
          </div>
        )
      )}

      {/* Unresolved questions */}
      {report.unresolved_questions && report.unresolved_questions.length > 0 && (
        <div className="card p-5 border-amber-900/30">
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Unresolved Questions</span>
          </div>
          <ul className="space-y-2">
            {report.unresolved_questions.map((q, i) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-amber-500 flex-shrink-0">?</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommended queries */}
      {report.recommended_queries && report.recommended_queries.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <ArrowRight size={14} className="text-research-teal" />
            <span className="text-xs font-semibold text-research-teal uppercase tracking-wider">Recommended Next Queries</span>
          </div>
          <ul className="space-y-2">
            {report.recommended_queries.map((q, i) => (
              <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                <span className="text-research-teal flex-shrink-0">→</span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetaStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center">
      <div className={clsx('text-lg font-bold', color ?? 'text-white')}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function ReportContent({ content }: { content: string }) {
  // Render markdown-like content with basic formatting
  const paragraphs = content.split('\n\n').filter(p => p.trim());
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => {
        if (p.startsWith('# ')) {
          return <h1 key={i} className="text-xl font-bold text-white">{p.slice(2)}</h1>;
        }
        if (p.startsWith('## ')) {
          return <h2 key={i} className="text-lg font-semibold text-white">{p.slice(3)}</h2>;
        }
        if (p.startsWith('### ')) {
          return <h3 key={i} className="text-base font-semibold text-slate-200">{p.slice(4)}</h3>;
        }
        if (p.startsWith('- ') || p.startsWith('* ')) {
          const items = p.split('\n').filter(l => l.startsWith('- ') || l.startsWith('* '));
          return (
            <ul key={i} className="space-y-1 list-none">
              {items.map((item, j) => (
                <li key={j} className="flex items-start gap-2 text-slate-300 text-sm">
                  <span className="text-accent mt-1 flex-shrink-0">▸</span>
                  {item.slice(2)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-slate-300 text-sm leading-relaxed">{p}</p>
        );
      })}
    </div>
  );
}
