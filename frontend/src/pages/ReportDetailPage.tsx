import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReportMarkdown from '../components/reports/ReportMarkdown';
import ReaderView from '../components/reports/reader/ReaderView';
import { buildReaderMarkdown, legacyNumbersFrom, legacyNumbersOf, type ReaderEvidence } from '../components/reports/reader/readerModel';
import api, {
  getReport,
  getReportRevision,
  getReportRevisions,
  publishReportFeatured,
  getResearchRun,
} from '../utils/api';
import type { ReportRevisionRequestState } from '@/types/reportRevisionNavigation';
import MonitorToggle from '../components/monitors/MonitorToggle';
import ReportExportButton from '../components/reports/ReportExportButton';
import AttachmentDropZone from '../components/research/AttachmentDropZone';
import ReportForkActions from '../components/reports/ReportForkActions';
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  Printer,
  Share2,
  Download,
  Sparkles,
  Globe,
  ChevronDown,
  ChevronUp,
  MessageSquareText,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { getSocket, subscribeToJob } from '../utils/socket';

/** The style a report's own reference list was saved in, when the report records one. */
function savedReferenceStyle(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const style = (metadata as { reference_style?: unknown }).reference_style;
  return typeof style === 'string' && style ? style : null;
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [plainOpen, setPlainOpen] = useState(false);
  const [requestPromptOpen, setRequestPromptOpen] = useState(false);
  const [revisionRequestText, setRevisionRequestText] = useState('');
  const [revisionRationale, setRevisionRationale] = useState('');
  // Files and URLs attached to support the revision request. They get
  // ingested into the corpus AND their text is spliced into the revision
  // prompts so the models review them on this call.
  const [revisionFiles, setRevisionFiles] = useState<File[]>([]);
  const [revisionUrls, setRevisionUrls] = useState<string[]>([]);
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    subscribeToJob(id);
    const sock = getSocket();
    const onLivingCompleted = (payload: unknown) => {
      const p = payload as { reportId?: string };
      if (p.reportId && p.reportId !== id) return;
      qc.invalidateQueries({ queryKey: ['report', id] });
      qc.invalidateQueries({ queryKey: ['report-revisions', id] });
      qc.invalidateQueries({ queryKey: ['report-monitors', id] });
      addNotification('info', 'Living Report monitor produced a new revision for this report.');
    };
    sock.on('living_report:revision_completed', onLivingCompleted);
    return () => {
      sock.off('living_report:revision_completed', onLivingCompleted);
    };
  }, [id, qc, addNotification]);


  const { data: report, isLoading } = useQuery({
    queryKey: ['report', id],
    queryFn: () => getReport(id!),
    enabled: !!id,
  });
  const { data: authMe } = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const response = await api.get<{ userId: string; isAdmin: boolean }>('/auth/me');
      return response.data;
    },
  });

  const { data: sourceRun } = useQuery({
    queryKey: ['research-run', report?.run_id],
    queryFn: () => getResearchRun(report!.run_id!),
    enabled: Boolean(report?.run_id),
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

  // If this report IS itself the result of a revision (its `parent_report_id`
  // is set), find the revision row that produced it and auto-fetch the
  // section-level diff so we can show a "What changed in this revision"
  // panel near the top of the page. Without this, the user submits a
  // revision request, lands on the revised report, and has no clear cue
  // about what was actually altered until they expand the Revision History
  // section and click into the row by hand.
  const currentRevisionEntry = useMemo(() => {
    if (!id) return null;
    type RevisionRow = { id: string; revised_report_id?: string; report_id?: string; rationale?: string; revision_number?: number; created_at?: string };
    const rows = revisions as unknown as RevisionRow[];
    return rows.find((r) => r.revised_report_id === id) ?? null;
  }, [revisions, id]);
  const { data: currentRevisionDetail } = useQuery({
    queryKey: ['report-revision-current', id, currentRevisionEntry?.id],
    queryFn: () => getReportRevision(id!, currentRevisionEntry!.id),
    enabled: Boolean(id && currentRevisionEntry?.id),
  });

  const { data: citations = [] } = useQuery({
    queryKey: ['report-citations', id],
    queryFn: async () => {
      const { default: api } = await import('../utils/api');
      const res = await api.get(`/reports/${id}/citations`);
      // Only what numbers an older report's passage labels is read. Grade and stance values are not.
      return res.data as Array<{ id: string; citation_text?: string; source_id?: string | null; citation_order?: number | null }>;
    },
    enabled: !!id,
  });

  // Every report is shown in the reader view. Nothing the backend sends, and no
  // setting, selects another layout: there is none.
  const { data: readerEvidence } = useQuery({
    queryKey: ['report-reader', id],
    queryFn: async () => (await api.get(`/reports/${id}/reader`)).data as ReaderEvidence,
    enabled: Boolean(id) && Boolean(report),
  });
  const legacyNumbers = useMemo(() => legacyNumbersFrom(citations), [citations]);

  const plainMd =
    report?.metadata && typeof report.metadata === 'object' && 'plain_language_markdown' in report.metadata
      ? String((report.metadata as { plain_language_markdown?: string }).plain_language_markdown ?? '')
      : '';

  const researchRequestSnapshot = useMemo(() => {
    const meta = report?.metadata as { research_request?: { query?: string; supplemental?: string; supplemental_attachments?: unknown } } | undefined;
    const fromMeta = meta?.research_request;
    const attachments = (sourceRun?.supplemental_attachments ??
      fromMeta?.supplemental_attachments) as
      | Array<{ kind: string; url?: string; filename?: string; mimetype?: string; ingestion_job_id: string }>
      | undefined;
    return {
      query: fromMeta?.query ?? sourceRun?.query ?? report?.query ?? '',
      supplemental: (fromMeta?.supplemental ?? sourceRun?.supplemental ?? '').trim(),
      attachments: Array.isArray(attachments) ? attachments : [],
    };
  }, [report?.metadata, report?.query, sourceRun]);

  const openRevisionWorkspace = () => {
    if (!id || !revisionRequestText.trim() || revisionSubmitting) return;
    const state: ReportRevisionRequestState = {
      requestText: revisionRequestText.trim(),
      rationale: revisionRationale.trim() || undefined,
      revisionFiles: revisionFiles.length > 0 ? revisionFiles : undefined,
      revisionUrls: revisionUrls.length > 0 ? revisionUrls : undefined,
    };
    setRevisionSubmitting(true);
    navigate(`/app/reports/${id}/revising`, { state });
  };

  const featuredMutation = useMutation({
    mutationFn: async () => publishReportFeatured(id!, undefined),
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
        await navigator.share({ title: report?.title ?? 'Research dossier', url });
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

  const handleDownload = async () => {
    if (!report) return;
    // The download is the view the reader is in. An older report's passage
    // labels are numbered from the page's data; if that has not arrived yet it
    // is fetched here, so a quick click does not save a file with its
    // citations missing.
    let evidence = readerEvidence;
    if (!evidence) {
      try {
        evidence = (await api.get(`/reports/${report.id}/reader`)).data as ReaderEvidence;
      } catch {
        evidence = undefined;
      }
    }
    const md = buildReaderMarkdown(report, new Map([...legacyNumbersOf(evidence), ...legacyNumbers]));
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

  const retentionNotices = (
    <>
        {(report.retention_status === 'living_active' || report.has_active_living_report) && (
          <div className="flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
            <AlertTriangle size={14} className="text-accent mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-300">Living Report active — source set and monitoring state retained while active.</p>
          </div>
        )}
        {report.workspace_purged_at && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-800/30 bg-amber-900/10 px-3 py-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-300">
              The temporary research workspace for this report has been cleared. The final report and citations remain available
              {report.report_expires_at ? ` until ${format(new Date(report.report_expires_at), 'MMM d, yyyy')}` : ''}.
            </p>
          </div>
        )}
        {report.report_expires_at && report.status === 'finalized' && !report.has_active_living_report && report.retention_status !== 'living_active' && !report.workspace_purged_at && (
          <div className="flex items-start gap-2 rounded-lg border border-indigo-900/20 bg-surface-200/50 px-3 py-2">
            <FileText size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-r1-text-muted">
              Available until {format(new Date(report.report_expires_at), 'MMM d, yyyy')}. Export or convert to a Living Report to keep monitoring active.
            </p>
          </div>
        )}
    </>
  );

  const originalRequest = (
      <div className="print:hidden">
        <button
          type="button"
          className="flex items-center gap-2 text-sm text-accent hover:underline mt-1"
          onClick={() => setRequestPromptOpen((o) => !o)}
        >
          <MessageSquareText size={14} />
          {requestPromptOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Original research request
          {researchRequestSnapshot.attachments.length > 0 && (
            <span className="text-xs text-slate-500">
              ({researchRequestSnapshot.attachments.length} supplemental item
              {researchRequestSnapshot.attachments.length === 1 ? '' : 's'})
            </span>
          )}
        </button>
        {requestPromptOpen && (
          <div className="mt-3 rounded-lg border border-indigo-900/30 bg-surface-200 p-4 space-y-3 text-sm">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Prompt</span>
              <p className="text-slate-200 whitespace-pre-wrap mt-1 leading-relaxed">{researchRequestSnapshot.query}</p>
            </div>
            {researchRequestSnapshot.supplemental ? (
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Supplemental text</span>
                <p className="text-slate-300 whitespace-pre-wrap mt-1 leading-relaxed">{researchRequestSnapshot.supplemental}</p>
              </div>
            ) : null}
            {researchRequestSnapshot.attachments.length > 0 ? (
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Supplemental URLs and files (ingested into corpus)
                </span>
                <ul className="mt-2 space-y-2">
                  {researchRequestSnapshot.attachments.map((a, i) => (
                    <li key={`${a.ingestion_job_id}-${i}`} className="text-slate-300 flex flex-col gap-0.5">
                      {a.kind === 'url' && a.url ? (
                        <>
                          <span className="text-xs text-slate-500">URL</span>
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent break-all hover:underline"
                          >
                            {a.url}
                          </a>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-slate-500">File</span>
                          <span>
                            {a.filename ?? 'file'}
                            {a.mimetype ? <span className="text-slate-500 text-xs"> ({a.mimetype})</span> : null}
                          </span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6 print:px-4">
      <button className="btn-ghost text-sm print:hidden" onClick={() => navigate('/app/dossiers')}>
        <ArrowLeft size={14} />
        Back to dossiers
      </button>

      <ReaderView
        report={report}
        evidence={readerEvidence}
        legacyNumbers={legacyNumbers}
        method={
          <div className="space-y-4">
            {originalRequest}
            {sourceRun?.run_ref && (
              <p className="text-sm text-slate-300">
                Run reference: <span className="font-mono">{sourceRun.run_ref}</span>. Quote it to support.
              </p>
            )}
          </div>
        }
      />
      <div className="space-y-3 print:hidden">
        <MonitorToggle reportId={report.id} reportStatus={report.status} />
        {retentionNotices}
      </div>
      {currentRevisionEntry && currentRevisionDetail && (
        <RevisionDiffPanel
          revisionEntry={currentRevisionEntry as { id: string; revision_number?: number; rationale?: string; created_at?: string }}
          revisionDetail={currentRevisionDetail as { rationale?: string; sections: Array<{ id: string; section_type?: string; section_title: string; change_type?: string; before_content: string; after_content: string }> }}
        />
      )}

      <ReportForkActions
        reportId={report.id}
        onEditInPlace={() => {
          const el = document.getElementById('revision-form');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        editDisabled={revisionSubmitting}
      />

      <div id="revision-form" className="card p-5 space-y-3 print:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Request edit / correction / re-evaluation</h2>
        <textarea
          className="textarea min-h-24"
          placeholder="Describe the edit, correction, or re-evaluation you want."
          value={revisionRequestText}
          onChange={(e) => setRevisionRequestText(e.target.value)}
          disabled={revisionSubmitting}
        />
        <textarea
          className="textarea min-h-20"
          placeholder="Optional basis for change (sources, rationale, assumptions to test)"
          value={revisionRationale}
          onChange={(e) => setRevisionRationale(e.target.value)}
          disabled={revisionSubmitting}
        />
        <AttachmentDropZone
          files={revisionFiles}
          urls={revisionUrls}
          onChange={({ files, urls }) => {
            setRevisionFiles(files);
            setRevisionUrls(urls);
          }}
          disabled={revisionSubmitting}
          mode="revision"
          label="Supplemental files and URLs to support the revision (optional)"
        />
        <p className="text-xs text-slate-500">
          Opens a page where you can follow the revision, then the new version of the report when it is ready.
          Want to start again with different settings? Use <strong>New follow-up research</strong> above.
        </p>
        <button
          type="button"
          className="btn-primary"
          disabled={!revisionRequestText.trim() || revisionSubmitting}
          onClick={openRevisionWorkspace}
        >
          {revisionSubmitting ? 'Opening revision workspace…' : 'Submit revision request'}
        </button>
      </div>

      <ReportActionBar
        className="print:hidden"
        reportId={report.id}
        runCitationStyle={savedReferenceStyle(report.metadata) ?? sourceRun?.citation_style ?? null}
        onPrint={handlePrint}
        onShare={handleShare}
        onDownload={handleDownload}
        onFeatured={() => featuredMutation.mutate()}
        featuredPending={featuredMutation.isPending}
        canFeature={authMe?.isAdmin === true}
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
  reportId,
  runCitationStyle,
  onPrint,
  onShare,
  onDownload,
  onFeatured,
  featuredPending,
  canFeature,
  showPlainLink,
  onOpenPlain,
  className,
}: {
  reportId: string;
  runCitationStyle?: string | null;
  onPrint: () => void;
  onShare: () => void;
  onDownload: () => void;
  onFeatured: () => void;
  featuredPending: boolean;
  canFeature: boolean;
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
      <ReportExportButton reportId={reportId} runCitationStyle={runCitationStyle} />
      {showPlainLink && (
        <button type="button" className="btn-ghost p-2 h-9 w-9" title="Plain language" onClick={onOpenPlain}>
          <Sparkles size={16} />
        </button>
      )}
      {canFeature && (
        <button
          type="button"
          className="btn-ghost p-2 h-9 w-9 disabled:opacity-50"
          title="Publish as Featured Report"
          onClick={onFeatured}
          disabled={featuredPending}
        >
          <Globe size={16} />
        </button>
      )}
    </div>
  );
}

function ReportContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReportMarkdown>{content}</ReportMarkdown>
    </div>
  );
}

/**
 * Auto-shown summary of "what changed in this revision" rendered near the
 * top of a revised report. Uses the report_revision_sections rows
 * (before_content / after_content) populated by reportRevisionService when
 * the revision was applied. Each row collapses to a one-line summary
 * (added / rewritten section, with a quick line-count delta) and expands
 * to the full before/after side-by-side diff on click.
 *
 * This complements the bottom-of-page "Revision History" — that one lists
 * every revision in the chain so the user can step through history; this
 * one calls out the diff for the revision that produced THIS report so
 * the user does not have to hunt for it after submitting an edit request.
 */
function RevisionDiffPanel({
  revisionEntry,
  revisionDetail,
}: {
  revisionEntry: { id: string; revision_number?: number; rationale?: string; created_at?: string };
  revisionDetail: {
    rationale?: string;
    sections: Array<{
      id: string;
      section_type?: string;
      section_title: string;
      change_type?: string;
      before_content: string;
      after_content: string;
    }>;
  };
}) {
  const [openSectionIds, setOpenSectionIds] = useState<Set<string>>(new Set());
  const sections = revisionDetail.sections ?? [];
  const rationale = (revisionDetail.rationale ?? revisionEntry.rationale ?? '').trim();
  if (sections.length === 0) {
    return (
      <div className="card p-4 border-accent/30 bg-accent/5 print:hidden">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquareText size={14} className="text-accent" />
          <span className="text-xs font-semibold text-accent uppercase tracking-wider">
            Revision v{revisionEntry.revision_number ?? '?'} applied
          </span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          The revision request was accepted{rationale ? ` ("${rationale}")` : ''} but did not change any sections. Compare with the previous version in Revision History.
        </p>
      </div>
    );
  }
  const toggle = (id: string) => {
    setOpenSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className="card p-4 border-accent/30 bg-accent/5 space-y-3 print:hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MessageSquareText size={14} className="text-accent" />
          <span className="text-xs font-semibold text-accent uppercase tracking-wider">
            What changed in this revision (v{revisionEntry.revision_number ?? '?'})
          </span>
        </div>
        {revisionEntry.created_at && (
          <span className="text-[11px] text-slate-500">
            applied {formatDistanceToNow(new Date(revisionEntry.created_at), { addSuffix: true })}
          </span>
        )}
      </div>
      {rationale && (
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-slate-500 uppercase tracking-wide font-semibold">Rationale: </span>
          {rationale}
        </p>
      )}
      <ul className="space-y-2">
        {sections.map((s) => {
          const isOpen = openSectionIds.has(s.id);
          const beforeLen = (s.before_content ?? '').length;
          const afterLen = (s.after_content ?? '').length;
          const delta = afterLen - beforeLen;
          const changeLabel = s.change_type === 'insertion'
            ? 'New section'
            : s.change_type === 'deletion'
              ? 'Removed'
              : 'Rewritten';
          const deltaLabel = delta === 0
            ? 'no length change'
            : `${delta > 0 ? '+' : ''}${delta} chars`;
          return (
            <li key={s.id} className="rounded-md border border-indigo-900/30 bg-surface-900/40">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-200/50 transition-colors"
                onClick={() => toggle(s.id)}
                aria-expanded={isOpen}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {isOpen ? <ChevronUp size={12} className="text-slate-500 flex-shrink-0" /> : <ChevronDown size={12} className="text-slate-500 flex-shrink-0" />}
                  <span className="text-xs text-slate-200 truncate">{s.section_title}</span>
                  <span className="text-[10px] text-accent font-semibold uppercase tracking-wide flex-shrink-0">{changeLabel}</span>
                </span>
                <span className="text-[10px] text-slate-500 tabular-nums flex-shrink-0">{deltaLabel}</span>
              </button>
              {isOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 px-3 pb-3 text-xs">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Before</div>
                    <div className="bg-surface-900 rounded p-2 text-slate-400 max-h-64 overflow-auto whitespace-pre-wrap leading-relaxed">
                      {s.before_content || <span className="italic text-slate-600">(empty — section was newly inserted)</span>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">After</div>
                    <div className="bg-surface-900 rounded p-2 text-slate-300 max-h-64 overflow-auto whitespace-pre-wrap leading-relaxed">
                      {s.after_content || <span className="italic text-slate-600">(empty — section was removed)</span>}
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
