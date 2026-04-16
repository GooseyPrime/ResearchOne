import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { startResearch, getResearchRuns, ResearchRun } from '../utils/api';
import { useStore } from '../store/useStore';
import { getSocket, subscribeToJob } from '../utils/socket';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';
interface ResearchProgressEvent {
  runId?: string;
  stage: string;
  percent: number;
  message: string;
  detail?: string;
  substep?: string;
  timestamp?: string;
  model?: string;
  tokenUsage?: { prompt: number; completion: number };
  sourceCount?: number;
  chunkCount?: number;
}

interface ResearchFailureEvent {
  runId: string;
  stage: string;
  percent: number;
  message: string;
  error?: string;
  retryable?: boolean;
}

function formatTraceMeta(evt: ResearchProgressEvent): string {
  const parts: string[] = [];
  if (evt.detail) parts.push(evt.detail);
  if (evt.substep) parts.push(evt.substep);
  if (typeof evt.chunkCount === 'number') parts.push(`${evt.chunkCount} chunks`);
  if (typeof evt.sourceCount === 'number') parts.push(`${evt.sourceCount} sources`);
  return parts.join(' · ');
}

const WORKFLOW_STAGES = [
  { id: 'planning', icon: Brain, label: 'Planner', desc: 'Decomposes research query' },
  { id: 'retrieval', icon: FileSearch, label: 'Retriever', desc: 'Gathers evidence' },
  { id: 'reasoning', icon: Zap, label: 'Reasoner', desc: 'Builds arguments' },
  { id: 'challenge', icon: Shield, label: 'Skeptic', desc: 'Challenges conclusions' },
  { id: 'synthesis', icon: PenLine, label: 'Synthesizer', desc: 'Writes report' },
  { id: 'verification', icon: Target, label: 'Verifier', desc: 'Epistemic gate' },
];

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

  const { data: runs = [] } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    refetchInterval: 5000,
  });

  const mutation = useMutation({
    mutationFn: startResearch,
    onSuccess: (data) => {
      setTrackingRunId(data.runId);
      setProgress({ stage: 'queued', percent: 0, message: 'Research queued...' });
      setFailure(null);
      setTraceEvents([]);
      subscribeToJob(data.runId);
      addNotification('info', 'Research started — tracking progress...');
      qc.invalidateQueries({ queryKey: ['research-runs'] });
    },
    onError: () => {
      addNotification('error', 'Failed to start research. Check API connection.');
    },
  });

  // WebSocket progress tracking
  useEffect(() => {
    const socket = getSocket();

    socket.on('research:progress', (update: ResearchProgressEvent) => {
      if (update.runId === trackingRunId) {
        setProgress(update);
        setActiveRun({ ...update, runId: update.runId });
        setTraceEvents(prev => [update, ...prev].slice(0, 100));
      }
    });

    socket.on('research:completed', (result: { runId: string; reportId: string }) => {
      if (result.runId === trackingRunId) {
        setProgress({ stage: 'done', percent: 100, message: 'Report ready!' });
        setActiveRun(null);
        setTrackingRunId(null);
        addNotification('success', 'Research complete — report generated!');
        qc.invalidateQueries({ queryKey: ['research-runs'] });
        qc.invalidateQueries({ queryKey: ['reports'] });
        setTimeout(() => navigate(`/reports/${result.reportId}`), 1500);
      }
    });

    socket.on('research:failed', (failed: ResearchFailureEvent) => {
      if (failed.runId === trackingRunId) {
        setFailure(failed);
        setProgress(null);
        setTrackingRunId(null);
        setActiveRun(null);
        addNotification('error', failed.error || failed.message || 'Research failed.');
        qc.invalidateQueries({ queryKey: ['research-runs'] });
      }
    });

    return () => {
      socket.off('research:progress');
      socket.off('research:completed');
      socket.off('research:failed');
    };
  }, [trackingRunId, navigate, addNotification, setActiveRun, qc]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    mutation.mutate({
      query: query.trim(),
      supplemental: supplemental.trim() || undefined,
      filterTags: filterTags ? filterTags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    });
  };

  const currentStageIndex = progress
    ? WORKFLOW_STAGES.findIndex(s => s.id === progress.stage)
    : -1;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <FlaskConical className="text-accent" size={28} />
          <span className="text-gradient">Start Research</span>
        </h1>
        <p className="text-slate-400 mt-2 text-sm">
          Disciplined anomaly research with evidence-tiered reporting. Not a chatbot. Not a hallucination machine.
        </p>
      </div>

      {/* Research form */}
      <div className="card-glow p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="section-title block mb-2">Research Query</label>
            <textarea
              className="textarea min-h-28 text-base"
              placeholder="What is the relationship between mitochondrial dysfunction and cancer metabolism? What does mainstream oncology omit?"
              value={query}
              onChange={e => setQuery(e.target.value)}
              disabled={mutation.isPending || !!trackingRunId}
            />
            <p className="text-xs text-slate-500 mt-1">
              Be specific. Include what you suspect may be neglected or suppressed.
            </p>
          </div>

          {/* Supplemental toggle */}
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => setShowSupplemental(!showSupplemental)}
          >
            {showSupplemental ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Supplemental context / starting documents
          </button>

          {showSupplemental && (
            <div className="space-y-3 animate-in">
              <div>
                <label className="section-title block mb-2">Supplemental Context</label>
                <textarea
                  className="textarea min-h-24"
                  placeholder="Paste relevant text, abstracts, or context that should inform this research..."
                  value={supplemental}
                  onChange={e => setSupplemental(e.target.value)}
                  disabled={mutation.isPending || !!trackingRunId}
                />
              </div>
              <div>
                <label className="section-title block mb-2">Filter by Tags</label>
                <input
                  type="text"
                  className="input"
                  placeholder="biology, oncology, metabolism (comma-separated)"
                  value={filterTags}
                  onChange={e => setFilterTags(e.target.value)}
                  disabled={mutation.isPending || !!trackingRunId}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full py-3 text-base justify-center"
            disabled={!query.trim() || mutation.isPending || !!trackingRunId}
          >
            <Send size={16} />
            {mutation.isPending ? 'Queuing...' : trackingRunId ? 'Research Running...' : 'Run Research'}
          </button>
        </form>

        {/* Progress tracker */}
        {(progress || activeRun) && (
          <div className="border-t border-indigo-900/20 pt-5 space-y-4 animate-in">
            <div className="flex items-center justify-between">
              <span className="section-title">Research Pipeline</span>
              <span className="text-xs text-accent font-medium">
                {progress?.percent ?? 0}%
              </span>
            </div>

            {/* Stage indicators */}
            <div className="grid grid-cols-3 gap-2">
              {WORKFLOW_STAGES.map((stage, i) => {
                const done = i < currentStageIndex;
                const active = i === currentStageIndex;
                return (
                  <div
                    key={stage.id}
                    className={clsx(
                      'flex items-center gap-2 p-2 rounded-lg border text-xs transition-all',
                      done && 'border-green-800/40 bg-green-900/20 text-green-400',
                      active && 'border-accent/40 bg-accent/10 text-accent animate-pulse',
                      !done && !active && 'border-surface-100 bg-surface-200 text-slate-600'
                    )}
                  >
                    <stage.icon size={12} />
                    <span className="font-medium">{stage.label}</span>
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-surface-200 rounded-full overflow-hidden">
              <div
                className="progress-bar h-full transition-all duration-500"
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
            </div>

            <p className="text-sm text-slate-400">{progress?.message ?? 'Processing...'}</p>

            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setTraceOpen(v => !v)}
            >
              {traceOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              Live research trace ({traceEvents.length})
            </button>

            {traceOpen && (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-surface-100 bg-surface-200/60 p-3 space-y-2">
                {traceEvents.length === 0 && (
                  <p className="text-xs text-slate-500">No trace events yet.</p>
                )}
                {traceEvents.map((evt, idx) => (
                  <div key={`${evt.timestamp ?? 'no-ts'}-${evt.stage}-${evt.substep ?? 'none'}-${idx}`} className="text-xs border-b border-surface-100/50 pb-2">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>{evt.stage}</span>
                      <span>{evt.percent}%</span>
                    </div>
                    <p className="text-slate-400 mt-1">{evt.message}</p>
                    {(evt.detail || evt.substep || evt.chunkCount || evt.sourceCount) && (
                      <p className="text-slate-500 mt-1">
                        {formatTraceMeta(evt)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {failure && (
          <div className="border border-red-900/40 bg-red-950/30 rounded-lg p-4 space-y-1">
            <p className="text-sm text-red-300 font-medium">Run failed</p>
            <p className="text-xs text-red-200">Stage: {failure.stage || 'unknown'}</p>
            <p className="text-xs text-red-200">Reason: {failure.error || failure.message}</p>
            {failure.retryable && (
              <p className="text-xs text-amber-300">Retry hint: this failure appears retryable.</p>
            )}
          </div>
        )}
      </div>

      {/* Workflow explanation */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Research Governance Model</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {WORKFLOW_STAGES.map(stage => (
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

      {/* Recent runs */}
      {runs.length > 0 && (
        <div>
          <h2 className="section-title mb-3">Recent Research Runs</h2>
          <div className="space-y-2">
            {runs.slice(0, 5).map(run => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RunRow({ run }: { run: ResearchRun }) {
  const navigate = useNavigate();
  const [showError, setShowError] = useState(false);

  const STATUS_CONFIG = {
    queued: { icon: Clock, color: 'text-slate-400', label: 'Queued' },
    running: { icon: Zap, color: 'text-accent animate-pulse', label: 'Running' },
    completed: { icon: CheckCircle2, color: 'text-green-400', label: 'Completed' },
    failed: { icon: AlertCircle, color: 'text-red-400', label: 'Failed' },
    cancelled: { icon: AlertCircle, color: 'text-slate-500', label: 'Cancelled' },
  };

  const cfg = STATUS_CONFIG[run.status];
  const Icon = cfg.icon;

  return (
    <div className="card p-3 space-y-2">
      <div
        className="flex items-center justify-between hover:border-accent/30 cursor-pointer transition-all"
        onClick={() => run.status === 'completed' && navigate(`/reports`)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon size={14} className={cfg.color} />
          <div className="min-w-0">
            <p className="text-sm text-white truncate">{run.title}</p>
            <p className="text-xs text-slate-500">
              {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
        <span className={clsx('text-xs font-medium flex-shrink-0', cfg.color)}>{cfg.label}</span>
      </div>

      {run.status === 'failed' && (run.error_message || run.failed_stage) && (
        <div>
          <button
            type="button"
            className="text-xs text-red-300 hover:text-red-200"
            onClick={() => setShowError(v => !v)}
          >
            {showError ? 'Hide error details' : 'Show error details'}
          </button>
          {showError && (
            <p className="text-xs text-red-200 mt-1">
              {run.failed_stage ? `Stage: ${run.failed_stage} · ` : ''}
              {run.error_message || 'Unknown failure'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
