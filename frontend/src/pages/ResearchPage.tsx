import { useState, useEffect, useMemo } from 'react';
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

function formatTraceMeta(evt: ResearchProgressEvent): string {
  const parts: string[] = [];
  if (evt.detail) parts.push(evt.detail);
  if (evt.substep) parts.push(evt.substep);
  if (typeof evt.chunkCount === 'number') parts.push(`${evt.chunkCount} chunks`);
  if (typeof evt.sourceCount === 'number') parts.push(`${evt.sourceCount} sources`);
  if (evt.model) parts.push(evt.model);
  if (evt.tokenUsage) parts.push(`${evt.tokenUsage.prompt}p/${evt.tokenUsage.completion}c`);
  return parts.join(' · ');
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
              <div className="max-h-80 overflow-y-auto rounded-lg border border-surface-100 bg-surface-200/60 p-3 space-y-2">
                {traceEvents.length === 0 && <p className="text-xs text-slate-500">No trace events yet.</p>}
                {traceEvents.map((evt, idx) => {
                  const warning = evt.eventType === 'run_failed' || evt.stage === 'failed';
                  const completed = evt.eventType === 'run_completed' || evt.stage === 'done';
                  const resumed = evt.eventType === 'run_resumed';
                  return (
                    <div key={`${evt.timestamp ?? 'no-ts'}-${evt.stage}-${idx}`} className="text-xs border-b border-surface-100/50 pb-2">
                      <div className="flex items-center justify-between">
                        <span className={warning ? 'text-amber-300' : completed ? 'text-green-400' : resumed ? 'text-blue-300' : 'text-slate-300'}>
                          {evt.stage.replace(/_/g, ' ')}
                        </span>
                        <span className="text-slate-400">{evt.percent}%</span>
                      </div>
                      <p className="text-slate-300 mt-1">{evt.message}</p>
                      {(evt.detail || evt.substep || evt.chunkCount || evt.sourceCount || evt.model || evt.tokenUsage) && (
                        <p className="text-slate-500 mt-1">{formatTraceMeta(evt)}</p>
                      )}
                      {evt.failure?.errorMessage && <p className="text-amber-200 mt-1">{evt.failure.errorMessage}</p>}
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
