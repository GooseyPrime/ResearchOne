import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getReport,
  getReportRevision,
  getReportRevisions,
  publishReportFeatured,
  ADMIN_SESSION_TOKEN_KEY,
} from '../utils/api';
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
  Printer,
  Share2,
  Download,
  Sparkles,
  Globe,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { useState } from 'react';
import { useStore } from '../store/useStore';

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

function buildReportMarkdown(report: {
  title: string;
  query: string;
  sections?: Array<{ title: string; content: string }>;
  executive_summary?: string;
}): string {
  const lines: string[] = [`# ${report.title}`, '', `**Research query:** ${report.query}`, ''];
  if (report.sections && report.sections.length > 0) {
    for (const s of report.sections) {
      lines.push(`## ${s.title}`, '', s.content, '', '');
    }
  } else if (report.executive_summary) {
    lines.push(report.executive_summary);
  }
  return lines.join('\n').trim() + '\n';
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addNotification } = useStore();
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [plainOpen, setPlainOpen] = useState(false);

  const { data: report, isLoading } = useQuery({
    queryKey: ['report', id],
    queryFn: () => getReport(id!),
    enabled: !!id,
  });

  const { data: revisions = [] } = useQuery({
    queryKey: ['report-revisions', id],
    queryFn: () => getReportRevisions(id!),
    enabled: !!id,
  });

  const { data: revisionDetail } = useQuery({
    queryKey: ['report-revision', id, selectedRevisionId],
    queryFn: () => getReportRevision(id!, selectedRevisionId!),
    enabled: !!id && !!selectedRevisionId,
  });

  const plainMd =
    report?.metadata && typeof report.metadata === 'object' && 'plain_language_markdown' in report.metadata
      ? String((report.metadata as { plain_language_markdown?: string }).plain_language_markdown ?? '')
      : '';

  const featuredMutation = useMutation({
    mutationFn: async () => {
      let token = sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY);
      if (!token) {
        token = window.prompt('Admin token required to publish to Featured Report on thenewontology.life')?.trim() ?? '';
        if (token) sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, token);
      }
      if (!token) throw new Error('Admin token required');
      return publishReportFeatured(id!, token);
    },
    onSuccess: (data) => {
      addNotification('success', data.commitUrl ? 'Featured report updated — commit pushed.' : 'Featured report publish completed.');
      if (data.commitUrl) {
        window.open(data.commitUrl, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Publish failed';
      addNotification('error', msg);
    },
  });

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: report?.title ?? 'Research report', url });
      } else {
        await navigator.clipboard.writeText(url);
        addNotification('info', 'Link copied to clipboard.');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        addNotification('info', 'Link copied to clipboard.');
      } catch {
        addNotification('error', 'Could not share or copy link.');
      }
    }
  };

  const handleDownload = () => {
    if (!report) return;
    const md = buildReportMarkdown(report);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${report.id.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

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
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6 print:px-4">
      <button className="btn-ghost text-sm print:hidden" onClick={() => navigate('/reports')}>
        <ArrowLeft size={14} />
        Back to Reports
      </button>

      <ReportActionBar
        onPrint={handlePrint}
        onShare={handleShare}
        onDownload={handleDownload}
        onFeatured={() => featuredMutation.mutate()}
        featuredPending={featuredMutation.isPending}
        showPlainLink={plainMd.length > 0}
        onOpenPlain={() => setPlainOpen(true)}
      />

      <div className="card-glow p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-white leading-tight">{report.title}</h1>
          <span
            className={clsx(
              'badge border flex-shrink-0',
              report.status === 'finalized'
                ? 'bg-green-900/20 text-green-400 border-green-800/30'
                : 'bg-accent/10 text-accent border-accent/30'
            )}
          >
            {report.status}
          </span>
        </div>

        {plainMd.length > 0 && (
          <button
            type="button"
            className="text-sm text-accent hover:underline flex items-center gap-1.5 print:hidden"
            onClick={() => setPlainOpen(true)}
          >
            <Sparkles size={14} />
            See this report in plain language
          </button>
        )}

        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span>{formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}</span>
          <span>•</span>
          <span>v{report.version_number ?? 1}</span>
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

        <div className="grid grid-cols-4 gap-3 pt-2 border-t border-indigo-900/20">
          <MetaStat label="Evidence Chunks" value={report.chunk_count} />
          <MetaStat label="Sources" value={report.source_count} />
          <MetaStat label="Contradictions" value={report.contradiction_count} color="text-amber-400" />
          <MetaStat label="Status" value={report.status} />
        </div>
      </div>

      {report.falsification_criteria && (
        <div className="card p-4 border-purple-900/40 bg-purple-900/10">
          <div className="flex items-center gap-2 mb-2">
            <Target size={14} className="text-purple-400" />
            <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Falsification Criteria</span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{report.falsification_criteria}</p>
        </div>
      )}

      {report.sections && report.sections.length > 0 ? (
        <div className="space-y-4">
          {report.sections.map(section => {
            const Icon = SECTION_ICONS[section.section_type] ?? FileText;
            const color = SECTION_COLORS[section.section_type] ?? 'text-slate-400';
            return (
              <div key={section.id} className="card p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <Icon size={16} className={color} />
                  <h2 className={clsx('font-semibold text-sm uppercase tracking-wide', color)}>{section.title}</h2>
                </div>
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReportContent content={section.content} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        report.executive_summary && (
          <div className="card p-6">
            <ReportContent content={report.executive_summary} />
          </div>
        )
      )}

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

      <ReportActionBar
        className="print:hidden"
        onPrint={handlePrint}
        onShare={handleShare}
        onDownload={handleDownload}
        onFeatured={() => featuredMutation.mutate()}
        featuredPending={featuredMutation.isPending}
        showPlainLink={plainMd.length > 0}
        onOpenPlain={() => setPlainOpen(true)}
      />

      <div className="card p-5 space-y-3 print:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Revision History</h2>
        {revisions.length === 0 ? (
          <p className="text-xs text-slate-500">No post-publication revisions yet.</p>
        ) : (
          <div className="space-y-2">
            {revisions.map(revision => (
              <button
                key={revision.id}
                className={clsx(
                  'w-full text-left p-3 rounded border text-xs transition-colors',
                  selectedRevisionId === revision.id
                    ? 'border-accent/50 bg-accent/10 text-slate-100'
                    : 'border-indigo-900/30 bg-surface-900 text-slate-400 hover:border-accent/30'
                )}
                onClick={() => setSelectedRevisionId(revision.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>v{revision.revision_number}</span>
                  <span>{formatDistanceToNow(new Date(revision.created_at), { addSuffix: true })}</span>
                </div>
                {revision.rationale && <p className="mt-1 line-clamp-2">{revision.rationale}</p>}
              </button>
            ))}
          </div>
        )}
        {revisionDetail && (
          <div className="space-y-3 pt-3 border-t border-indigo-900/20">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Changed Sections</h3>
            {revisionDetail.sections.map(section => (
              <div key={section.id} className="rounded border border-indigo-900/30 p-3 space-y-2">
                <div className="text-xs text-slate-300">{section.section_title}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500 mb-1">Before</div>
                    <div className="bg-surface-900 rounded p-2 text-slate-400 max-h-48 overflow-auto">{section.before_content}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 mb-1">After</div>
                    <div className="bg-surface-900 rounded p-2 text-slate-300 max-h-48 overflow-auto">{section.after_content}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {plainOpen && plainMd.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plain-language-title"
          onClick={() => setPlainOpen(false)}
        >
          <div
            className="bg-surface-300 border border-indigo-900/40 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 p-4 border-b border-indigo-900/30">
              <h2 id="plain-language-title" className="text-lg font-semibold text-white flex items-center gap-2">
                <Sparkles size={18} className="text-accent" />
                Plain language report
              </h2>
              <button type="button" className="btn-ghost text-sm" onClick={() => setPlainOpen(false)}>
                Close
              </button>
            </div>
            <div className="overflow-y-auto p-5 prose prose-invert prose-sm max-w-none">
              <ReportContent content={plainMd} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportActionBar({
  onPrint,
  onShare,
  onDownload,
  onFeatured,
  featuredPending,
  showPlainLink,
  onOpenPlain,
  className,
}: {
  onPrint: () => void;
  onShare: () => void;
  onDownload: () => void;
  onFeatured: () => void;
  featuredPending: boolean;
  showPlainLink: boolean;
  onOpenPlain: () => void;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center gap-2 rounded-lg border border-indigo-900/30 bg-surface-200/80 px-3 py-2 print:hidden',
        className
      )}
    >
      <span className="text-xs text-slate-500 mr-1">Actions</span>
      <button type="button" className="btn-ghost p-2 h-9 w-9" title="Print" onClick={onPrint}>
        <Printer size={16} />
      </button>
      <button type="button" className="btn-ghost p-2 h-9 w-9" title="Share" onClick={onShare}>
        <Share2 size={16} />
      </button>
      <button type="button" className="btn-ghost p-2 h-9 w-9" title="Download Markdown" onClick={onDownload}>
        <Download size={16} />
      </button>
      {showPlainLink && (
        <button type="button" className="btn-ghost p-2 h-9 w-9" title="Plain language" onClick={onOpenPlain}>
          <Sparkles size={16} />
        </button>
      )}
      <button
        type="button"
        className="btn-ghost p-2 h-9 w-9 disabled:opacity-50"
        title="Publish as Featured Report (thenewontology.life)"
        onClick={onFeatured}
        disabled={featuredPending}
      >
        <Globe size={16} />
      </button>
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
  const paragraphs = content.split('\n\n').filter(p => p.trim());
  return (
    <div className="space-y-3">
      {paragraphs.map((p, i) => {
        if (p.startsWith('# ')) {
          return (
            <h1 key={i} className="text-xl font-bold text-white">
              {p.slice(2)}
            </h1>
          );
        }
        if (p.startsWith('## ')) {
          return (
            <h2 key={i} className="text-lg font-semibold text-white">
              {p.slice(3)}
            </h2>
          );
        }
        if (p.startsWith('### ')) {
          return (
            <h3 key={i} className="text-base font-semibold text-slate-200">
              {p.slice(4)}
            </h3>
          );
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
          <p key={i} className="text-slate-300 text-sm leading-relaxed">
            {p}
          </p>
        );
      })}
    </div>
  );
}
