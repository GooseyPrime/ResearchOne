import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
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
  Layers,
  RotateCcw,
  ChevronRight,
} from 'lucide-react';
import {
  startResearch,
  getResearchRuns,
  getResearchRun,
  cancelResearchRun,
  deleteResearchRun,
  getResearchModelOptions,
  ResearchRun,
  ResearchProgressEvent,
} from '../utils/api';
import { useStore } from '../store/useStore';
import { getSocket, subscribeToJob } from '../utils/socket';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

interface ResearchFailureEvent {
  runId: string;
  stage: string;
  percent: number;
  message: string;
  error?: string;
  retryable?: boolean;
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
  if (backendStage === 'failed') return 'failed';
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

const PHASE_ORDER: string[] = [...STAGES.map((s) => s.id), 'failed'];

function bucketEventsByPhase(events: ResearchProgressEvent[]): Map<string, ResearchProgressEvent[]> {
  const map = new Map<string, ResearchProgressEvent[]>();
  for (const evt of events) {
    const id = stageUiId(evt.stage);
    const list = map.get(id) ?? [];
    list.push(evt);
    map.set(id, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  }
  return map;
}

function orderedPhaseIds(bucket: Map<string, ResearchProgressEvent[]>): string[] {
  return PHASE_ORDER.filter((id) => (bucket.get(id)?.length ?? 0) > 0);
}

function phaseLabelForId(phaseId: string): { label: string; Icon: StageDescriptor['icon'] } {
  const found = STAGES.find((s) => s.id === phaseId);
  if (found) return { label: found.label, Icon: found.icon };
  if (phaseId === 'failed') return { label: 'Error / recovery', Icon: AlertCircle };
  return { label: phaseId.replace(/_/g, ' '), Icon: Zap };
}

function eventHasModelDetails(evt: ResearchProgressEvent): boolean {
  return Boolean(evt.model || evt.tokenUsage || evt.detail || evt.substep);
}

function retryBadgeForEvent(evt: ResearchProgressEvent): { text: string; variant: 'retryable' | 'resumed' | 'terminal' } | null {
  if (evt.eventType === 'run_resumed') {
    return { text: 'Resumed', variant: 'resumed' };
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

function formatShortTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ResearchPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification, setActiveRun, activeRun } = useStore();

  const [query, setQuery] = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [showSupplemental, setShowSupplemental] = useState(false);
  const [filterTags, setFilterTags] = useState('');
  const [trackingRunId, setTrackingRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ResearchProgressEvent | null>(null);
  const [failure, setFailure] = useState<ResearchFailureEvent | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceEvents, setTraceEvents] = useState<ResearchProgressEvent[]>([]);
  /** `undefined` = derive open state from the current pipeline stage */
  const [phaseExpanded, setPhaseExpanded] = useState<Record<string, boolean | undefined>>({});
  const [traceRowExpanded, setTraceRowExpanded] = useState<Record<string, boolean>>({});
  const traceScrollRef = useRef<HTMLDivElement>(null);

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
    refetchInterval: 4000,
  });

  const trackedRun = runs.find((r) => r.id === trackingRunId);
  const pollEnabled = Boolean(trackingRunId) && (trackedRun?.status === 'running' || trackedRun?.status === 'queued');

  const { data: polledRun } = useQuery({
    queryKey: ['research-run', trackingRunId],
    queryFn: () => getResearchRun(trackingRunId!),
    enabled: pollEnabled,
    refetchInterval: 2000,
  });

  const mutation = useMutation({
    mutationFn: startResearch,
    onSuccess: (data) => {
      setTrackingRunId(data.runId);
      const queuedEvt: ResearchProgressEvent = { runId: data.runId, stage: 'planning', percent: 0, message: 'Research queued...', timestamp: new Date().toISOString() };
      setProgress(queuedEvt);
      setActiveRun(queuedEvt);
      setFailure(null);
      setTraceEvents([queuedEvt]);
      subscribeToJob(data.runId);
      addNotification('info', 'Research started — tracking detailed progress...');
      qc.invalidateQueries({ queryKey: ['research-runs'] });
    },
    onError: (error) => {
      addNotification('error', extractStartResearchErrorMessage(error));
    },
  });

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
      setTraceEvents(sorted.slice(-150).reverse());
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
      setTraceEvents((prev) => [polledEvt, ...prev].slice(0, 150));
    }

    if (polledRun.status === 'failed') {
      const failed: ResearchFailureEvent = {
        runId: polledRun.id,
        stage: polledRun.failed_stage || polledRun.progress_stage || 'unknown',
        percent: polledRun.progress_percent ?? 0,
        message: polledRun.error_message || 'Research run failed',
        error: polledRun.error_message,
        retryable: Boolean(polledRun.failure_meta && (polledRun.failure_meta as Record<string, unknown>).retryable),
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
        setTraceEvents((prev) => [update, ...prev].slice(0, 150));
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
        addNotification('success', 'Research complete — report generated!');
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
        addNotification('error', failureReason || 'Research failed.');
      }
    });

    socket.on('research:cancelled', (payload: { runId: string }) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (payload.runId === trackingRunId) {
        setProgress(null);
        setTrackingRunId(null);
        setActiveRun(null);
        addNotification('info', 'Research run cancelled.');
      }
    });

    return () => {
      socket.off('research:progress');
      socket.off('research:completed');
      socket.off('research:failed');
      socket.off('research:cancelled');
    };
  }, [trackingRunId, navigate, addNotification, setActiveRun, qc]);

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
    mutation.mutate({
      query: query.trim(),
      supplemental: supplemental.trim() || undefined,
      filterTags: filterTags ? filterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      modelOverrides: Object.keys(runtimeOverridesPayload).length > 0 ? runtimeOverridesPayload : undefined,
    });
  };

  const current = progress || activeRun;
  const currentUiStage = stageUiId(current?.stage);
  const currentIndex = stageOrderIndex(currentUiStage);
  const hasWarning = Boolean(failure) || currentUiStage === 'failed';

  const phaseBuckets = useMemo(() => bucketEventsByPhase(traceEvents), [traceEvents]);
  const orderedPhases = useMemo(() => orderedPhaseIds(phaseBuckets), [phaseBuckets]);

  const isPhaseOpen = (phaseId: string) => {
    const explicit = phaseExpanded[phaseId];
    if (explicit !== undefined) return explicit;
    if (phaseId === 'failed') return hasWarning;
    return phaseId === currentUiStage;
  };

  const togglePhase = (phaseId: string) => {
    setPhaseExpanded((prev) => {
      const nextOpen = !isPhaseOpen(phaseId);
      return { ...prev, [phaseId]: nextOpen };
    });
  };

  useEffect(() => {
    if (!traceOpen || !traceScrollRef.current) return;
    const wrap = traceScrollRef.current;
    const target = wrap.querySelector(`[data-telemetry-phase="${currentUiStage}"]`);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [traceOpen, currentUiStage]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <FlaskConical className="text-accent" size={28} />
          <span className="text-gradient">Start Research</span>
        </h1>
        <p className="text-slate-400 mt-2 text-sm">
          Disciplined anomaly research with evidence-tiered reporting and full-stage telemetry.
        </p>
      </div>

      <div className="card-glow p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="section-title block mb-2">Research Query</label>
            <textarea
              className="textarea min-h-28 text-base"
              placeholder="What is the relationship between mitochondrial dysfunction and cancer metabolism?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={mutation.isPending || !!trackingRunId}
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
                      disabled={mutation.isPending || !!trackingRunId}
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
                      disabled={mutation.isPending || !!trackingRunId}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="submit" className="btn-primary w-full py-3 text-base justify-center" disabled={!query.trim() || mutation.isPending || !!trackingRunId}>
            <Send size={16} />
            {mutation.isPending ? 'Queuing...' : trackingRunId ? 'Research Running...' : 'Run Research'}
          </button>
        </form>

        {(progress || activeRun || trackingRunId) && (
          <div className="border-t border-indigo-900/20 pt-5 space-y-4 animate-in">
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
              <div className={hasWarning ? 'h-full bg-amber-500 transition-all duration-500' : 'progress-bar h-full transition-all duration-500'} style={{ width: `${current?.percent ?? 0}%` }} />
            </div>

            <p className="text-sm text-slate-300">{current?.message ?? 'Processing...'}</p>

            <button type="button" className="btn-ghost text-xs" onClick={() => setTraceOpen((v) => !v)}>
              {traceOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Live research trace ({traceEvents.length})
            </button>

            {traceOpen && (
              <div
                ref={traceScrollRef}
                className="max-h-[22rem] overflow-y-auto rounded-lg border border-surface-100 bg-surface-200/60 p-2 space-y-1"
              >
                {traceEvents.length === 0 && <p className="text-xs text-slate-500 px-2 py-2">No trace events yet.</p>}
                {orderedPhases.map((phaseId) => {
                  const phaseEvents = phaseBuckets.get(phaseId) ?? [];
                  const { label, Icon } = phaseLabelForId(phaseId);
                  const open = isPhaseOpen(phaseId);
                  const phaseActive = phaseId === currentUiStage && currentUiStage !== 'failed';
                  const phaseDone =
                    stageOrderIndex(phaseId) < currentIndex || (phaseId === 'done' && currentUiStage === 'done');
                  const phaseWarn = hasWarning && (phaseId === 'failed' || (phaseActive && hasWarning));

                  return (
                    <div
                      key={phaseId}
                      data-telemetry-phase={phaseId}
                      className={clsx(
                        'rounded-lg border overflow-hidden',
                        phaseDone && !phaseWarn && 'border-green-800/35 bg-green-950/15',
                        phaseActive && !phaseWarn && 'border-accent/35 bg-accent/5',
                        phaseWarn && 'border-amber-700/40 bg-amber-950/20',
                        !phaseDone && !phaseActive && !phaseWarn && 'border-surface-100/60 bg-surface-200/40'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => togglePhase(phaseId)}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-white/5 transition-colors"
                      >
                        <Layers size={14} className="text-slate-500 flex-shrink-0" />
                        <Icon size={14} className={clsx('flex-shrink-0', phaseWarn ? 'text-amber-400' : 'text-accent')} />
                        <span className="text-xs font-semibold text-slate-200 flex-1 min-w-0 truncate">{label}</span>
                        <span className="text-[10px] text-slate-500 tabular-nums">{phaseEvents.length} evt</span>
                        {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                      </button>
                      {open && (
                        <div className="border-t border-surface-100/40 px-2 pb-2 pt-1 space-y-1.5">
                          {phaseEvents.map((evt, idx) => {
                            const warning = evt.eventType === 'run_failed' || evt.stage === 'failed';
                            const completed = evt.eventType === 'run_completed' || evt.stage === 'done';
                            const resumed = evt.eventType === 'run_resumed';
                            const rowKey = `${evt.timestamp ?? 'ts'}-${evt.stage}-${idx}`;
                            const detailsOpen = traceRowExpanded[rowKey] ?? false;
                            const hasDetails = eventHasModelDetails(evt);
                            const retryBadge = retryBadgeForEvent(evt);

                            return (
                              <div key={rowKey} className="text-xs rounded-md border border-surface-100/30 bg-surface-300/40 p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span
                                        className={
                                          warning
                                            ? 'text-amber-300 font-medium'
                                            : completed
                                              ? 'text-green-400 font-medium'
                                              : resumed
                                                ? 'text-blue-300 font-medium'
                                                : 'text-slate-300 font-medium'
                                        }
                                      >
                                        {evt.stage.replace(/_/g, ' ')}
                                      </span>
                                      {retryBadge && (
                                        <span
                                          className={clsx(
                                            'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                                            retryBadge.variant === 'resumed' && 'bg-blue-950/60 text-blue-300 border border-blue-800/40',
                                            retryBadge.variant === 'retryable' && 'bg-amber-950/60 text-amber-200 border border-amber-800/40',
                                            retryBadge.variant === 'terminal' && 'bg-slate-800 text-slate-400 border border-slate-600/50'
                                          )}
                                        >
                                          {retryBadge.variant !== 'terminal' && <RotateCcw size={10} />}
                                          {retryBadge.text}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-slate-300 mt-0.5 leading-snug">{evt.message}</p>
                                    {!hasDetails && (evt.chunkCount != null || evt.sourceCount != null) && (
                                      <p className="text-slate-500 mt-1 text-[11px]">
                                        {typeof evt.chunkCount === 'number' ? `${evt.chunkCount} chunks` : ''}
                                        {typeof evt.chunkCount === 'number' && typeof evt.sourceCount === 'number' ? ' · ' : ''}
                                        {typeof evt.sourceCount === 'number' ? `${evt.sourceCount} sources` : ''}
                                      </p>
                                    )}
                                    {evt.failure?.errorMessage && (
                                      <p className="text-amber-200/95 mt-1 text-[11px] leading-snug">{evt.failure.errorMessage}</p>
                                    )}
                                  </div>
                                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                    <span className="text-slate-400 tabular-nums">{evt.percent}%</span>
                                    <span className="text-[10px] text-slate-500">{formatShortTime(evt.timestamp)}</span>
                                  </div>
                                </div>
                                {hasDetails && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTraceRowExpanded((prev) => ({ ...prev, [rowKey]: !detailsOpen }))
                                      }
                                      className="mt-1.5 flex items-center gap-1 text-[11px] text-accent/90 hover:text-accent"
                                    >
                                      <ChevronRight
                                        size={12}
                                        className={clsx('transition-transform', detailsOpen && 'rotate-90')}
                                      />
                                      {detailsOpen ? 'Hide model call details' : 'Model call details'}
                                    </button>
                                    {detailsOpen && (
                                      <div className="mt-2 rounded border border-indigo-900/25 bg-surface-200/80 p-2 space-y-1 text-[11px] text-slate-400">
                                        {evt.model && (
                                          <p>
                                            <span className="text-slate-500">Model:</span> {evt.model}
                                          </p>
                                        )}
                                        {evt.tokenUsage && (
                                          <p>
                                            <span className="text-slate-500">Tokens:</span> {evt.tokenUsage.prompt} prompt /{' '}
                                            {evt.tokenUsage.completion} completion
                                          </p>
                                        )}
                                        {evt.substep && (
                                          <p>
                                            <span className="text-slate-500">Substep:</span> {evt.substep}
                                          </p>
                                        )}
                                        {evt.detail && (
                                          <p className="text-slate-300 whitespace-pre-wrap break-words">{evt.detail}</p>
                                        )}
                                        {(evt.chunkCount != null || evt.sourceCount != null) && (
                                          <p>
                                            {typeof evt.chunkCount === 'number' ? `${evt.chunkCount} chunks` : ''}
                                            {typeof evt.chunkCount === 'number' && typeof evt.sourceCount === 'number'
                                              ? ' · '
                                              : ''}
                                            {typeof evt.sourceCount === 'number' ? `${evt.sourceCount} sources` : ''}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {failure && (
          <div className="border border-amber-700/40 bg-amber-950/30 rounded-lg p-4 space-y-1">
            <p className="text-sm text-amber-300 font-medium">Run encountered an error</p>
            <p className="text-xs text-amber-200">Stage: {failure.stage || 'unknown'}</p>
            <p className="text-xs text-amber-200">Reason: {formatFailureReason(failure.error || failure.message, failure.failureMeta)}</p>
            {failure.retryable && <p className="text-xs text-blue-300">Automatic retry may resume processing if queue policy allows.</p>}
          </div>
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

  const STATUS_CONFIG = {
    queued: { icon: Clock, color: 'text-slate-400', label: 'Queued' },
    running: { icon: Zap, color: 'text-accent animate-pulse', label: 'Running' },
    completed: { icon: CheckCircle2, color: 'text-green-400', label: 'Completed' },
    failed: { icon: AlertCircle, color: 'text-amber-400', label: 'Needs review' },
    cancelled: { icon: AlertCircle, color: 'text-slate-500', label: 'Cancelled' },
  };

  const cfg = STATUS_CONFIG[run.status];
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
          {(run.status === 'queued' || run.status === 'failed' || run.status === 'cancelled') && (
            <button type="button" className="btn-ghost p-1.5 text-slate-400" title="Remove from list" disabled={busy} onClick={handleDelete}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {run.status === 'failed' && (run.error_message || run.failed_stage) && (
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

function formatFailureReason(message: string, failureMeta?: Record<string, unknown>): string {
  if (!failureMeta) return message;
  const providerMessage = typeof failureMeta.providerMessage === 'string' ? failureMeta.providerMessage : undefined;
  const status = typeof failureMeta.status === 'number' ? String(failureMeta.status) : undefined;
  const classification = typeof failureMeta.classification === 'string' ? failureMeta.classification : undefined;
  const endpoint = typeof failureMeta.endpoint === 'string' ? failureMeta.endpoint : undefined;

  const details = [
    classification ? `classification=${classification}` : '',
    status ? `status=${status}` : '',
    endpoint ? `endpoint=${endpoint}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  if (!providerMessage && !details) return message;
  return [message, providerMessage, details].filter(Boolean).join(' | ');
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
