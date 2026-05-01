import { useRef, useCallback } from 'react';
import { Copy, CheckCircle2, AlertCircle, XCircle, Ban } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';
import type { ResearchRun, ResearchProgressEvent } from '../../utils/api';

// Shape emitted by the backend run:summary Socket.IO event and the
// orchestrator's final summary payload.
export interface RunSummaryData {
  runId: string;
  status: string;
  totalDurationMs: number;
  phaseDurations: Record<string, number>;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retryCount: number;
  failedStage?: string | null;
  errorMessage?: string | null;
  failureMeta?: Record<string, unknown> | null;
  orchestratorHints?: string[];
  modelUsage?: Array<{ role: string; model: string; promptTokens: number; completionTokens: number; durationMs: number }>;
}

interface Props {
  summary: RunSummaryData | null;
  run: ResearchRun | null;
  traceEvents: ResearchProgressEvent[];
  failure: { stage: string; message: string; error?: string; retryable?: boolean; terminal?: boolean; failureMeta?: Record<string, unknown> } | null;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

// Derive phase timings from trace events when no server-side summary is present.
function derivePhaseTimings(events: ResearchProgressEvent[]): Record<string, number> {
  const phases: Record<string, { start: number; end: number }> = {};
  for (const evt of events) {
    if (!evt.timestamp || !evt.stage) continue;
    const t = new Date(evt.timestamp).getTime();
    if (Number.isNaN(t)) continue;
    const stage = evt.stage;
    if (!phases[stage]) phases[stage] = { start: t, end: t };
    else {
      phases[stage].start = Math.min(phases[stage].start, t);
      phases[stage].end = Math.max(phases[stage].end, t);
    }
  }
  const result: Record<string, number> = {};
  for (const [stage, { start, end }] of Object.entries(phases)) {
    result[stage] = end - start;
  }
  return result;
}

function deriveTokenTotals(events: ResearchProgressEvent[]): { prompt: number; completion: number } {
  let prompt = 0;
  let completion = 0;
  for (const evt of events) {
    if (evt.tokenUsage) {
      prompt += evt.tokenUsage.prompt ?? 0;
      completion += evt.tokenUsage.completion ?? 0;
    }
  }
  return { prompt, completion };
}

function deriveRunDurationMs(run: ResearchRun | null, events: ResearchProgressEvent[]): number {
  if (run?.created_at) {
    const end =
      (run as unknown as Record<string, string>).completed_at ||
      (run as unknown as Record<string, string>).failed_at ||
      new Date().toISOString();
    const ms = new Date(end).getTime() - new Date(run.created_at).getTime();
    if (!Number.isNaN(ms) && ms > 0) return ms;
  }
  if (events.length >= 2) {
    const first = new Date(events[0].timestamp || '').getTime();
    const last = new Date(events[events.length - 1].timestamp || '').getTime();
    if (!Number.isNaN(first) && !Number.isNaN(last) && last > first) return last - first;
  }
  return 0;
}

export default function RunSummaryReport({ summary, run, traceEvents, failure }: Props) {
  const [copied, setCopied] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const status = summary?.status ?? run?.status ?? 'unknown';
  const totalDurationMs = summary?.totalDurationMs ?? deriveRunDurationMs(run, traceEvents);
  const phaseDurations = summary?.phaseDurations ?? derivePhaseTimings(traceEvents);
  const tokens = {
    prompt: summary?.totalPromptTokens ?? deriveTokenTotals(traceEvents).prompt,
    completion: summary?.totalCompletionTokens ?? deriveTokenTotals(traceEvents).completion,
  };
  const retryCount = summary?.retryCount ?? 0;
  const failedStage = summary?.failedStage ?? failure?.stage ?? run?.failed_stage ?? null;
  const errorMessage = summary?.errorMessage ?? failure?.error ?? failure?.message ?? run?.error_message ?? null;
  const fmeta = summary?.failureMeta ?? failure?.failureMeta ?? (run?.failure_meta as Record<string, unknown> | undefined) ?? null;
  const hints = summary?.orchestratorHints ?? (Array.isArray(fmeta?.orchestratorHints) ? fmeta.orchestratorHints as string[] : []);
  const modelUsage = summary?.modelUsage ?? [];

  const runId = summary?.runId ?? run?.id ?? 'unknown';
  const query = run?.title ?? '';
  const objective = (run as unknown as Record<string, string> | null)?.research_objective ?? '';
  const createdAt = run?.created_at ? new Date(run.created_at).toISOString() : '';

  // Build the full plain-text report string for clipboard copy.
  const buildPlainText = useCallback((): string => {
    const lines: string[] = [];
    const hr = '─'.repeat(72);
    lines.push('RESEARCH ONE 2 — RUN SUMMARY REPORT');
    lines.push(hr);
    lines.push(`Run ID       : ${runId}`);
    if (query) lines.push(`Query        : ${query}`);
    if (objective) lines.push(`Objective    : ${objective}`);
    if (createdAt) lines.push(`Started      : ${createdAt}`);
    lines.push(`Status       : ${status.toUpperCase()}`);
    lines.push(`Duration     : ${fmtMs(totalDurationMs)}`);
    lines.push(`Tokens       : ${fmtNum(tokens.prompt)} prompt  +  ${fmtNum(tokens.completion)} completion  =  ${fmtNum(tokens.prompt + tokens.completion)} total`);
    if (retryCount > 0) lines.push(`Retries      : ${retryCount}`);
    lines.push('');

    if (Object.keys(phaseDurations).length > 0) {
      lines.push('PHASE TIMINGS');
      lines.push(hr);
      for (const [phase, ms] of Object.entries(phaseDurations).sort(([, a], [, b]) => b - a)) {
        lines.push(`  ${phase.padEnd(32)} ${fmtMs(ms)}`);
      }
      lines.push('');
    }

    if (modelUsage.length > 0) {
      lines.push('MODEL USAGE PER ROLE');
      lines.push(hr);
      for (const u of modelUsage) {
        lines.push(`  ${u.role.padEnd(32)} ${u.model}`);
        lines.push(`  ${''.padEnd(32)} ${fmtNum(u.promptTokens)}p + ${fmtNum(u.completionTokens)}c tok  |  ${fmtMs(u.durationMs)}`);
      }
      lines.push('');
    }

    if (failedStage || errorMessage || fmeta) {
      lines.push('FAILURE DETAILS');
      lines.push(hr);
      if (failedStage) lines.push(`  Stage        : ${failedStage}`);
      if (errorMessage) lines.push(`  Error        : ${errorMessage}`);
      if (fmeta) {
        for (const [k, v] of Object.entries(fmeta)) {
          if (v == null || v === '') continue;
          lines.push(`  ${String(k).padEnd(15)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
        }
      }
      if (hints.length > 0) {
        lines.push('');
        lines.push('  Orchestrator hints:');
        for (const h of hints) lines.push(`    • ${h}`);
      }
      lines.push('');
    }

    if (traceEvents.length > 0) {
      lines.push('FULL EVENT TRACE');
      lines.push(hr);
      for (const evt of traceEvents) {
        const ts = evt.timestamp ? new Date(evt.timestamp).toISOString() : '';
        const tok = evt.tokenUsage ? `  [${evt.tokenUsage.prompt}p+${evt.tokenUsage.completion}c]` : '';
        const model = evt.model ? `  <${evt.model}>` : '';
        const substep = evt.substep ? `  (${evt.substep})` : '';
        lines.push(`${ts}  ${String(evt.percent).padStart(3)}%  ${evt.stage.padEnd(20)}  ${evt.message}${tok}${model}${substep}`);
        if (evt.failure?.errorMessage) lines.push(`  ERROR: ${evt.failure.errorMessage}`);
      }
      lines.push('');
    }

    lines.push(hr);
    lines.push(`Generated at : ${new Date().toISOString()}`);
    return lines.join('\n');
  }, [runId, query, objective, createdAt, status, totalDurationMs, tokens, retryCount, phaseDurations, modelUsage, failedStage, errorMessage, fmeta, hints, traceEvents]);

  const handleCopy = useCallback(async () => {
    const text = buildPlainText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: select the <pre> content
      const pre = reportRef.current?.querySelector('pre');
      if (pre) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pre);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [buildPlainText]);

  const StatusIcon =
    status === 'completed' ? CheckCircle2
    : status === 'aborted' ? XCircle
    : status === 'cancelled' ? Ban
    : AlertCircle;

  const statusColor =
    status === 'completed' ? 'text-green-400'
    : status === 'aborted' ? 'text-red-400'
    : status === 'cancelled' ? 'text-slate-400'
    : 'text-amber-400';

  const borderColor =
    status === 'completed' ? 'border-green-800/30'
    : status === 'aborted' ? 'border-red-800/30'
    : 'border-amber-700/30';

  return (
    <div className={clsx('rounded-lg border bg-surface-200/60 overflow-hidden', borderColor)} ref={reportRef}>
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100/30">
        <div className="flex items-center gap-2">
          <StatusIcon size={15} className={statusColor} />
          <span className="text-sm font-semibold text-white">Run summary</span>
          <span className={clsx('text-xs font-medium ml-1', statusColor)}>{status.toUpperCase()}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="btn-ghost text-xs flex items-center gap-1.5"
          title="Copy full report as plain text"
        >
          {copied ? <CheckCircle2 size={13} className="text-green-400" /> : <Copy size={13} />}
          {copied ? 'Copied!' : 'Copy full report'}
        </button>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-surface-100/20 border-b border-surface-100/20">
        {[
          { label: 'Duration', value: fmtMs(totalDurationMs) },
          { label: 'Prompt tokens', value: fmtNum(tokens.prompt) },
          { label: 'Completion tokens', value: fmtNum(tokens.completion) },
          { label: 'Retries', value: String(retryCount) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-200 px-4 py-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
            <div className="text-sm font-semibold text-white tabular-nums mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* Phase timing breakdown */}
      {Object.keys(phaseDurations).length > 0 && (
        <div className="px-4 py-3 border-b border-surface-100/20">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Phase timing</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
            {Object.entries(phaseDurations)
              .sort(([, a], [, b]) => b - a)
              .map(([phase, ms]) => (
                <div key={phase} className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 truncate">{phase.replace(/_/g, ' ')}</span>
                  <span className="text-slate-300 tabular-nums ml-2 flex-shrink-0">{fmtMs(ms)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Model usage */}
      {modelUsage.length > 0 && (
        <div className="px-4 py-3 border-b border-surface-100/20">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Model usage per role</div>
          <div className="space-y-1">
            {modelUsage.map((u) => (
              <div key={u.role} className="flex items-center gap-3 text-xs">
                <span className="text-slate-500 w-32 truncate flex-shrink-0">{u.role.replace(/_/g, ' ')}</span>
                <span className="text-indigo-400/80 truncate flex-1 min-w-0">{u.model}</span>
                <span className="text-slate-500 tabular-nums flex-shrink-0">
                  {fmtNum(u.promptTokens)}p+{fmtNum(u.completionTokens)}c
                </span>
                <span className="text-slate-600 tabular-nums flex-shrink-0">{fmtMs(u.durationMs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failure details */}
      {(failedStage || errorMessage || (hints.length > 0)) && (
        <div className="px-4 py-3 border-b border-surface-100/20 bg-red-950/10">
          <div className="text-[10px] uppercase tracking-wide text-red-400/70 mb-2">Failure details</div>
          {failedStage && (
            <p className="text-xs text-slate-400"><span className="text-slate-500">Stage:</span> {failedStage}</p>
          )}
          {errorMessage && (
            <p className="text-xs text-red-300 mt-1 leading-snug">{errorMessage}</p>
          )}
          {fmeta && Object.entries(fmeta).filter(([, v]) => v != null && v !== '').length > 0 && (
            <div className="mt-2 space-y-0.5">
              {Object.entries(fmeta)
                .filter(([, v]) => v != null && v !== '')
                .map(([k, v]) => (
                  <p key={k} className="text-[11px] text-slate-500 font-mono">
                    <span className="text-slate-600">{k}:</span>{' '}
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </p>
                ))}
            </div>
          )}
          {hints.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-200/80 list-disc pl-4">
              {hints.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Copyable plain-text block */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Copyable troubleshooting report</span>
          <button type="button" onClick={handleCopy} className="text-[11px] text-accent hover:underline">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="text-[10px] font-mono text-slate-400 bg-[#080a10] rounded border border-surface-100/20 p-3 overflow-x-auto whitespace-pre leading-5 max-h-64 overflow-y-auto select-all">
          {buildPlainText()}
        </pre>
      </div>
    </div>
  );
}
