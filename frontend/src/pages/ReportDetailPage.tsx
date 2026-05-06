import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  getReport,
  getReportRevision,
  getReportRevisions,
  createReportRevision,
  publishReportFeatured,
  getResearchRun,
  getRunArtifacts,
  ADMIN_SESSION_TOKEN_KEY,
  type ResearchRun,
  type ResearchProgressEvent,
} from '../utils/api';
import RunSummaryReport, { type RunSummaryData } from '../components/research/RunSummaryReport';
import AttachmentDropZone from '../components/research/AttachmentDropZone';
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
  ChevronDown,
  ChevronUp,
  MessageSquareText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { getSocket, subscribeToJob } from '../utils/socket';

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


function getReaderFrontMatter(metadata?: Record<string, unknown>): {
  overall_summary?: string;
  conclusions_nutshell?: string;
  metric_glosses?: Array<{ label?: string; narrative?: string }>;
} {
  if (!metadata) return {};
  const m = metadata as Record<string, unknown>;
  const r = m.reader_front_matter as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return {};
  return {
    overall_summary: typeof r.overall_summary === 'string' ? r.overall_summary : undefined,
    conclusions_nutshell: typeof r.conclusions_nutshell === 'string' ? r.conclusions_nutshell : undefined,
    metric_glosses: Array.isArray(r.metric_glosses) ? (r.metric_glosses as Array<{ label?: string; narrative?: string }>) : undefined,
  };
}

function metricNarrative(metricGlosses: Array<{ label?: string; narrative?: string }> | undefined, fallback: string, key: string): string {
  const hit = metricGlosses?.find((g) => (g.label || '').toLowerCase().includes(key.toLowerCase()));
  return hit?.narrative || fallback;
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
  const [revisionProgress, setRevisionProgress] = useState<{
    stage: string;
    percent: number;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    subscribeToJob(id);
    const sock = getSocket();
    const onProgress = (payload: unknown) => {
      const p = payload as { reportId?: string; stage?: string; percent?: number; message?: string };
      if (p.reportId && p.reportId !== id) return;
      setRevisionProgress({
        stage: p.stage ?? '',
        percent: typeof p.percent === 'number' ? p.percent : 0,
        message: p.message ?? '',
      });
    };
    const onCompleted = () => setRevisionProgress(null);
    sock.on('revision:progress', onProgress);
    sock.on('revision:completed', onCompleted);
    return () => {
      sock.off('revision:progress', onProgress);
      sock.off('revision:completed', onCompleted);
    };
  }, [id]);


  const { data: report, isLoading } = useQuery({
    queryKey: ['report', id],
    queryFn: () => getReport(id!),
    enabled: !!id,
  });

  const { data: sourceRun } = useQuery({
    queryKey: ['research-run', report?.run_id],
    queryFn: () => getResearchRun(report!.run_id!),
    enabled: Boolean(report?.run_id),
  });

  // Fetch the run's artifacts (progress events, model_log, plan, etc.) so the
  // same RunSummaryReport rendered on FailedRunReportPage is available here
  // on the success report page. This shows the user the full path the
  // orchestrator took to a successful report (matching the failed-run view).
  const { data: runArtifacts } = useQuery({
    queryKey: ['run-artifacts', report?.run_id],
    queryFn: () => getRunArtifacts(report!.run_id!),
    enabled: Boolean(report?.run_id),
    retry: 1,
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
      return res.data as Array<{ id: string; citation_text?: string; source_title?: string; source_url?: string; evidence_tier?: string; stance?: string }>;
    },
    enabled: !!id,
  });

  const frontMatter = getReaderFrontMatter(report?.metadata as Record<string, unknown> | undefined);
  const metricGlosses = frontMatter.metric_glosses;

  const plainMd =
    report?.metadata && typeof report.metadata === 'object' && 'plain_language_markdown' in report.metadata
      ? String((report.metadata as { plain_language_markdown?: string }).plain_language_markdown ?? '')
      : '';

  const runSummary: RunSummaryData | null = useMemo(() => {
    if (!sourceRun) return null;
    const events = runArtifacts?.progressEvents ?? sourceRun.progress_events ?? [];
    const phaseDurations: Record<string, number> = {};
    if (events.length > 0) {
      const buckets: Record<string, { start: number; end: number }> = {};
      for (const evt of events) {
        if (!evt.timestamp || !evt.stage) continue;
        const t = new Date(evt.timestamp).getTime();
        if (Number.isNaN(t)) continue;
        const bucket = buckets[evt.stage] ?? (buckets[evt.stage] = { start: t, end: t });
        bucket.start = Math.min(bucket.start, t);
        bucket.end = Math.max(bucket.end, t);
      }
      for (const [stage, { start, end }] of Object.entries(buckets)) {
        phaseDurations[stage] = end - start;
      }
    }
    const totalDurationMs =
      sourceRun.completed_at && sourceRun.created_at
        ? new Date(sourceRun.completed_at).getTime() - new Date(sourceRun.created_at).getTime()
        : 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const modelUsage: RunSummaryData['modelUsage'] = [];
    for (const entry of runArtifacts?.modelLog ?? []) {
      const e = entry as Record<string, unknown>;
      const promptTokens = Number(e.promptTokens ?? 0);
      const completionTokens = Number(e.completionTokens ?? 0);
      totalPromptTokens += promptTokens;
      totalCompletionTokens += completionTokens;
      modelUsage!.push({
        role: typeof e.role === 'string' ? e.role : 'unknown',
        model: typeof e.model === 'string' ? e.model : 'unknown',
        promptTokens,
        completionTokens,
        durationMs: Number(e.durationMs ?? 0),
      });
    }
    return {
      runId: sourceRun.id,
      status: sourceRun.status,
      totalDurationMs,
      phaseDurations,
      totalPromptTokens,
      totalCompletionTokens,
      retryCount: sourceRun.retry_attempts ?? 0,
      failedStage: sourceRun.failed_stage ?? null,
      errorMessage: sourceRun.error_message ?? null,
      failureMeta: (sourceRun.failure_meta as Record<string, unknown> | undefined) ?? null,
      modelUsage,
    };
  }, [sourceRun, runArtifacts]);

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

  const revisionMutation = useMutation({
    mutationFn: () =>
      createReportRevision(id!, {
        requestText: revisionRequestText.trim(),
        rationale: revisionRationale.trim() || undefined,
        revisionFiles: revisionFiles.length > 0 ? revisionFiles : undefined,
        revisionUrls: revisionUrls.length > 0 ? revisionUrls : undefined,
      }),
    onMutate: () => {
      const attachmentNote =
        revisionFiles.length > 0 || revisionUrls.length > 0
          ? ` (${revisionFiles.length} file${revisionFiles.length === 1 ? '' : 's'} · ${revisionUrls.length} URL${revisionUrls.length === 1 ? '' : 's'} attached)`
          : '';
      addNotification('info', `Revision request submitted${attachmentNote} — processing on the server…`);
      setRevisionProgress({ stage: 'queued', percent: 0, message: 'Connecting…' });
    },
    onSuccess: (data) => {
      setRevisionProgress(null);
      addNotification('success', 'Revision requested and applied as a new version.');
      setRevisionRequestText('');
      setRevisionRationale('');
      setRevisionFiles([]);
      setRevisionUrls([]);
      qc.invalidateQueries({ queryKey: ['report-revisions', id] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      if (data.revisedReportId) {
        navigate(`/reports/${data.revisedReportId}`);
      }
    },
    onError: (err: unknown) => {
      setRevisionProgress(null);
      addNotification('error', err instanceof Error ? err.message : 'Revision request failed');
    },
  });

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
      <button className="btn-ghost text-sm print:hidden" onClick={() => navigate('/app/reports')}>
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

        <div className="pt-2 border-t border-indigo-900/20 space-y-3">
          {(frontMatter.overall_summary || frontMatter.conclusions_nutshell) && (
            <div className="rounded-lg border border-indigo-900/20 bg-surface-200 p-3 space-y-2">
              {frontMatter.overall_summary && (
                <p className="text-sm text-slate-200 leading-relaxed">
                  {frontMatter.overall_summary}
                </p>
              )}
              {frontMatter.conclusions_nutshell && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  {frontMatter.conclusions_nutshell}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <MetaStat
              label="Evidence coverage"
              value={`${report.chunk_count} chunks from ${report.source_count} sources`}
              narrative={metricNarrative(metricGlosses, 'Total corpus slices reviewed for this report. More sources can still shift confidence.', 'evidence')}
            />
            <MetaStat
              label="Claim conflicts"
              value={report.contradiction_count}
              color="text-amber-400"
              narrative={metricNarrative(metricGlosses, 'Conflicts indicate claims that cannot both hold as currently framed; review contradiction analysis for the exact pairs.', 'contradiction')}
            />
            <MetaStat
              label="Falsification target"
              value={report.falsification_criteria ? 'Defined' : 'Pending'}
              narrative={metricNarrative(metricGlosses, 'Counterevidence must directly disprove the report\'s core mechanism or assumptions listed in falsification criteria.', 'falsification')}
            />
            <MetaStat
              label="Report status"
              value={report.status}
              narrative="Finalized means this revision passed the verifier and has persisted claims, contradictions, and citations."
            />
          </div>
        </div>
      </div>

      {currentRevisionEntry && currentRevisionDetail && (
        <RevisionDiffPanel
          revisionEntry={currentRevisionEntry as { id: string; revision_number?: number; rationale?: string; created_at?: string }}
          revisionDetail={currentRevisionDetail as { rationale?: string; sections: Array<{ id: string; section_type?: string; section_title: string; change_type?: string; before_content: string; after_content: string }> }}
        />
      )}

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

      {sourceRun && (
        <div className="print:hidden space-y-2">
          <RunGenerationTracePanel
            runSummary={runSummary}
            run={sourceRun}
            traceEvents={runArtifacts?.progressEvents ?? sourceRun.progress_events ?? []}
          />
        </div>
      )}

      <div className="card p-5 space-y-3 print:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Request edit / correction / re-evaluation</h2>
        <textarea
          className="textarea min-h-24"
          placeholder="Describe the edit, correction, or re-evaluation you want."
          value={revisionRequestText}
          onChange={(e) => setRevisionRequestText(e.target.value)}
          disabled={revisionMutation.isPending}
        />
        <textarea
          className="textarea min-h-20"
          placeholder="Optional basis for change (sources, rationale, assumptions to test)"
          value={revisionRationale}
          onChange={(e) => setRevisionRationale(e.target.value)}
          disabled={revisionMutation.isPending}
        />
        <AttachmentDropZone
          files={revisionFiles}
          urls={revisionUrls}
          onChange={({ files, urls }) => {
            setRevisionFiles(files);
            setRevisionUrls(urls);
          }}
          disabled={revisionMutation.isPending}
          label="Supplemental files and URLs to support the revision (optional)"
          description="Attached files are extracted and reviewed by the revision pipeline (intake → planner → section rewriter) and also imported into the corpus so future runs can retrieve them. PDF / TXT / Markdown."
        />
        <button
          type="button"
          className="btn-primary"
          disabled={!revisionRequestText.trim() || revisionMutation.isPending}
          onClick={() => revisionMutation.mutate()}
        >
          {revisionMutation.isPending ? 'Submitting revision...' : 'Submit revision request'}
        </button>
        {revisionProgress && (
          <div className="rounded border border-indigo-900/30 bg-surface-900/80 p-3 space-y-2">
            <div className="flex justify-between gap-2 text-xs text-slate-400">
              <span className="text-slate-300">{revisionProgress.message}</span>
              <span className="tabular-nums text-slate-500">{revisionProgress.percent}%</span>
            </div>
            <div className="h-1.5 bg-surface-400 rounded overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(0, revisionProgress.percent))}%` }}
              />
            </div>
            {revisionProgress.stage && (
              <p className="text-[11px] text-slate-500 uppercase tracking-wide">{revisionProgress.stage}</p>
            )}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3 print:hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">References and citations</h2>
        {citations.length === 0 ? (
          <p className="text-xs text-slate-500">No mapped citations available for this report revision yet.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {citations.map((c, idx) => (
              <li key={c.id} className="rounded border border-indigo-900/20 bg-surface-200 p-2 space-y-1">
                <div className="text-slate-300">[{idx + 1}] {c.source_title || c.source_url || 'Untitled source'}</div>
                {c.citation_text && <div className="text-slate-400">{c.citation_text}</div>}
                <div className="text-slate-500">tier: {c.evidence_tier || 'unknown'} · stance: {c.stance || 'unknown'}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

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

function MetaStat({
  label,
  value,
  color,
  narrative,
}: {
  label: string;
  value: string | number;
  color?: string;
  narrative?: string;
}) {
  return (
    <div className="rounded-lg border border-indigo-900/20 bg-surface-200 p-3">
      <div className={clsx('text-sm font-semibold', color ?? 'text-white')}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      {narrative && <div className="text-xs text-slate-400 mt-1 leading-relaxed">{narrative}</div>}
    </div>
  );
}

function ReportContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold text-white mt-4 mb-2 leading-snug">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold text-slate-100 mt-4 mb-2 leading-snug">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold text-slate-200 mt-3 mb-1.5">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-semibold text-slate-300 mt-2 mb-1">{children}</h4>
        ),
        p: ({ children }) => (
          <p className="text-slate-300 text-sm leading-relaxed mb-3">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="space-y-1 mb-3">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="space-y-1 mb-3 ml-5 list-decimal text-slate-300 text-sm">{children}</ol>
        ),
        li: ({ children, ...props }) => {
          const isOrdered = (props as { ordered?: boolean }).ordered;
          return isOrdered ? (
            <li className="text-slate-300 text-sm leading-relaxed pl-1">{children}</li>
          ) : (
            <li className="flex items-start gap-2 text-slate-300 text-sm">
              <span className="text-accent mt-0.5 flex-shrink-0 select-none text-xs">▸</span>
              <span className="flex-1">{children}</span>
            </li>
          );
        },
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-100">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-slate-300">{children}</em>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent/40 pl-3 my-3 text-slate-400 text-sm italic">{children}</blockquote>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-');
          return isBlock ? (
            <pre className="bg-surface-200 rounded p-3 my-3 overflow-x-auto text-xs font-mono text-slate-300">
              <code>{children}</code>
            </pre>
          ) : (
            <code className="bg-surface-200 rounded px-1 py-0.5 text-xs font-mono text-accent">{children}</code>
          );
        },
        hr: () => <hr className="border-surface-100/30 my-4" />,
        table: ({ children }) => (
          <div className="overflow-x-auto my-3">
            <table className="text-xs text-slate-300 border-collapse w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border border-surface-100/30 px-2 py-1 text-left font-semibold text-slate-200 bg-surface-200">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-surface-100/20 px-2 py-1">{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/**
 * Collapsible panel that shows the same Run Summary Report (phase timings,
 * model usage, full event trace) used on the FailedRunReportPage — but here
 * it sits on the success report page so the user can see the path the
 * orchestrator took to a successful report. Closed by default to keep the
 * report itself the focus of the page.
 */
function RunGenerationTracePanel({
  runSummary,
  run,
  traceEvents,
}: {
  runSummary: RunSummaryData | null;
  run: ResearchRun;
  traceEvents: ResearchProgressEvent[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-0 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-300">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Generation trace and run summary
          <span className="text-[10px] font-normal text-slate-500 normal-case tracking-normal">
            (full path the orchestrator took to this report)
          </span>
        </span>
        <span className="text-[10px] uppercase text-slate-500 font-mono">
          {(traceEvents ?? []).length} events
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <RunSummaryReport
            summary={runSummary}
            run={run}
            traceEvents={traceEvents ?? []}
            failure={null}
          />
        </div>
      )}
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
          The revision pipeline accepted the request{rationale ? ` ("${rationale}")` : ''} but did not change any sections. Compare with the previous version in Revision History.
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
