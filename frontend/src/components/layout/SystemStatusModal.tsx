import { useEffect, useState } from 'react';
import axios from 'axios';
import clsx from 'clsx';
import { getRuntimeLogs, type RuntimeLogResponse, type SystemHealth } from '../../utils/api';

type LogStream = 'out' | 'err';

function formatCheckDetails(check: Record<string, unknown>): string {
  const { ok: _ok, ...rest } = check;
  const entries = Object.entries(rest).filter(([, value]) => value !== undefined && value !== '');
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

function healthErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    const message = data?.error || data?.message || err.message;
    return status ? `HTTP ${status}: ${message}` : message;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

function runtimeLogsErrorMessage(err: unknown): string {
  let base = healthErrorMessage(err);
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { hint?: string; triedPaths?: string[] } | undefined;
    if (data?.hint) base += ` ${data.hint}`;
    if (data?.triedPaths?.length) base += ` Tried: ${data.triedPaths.join(', ')}`;
  }
  return base;
}

function downloadRuntimeLogTxt(content: string, stream: LogStream) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `researchone-runtime-${stream}-${stamp}.txt`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
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
  /** Clerk session is in ADMIN_USER_IDS — only these users receive operations controls. */
  isAllowlistedAdmin: boolean;
}

function PublicOperationalStatus({
  health,
  healthLoading,
  healthError,
}: Pick<SystemStatusModalProps, 'health' | 'healthLoading' | 'healthError'>) {
  const status = healthError ? 'down' : health?.status;
  const statusCopy =
    status === 'ok'
      ? 'All systems operational'
      : status === 'degraded'
        ? 'Some services are experiencing delays'
        : status === 'down'
          ? 'Service disruption detected'
          : 'Checking system availability';

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-6 text-center">
      <span
        className={clsx(
          'mx-auto mb-4 block h-2.5 w-2.5 rounded-full',
          healthLoading && 'animate-pulse bg-r1-muted',
          !healthLoading && status === 'ok' && 'bg-r1-green',
          !healthLoading && status === 'degraded' && 'bg-r1-amber',
          !healthLoading && status === 'down' && 'bg-r1-challenge',
          !healthLoading && !status && 'bg-r1-muted',
        )}
        aria-hidden
      />
      <h3 className="text-base font-semibold text-r1-heading">{statusCopy}</h3>
      <p className="mt-2 text-sm text-r1-muted">
        {status === 'ok'
          ? 'ResearchOne is available.'
          : 'The team has access to the technical diagnostics needed to investigate.'}
      </p>
    </section>
  );
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
  isAllowlistedAdmin,
}: SystemStatusModalProps) {
  const [logStream, setLogStream] = useState<LogStream>('out');
  const [logState, setLogState] = useState<{
    loading: boolean;
    error: string | null;
    data: RuntimeLogResponse | null;
  }>({ loading: false, error: null, data: null });

  useEffect(() => {
    if (open) onRefreshHealth();
  }, [open, onRefreshHealth]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const loadLogs = async () => {
    if (!isAllowlistedAdmin) return;
    setLogState({ loading: true, error: null, data: null });
    try {
      const data = await getRuntimeLogs(undefined, { stream: logStream, lines: 500 });
      setLogState({ loading: false, error: null, data });
    } catch (err) {
      setLogState({ loading: false, error: runtimeLogsErrorMessage(err), data: null });
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-status-title"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/10 bg-r1-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 id="system-status-title" className="text-sm font-semibold text-r1-heading">
            System status
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onRefreshHealth}>
              Refresh
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!isAllowlistedAdmin ? (
            <PublicOperationalStatus
              health={health}
              healthLoading={healthLoading}
              healthError={healthError}
            />
          ) : (
            <>
              <section>
                <h3 className="section-title mb-2">Health checks</h3>
                {healthLoading && <p className="text-xs text-r1-muted">Loading health from API…</p>}
                {!healthLoading && healthError && (
                  <div className="rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-200">
                    <p className="font-medium text-red-300">Could not reach the API health endpoint.</p>
                    <p className="mt-1">{healthErrorMessage(healthError)}</p>
                  </div>
                )}
                {!healthLoading && !healthError && health && (
                  <div className="space-y-2">
                    <p className="text-xs text-r1-muted">
                      Overall: <span className="font-medium text-r1-heading">{health.status}</span> · {health.timestamp}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {Object.entries(health.checks ?? {}).map(([name, check]) => {
                        const details = formatCheckDetails(check as unknown as Record<string, unknown>);
                        return (
                          <div key={name} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-r1-muted">{name}</span>
                              <span className={check.ok ? 'text-r1-green' : 'text-r1-challenge'}>
                                {check.ok ? 'ok' : 'down'}
                              </span>
                            </div>
                            {details && <p className="mt-1.5 break-words text-r1-dim">{details}</p>}
                          </div>
                        );
                      })}
                    </div>
                    {health.restartAvailable && (
                      <button type="button" className="btn-ghost mt-2 text-xs" disabled={restartBusy} onClick={onRestart}>
                        {restartBusy ? 'Restarting…' : 'Restart runtime'}
                      </button>
                    )}
                  </div>
                )}
              </section>

              <section>
                <h3 className="section-title mb-2">Runtime logs</h3>
                <p className="mb-3 text-xs text-r1-muted">Operator-only PM2 stdout and stderr.</p>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-md border border-white/10 bg-black/20 p-0.5">
                    {(['out', 'err'] as const).map((stream) => (
                      <button
                        key={stream}
                        type="button"
                        className={clsx(
                          'rounded px-3 py-1 text-xs',
                          logStream === stream ? 'bg-r1-cyan/15 text-r1-cyan' : 'text-r1-muted',
                        )}
                        onClick={() => {
                          setLogStream(stream);
                          setLogState((current) => ({ ...current, data: null, error: null }));
                        }}
                      >
                        std{stream}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={loadLogs} disabled={logState.loading}>
                    {logState.loading ? 'Loading…' : 'Load logs'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => logState.data?.content && downloadRuntimeLogTxt(logState.data.content, logStream)}
                    disabled={!logState.data?.content}
                  >
                    Export logs to .txt
                  </button>
                </div>
                {logState.error && <p className="mb-2 text-xs text-red-300">{logState.error}</p>}
                {logState.data?.truncated && (
                  <p className="mb-2 text-xs text-r1-amber">Showing the latest portion of the log file.</p>
                )}
                {logState.data && (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-r1-muted">
                    {logState.data.content || '(empty)'}
                  </pre>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
