import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FlaskConical,
  Send,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  Zap,
  Brain,
  Shield,
  FileSearch,
  PenLine,
  Target,
  Trash2,
  Ban,
  Settings2,
  RotateCcw,
  ChevronRight,
  XCircle,
} from 'lucide-react';
import RunSummaryReport, { type RunSummaryData } from '../components/research/RunSummaryReport';
import {
  startResearch,
  getResearchRuns,
  getResearchRun,
  cancelResearchRun,
  deleteResearchRun,
  retryResearchRunFromFailure,
  getResearchV2EnsemblePresets,
  ResearchRun,
  ResearchProgressEvent,
  type ResearchObjective,
} from '../utils/api';
import { getAdaptiveRefetchIntervalMs } from '../utils/apiRateLimit';
import { useStore } from '../store/useStore';
import { getSocket, subscribeToJob } from '../utils/socket';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

const RESEARCH_OBJECTIVE_OPTIONS: { value: ResearchObjective; label: string }[] = [
  { value: 'GENERAL_EPISTEMIC_RESEARCH', label: 'General epistemic research' },
  { value: 'INVESTIGATIVE_SYNTHESIS', label: 'Investigative synthesis' },
  { value: 'NOVEL_APPLICATION_DISCOVERY', label: 'Novel application discovery' },
  { value: 'PATENT_GAP_ANALYSIS', label: 'Patent gap analysis' },
  { value: 'ANOMALY_CORRELATION', label: 'Anomaly correlation' },
];

interface ResearchFailureEvent {
  runId: string;
  stage: string;
  percent: number;
  message: string;
  error?: string;
  retryable?: boolean;
  /** True when the run is in terminal `aborted` state — no further retries are possible. */
  terminal?: boolean;
  failureMeta?: Record<string, unknown>;
}

import {
  classifyLiveStatus,
  LIVE_STATUS_COPY,
  deriveRunState,
  isResumeAvailable,
  failureCardHeadline,
  type LiveStatus,
} from '../utils/researchLiveStatus';

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
  { id: 'retrieval', icon: FileSearch, label: 'Retrieval', desc: 'Evidence retrieval and ranking', backendStages: ['retrieval', 'retriever_analysis'] },
  { id: 'reasoning', icon: Zap, label: 'Reasoning', desc: 'Argument construction across evidence', backendStages: ['reasoning'] },
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
  // 'aborted' is treated as a terminal variant of the same Error/recovery
  // phase so the trace renders both in one place.
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


function retryBadgeForEvent(evt: ResearchProgressEvent): { text: string; variant: 'retryable' | 'resumed' | 'terminal' } | null {
  if (evt.eventType === 'run_resumed') {
    return { text: 'Resumed', variant: 'resumed' };
  }
  if (evt.eventType === 'run_aborted' || evt.stage === 'aborted') {
    return { text: 'Aborted', variant: 'terminal' };
  }
  if (evt.eventType === 'run_failed' || evt.stage === 'failed') {
    const retryable = evt.failure?.retryable === true;
    return { text: retryable ? 'Retryable' : 'Stopped', variant: retryable ? 'retryable' : 'terminal' };
  }
  if (evt.failure?.retryable === true) {
    return { text: 'Retryable', variant: 'retryable' };
  }
  const msg = `${evt.message} ${evt.substep || ''}`.toLowerCase();
  if (/\b(retry|retried|resum|backoff)\b/.test(msg)) {
    return { text: 'Retry', variant: 'retryable' };
  }
  return null;
}

function LiveStatusBanner({
  runStatus,
  failure,
  retryAttempts,
  progressMessage,
  progressStage,
}: {
  runStatus?: string;
  failure: ResearchFailureEvent | null;
  retryAttempts?: number | null;
  progressMessage?: string | null;
  progressStage?: string | null;
}) {
  const live = classifyLiveStatus(runStatus, failure, {
    retryAttempts,
    progressMessage,
    progressStage,
  });
  const copy = LIVE_STATUS_COPY[live];
  const toneClass =
    copy.tone === 'good'
      ? 'border-green-800/40 bg-green-950/30 text-green-300'
      : copy.tone === 'warn'
        ? 'border-amber-700/40 bg-amber-950/30 text-amber-200'
        : copy.tone === 'bad'
          ? 'border-red-700/40 bg-red-950/30 text-red-200'
          : copy.tone === 'info'
            ? 'border-accent/40 bg-accent/10 text-accent'
            : 'border-surface-100 bg-surface-200 text-slate-400';

  const Icon =
    copy.tone === 'good'
      ? CheckCircle2
      : copy.tone === 'warn'
        ? AlertCircle
        : copy.tone === 'bad'
          ? XCircle
          : copy.tone === 'info'
            ? Zap
            : Clock;

  return (
    <div className={clsx('rounded-lg border px-3 py-2 flex items-start gap-2', toneClass)}>
      <Icon size={16} className="mt-0.5 flex-shrink-0" />
      <p className="text-xs leading-snug">{copy.label}</p>
    </div>
  );
}

function formatShortTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ResearchPageV2() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification, setActiveRun, activeRun } = useStore();

  const [query, setQuery] = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [showSupplemental, setShowSupplemental] = useState(false);
  const [filterTags, setFilterTags] = useState('');
  const [researchObjective, setResearchObjective] = useState<ResearchObjective>('GENERAL_EPISTEMIC_RESEARCH');
  const [trackingRunId, setTrackingRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ResearchProgressEvent | null>(null);
  const [failure, setFailure] = useState<ResearchFailureEvent | null>(null);
  const [traceEvents, setTraceEvents] = useState<ResearchProgressEvent[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummaryData | null>(null);
  const traceScrollRef = useRef<HTMLDivElement>(null);

  const [showModels, setShowModels] = useState(false);
  const [modelRows, setModelRows] = useState<
    Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }>
  >({});

  const { data: ensembleData } = useQuery({
    queryKey: ['research-v2-ensemble-presets'],
    queryFn: getResearchV2EnsemblePresets,
    staleTime: 60000,
  });

  const { data: runs = [] } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    refetchInterval: () => getAdaptiveRefetchIntervalMs(8_000),
  });

  const trackedRun = runs.find((r) => r.id === trackingRunId);
  const pollEnabled = Boolean(trackingRunId) && (trackedRun?.status === 'running' || trackedRun?.status === 'queued');

  const { data: polledRun } = useQuery({
    queryKey: ['research-run', trackingRunId],
    queryFn: () => getResearchRun(trackingRunId!),
    enabled: pollEnabled,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(4_000),
  });

  const mutation = useMutation({
    mutationFn: startResearch,
    onSuccess: (data) => {
      setTrackingRunId(data.runId);
      const queuedEvt: ResearchProgressEvent = { runId: data.runId, stage: 'planning', percent: 0, message: 'Research One 2 queued...', timestamp: new Date().toISOString() };
      setProgress(queuedEvt);
      setActiveRun(queuedEvt);
      setFailure(null);
      setRunSummary(null);
      setTraceEvents([queuedEvt]);
      subscribeToJob(data.runId);
      addNotification('info', 'Research One 2 started — tracking detailed progress...');
      qc.invalidateQueries({ queryKey: ['research-runs'] });
    },
    onError: (error) => {
      addNotification('error', extractStartResearchErrorMessage(error));
    },
  });

  useEffect(() => {
    if (!ensembleData?.presets) return;
    const preset = ensembleData.presets[researchObjective];
    if (!preset) return;
    const rows: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> = {};
    for (const role of Object.keys(preset)) {
      const p = preset[role];
      rows[role] = { primary: p.primary, fallback: p.fallback, fallbackEnabled: false };
    }
    setModelRows(rows);
  }, [ensembleData, researchObjective]);

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
      setTraceEvents((prev) => sortEventsChronological([...prev, polledEvt].slice(-150)));
    }

    if (polledRun.status === 'failed' || polledRun.status === 'aborted') {
      const fmeta = (polledRun.failure_meta as Record<string, unknown> | undefined) ?? undefined;
      const failed: ResearchFailureEvent = {
        runId: polledRun.id,
        stage: polledRun.failed_stage || polledRun.progress_stage || 'unknown',
        percent: polledRun.progress_percent ?? 0,
        message: polledRun.error_message || 'Research run failed',
        error: polledRun.error_message,
        retryable:
          polledRun.status !== 'aborted' && Boolean(fmeta && fmeta.retryable === true),
        terminal: polledRun.status === 'aborted' || (fmeta && fmeta.terminal === true) === true,
        failureMeta: fmeta,
      };
      setFailure(failed);
      const isAborted = polledRun.status === 'aborted' || failed.terminal === true;
      setActiveRun({
        runId: failed.runId,
        stage: isAborted ? 'aborted' : 'failed',
        percent: failed.percent,
        message: failed.message,
        timestamp: new Date().toISOString(),
        eventType: isAborted ? 'run_aborted' : 'run_failed',
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
        setTraceEvents((prev) => sortEventsChronological([...prev, update].slice(-150)));
      }
    });

    socket.on('research:completed', (result: { runId: string; reportId: string }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
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
        addNotification('success', 'Research One 2 complete — report generated!');
        qc.invalidateQueries({ queryKey: ['reports'] });
        setTimeout(() => navigate(`/reports/${result.reportId}`), 1200);
      }
    });

    socket.on('research:failed', (failed: ResearchFailureEvent) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
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
        addNotification('error', failureReason || 'Research One 2 failed.');
      }
    });

    socket.on('research:aborted', (failed: ResearchFailureEvent) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
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

    socket.on('research:cancelled', (payload: { runId: string }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (payload.runId === trackingRunId) {
        setProgress(null);
        setTrackingRunId(null);
        setActiveRun(null);
        addNotification('info', 'Research One 2 run cancelled.');
      }
    });

    socket.on('run:summary', (summary: RunSummaryData) => {
      if (summary.runId === trackingRunId || summary.runId === progress?.runId) {
        setRunSummary(summary);
      }
    });

    return () => {
      socket.off('research:progress');
      socket.off('research:completed');
      socket.off('research:failed');
      socket.off('research:aborted');
      socket.off('research:cancelled');
      socket.off('run:summary');
    };
  }, [trackingRunId, navigate, addNotification, setActiveRun, qc]);

  /** Full per-role snapshot for V2: primary, fallback model id, and per-role fallback opt-in. */
  const runtimeOverridesPayload = useMemo(() => {
    const payload: Record<string, unknown> = {};
    if (!ensembleData?.presets) return payload;
    const baseline = ensembleData.presets[researchObjective];
    if (!baseline) return payload;

    for (const role of Object.keys(baseline)) {
      const row = modelRows[role];
      const defaultsPrimary = baseline[role].primary;
      const defaultsFallback = baseline[role].fallback;
      const primary = (row?.primary?.trim() || defaultsPrimary).trim();
      const fallback = (row?.fallback?.trim() || defaultsFallback).trim();
      payload[role] = {
        primary,
        fallback,
        fallbackEnabled: row?.fallbackEnabled === true,
      };
    }

    return payload;
  }, [modelRows, ensembleData, researchObjective]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    mutation.mutate({
      query: query.trim(),
      supplemental: supplemental.trim() || undefined,
      filterTags: filterTags ? filterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      modelOverrides: Object.keys(runtimeOverridesPayload).length > 0 ? runtimeOverridesPayload : undefined,
      engineVersion: 'v2',
      researchObjective,
    });
  };

  const current = progress || activeRun;
  const currentUiStage = stageUiId(current?.stage);
  const currentIndex = stageOrderIndex(currentUiStage);
  const hasWarning = Boolean(failure) || currentUiStage === 'failed';

  // Auto-scroll the flat chronological log to the bottom when new events arrive.
  useEffect(() => {
    if (!traceScrollRef.current) return;
    traceScrollRef.current.scrollTop = traceScrollRef.current.scrollHeight;
  }, [traceEvents.length]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <FlaskConical className="text-accent" size={28} />
          <span className="text-gradient">Research One 2</span>
        </h1>
        <p className="text-slate-400 mt-2 text-sm">
          Frontier ensemble (V2 engine): evidence-tiered reporting with full-stage telemetry.{' '}
          <Link to="/guide/research-v2" className="text-accent hover:underline">
            Research modes and capabilities
          </Link>
        </p>
      </div>

      <div className="card-glow p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="section-title block mb-2">Research One 2 query</label>
            <textarea
              className="textarea min-h-28 text-base"
              placeholder="What is the relationship between mitochondrial dysfunction and cancer metabolism?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={mutation.isPending || !!trackingRunId}
            />
            <p className="text-xs text-slate-500 mt-1">Be specific and include the exact framing you want tested.</p>
          </div>

          <div>
            <label className="section-title block mb-2">Research objective</label>
            <select
              className="input w-full md:max-w-md"
              value={researchObjective}
              onChange={(e) => setResearchObjective(e.target.value as ResearchObjective)}
              disabled={mutation.isPending || !!trackingRunId}
            >
              {RESEARCH_OBJECTIVE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Selects the default model ensemble for this run. Open “Model ensemble” to set primary models and optionally
              enable per-role fallbacks (off by default).
            </p>
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
                  disabled={mutation.isPending || !!trackingRunId}
                />
              </div>
              <div>
                <label className="section-title block mb-2">Filter by Tags</label>
                <input
                  type="text"
                  className="input"
                  placeholder="biology, oncology, metabolism"
                  value={filterTags}
                  onChange={(e) => setFilterTags(e.target.value)}
                  disabled={mutation.isPending || !!trackingRunId}
                />
              </div>
            </div>
          )}

          <button type="button" className="btn-ghost text-xs" onClick={() => setShowModels((v) => !v)}>
            <Settings2 size={14} />
            {showModels ? 'Hide model ensemble' : 'Show model ensemble (Research One 2)'}
          </button>

          {showModels && ensembleData?.presets?.[researchObjective] && (
            <div className="rounded-lg border border-indigo-900/30 bg-surface-200 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  Defaults for <span className="text-slate-300">{RESEARCH_OBJECTIVE_OPTIONS.find((o) => o.value === researchObjective)?.label ?? researchObjective}</span>. Edits apply to this run only.
                </p>
                <button
                  type="button"
                  className="btn-ghost text-xs flex items-center gap-1"
                  disabled={mutation.isPending || !!trackingRunId}
                  onClick={() => {
                    const preset = ensembleData.presets[researchObjective];
                    const rows: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> = {};
                    for (const role of Object.keys(preset)) {
                      const p = preset[role];
                      rows[role] = { primary: p.primary, fallback: p.fallback, fallbackEnabled: false };
                    }
                    setModelRows(rows);
                  }}
                >
                  <RotateCcw size={14} />
                  Reset to default for this objective
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {Object.keys(ensembleData.presets[researchObjective]).map((role) => (
                  <div key={role} className="border border-indigo-900/20 rounded p-2 space-y-2">
                    <div className="text-xs text-slate-400 uppercase tracking-wide">{role.replace(/_/g, ' ')}</div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Primary (approved)</div>
                      <input
                        className="input text-xs"
                        placeholder="primary"
                        value={modelRows[role]?.primary || ''}
                        onChange={(e) =>
                          setModelRows((prev) => ({
                            ...prev,
                            [role]: { ...prev[role], primary: e.target.value },
                          }))
                        }
                        disabled={mutation.isPending || !!trackingRunId}
                      />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Fallback (pre-selected)</div>
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1.5 rounded border-indigo-900/40 bg-surface-200 flex-shrink-0"
                          id={`fb-${role}`}
                          checked={modelRows[role]?.fallbackEnabled === true}
                          onChange={(e) =>
                            setModelRows((prev) => ({
                              ...prev,
                              [role]: { ...prev[role], fallbackEnabled: e.target.checked },
                            }))
                          }
                          disabled={mutation.isPending || !!trackingRunId}
                        />
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <label htmlFor={`fb-${role}`} className="text-[10px] text-slate-500 cursor-pointer block">
                            Use fallback on failure
                          </label>
                          <input
                            className="input text-xs w-full"
                            placeholder="fallback model id"
                            value={modelRows[role]?.fallback || ''}
                            onChange={(e) =>
                              setModelRows((prev) => ({
                                ...prev,
                                [role]: { ...prev[role], fallback: e.target.value },
                              }))
                            }
                            disabled={mutation.isPending || !!trackingRunId}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="submit" className="btn-primary w-full py-3 text-base justify-center" disabled={!query.trim() || mutation.isPending || !!trackingRunId}>
            <Send size={16} />
            {mutation.isPending ? 'Queuing...' : trackingRunId ? 'Research One 2 running...' : 'Run Research One 2'}
          </button>
        </form>

        {(progress || activeRun || trackingRunId) && (
          <div className="border-t border-indigo-900/20 pt-5 space-y-4 animate-in">
            <div className="flex items-center justify-between">
              <span className="section-title">Research One 2 pipeline</span>
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
              <div className={hasWarning ? 'h-full bg-amber-500 transition-all duration-500' : 'progress-bar h-full transition-all duration-500'} style={{ width: `${current?.percent ?? 0}%` }} />
            </div>

            <p className="text-sm text-slate-300">{current?.message ?? 'Processing...'}</p>

            <LiveStatusBanner
              runStatus={trackedRun?.status}
              failure={failure}
              retryAttempts={trackedRun?.retry_attempts ?? polledRun?.retry_attempts ?? null}
              progressMessage={trackedRun?.progress_message ?? polledRun?.progress_message ?? null}
              progressStage={trackedRun?.progress_stage ?? polledRun?.progress_stage ?? null}
            />

            <div className="flex items-center justify-between">
              <span className="section-title">Live research trace ({traceEvents.length})</span>
              <span className="text-[10px] text-slate-500">Chronological · newest at bottom</span>
            </div>

            <div
              ref={traceScrollRef}
              className="max-h-[28rem] overflow-y-auto rounded-lg border border-surface-100 bg-[#0b0d14] font-mono text-[11px] leading-5"
            >
              {traceEvents.length === 0 && (
                <p className="text-slate-500 px-3 py-3">Waiting for events…</p>
              )}
              {traceEvents.map((evt, idx) => {
                const isError = evt.eventType === 'run_failed' || evt.eventType === 'run_aborted' || evt.stage === 'failed' || evt.stage === 'aborted';
                const isDone = evt.eventType === 'run_completed' || evt.stage === 'done';
                const isResumed = evt.eventType === 'run_resumed';
                const isModel = Boolean(evt.model || evt.tokenUsage);
                const rowKey = `${evt.timestamp ?? idx}-${evt.stage}-${idx}`;
                const retryBadge = retryBadgeForEvent(evt);

                return (
                  <div
                    key={rowKey}
                    className={clsx(
                      'flex gap-2 px-3 py-1 border-b border-surface-100/20 last:border-0',
                      isError && 'bg-red-950/20',
                      isDone && 'bg-green-950/15',
                      isResumed && 'bg-blue-950/15',
                      isModel && !isError && !isDone && 'bg-indigo-950/10'
                    )}
                  >
                    {/* Timestamp */}
                    <span className="text-slate-600 tabular-nums flex-shrink-0 select-none w-[7ch]">
                      {formatShortTime(evt.timestamp)}
                    </span>

                    {/* Stage tag */}
                    <span
                      className={clsx(
                        'flex-shrink-0 w-[12ch] truncate',
                        isError ? 'text-red-400' : isDone ? 'text-green-400' : isResumed ? 'text-blue-400' : 'text-indigo-400'
                      )}
                    >
                      {evt.stage.replace(/_/g, ' ')}
                    </span>

                    {/* Percent */}
                    <span className="text-slate-600 flex-shrink-0 w-[5ch] tabular-nums text-right">{evt.percent}%</span>

                    {/* Message + inline details */}
                    <span className="flex-1 min-w-0 text-slate-300 break-words">
                      {evt.message}
                      {retryBadge && (
                        <span className={clsx(
                          'ml-2 inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium uppercase tracking-wide',
                          retryBadge.variant === 'resumed' && 'bg-blue-950/60 text-blue-300',
                          retryBadge.variant === 'retryable' && 'bg-amber-950/60 text-amber-200',
                          retryBadge.variant === 'terminal' && 'bg-slate-800 text-slate-400'
                        )}>
                          {retryBadge.text}
                        </span>
                      )}
                      {evt.model && (
                        <span className="ml-2 text-indigo-400/70">[{evt.model}]</span>
                      )}
                      {evt.tokenUsage && (
                        <span className="ml-1 text-slate-500">
                          {evt.tokenUsage.prompt}p+{evt.tokenUsage.completion}c tok
                        </span>
                      )}
                      {(evt.chunkCount != null || evt.sourceCount != null) && (
                        <span className="ml-1 text-slate-500">
                          {typeof evt.chunkCount === 'number' ? `${evt.chunkCount} chunks` : ''}
                          {typeof evt.chunkCount === 'number' && typeof evt.sourceCount === 'number' ? ' · ' : ''}
                          {typeof evt.sourceCount === 'number' ? `${evt.sourceCount} sources` : ''}
                        </span>
                      )}
                      {evt.failure?.errorMessage && (
                        <span className="ml-1 text-red-300/90">{evt.failure.errorMessage}</span>
                      )}
                      {evt.substep && (
                        <span className="ml-1 text-slate-500">({evt.substep})</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {failure && (
          <FailureCard
            failure={failure}
            // Read once from the canonical state machine. The card never
            // recomputes retryable/terminal/aborted; it just renders the
            // result. This eliminates the post-merge UI contradiction
            // (Retryable badge + 'not recoverable' headline + Aborted
            // banner all on the same screen).
            derivedState={deriveRunState(trackedRun ?? null, {
              terminal: failure.terminal,
              retryable: failure.retryable,
              failureMeta: failure.failureMeta,
            })}
            onRetried={(rid) => {
              setFailure(null);
              setTrackingRunId(rid);
              qc.invalidateQueries({ queryKey: ['research-runs'] });
              addNotification('info', 'Retry queued from last failure.');
            }}
            onError={(msg) => addNotification('error', msg)}
            onInfo={(msg) => addNotification('info', msg)}
          />
        )}

        {(runSummary || (trackedRun && ['completed', 'cancelled', 'failed', 'aborted'].includes(trackedRun.status))) && (
          <RunSummaryReport
            summary={runSummary}
            run={trackedRun ?? null}
            traceEvents={traceEvents}
            failure={failure}
          />
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Research One 2 governance model</h2>
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
          <h2 className="section-title mb-3">Recent runs</h2>
          <div className="space-y-2">
            {runs.slice(0, 10).map((run) => (
              <RunRow
                key={run.id}
                run={run}
                onRunsChanged={() => qc.invalidateQueries({ queryKey: ['research-runs'] })}
                onRemoved={(id) => {
                  if (id === trackingRunId) {
                    setTrackingRunId(null);
                    setProgress(null);
                    setFailure(null);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  onRunsChanged,
  onRemoved,
}: {
  run: ResearchRun;
  onRunsChanged: () => void;
  onRemoved?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [showError, setShowError] = useState(false);
  const [busy, setBusy] = useState(false);

  const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
    queued: { icon: Clock, color: 'text-slate-400', label: 'Queued' },
    running: { icon: Zap, color: 'text-accent animate-pulse', label: 'Running' },
    completed: { icon: CheckCircle2, color: 'text-green-400', label: 'Completed' },
    failed: { icon: AlertCircle, color: 'text-amber-400', label: 'Needs review' },
    cancelled: { icon: AlertCircle, color: 'text-slate-500', label: 'Cancelled' },
    aborted: { icon: XCircle, color: 'text-red-400', label: 'Aborted' },
  };

  const cfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.failed;
  const Icon = cfg.icon;

  const latestEvent = Array.isArray(run.progress_events) && run.progress_events.length > 0
    ? run.progress_events[run.progress_events.length - 1]
    : null;

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Cancel this run?')) return;
    setBusy(true);
    try {
      await cancelResearchRun(run.id);
      onRunsChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Remove this run from the list?')) return;
    setBusy(true);
    try {
      await deleteResearchRun(run.id);
      onRemoved?.(run.id);
      onRunsChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between hover:border-accent/30 cursor-pointer transition-all gap-2" onClick={() => run.status === 'completed' && navigate(`/reports`)}>
        <div className="flex items-center gap-3 min-w-0">
          <Icon size={14} className={cfg.color} />
          <div className="min-w-0">
            <p className="text-sm text-white truncate">{run.title}</p>
            <p className="text-xs text-slate-500">{formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}</p>
            {(run.status === 'running' || run.status === 'queued' || latestEvent) && (
              <p className="text-xs text-accent/90 mt-1 line-clamp-2">
                {typeof run.progress_percent === 'number' ? `${run.progress_percent}% · ` : ''}
                {run.progress_message || latestEvent?.message || 'Awaiting updates...'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className={clsx('text-xs font-medium', cfg.color)}>{cfg.label}</span>
          {(run.status === 'queued' || run.status === 'running') && (
            <button type="button" className="btn-ghost p-1.5 text-amber-400" title="Cancel run" disabled={busy} onClick={handleCancel}>
              <Ban size={14} />
            </button>
          )}
          {(run.status === 'queued' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'aborted') && (
            <button type="button" className="btn-ghost p-1.5 text-slate-400" title="Remove from list" disabled={busy} onClick={handleDelete}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {(run.status === 'failed' || run.status === 'aborted') && (run.error_message || run.failed_stage) && (
        <div>
          <button type="button" className="text-xs text-amber-300 hover:text-amber-200" onClick={() => setShowError((v) => !v)}>
            {showError ? 'Hide error details' : 'Show error details'}
          </button>
          {showError && (
            <p className="text-xs text-amber-200 mt-1">
              {run.failed_stage ? `Stage: ${run.failed_stage} · ` : ''}
              {formatFailureReason(run.error_message || 'Unknown failure', run.failure_meta)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FailureCard({
  failure,
  derivedState,
  onRetried,
  onError,
  onInfo,
}: {
  failure: ResearchFailureEvent;
  /**
   * Canonical state from `deriveRunState`. The card NEVER computes its own
   * retryable/terminal flags — it just renders what the state machine says.
   * This is what fixes the "Retryable badge + Aborted banner + 'not
   * recoverable' headline all on the same screen" failure mode reported on
   * 2026-04-28.
   */
  derivedState: LiveStatus;
  onRetried: (runId: string) => void;
  onError: (message: string) => void;
  /**
   * Used for non-error post-action messages (e.g. "2 retries remaining after
   * this attempt"). Wired to an info-level notification by the parent so we
   * do not surface a false error toast on a successful retry queue
   * (PR #39 Copilot review).
   */
  onInfo: (message: string) => void;
}) {
  const fmeta = failure.failureMeta ?? {};
  const role = typeof fmeta.role === 'string' ? fmeta.role : undefined;
  const model = typeof fmeta.model === 'string' ? fmeta.model : undefined;
  const upstream = typeof fmeta.upstream === 'string' ? fmeta.upstream : undefined;
  const classification =
    typeof fmeta.classification === 'string' ? fmeta.classification : undefined;
  const retryAttempts = typeof fmeta.retryAttempts === 'number' ? fmeta.retryAttempts : undefined;
  const retryBudget = typeof fmeta.retryBudget === 'number' ? fmeta.retryBudget : undefined;
  const attemptsRemaining =
    typeof fmeta.attemptsRemaining === 'number' ? fmeta.attemptsRemaining : undefined;
  const abortReason = typeof fmeta.abortReason === 'string' ? fmeta.abortReason : undefined;

  const isTerminal = derivedState === 'aborted';
  const showResume = isResumeAvailable(derivedState);

  const tone = isTerminal ? 'red' : 'amber';
  const headlineClass = isTerminal ? 'text-red-300' : 'text-amber-300';
  const containerClass = isTerminal
    ? 'border-red-700/40 bg-red-950/30'
    : 'border-amber-700/40 bg-amber-950/30';

  const reason = formatFailureReason(failure.error || failure.message, fmeta);
  const headline =
    failureCardHeadline(derivedState) ?? 'Run encountered an error.';

  const guidance: string[] = [];
  if (isTerminal) {
    if (abortReason === 'auth_error') {
      guidance.push(
        'The upstream rejected the call as unauthenticated. The server-side OPENROUTER_API_KEY / HF_TOKEN may be missing or expired — contact the operator.'
      );
    } else if (abortReason === 'invalid_request') {
      guidance.push(
        'The orchestrator classified this request as malformed. Inspect the query / supplemental files and start a new run.'
      );
    } else if (abortReason === 'budget_exhausted') {
      guidance.push(
        `The retry budget (${retryBudget ?? 3}) is exhausted. Start a new run with the same query if you want to try again.`
      );
    } else {
      guidance.push(
        'The orchestrator marked this failure non-recoverable. Start a new run with the same query if you want to try again.'
      );
    }
  } else if (showResume) {
    guidance.push(
      'Click "Resume from last failure" to re-queue this run from the saved checkpoint with the same models, ensemble, and supplemental context.'
    );
    if (typeof retryAttempts === 'number' && typeof retryBudget === 'number') {
      guidance.push(`Retries used so far: ${retryAttempts} of ${retryBudget}.`);
    }
  }
  if (classification === 'provider_unavailable' && upstream === 'huggingface_inference') {
    guidance.push(
      'The Hugging Face Inference Provider for this exact repo was temporarily unavailable. If this keeps happening, switch the role to a different model in the per-run model panel above.'
    );
  }
  if (classification === 'auth_error') {
    guidance.push(
      'The upstream rejected the call as unauthenticated. The server-side OPENROUTER_API_KEY / HF_TOKEN may be missing or expired — contact the operator.'
    );
  }
  if (classification === 'rate_limited') {
    guidance.push(
      'You are being rate-limited by the upstream provider. Wait briefly before resuming.'
    );
  }

  return (
    <div className={clsx('border rounded-lg p-4 space-y-2', containerClass)}>
      <div className="flex items-center gap-2">
        {isTerminal ? (
          <XCircle size={16} className="text-red-400" />
        ) : (
          <AlertCircle size={16} className="text-amber-400" />
        )}
        <p className={clsx('text-sm font-medium', headlineClass)}>{headline}</p>
      </div>

      <div className={clsx('text-xs space-y-1', tone === 'red' ? 'text-red-200' : 'text-amber-200')}>
        <p>
          <span className="text-slate-400">Stage:</span> {failure.stage || 'unknown'}
          {role ? <span> · <span className="text-slate-400">Role:</span> {role}</span> : null}
          {model ? <span> · <span className="text-slate-400">Model:</span> {model}</span> : null}
          {upstream ? <span> · <span className="text-slate-400">Upstream:</span> {upstream}</span> : null}
          {classification ? (
            <span> · <span className="text-slate-400">Class:</span> {classification}</span>
          ) : null}
        </p>
        <p className="opacity-90">{reason}</p>
        {typeof retryAttempts === 'number' && typeof retryBudget === 'number' && (
          <p className="text-slate-400">
            Retries used: <span className="text-slate-300">{retryAttempts}</span> of{' '}
            <span className="text-slate-300">{retryBudget}</span>
            {typeof attemptsRemaining === 'number' && attemptsRemaining > 0 ? (
              <span> · <span className="text-slate-300">{attemptsRemaining}</span> remaining</span>
            ) : null}
          </p>
        )}
      </div>

      {guidance.length > 0 && (
        <ul className="text-xs space-y-1 text-slate-300 pl-4 list-disc">
          {guidance.map((g, idx) => (
            <li key={idx}>{g}</li>
          ))}
        </ul>
      )}

      {showResume && (
        <button
          type="button"
          className="btn-ghost text-xs mt-1"
          onClick={async () => {
            if (!failure.runId) return;
            try {
              const result = await retryResearchRunFromFailure(failure.runId);
              onRetried(failure.runId);
              if (typeof result?.attemptsRemaining === 'number') {
                onInfo(
                  `${result.attemptsRemaining} ${
                    result.attemptsRemaining === 1 ? 'retry' : 'retries'
                  } remaining after this attempt.`
                );
              }
            } catch (err) {
              if (axios.isAxiosError(err)) {
                const d = err.response?.data as
                  | { error?: string; reason?: string; hint?: string; terminal?: boolean }
                  | undefined;
                const detail = [d?.error, d?.reason, d?.hint].filter(Boolean).join(' — ');
                onError(detail || err.message || 'Failed to queue retry');
              } else {
                onError(err instanceof Error ? err.message : 'Failed to queue retry');
              }
            }
          }}
        >
          <RotateCcw size={12} />
          Resume from last failure
        </button>
      )}
    </div>
  );
}

function formatFailureReason(message: string, failureMeta?: Record<string, unknown>): string {
  if (!failureMeta) return message;
  const providerMessage = typeof failureMeta.providerMessage === 'string' ? failureMeta.providerMessage : undefined;
  const status = typeof failureMeta.status === 'number' ? String(failureMeta.status) : undefined;
  const classification = typeof failureMeta.classification === 'string' ? failureMeta.classification : undefined;
  const endpoint = typeof failureMeta.endpoint === 'string' ? failureMeta.endpoint : undefined;
  const hint = typeof failureMeta.hint === 'string' ? failureMeta.hint : undefined;
  const reason = typeof failureMeta.reason === 'string' ? failureMeta.reason : undefined;
  const orchestratorHints = Array.isArray(failureMeta.orchestratorHints)
    ? failureMeta.orchestratorHints.filter((h) => typeof h === 'string').join(' | ')
    : undefined;

  const details = [
    classification ? `classification=${classification}` : '',
    status ? `status=${status}` : '',
    endpoint ? `endpoint=${endpoint}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  if (!providerMessage && !details && !orchestratorHints && !hint && !reason) return message;
  return [message, providerMessage, details, reason, hint, orchestratorHints].filter(Boolean).join(' | ');
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
