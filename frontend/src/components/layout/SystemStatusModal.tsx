import { useEffect, useState } from 'react';
import axios from 'axios';
import clsx from 'clsx';
import { getRuntimeLogs, type RuntimeLogResponse, type SystemHealth } from '../../utils/api';

type LogStream = 'out' | 'err';

function formatCheckDetails(check: Record<string, unknown>): string {
  const { ok: _ok, ...rest } = check;
  const entries = Object.entries(rest).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
}

function healthErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    const msg = data?.error || data?.message || err.message;
    if (status) return `HTTP ${status}: ${msg}`;
    const code = err.code;
    if (code === 'ERR_NETWORK' || msg === 'Network Error') {
      return (
        'Network error (no response from the API). Typical causes: wrong or unreachable ' +
        'VITE_API_BASE_URL; an HTTPS page calling an HTTP API (blocked as mixed content); or ' +
        'CORS_ORIGINS on the backend missing this page’s origin (including preview URLs). ' +
        'Open DevTools → Network and inspect the failed request to /api/health.'
      );
    }
    return code ? `${code}: ${msg}` : msg;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

function runtimeLogsErrorMessage(err: unknown): string {
  let base = healthErrorMessage(err);
  if (axios.isAxiosError(err)) {
    const d = err.response?.data as { hint?: string; triedPaths?: string[] } | undefined;
    if (d?.hint) base += ` ${d.hint}`;
    if (d?.triedPaths?.length) base += ` Tried: ${d.triedPaths.join(', ')}`;
  }
  return base;
}

function downloadRuntimeLogTxt(content: string, stream: LogStream) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `researchone-runtime-${stream}-${stamp}.txt`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export interface SystemStatusModalProps {
  open: boolean;
  onClose: () => void;
  health: SystemHealth | undefined;
  healthLoading: boolean;
  healthError: Error | null;
  onRefreshHealth: () => void;
  onRestart: () => void;
  restartBusy: boolean;
}

export default function SystemStatusModal({
  open,
  onClose,
  health,
  healthLoading,
  healthError,
  onRefreshHealth,
  onRestart,
  restartBusy,
}: SystemStatusModalProps) {
  const [logStream, setLogStream] = useState<LogStream>('out');
  const [logState, setLogState] = useState<{
    loading: boolean;
    error: string | null;
    data: RuntimeLogResponse | null;
  }>({ loading: false, error: null, data: null });

  useEffect(() => {
    if (!open) return;
    onRefreshHealth();
  }, [open, onRefreshHealth]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const loadLogs = async () => {
    setLogState({ loading: true, error: null, data: null });
    try {
      const data = await getRuntimeLogs(undefined, { stream: logStream, lines: 500 });
      setLogState({ loading: false, error: null, data });
    } catch (err) {
      setLogState({
        loading: false,
        error: runtimeLogsErrorMessage(err),
        data: null,
      });
    }
  };

  const exportLoadedLogs = () => {
    if (!logState.data?.content?.length) return;
    downloadRuntimeLogTxt(logState.data.content, logStream);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-status-title"
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-indigo-900/40 bg-surface-300 shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-indigo-900/30 flex-shrink-0">
          <h2 id="system-status-title" className="text-sm font-semibold text-white">
            System status
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => onRefreshHealth()}>
              Refresh health
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          <section>
            <h3 className="section-title mb-2">Health checks</h3>
            {healthLoading && (
              <p className="text-xs text-slate-400">Loading health from API…</p>
            )}
            {!healthLoading && healthError && (
              <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-200 space-y-1">
                <p className="font-medium text-red-300">Could not reach the API health endpoint.</p>
                <p>{healthErrorMessage(healthError)}</p>
                <p className="text-slate-400">
                  Confirm VITE_API_BASE_URL and CORS_ORIGINS on the backend include this origin.
                </p>
              </div>
            )}
            {!healthLoading && !healthError && health && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">
                  Overall:{' '}
                  <span
                    className={clsx(
                      'font-medium',
                      health.status === 'ok' && 'text-green-400',
                      health.status === 'degraded' && 'text-amber-400',
                      health.status === 'down' && 'text-red-400'
                    )}
                  >
                    {health.status}
                  </span>
                  <span className="text-slate-600"> · </span>
                  {health.timestamp}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(health.checks).map(([name, check]) => (
                    <div
                      key={name}
                      className="bg-surface-200 rounded-lg px-3 py-2 text-xs border border-indigo-900/20"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400 font-medium">{name}</span>
                        <span className={check.ok ? 'text-green-400' : 'text-red-400'}>
                          {check.ok ? 'ok' : 'down'}
                        </span>
                      </div>
                      {formatCheckDetails(check as unknown as Record<string, unknown>) && (
                        <p className="text-slate-500 mt-1.5 break-words">
                          {formatCheckDetails(check as unknown as Record<string, unknown>)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {health.restartAvailable && (
                  <button
                    type="button"
                    className="btn-ghost text-xs mt-2"
                    disabled={restartBusy}
                    onClick={onRestart}
                  >
                    {restartBusy ? 'Restarting…' : 'Restart runtime'}
                  </button>
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="section-title mb-2">Runtime logs</h3>
            <p className="text-xs text-slate-500 mb-3">
              Tail of PM2 stdout/stderr. Requires an admin session (same ADMIN_USER_IDS gate as model overrides).
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="inline-flex rounded-md border border-indigo-900/30 p-0.5 bg-surface-200">
                <button
                  type="button"
                  className={clsx(
                    'px-3 py-1 text-xs rounded',
                    logStream === 'out' ? 'bg-accent/20 text-accent' : 'text-slate-400'
                  )}
                  onClick={() => {
                    setLogStream('out');
                    setLogState(s => ({ ...s, data: null, error: null }));
                  }}
                >
                  stdout
                </button>
                <button
                  type="button"
                  className={clsx(
                    'px-3 py-1 text-xs rounded',
                    logStream === 'err' ? 'bg-accent/20 text-accent' : 'text-slate-400'
                  )}
                  onClick={() => {
                    setLogStream('err');
                    setLogState(s => ({ ...s, data: null, error: null }));
                  }}
                >
                  stderr
                </button>
              </div>
              <button type="button" className="btn-primary text-xs py-1.5 px-3" onClick={loadLogs} disabled={logState.loading}>
                {logState.loading ? 'Loading…' : 'Load logs'}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={exportLoadedLogs}
                disabled={!logState.data?.content}
                title="Download the log text currently shown (same tail as on screen)"
              >
                Export logs to .txt
              </button>
            </div>
            {logState.error && (
              <p className="text-xs text-red-300 mb-2">{logState.error}</p>
            )}
            {logState.data?.truncated && (
              <p className="text-xs text-amber-300/90 mb-2">
                Showing last portion of log file (file larger than read window).
              </p>
            )}
            {logState.data && (
              <pre
                className="max-h-64 overflow-auto rounded-lg border border-indigo-900/30 bg-surface-400 p-3 text-[11px] leading-relaxed font-mono text-slate-300 whitespace-pre-wrap break-words"
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
              >
                {logState.data.content || '(empty)'}
              </pre>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
