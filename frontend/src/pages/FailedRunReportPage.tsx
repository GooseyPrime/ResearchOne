import type { ReactNode } from 'react';
import { useId, useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import NotUsedSources from '../components/research/NotUsedSources';
import DiscoverySummaryView from '../components/research/DiscoverySummaryView';
import ShowAllList from '../components/ui/ShowAllList';
import {
  getResearchRun,
  getRunArtifacts,
  retryResearchRunFromFailure,
  extractApiError,
} from '../utils/api';
import { SEND_AS_NEW_REQUEST, retryRefusalFromError, retryRefusedText, sentenceForRunThatCannotRunAgain } from '../utils/customerFailureText';
import { requestPrefillUrl } from '../utils/researchRunRoutes';
import { readLongFrames } from '../lib/longFrameLog';
import RunSummaryReport, { type RunSummaryData } from '../components/research/RunSummaryReport';
import { useIsAdmin } from '../hooks/useIsAdmin';
import {
  ArrowLeft,
  XCircle,
  AlertTriangle,
  Database,
  Brain,
  RefreshCw,
  ExternalLink,
  Clock,
  ChevronDown,
  ChevronRight,
  FileText,
  ListTree,
  Target,
  PenLine,
  Cpu,
  Paperclip,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import clsx from 'clsx';
import { plainLabel, plainProgressText } from '@/lib/researchone/plainWords';
import { readerStageLabel } from '@/lib/researchone/stageLabels';

const TIER_COLORS: Record<string, string> = {
  established_fact: 'text-green-400',
  strong_evidence: 'text-blue-400',
  testimony: 'text-purple-400',
  inference: 'text-amber-400',
  speculation: 'text-red-400',
};

function formatShortTime(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return '';
  }
}

export default function FailedRunReportPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  // The server refused to run this run again: its sentence, and (administrators only) why.
  const [retryRefused, setRetryRefused] = useState<{ sentence: string | null; adminReason: string | null } | null>(null);
  const isAdmin = useIsAdmin();
  // Times this browser was held still on any page, with the script that was running (RJ-022B).
  const longFrames = useMemo(() => readLongFrames(), []);

  const { data: run, isLoading: runLoading, error: runError } = useQuery({
    queryKey: ['research-run', runId],
    queryFn: () => getResearchRun(runId!),
    enabled: Boolean(runId),
  });

  const {
    data: artifacts,
    isLoading: artifactsLoading,
    isError: artifactsError,
    error: artifactsErrorObj,
    refetch: refetchArtifacts,
  } = useQuery({
    queryKey: ['run-artifacts', runId],
    queryFn: () => getRunArtifacts(runId!),
    enabled: Boolean(runId),
    retry: 1,
  });

  const retryMutation = useMutation({
    mutationFn: () => retryResearchRunFromFailure(runId!),
    onSuccess: () => navigate('/app/research'),
    onError: (err) => setRetryRefused(retryRefusalFromError(err)),
  });

  // Build a RunSummaryData payload from the persisted run row + artifacts so
  // the same RunSummaryReport component used on the live research page is
  // available here on failed runs.
  const runSummary: RunSummaryData | null = useMemo(() => {
    if (!run) return null;
    const phaseDurations: Record<string, number> = {};
    const events = artifacts?.progressEvents ?? [];
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
      run.completed_at && run.created_at
        ? new Date(run.completed_at).getTime() - new Date(run.created_at).getTime()
        : 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const modelUsage: RunSummaryData['modelUsage'] = [];
    for (const entry of artifacts?.modelLog ?? []) {
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
      runId: run.id,
      status: run.status,
      totalDurationMs,
      phaseDurations,
      totalPromptTokens,
      totalCompletionTokens,
      retryCount: run.retry_attempts ?? 0,
      failedStage: run.failed_stage ?? null,
      errorMessage: run.error_message ?? null,
      failureMeta: (run.failure_meta as Record<string, unknown> | undefined) ?? null,
      modelUsage,
    };
  }, [run, artifacts]);

  if (runLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm animate-pulse">
        Loading run data…
      </div>
    );
  }

  if (runError || !run) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 text-center space-y-3">
        <XCircle size={40} className="mx-auto text-red-400" />
        <p className="text-white">Run not found or could not be loaded.</p>
        <button type="button" className="btn-ghost text-sm" onClick={() => navigate('/app/dossiers')}>
          Back to dossiers
        </button>
      </div>
    );
  }

  const isAborted = run.status === 'aborted';
  const fmeta = (run.failure_meta as Record<string, unknown> | undefined) ?? {};
  // The test the server applies before it runs a run again.
  const retryable = fmeta.retryable === true || fmeta.resumeAvailable === true;
  const canRunAgain = retryable && !retryRefused;
  const sourceCount = artifacts?.sources.length ?? 0;
  const claimCount = artifacts?.claims.length ?? 0;
  const sourcesTotal = artifacts?.sourcesTotal ?? sourceCount;
  const claimsTotal = artifacts?.claimsTotal ?? claimCount;
  const progressEvents = artifacts?.progressEvents ?? [];
  const notUsedSources = artifacts?.notUsedSources ?? [];
  const supplementalAttachments = run.supplemental_attachments ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Nav */}
      <button
        type="button"
        className="btn-ghost text-xs flex items-center gap-1.5"
        onClick={() => navigate('/app/dossiers')}
      >
        <ArrowLeft size={13} />
        Back to dossiers
      </button>

      {/* Failed banner */}
      <div className="rounded-xl border border-red-800/40 bg-red-950/30 p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <XCircle size={24} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h1 className="text-lg font-bold text-white leading-snug">
                Research Run {isAborted ? 'Aborted' : 'Failed'}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                {run.completed_at && ` · completed ${format(new Date(run.completed_at), 'PPp')}`}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {canRunAgain ? (
              <button
                type="button"
                className="btn-ghost text-xs flex items-center gap-1.5 text-accent border border-accent/30 px-3 py-1.5 rounded-lg"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
              >
                <RefreshCw size={12} className={retryMutation.isPending ? 'animate-spin' : ''} />
                Run it again
              </button>
            ) : (
              // A run that cannot be run again (stored that way, or just refused
              // by the server) is offered as a new request with the same words.
              <Link
                to={requestPrefillUrl(run.id)}
                className="btn-ghost text-xs flex items-center gap-1.5 text-accent border border-accent/30 px-3 py-1.5 rounded-lg"
              >
                {SEND_AS_NEW_REQUEST}
              </Link>
            )}
            {retryRefused && (
              <p className="text-[10px] text-red-400 max-w-56 text-right leading-snug" role="alert" data-testid="retry-refused">
                {retryRefusedText(retryRefused.sentence)}
              </p>
            )}
            {isAdmin && retryRefused?.adminReason && (
              <p className="text-[10px] text-slate-500 font-mono max-w-56 text-right leading-snug" data-testid="retry-refused-reason">
                {retryRefused.adminReason}
              </p>
            )}
          </div>
        </div>

        {/* Original query */}
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Research query</div>
          <p className="text-sm text-white leading-relaxed bg-black/20 rounded-lg p-3 border border-white/5 whitespace-pre-wrap">
            {run.query}
          </p>
        </div>

        {/* Research objective + engine version: internal names, for administrators. */}
        {isAdmin && (run.research_objective || run.engine_version) && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            {run.research_objective && (
              <span>
                <span className="text-slate-600">Objective:</span>{' '}
                <span className="font-mono text-slate-300">{String(run.research_objective)}</span>
              </span>
            )}
            {run.engine_version && (
              <span>
                <span className="text-slate-600">Engine:</span>{' '}
                <span className="font-mono text-slate-300">{run.engine_version}</span>
              </span>
            )}
          </div>
        )}

        {/* Supplemental context */}
        {(run.supplemental && run.supplemental.trim().length > 0) && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">
              Supplemental context (as submitted)
            </div>
            <p className="text-xs text-slate-300 leading-relaxed bg-black/20 rounded-lg p-3 border border-white/5 whitespace-pre-wrap max-h-64 overflow-y-auto">
              {run.supplemental}
            </p>
          </div>
        )}

        {/* Supplemental attachments */}
        {supplementalAttachments.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1 flex items-center gap-1.5">
              <Paperclip size={10} />
              Supplemental attachments ({supplementalAttachments.length})
            </div>
            <div className="space-y-1">
              {supplementalAttachments.map((att, i) => (
                <div key={i} className="text-xs text-slate-300 bg-black/20 rounded-lg p-2 border border-white/5 flex items-center gap-2">
                  <span className="text-[10px] uppercase text-slate-500 font-mono">{att.kind}</span>
                  {att.kind === 'url' ? (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline truncate flex-1 min-w-0"
                    >
                      {att.url}
                    </a>
                  ) : (
                    <span className="truncate flex-1 min-w-0">
                      {att.filename}
                      {att.mimetype && <span className="text-slate-500 ml-1">({att.mimetype})</span>}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">
                    job {att.ingestion_job_id.slice(0, 8)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error details */}
        {(run.failed_stage || run.error_message) && (
          <div className="space-y-2">
            {isAdmin && run.failed_stage && (
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
                <span className="text-xs text-slate-400">
                  Failed at stage: <span className="text-amber-400">{readerStageLabel(run.failed_stage)}</span>
                </span>
              </div>
            )}
            {run.error_message && (
              <div className="rounded-lg bg-black/30 border border-red-900/30 p-3">
                <div className="text-[10px] uppercase tracking-widest text-red-500/70 mb-1">Error</div>
                <p className="text-xs text-red-300/90 leading-relaxed font-mono whitespace-pre-wrap break-words">
                  {/* An administrator reads the stored error. Everyone else reads the server's
                      sentence, which does not name "Run it again" once the run cannot be. */}
                  {isAdmin || canRunAgain
                    ? plainProgressText(run.error_message)
                    : sentenceForRunThatCannotRunAgain(plainProgressText(run.error_message))}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Retry info */}
        {(run.retry_attempts != null || run.retry_budget != null) && (
          <p className="text-xs text-slate-500">
            Retries used: <span className="text-slate-300">{run.retry_attempts ?? 0}</span>
            {run.retry_budget != null && (
              <> of <span className="text-slate-300">{run.retry_budget}</span></>
            )}
            {isAdmin && fmeta.terminal === true && (
              <span className="ml-2 text-slate-600">
                · budget locked ({String(fmeta.abortReason ?? 'non-recoverable')})
              </span>
            )}
          </p>
        )}
      </div>

      {/* The technical record of the run (its trace, the steps that ran, model and
          token counts) is for administrators. A customer is shown what went
          wrong in plain words above, and the reference to quote to support. */}
      {isAdmin && <RunSummaryReport
        summary={runSummary}
        run={run}
        plan={(artifacts?.plan as Record<string, unknown> | null | undefined) ?? (run?.plan ?? null)}
        traceEvents={progressEvents}
        failure={{
          stage: run.failed_stage ?? 'unknown',
          message: run.error_message ?? '',
          error: run.error_message ?? '',
          failureMeta: fmeta,
        }}
      />}

      {/* Artifacts error */}
      {artifactsError && (
        <div className="rounded-lg border border-amber-800/30 bg-amber-950/20 p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-400">
            Could not load artifacts: {extractApiError(artifactsErrorObj)}
          </p>
          <button type="button" className="btn-ghost text-xs flex-shrink-0" onClick={() => refetchArtifacts()}>
            Retry
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<Database size={16} className="text-blue-400" />}
          label="Sources used"
          value={artifactsLoading ? '…' : String(sourcesTotal)}
        />
        <StatCard
          icon={<Brain size={16} className="text-purple-400" />}
          label="Findings extracted"
          value={artifactsLoading ? '…' : String(claimsTotal)}
        />
        <StatCard
          icon={<Clock size={16} className="text-slate-400" />}
          label="Started"
          value={run.started_at ? format(new Date(run.started_at), 'PP') : 'Not started'}
        />
      </div>

      {/* Full event trace */}
      {progressEvents.length > 0 && (
        <CollapsibleSection
          icon={<Clock size={15} className="text-indigo-400" />}
          title={`Full event trace (${progressEvents.length} events)`}
          defaultOpen
        >
          <div className="font-mono text-[11px] leading-5 bg-[#080a10] rounded border border-surface-100/20 max-h-96 overflow-y-auto">
            {progressEvents.map((evt, i) => {
              const isError = evt.eventType === 'run_failed' || evt.eventType === 'run_aborted';
              const isDone = evt.eventType === 'run_completed';
              return (
                <div
                  key={i}
                  className={clsx(
                    'flex gap-2 px-3 py-1 border-b border-surface-100/10 last:border-0',
                    isError && 'bg-red-950/30',
                    isDone && 'bg-green-950/15'
                  )}
                >
                  <span className="text-slate-600 tabular-nums w-[7ch] flex-shrink-0">{formatShortTime(evt.timestamp)}</span>
                  <span className={clsx(
                    'w-[14ch] flex-shrink-0 truncate',
                    isError ? 'text-red-400' : isDone ? 'text-green-400' : 'text-indigo-400'
                  )}>{readerStageLabel(evt.stage)}</span>
                  <span className="w-[5ch] flex-shrink-0 text-right text-slate-600 tabular-nums">{evt.percent ?? 0}%</span>
                  <span className="flex-1 min-w-0 text-slate-300 break-words">
                    {plainProgressText(evt.message)}
                    {evt.model && <span className="ml-2 text-indigo-400/70">[{evt.model}]</span>}
                    {evt.tokenUsage && (
                      <span className="ml-1 text-slate-500">{evt.tokenUsage.prompt}p+{evt.tokenUsage.completion}c</span>
                    )}
                    {evt.failure?.errorMessage && (
                      <span className="ml-1 text-red-300/90">→ {plainProgressText(evt.failure.errorMessage)}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Plan from planner */}
      {/* The stored plan is the technical record (field names, search strings, settings): administrators only. */}
      {isAdmin && artifacts?.plan && (
        <CollapsibleSection
          icon={<Target size={15} className="text-amber-400" />}
          title="Research plan (from planner)"
        >
          <pre className="text-[11px] font-mono text-slate-300 bg-[#080a10] rounded border border-surface-100/20 p-3 overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {JSON.stringify(artifacts.plan, null, 2)}
          </pre>
        </CollapsibleSection>
      )}

      {/* Discovery summary + events */}
      {(artifacts?.discoverySummary || (artifacts?.discoveryEvents && artifacts.discoveryEvents.length > 0)) && (
        <CollapsibleSection
          icon={<ListTree size={15} className="text-cyan-400" />}
          title={`Discovery (${artifacts?.discoveryEvents?.length ?? 0} events)`}
        >
          <div className="space-y-3">
            {artifacts?.discoverySummary && (
              <DiscoverySummaryView summary={artifacts.discoverySummary} isAdmin={isAdmin} />
            )}
            {artifacts?.discoveryEvents && artifacts.discoveryEvents.length > 0 && (
              <div className="space-y-1.5">
                {artifacts.discoveryEvents.map((evt, i) => (
                  <div key={i} className="text-xs bg-surface-200/40 border border-surface-100/20 rounded p-2 space-y-1">
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                      <span className="text-cyan-400">{plainLabel(evt.phase)}</span>
                      <span>·</span>
                      <span className="text-slate-400">{evt.provider}</span>
                      <span className="ml-auto">{format(new Date(evt.created_at), 'HH:mm:ss')}</span>
                    </div>
                    <p className="text-xs text-slate-300 break-all">{evt.query_text}</p>
                    <div className="text-[10px] text-slate-500">
                      {evt.result_count} results · {evt.selected_count} selected
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Model log (raw model calls) */}
      {artifacts?.modelLog && artifacts.modelLog.length > 0 && (
        <CollapsibleSection
          icon={<Cpu size={15} className="text-purple-400" />}
          title={`Model calls (${artifacts.modelLog.length})`}
        >
          <div className="space-y-2">
            {artifacts.modelLog.map((entry, i) => {
              const e = entry as Record<string, unknown>;
              return (
                <details key={i} className="bg-surface-200/40 border border-surface-100/20 rounded">
                  <summary className="cursor-pointer px-3 py-2 text-xs flex items-center gap-2">
                    <span className="text-slate-500 w-32 truncate">{plainLabel(typeof e.role === 'string' ? e.role : '') || 'Unknown step'}</span>
                    <span className="text-indigo-400/80 truncate flex-1 min-w-0">{String(e.model ?? 'unknown')}</span>
                    <span className="text-slate-500 tabular-nums">
                      {Number(e.promptTokens ?? 0)}p+{Number(e.completionTokens ?? 0)}c
                    </span>
                  </summary>
                  <pre className="text-[10px] font-mono text-slate-400 px-3 pb-2 whitespace-pre-wrap max-h-72 overflow-y-auto">
                    {typeof e.content === 'string' ? e.content : JSON.stringify(e, null, 2)}
                  </pre>
                </details>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Sources */}
      {sourceCount > 0 && (
        <CollapsibleSection
          icon={<Database size={15} className="text-blue-400" />}
          title={`Sources used (${sourceCount}${sourcesTotal > sourceCount ? ` of ${sourcesTotal}` : ''})`}
        >
          <ShowAllList items={artifacts!.sources} className="space-y-2" testId="sources-used">
            {(s) => (
              <div
                key={s.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-surface-200/50 border border-surface-100/20"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{s.title || s.url || 'Untitled'}</p>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-accent hover:underline truncate block"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {s.url.slice(0, 80)}
                      <ExternalLink size={9} className="inline ml-1" />
                    </a>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 flex-shrink-0">{s.source_type}</span>
              </div>
            )}
          </ShowAllList>
        </CollapsibleSection>
      )}

      {/* Diagnostics, administrators only: the API sends this list to no one else. */}
      {notUsedSources.length > 0 && (
        <CollapsibleSection
          icon={<Database size={15} className="text-slate-400" />}
          title={`Not used (${notUsedSources.length}) — diagnostics`}
        >
          <NotUsedSources sources={notUsedSources} />
        </CollapsibleSection>
      )}

      {/* Claims */}
      {claimCount > 0 && (
        <CollapsibleSection
          icon={<Brain size={15} className="text-purple-400" />}
          title={`Findings extracted (${claimCount}${claimsTotal > claimCount ? ` of ${claimsTotal}` : ''})`}
        >
          <ShowAllList items={artifacts!.claims} className="space-y-2" testId="findings-extracted">
            {(c) => (
              <div
                key={c.id}
                className="p-3 rounded-lg bg-surface-200/50 border border-surface-100/20 space-y-1"
              >
                <p className="text-xs text-slate-300 leading-relaxed">{c.claim_text}</p>
                {c.evidence_tier && (
                  <span className={clsx('text-[10px] font-medium', TIER_COLORS[c.evidence_tier] ?? 'text-slate-500')}>
                    {c.evidence_tier.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            )}
          </ShowAllList>
        </CollapsibleSection>
      )}

      {/* Checkpoints */}
      {artifacts && artifacts.checkpoints.length > 0 && (
        <CollapsibleSection
          icon={<PenLine size={15} className="text-slate-400" />}
          title={`Progress checkpoints (${artifacts.checkpoints.length})`}
        >
          <div className="space-y-1.5">
            {artifacts.checkpoints.map((cp, i) => (
              <details key={i} className="text-xs bg-surface-200/30 border border-surface-100/10 rounded">
                <summary className="cursor-pointer flex items-center gap-3 py-1.5 px-3">
                  <span className="text-slate-500 flex-shrink-0">{readerStageLabel(cp.stage)}</span>
                  <span className="text-slate-600 flex-shrink-0">→</span>
                  <span className="text-slate-400 truncate">{plainLabel(cp.checkpoint_key)}</span>
                  <span className="text-slate-600 text-[10px] ml-auto flex-shrink-0">
                    {format(new Date(cp.created_at), 'HH:mm:ss')}
                  </span>
                </summary>
                <pre className="text-[10px] font-mono text-slate-400 px-3 pb-2 whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {JSON.stringify(cp.snapshot, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Diagnostics, administrators only: what this browser recorded when a page stopped responding. */}
      {isAdmin && longFrames.length > 0 && (
        <CollapsibleSection
          icon={<Clock size={15} className="text-amber-400" />}
          title={`Times a page was held still in this browser (${longFrames.length})`}
        >
          <div className="space-y-1.5" data-testid="long-frames">
            {[...longFrames].reverse().map((frame, i) => (
              <div key={i} className="text-xs bg-surface-200/40 border border-surface-100/20 rounded p-2 space-y-1 font-mono">
                <p className="text-slate-300">
                  {(frame.ms / 1000).toFixed(1)} s · {frame.path} · {frame.at}
                </p>
                {frame.scripts.length === 0 && <p className="text-[10px] text-slate-500">No script was named for this one.</p>}
                {frame.scripts.map((script, j) => (
                  <p key={j} className="text-[10px] text-slate-500 break-all">
                    {(script.ms / 1000).toFixed(1)} s · {script.source}
                    {script.fn ? ` · ${script.fn}` : ''}
                    {script.invoker ? ` · ${script.invoker}` : ''}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Link to saved report (if one was persisted before failure) */}
      {artifacts?.reportId && (
        <div className="rounded-lg border border-green-800/40 bg-green-950/20 p-3 flex items-center gap-3">
          <FileText size={14} className="text-green-400" />
          <span className="text-xs text-slate-300 flex-1">A partial report was saved before the failure.</span>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => navigate(`/app/reports/${artifacts.reportId}`)}
          >
            Open report
          </button>
        </div>
      )}

      {/* No artifacts at all */}
      {!artifactsLoading && !artifactsError && sourceCount === 0 && claimCount === 0 && progressEvents.length === 0 && (
        <div className="text-center py-8 text-slate-600 text-sm">
          No artifacts were collected before the run failed.
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon, label, value,
}: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
    </div>
  );
}

function CollapsibleSection({
  icon,
  title,
  children,
  defaultOpen = false,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <section className="space-y-3">
      <button
        type="button"
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        {open ? <ChevronDown size={14} className="text-slate-500" aria-hidden /> : <ChevronRight size={14} className="text-slate-500" aria-hidden />}
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </button>
      <div id={contentId} hidden={!open}>
        {open && children}
      </div>
    </section>
  );
}
