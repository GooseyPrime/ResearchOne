import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FlaskConical,
  Send,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Zap,
  Brain,
  Shield,
  FileSearch,
  PenLine,
  Target,
  Settings2,
} from 'lucide-react';
import RunSummaryReport, { type RunSummaryData } from '../components/research/RunSummaryReport';
import LiveResearchTraceLog from '../components/research/LiveResearchTraceLog';
import LiveStatusBanner from '../components/research/LiveStatusBanner';
import ResearchRunFailureCard from '../components/research/ResearchRunFailureCard';
import PlanConfirmationPanel, { type PlanGateSnapshot } from '../components/research/PlanConfirmationPanel';
import ResearchRunRow from '../components/research/ResearchRunRow';
import { useResearchRunTracking } from '../hooks/useResearchRunTracking';
import {
  startResearch,
  getResearchRuns,
  getResearchRun,
  getResearchModelOptions,
  ResearchRun,
  ResearchProgressEvent,
} from '../utils/api';
import { getAdaptiveRefetchIntervalMs } from '../utils/apiRateLimit';
import { formatFailureReason } from '../utils/researchFailureFormat';
import { classifyLiveStatus, deriveRunState } from '../utils/researchLiveStatus';
import { dossierReportUrlForRun } from '../utils/researchRunRoutes';
import { isLiveAttachedResearchRun, researchRequestFromRun } from '../utils/researchOpenRun';
import { useResearchPageShell } from './ResearchPageContext';
import { appendKeepingNewestAtBottom } from '../utils/traceEventWindow';
import FreeLifetimeQuotaBanner from '../components/billing/FreeLifetimeQuotaBanner';
import { BILLING_SUBSCRIPTION_QUERY_KEY } from '../hooks/useBillingSubscription';
import { useStore } from '../store/useStore';
import { getSocket, subscribeToJob } from '../utils/socket';
import clsx from 'clsx';

interface ResearchFailureEvent {
  runId: string;
  stage: string;
  percent: number;
  message: string;
  error?: string;
  retryable?: boolean;
  terminal?: boolean;
  failureMeta?: Record<string, unknown>;
}

interface StageDescriptor {
  id: string;
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  label: string;
  desc: string;
  backendStages: string[];
}

const STAGES: StageDescriptor[] = [
  { id: 'planning', icon: Brain, label: 'Planning', desc: 'Query decomposition and research framing', backendStages: ['planning'] },
  { id: 'discovery', icon: FileSearch, label: 'Discovery', desc: 'External source discovery and ingestion', backendStages: ['discovery'] },
  { id: 'retrieval', icon: FileSearch, label: 'Retrieval', desc: 'Source retrieval and ranking', backendStages: ['retrieval', 'retriever_analysis'] },
  { id: 'reasoning', icon: Zap, label: 'Reasoning', desc: 'Argument construction across sources', backendStages: ['reasoning'] },
  { id: 'challenge', icon: Shield, label: 'Challenge', desc: 'Skeptic and counter-model pressure tests', backendStages: ['challenge'] },
  { id: 'synthesis', icon: PenLine, label: 'Synthesis', desc: 'Drafting report sections and coherence', backendStages: ['synthesis', 'plain_language'] },
  { id: 'verification', icon: Target, label: 'Verification', desc: 'Epistemic checks and persistence', backendStages: ['verification', 'saving', 'epistemic_persistence'] },
  { id: 'done', icon: CheckCircle2, label: 'Complete', desc: 'Run completed and report generated', backendStages: ['done'] },
];

const STAGE_BY_BACKEND = new Map<string, string>(
  STAGES.flatMap((s) => s.backendStages.map((b) => [b, s.id] as const))
);

function stageUiId(backendStage?: string): string {
  if (!backendStage) return 'planning';
  if (backendStage === 'failed' || backendStage === 'aborted') return 'failed';
  return STAGE_BY_BACKEND.get(backendStage) ?? 'planning';
}

function stageOrderIndex(uiStage: string): number {
  const idx = STAGES.findIndex((s) => s.id === uiStage);
  return idx >= 0 ? idx : 0;
}

function normalizeEvent(evt: ResearchProgressEvent): ResearchProgressEvent {
  return {
    ...evt,
    stage: evt.stage || 'planning',
    percent: Number.isFinite(evt.percent) ? evt.percent : 0,
    message: evt.message || evt.stage || 'Update',
    timestamp: evt.timestamp || new Date().toISOString(),
  };
}

function sortEventsChronological(events: ResearchProgressEvent[]): ResearchProgressEvent[] {
  return [...events].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

export default function ResearchStandardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification, setActiveRun, activeRun } = useStore();
  const { embeddedInShell, syncEngineForRun } = useResearchPageShell();

  const [query, setQuery] = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [supplementalUrlsText, setSupplementalUrlsText] = useState('');
  const [supplementalFiles, setSupplementalFiles] = useState<File[]>([]);
  const [showSupplemental, setShowSupplemental] = useState(false);
  const [filterTags, setFilterTags] = useState('');
  const [trackingRunId, setTrackingRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ResearchProgressEvent | null>(null);
  const [failure, setFailure] = useState<ResearchFailureEvent | null>(null);
  const [traceEvents, setTraceEvents] = useState<ResearchProgressEvent[]>([]);
  const lastKnownRunIdRef = useRef<string | null>(null);
  const runSummaryReceivedRef = useRef(false);
  const [runSummary, setRunSummary] = useState<RunSummaryData | null>(null);
  const traceScrollRef = useRef<HTMLDivElement>(null);
  const [planGateLocal, setPlanGateLocal] = useState<PlanGateSnapshot | null>(null);
  const [planGateBusy, setPlanGateBusy] = useState(false);
  const planGateRef = useRef<HTMLDivElement>(null);

  const [showModels, setShowModels] = useState(false);
  const [modelRows, setModelRows] = useState<Record<string, { primary?: string; fallback?: string }>>({});

  const { data: modelOptions } = useQuery({
    queryKey: ['research-model-options'],
    queryFn: getResearchModelOptions,
    staleTime: 60000,
  });

  const { data: runs = [] } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    refetchInterval: () => getAdaptiveRefetchIntervalMs(8_000),
  });

  const trackedRun = runs.find((r) => r.id === trackingRunId);
  const trackedStatus = trackedRun?.status;
  /** Poll quickly only while work is in flight; keep query enabled so cache can refresh on invalidate (PR #133 Copilot + Rule 10). */
  const runPollCadenceActive =
    trackedStatus === 'running' ||
    trackedStatus === 'queued' ||
    trackedStatus === 'plan_pending_confirmation';

  const { data: polledRun } = useQuery({
    queryKey: ['research-run', trackingRunId],
    queryFn: () => getResearchRun(trackingRunId!),
    enabled: Boolean(trackingRunId),
    refetchInterval: () =>
      runPollCadenceActive ? getAdaptiveRefetchIntervalMs(4_000) : false,
  });

  const applyRequestFormFromRun = useCallback((run: ResearchRun) => {
    const slice = researchRequestFromRun(run);
    setQuery(slice.query);
    setSupplemental(slice.supplemental);
    const urlLines = (run.supplemental_attachments ?? [])
      .filter((a) => a.kind === 'url' && a.url)
      .map((a) => a.url as string);
    setSupplementalUrlsText(urlLines.length > 0 ? urlLines.join('\n') : '');
    setSupplementalFiles([]);
    setShowSupplemental(Boolean(slice.supplemental.trim()) || urlLines.length > 0);
  }, []);

  const { attachRun, detachRun: detachTracking } = useResearchRunTracking({
    trackingRunId,
    setTrackingRunId,
    lastKnownRunIdRef,
    setProgress,
    setActiveRun,
    setTraceEvents,
    setFailure: () => setFailure(null),
    setRunSummary,
    runSummaryReceivedRef,
    setPlanGateLocal,
    setPlanGateBusy,
    runStatus: trackedRun?.status ?? polledRun?.status,
    engineVersionHint: trackedRun?.engine_version ?? polledRun?.engine_version,
  });

  const activeRunStatus = trackedRun?.status ?? polledRun?.status;
  const formLocked = Boolean(trackingRunId) && isLiveAttachedResearchRun(activeRunStatus);

  const handleOpenRun = useCallback(
    (run: ResearchRun) => {
      syncEngineForRun(run.engine_version);
      if (isLiveAttachedResearchRun(run.status)) {
        void attachRun({ runId: run.id, runRow: run });
        return;
      }
      detachTracking();
      applyRequestFormFromRun(run);
      addNotification('info', 'Loaded this run’s research request — edit and submit when ready.');
    },
    [syncEngineForRun, attachRun, detachTracking, applyRequestFormFromRun, addNotification]
  );

  const runStatusForGate = activeRunStatus;
  const showPlanGatePanel =
    Boolean(trackingRunId) &&
    (runStatusForGate === 'plan_pending_confirmation' || planGateLocal?.runId === trackingRunId);

  const planGateAwaitingForBanner = Boolean(
    showPlanGatePanel ||
      (planGateLocal &&
        trackingRunId &&
        planGateLocal.runId === trackingRunId &&
        (trackedRun?.status === 'running' || trackedRun?.status === 'queued'))
  );

  const trackedRunLiveStatus = useMemo(
    () =>
      classifyLiveStatus(trackedRun?.status ?? polledRun?.status, failure, {
        retryAttempts: trackedRun?.retry_attempts ?? polledRun?.retry_attempts ?? null,
        progressMessage: trackedRun?.progress_message ?? polledRun?.progress_message ?? null,
        progressStage: trackedRun?.progress_stage ?? polledRun?.progress_stage ?? null,
        planGateAwaiting: planGateAwaitingForBanner,
      }),
    [
      trackedRun?.status,
      polledRun?.status,
      failure,
      trackedRun?.retry_attempts,
      polledRun?.retry_attempts,
      trackedRun?.progress_message,
      polledRun?.progress_message,
      trackedRun?.progress_stage,
      polledRun?.progress_stage,
      planGateAwaitingForBanner,
    ]
  );

  useEffect(() => {
    if (!showPlanGatePanel || !planGateRef.current) return;
    const hash = window.location.hash;
    if (hash === '#plan' || runStatusForGate === 'plan_pending_confirmation') {
      planGateRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showPlanGatePanel, runStatusForGate, planGateLocal?.planId]);

  const mutation = useMutation({
    mutationFn: startResearch,
    onSuccess: (data) => {
      setPlanGateLocal(null);
      const queuedEvt: ResearchProgressEvent = {
        runId: data.runId,
        stage: 'planning',
        percent: 0,
        message: 'Research queued...',
        timestamp: new Date().toISOString(),
      };
      setProgress(queuedEvt);
      setActiveRun(queuedEvt);
      setTraceEvents([queuedEvt]);
      void attachRun({ runId: data.runId });
      const ing = data.supplementalIngest;
      if (ing && (ing.urlsQueued > 0 || ing.filesQueued > 0)) {
        addNotification(
          'info',
          `Research started — ingested ${ing.urlsQueued} URL(s) and ${ing.filesQueued} file(s) into the corpus.`
        );
      } else {
        addNotification('info', 'Research started — tracking detailed progress...');
      }
      qc.invalidateQueries({ queryKey: ['research-runs'] });
    },
    onError: (error) => {
      addNotification('error', extractStartResearchErrorMessage(error));
    },
  });

  useEffect(() => {
    runSummaryReceivedRef.current = runSummary !== null;
  }, [runSummary]);

  useEffect(() => {
    if (!failure || !trackingRunId) return;
    const capturedRunId = trackingRunId;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || runSummaryReceivedRef.current) return;
      try {
        const run = await getResearchRun(capturedRunId);
        if (cancelled || runSummaryReceivedRef.current) return;
        if (run.id !== lastKnownRunIdRef.current) return;
        runSummaryReceivedRef.current = true;
        setRunSummary({
          runId: run.id,
          status: run.status,
          totalDurationMs: 0,
          phaseDurations: {},
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          retryCount: run.retry_attempts ?? 0,
          failedStage: run.failed_stage ?? null,
          errorMessage: run.error_message ?? null,
          failureMeta: run.failure_meta ?? null,
        });
      } catch {
        // non-fatal
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [failure, trackingRunId]);

  useEffect(() => {
    if (!trackingRunId) return;
    if (trackedStatus !== 'failed' && trackedStatus !== 'aborted') return;
    void qc.invalidateQueries({ queryKey: ['research-run', trackingRunId] }, { cancelRefetch: false });
  }, [trackingRunId, trackedStatus, qc]);

  useEffect(() => {
    if (!modelOptions) return;
    const defaults = modelOptions.defaults || {};
    const rows: Record<string, { primary?: string; fallback?: string }> = {};
    for (const role of Object.keys(defaults)) {
      rows[role] = {
        primary: defaults[role],
        fallback: modelOptions.fallbacks?.[role],
      };
    }
    setModelRows(rows);
  }, [modelOptions]);

  useEffect(() => {
    if (!trackingRunId || !polledRun || polledRun.id !== trackingRunId) return;

    if (Array.isArray(polledRun.progress_events) && polledRun.progress_events.length > 0) {
      const sorted = [...polledRun.progress_events]
        .filter((e) => e && typeof e === 'object')
        .map((e) => normalizeEvent(e as ResearchProgressEvent))
        .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

      const latest = sorted[sorted.length - 1];
      if (latest) {
        setProgress((prev) => {
          if (prev && (prev.percent ?? 0) > (latest.percent ?? 0) && latest.stage !== 'failed') return prev;
          return latest;
        });
        setActiveRun(latest);
      }
      setTraceEvents(sortEventsChronological(sorted.slice(-150)));
    } else if (polledRun.progress_message != null || polledRun.progress_percent != null) {
      const polledEvt: ResearchProgressEvent = {
        runId: trackingRunId,
        stage: polledRun.progress_stage || 'planning',
        percent: polledRun.progress_percent ?? 0,
        message: polledRun.progress_message || 'Running…',
        timestamp: polledRun.progress_updated_at || new Date().toISOString(),
      };
      setProgress(polledEvt);
      setActiveRun(polledEvt);
      setTraceEvents((prev) => sortEventsChronological(appendKeepingNewestAtBottom(prev, polledEvt, 150)));
    }

    if (polledRun.status === 'failed' || polledRun.status === 'aborted') {
      const fmeta = (polledRun.failure_meta as Record<string, unknown> | undefined) ?? {};
      const failed: ResearchFailureEvent = {
        runId: polledRun.id,
        stage: polledRun.failed_stage || polledRun.progress_stage || 'unknown',
        percent: polledRun.progress_percent ?? 0,
        message: polledRun.error_message || 'Research run failed',
        error: polledRun.error_message,
        retryable: Boolean(fmeta.retryable),
        terminal: fmeta.terminal === true || polledRun.status === 'aborted',
        failureMeta: polledRun.failure_meta,
      };
      setFailure(failed);
      setActiveRun({
        runId: failed.runId,
        stage: 'failed',
        percent: failed.percent,
        message: failed.message,
        timestamp: new Date().toISOString(),
        eventType: 'run_failed',
        failure: {
          errorMessage: failed.error,
          retryable: failed.retryable,
          failureMeta: failed.failureMeta,
        },
      });
    }
  }, [polledRun, trackingRunId, setActiveRun]);

  useEffect(() => {
    const socket = getSocket();

    socket.on('research:progress', (raw: ResearchProgressEvent) => {
      const update = normalizeEvent(raw);
      const rid = update.runId;
      if (!rid) return;
      if (rid === trackingRunId) {
        setProgress(update);
        setActiveRun(update);
        setTraceEvents((prev) => sortEventsChronological(appendKeepingNewestAtBottom(prev, update, 150)));
      }
    });

    socket.on('research:completed', (result: { runId: string; reportId: string }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      void qc.invalidateQueries({ queryKey: BILLING_SUBSCRIPTION_QUERY_KEY }, { cancelRefetch: false });
      if (result.runId === trackingRunId) {
        const doneEvt: ResearchProgressEvent = {
          runId: result.runId,
          stage: 'done',
          percent: 100,
          message: 'Report ready!',
          timestamp: new Date().toISOString(),
          eventType: 'run_completed',
        };
        setProgress(doneEvt);
        setActiveRun(doneEvt);
        setTrackingRunId(null);
        addNotification('success', 'Research complete — report generated!');
        qc.invalidateQueries({ queryKey: ['reports'] });
        setTimeout(() => navigate(dossierReportUrlForRun(result.runId)), 1200);
      }
    });

    socket.on('run:summary', (summary: RunSummaryData) => {
      if (summary.runId === lastKnownRunIdRef.current) {
        runSummaryReceivedRef.current = true;
        setRunSummary(summary);
      }
    });

    socket.on('research:failed', (failed: ResearchFailureEvent) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      void qc.invalidateQueries({ queryKey: ['research-run', failed.runId] }, { cancelRefetch: false });
      if (failed.runId === trackingRunId) {
        const failureReason = formatFailureReason(failed.error || failed.message, failed.failureMeta);
        setFailure(failed);
        setProgress({
          runId: failed.runId,
          stage: 'failed',
          percent: failed.percent,
          message: failed.message,
          timestamp: new Date().toISOString(),
          eventType: 'run_failed',
          failure: {
            errorMessage: failureReason,
            retryable: failed.retryable,
            failureMeta: failed.failureMeta,
          },
        });
        setActiveRun({
          runId: failed.runId,
          stage: 'failed',
          percent: failed.percent,
          message: failed.message,
          timestamp: new Date().toISOString(),
          eventType: 'run_failed',
          failure: {
            errorMessage: failureReason,
            retryable: failed.retryable,
            failureMeta: failed.failureMeta,
          },
        });
        addNotification('error', failureReason || 'Research failed.');
      }
    });

    socket.on('research:aborted', (failed: ResearchFailureEvent) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      void qc.invalidateQueries({ queryKey: ['research-run', failed.runId] }, { cancelRefetch: false });
      if (failed.runId === trackingRunId) {
        const failureReason = formatFailureReason(failed.error || failed.message, failed.failureMeta);
        const finalFailure: ResearchFailureEvent = { ...failed, terminal: true, retryable: false };
        setFailure(finalFailure);
        setProgress({
          runId: failed.runId,
          stage: 'aborted',
          percent: failed.percent,
          message: failed.message,
          timestamp: new Date().toISOString(),
          eventType: 'run_aborted',
          failure: { errorMessage: failureReason, retryable: false, failureMeta: failed.failureMeta },
        });
        setActiveRun({
          runId: failed.runId,
          stage: 'aborted',
          percent: failed.percent,
          message: failed.message,
          timestamp: new Date().toISOString(),
          eventType: 'run_aborted',
          failure: { errorMessage: failureReason, retryable: false, failureMeta: failed.failureMeta },
        });
        addNotification(
          'error',
          'Run aborted — no more retries will run. Start a new run if you still need this report.'
        );
      }
    });

    socket.on('research:cancelled', async (payload: { runId: string }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (payload.runId === trackingRunId) {
        try {
          const row = await getResearchRun(payload.runId);
          applyRequestFormFromRun(row);
        } catch {
          const row = runs.find((r) => r.id === payload.runId);
          if (row) applyRequestFormFromRun(row);
        }
        detachTracking();
        addNotification('info', 'Research run cancelled — request loaded for editing.');
      }
    });

    return () => {
      socket.off('research:progress');
      socket.off('research:completed');
      socket.off('run:summary');
      socket.off('research:failed');
      socket.off('research:aborted');
      socket.off('research:cancelled');
    };
  }, [trackingRunId, navigate, addNotification, setActiveRun, qc, runs, applyRequestFormFromRun, detachTracking]);

  const runtimeOverridesPayload = useMemo(() => {
    const payload: Record<string, unknown> = {};
    if (!modelOptions) return payload;

    for (const role of Object.keys(modelRows)) {
      const row = modelRows[role];
      const defaultsPrimary = modelOptions.defaults?.[role];
      const defaultsFallback = modelOptions.fallbacks?.[role];
      const primary = row?.primary?.trim();
      const fallback = row?.fallback?.trim();

      if ((primary && primary !== defaultsPrimary) || (fallback && fallback !== defaultsFallback)) {
        payload[role] = {
          primary: primary || undefined,
          fallback: fallback || undefined,
        };
      }
    }

    return payload;
  }, [modelRows, modelOptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    const urlList = supplementalUrlsText
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    mutation.mutate({
      query: query.trim(),
      supplemental: supplemental.trim() || undefined,
      filterTags: filterTags ? filterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      modelOverrides: Object.keys(runtimeOverridesPayload).length > 0 ? runtimeOverridesPayload : undefined,
      supplementalUrls: urlList.length > 0 ? urlList : undefined,
      supplementalFiles: supplementalFiles.length > 0 ? supplementalFiles : undefined,
    });
  };

  const current = progress || activeRun;
  const currentUiStage = stageUiId(current?.stage);
  const currentIndex = stageOrderIndex(currentUiStage);
  const hasWarning = Boolean(failure) || currentUiStage === 'failed';

  return (
    <div className={embeddedInShell ? 'space-y-8' : 'max-w-5xl mx-auto px-6 py-8 space-y-8'}>
      {!embeddedInShell && (
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <FlaskConical className="text-accent" size={28} />
            <span className="text-gradient">Start Research</span>
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Disciplined anomaly research with source-corroboration-tiered reporting and full-stage telemetry.
          </p>
        </div>
      )}

      <FreeLifetimeQuotaBanner variant="research" />

      <div className="card-glow p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="section-title block mb-2">Research Query</label>
            <textarea
              className="textarea min-h-28 text-base"
              placeholder="What is the relationship between mitochondrial dysfunction and cancer metabolism?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={mutation.isPending || formLocked}
            />
            <p className="text-xs text-slate-500 mt-1">Be specific and include the exact framing you want tested.</p>
          </div>

          <button type="button" className="btn-ghost text-xs" onClick={() => setShowSupplemental((v) => !v)}>
            {showSupplemental ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Supplemental context / starting documents
          </button>

          {showSupplemental && (
            <div className="space-y-3 animate-in">
              <div>
                <label className="section-title block mb-2">Supplemental Context</label>
                <textarea
                  className="textarea min-h-24"
                  placeholder="Paste relevant text, abstracts, or constraints"
                  value={supplemental}
                  onChange={(e) => setSupplemental(e.target.value)}
                  disabled={mutation.isPending || formLocked}
                />
              </div>
              <div>
                <label className="section-title block mb-2">Supplemental URLs</label>
                <textarea
                  className="textarea min-h-16 font-mono text-sm"
                  placeholder={
                    'https://arxiv.org/abs/2301.00001\n(one URL per line, or comma-separated)'
                  }
                  value={supplementalUrlsText}
                  onChange={(e) => setSupplementalUrlsText(e.target.value)}
                  disabled={mutation.isPending || formLocked}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Each URL is fetched and added to the ResearchOne corpus, then used for this run.
                </p>
              </div>
              <div>
                <label className="section-title block mb-2">Supplemental files</label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,text/plain,application/pdf"
                  className="block w-full text-sm text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-surface-300 file:text-slate-200"
                  disabled={mutation.isPending || formLocked}
                  onChange={(e) => {
                    const list = e.target.files ? Array.from(e.target.files) : [];
                    setSupplementalFiles((prev) => [...prev, ...list]);
                    e.target.value = '';
                  }}
                />
                {supplementalFiles.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {supplementalFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 text-xs text-slate-400 bg-surface-200 rounded px-2 py-1">
                        <span className="truncate">{f.name}</span>
                        <button
                          type="button"
                          className="text-slate-500 hover:text-white flex-shrink-0"
                          onClick={() => setSupplementalFiles((prev) => prev.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-slate-500 mt-1">PDF, TXT, or Markdown — uploaded into the corpus for this run and later retrieval.</p>
              </div>
              <div>
                <label className="section-title block mb-2">Filter by Tags</label>
                <input
                  type="text"
                  className="input"
                  placeholder="biology, oncology, metabolism"
                  value={filterTags}
                  onChange={(e) => setFilterTags(e.target.value)}
                  disabled={mutation.isPending || formLocked}
                />
              </div>
            </div>
          )}

          <button type="button" className="btn-ghost text-xs" onClick={() => setShowModels((v) => !v)}>
            <Settings2 size={14} />
            {showModels ? 'Hide per-run model selection' : 'Show per-run model selection'}
          </button>

          {showModels && modelOptions && (
            <div className="rounded-lg border border-indigo-900/30 bg-surface-200 p-3 space-y-3">
              <p className="text-xs text-slate-400">These model settings apply only to this run, including queued runs.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.keys(modelOptions.defaults).map((role) => (
                  <div key={role} className="border border-indigo-900/20 rounded p-2 space-y-1">
                    <div className="text-xs text-slate-400 uppercase tracking-wide">{role.replace(/_/g, ' ')}</div>
                    <input
                      className="input text-xs"
                      value={modelRows[role]?.primary || ''}
                      onChange={(e) =>
                        setModelRows((prev) => ({
                          ...prev,
                          [role]: { ...prev[role], primary: e.target.value },
                        }))
                      }
                      disabled={mutation.isPending || formLocked}
                    />
                    <input
                      className="input text-xs"
                      value={modelRows[role]?.fallback || ''}
                      onChange={(e) =>
                        setModelRows((prev) => ({
                          ...prev,
                          [role]: { ...prev[role], fallback: e.target.value },
                        }))
                      }
                      disabled={mutation.isPending || formLocked}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="submit" className="btn-primary w-full py-3 text-base justify-center" disabled={!query.trim() || mutation.isPending || formLocked}>
            <Send size={16} />
            {mutation.isPending
              ? 'Queuing...'
              : trackingRunId
                ? trackedRunLiveStatus === 'plan_pending_confirmation'
                  ? 'Review plan below…'
                  : 'Research Running...'
                : 'Run Research'}
          </button>
        </form>

        {(progress || activeRun || trackingRunId) && (
          <div className="border-t border-indigo-900/20 pt-5 animate-in lg:grid lg:grid-cols-5 lg:gap-6 space-y-4 lg:space-y-0">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <span className="section-title">Research Pipeline</span>
                <span className={hasWarning ? 'text-xs text-amber-300 font-medium' : 'text-xs text-accent font-medium'}>
                  {current?.percent ?? 0}%
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {STAGES.map((stage, i) => {
                  const done = i < currentIndex;
                  const active = i === currentIndex && currentUiStage !== 'failed';
                  const warning = hasWarning && (active || i === currentIndex);
                  return (
                    <div
                      key={stage.id}
                      className={clsx(
                        'flex items-center gap-2 p-2 rounded-lg border text-xs transition-all',
                        done && 'border-green-800/40 bg-green-900/20 text-green-400',
                        active && 'border-accent/40 bg-accent/10 text-accent animate-pulse',
                        warning && 'border-amber-700/40 bg-amber-900/20 text-amber-300',
                        !done && !active && !warning && 'border-surface-100 bg-surface-200 text-slate-600'
                      )}
                    >
                      <stage.icon size={12} />
                      <span className="font-medium">{stage.label}</span>
                    </div>
                  );
                })}
              </div>

              <div className="h-1.5 bg-surface-200 rounded-full overflow-hidden">
                <div
                  className={hasWarning ? 'h-full bg-amber-500 transition-all duration-500' : 'progress-bar h-full transition-all duration-500'}
                  style={{ width: `${current?.percent ?? 0}%` }}
                />
              </div>

              <p className="text-sm text-slate-300">{current?.message ?? 'Processing...'}</p>

              <LiveStatusBanner
                runStatus={trackedRun?.status}
                failure={failure}
                retryAttempts={trackedRun?.retry_attempts ?? polledRun?.retry_attempts ?? null}
                progressMessage={trackedRun?.progress_message ?? polledRun?.progress_message ?? null}
                progressStage={trackedRun?.progress_stage ?? polledRun?.progress_stage ?? null}
                planGateAwaiting={planGateAwaitingForBanner}
              />
              {showPlanGatePanel && (
                <div ref={planGateRef} id="plan">
                  {planGateLocal && planGateLocal.runId === trackingRunId ? (
                    <PlanConfirmationPanel
                      snapshot={planGateLocal}
                      busy={planGateBusy}
                      onBusy={setPlanGateBusy}
                      tierAllowsSavedProfiles={false}
                      onAfterConfirm={() => {
                        setPlanGateLocal(null);
                        setPlanGateBusy(false);
                        void qc.invalidateQueries({ queryKey: ['research-runs'] });
                        void qc.invalidateQueries(
                          { queryKey: ['research-run', trackingRunId] },
                          { cancelRefetch: false }
                        );
                      }}
                      onAfterCancel={() => {
                        const row =
                          polledRun ??
                          trackedRun ??
                          runs.find((r) => r.id === trackingRunId) ??
                          null;
                        if (row) applyRequestFormFromRun(row);
                        detachTracking();
                        void qc.invalidateQueries({ queryKey: ['research-runs'] });
                      }}
                      onNotify={(kind, message) => addNotification(kind, message)}
                      onGatePlanMutated={() => {
                        void qc.invalidateQueries({ queryKey: ['research-runs'] });
                        if (trackingRunId) {
                          void qc.invalidateQueries(
                            { queryKey: ['run-plan-gate', trackingRunId] },
                            { cancelRefetch: false }
                          );
                        }
                      }}
                    />
                  ) : (
                    <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-4 text-sm text-amber-100/90">
                      Loading research plan…
                    </div>
                  )}
                </div>
              )}
            </div>

            <LiveResearchTraceLog traceEvents={traceEvents} traceScrollRef={traceScrollRef} />
          </div>
        )}

        {failure && (
          <ResearchRunFailureCard
            failure={failure}
            derivedState={deriveRunState(trackedRun ?? null, {
              terminal: failure.terminal,
              retryable: failure.retryable,
              failureMeta: failure.failureMeta,
            })}
            onRetried={(rid) => {
              setFailure(null);
              lastKnownRunIdRef.current = rid;
              runSummaryReceivedRef.current = false;
              setRunSummary(null);
              setTrackingRunId(rid);
              subscribeToJob(rid);
              void qc.invalidateQueries({ queryKey: ['research-runs'] });
              void qc.invalidateQueries({ queryKey: ['research-run', rid] }, { cancelRefetch: false });
              addNotification('info', 'Retry queued from last failure.');
            }}
            onError={(msg) => addNotification('error', msg)}
            onInfo={(msg) => addNotification('info', msg)}
          />
        )}

        {(runSummary || (trackedRun && ['completed', 'cancelled', 'failed', 'aborted'].includes(trackedRun.status))) && (
          <RunSummaryReport summary={runSummary} run={trackedRun ?? null} traceEvents={traceEvents} failure={failure} />
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Research Governance Model</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {STAGES.filter((s) => s.id !== 'done').map((stage) => (
            <div key={stage.id} className="flex items-start gap-2.5 p-3 bg-surface-200 rounded-lg">
              <stage.icon size={14} className="text-accent mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold text-white">{stage.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{stage.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {runs.length > 0 && (
        <div>
          <h2 className="section-title mb-3">Recent Research Runs</h2>
          <div className="space-y-2">
            {runs.slice(0, 10).map((run) => (
              <ResearchRunRow
                key={run.id}
                run={run}
                onRunsChanged={() => qc.invalidateQueries({ queryKey: ['research-runs'] })}
                onRemoved={(id) => {
                  if (id === trackingRunId) {
                    detachTracking();
                    setFailure(null);
                    setRunSummary(null);
                  }
                }}
                onResumeRun={handleOpenRun}
                onOpenRequestSetup={handleOpenRun}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function extractStartResearchErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Failed to start research. Check API connection.';
  }

  const status = error.response?.status;
  const data = error.response?.data as unknown;
  let message: string | undefined;
  if (typeof data === 'string') {
    message = data;
  } else if (data && typeof data === 'object') {
    const payload = data as { error?: string; message?: string; detail?: string };
    message = payload.error || payload.message || payload.detail;
  }

  const fallback = status ? `Failed to start research (HTTP ${status}).` : 'Failed to start research. Check API connection.';
  return message ? `${fallback} ${message}` : fallback;
}
