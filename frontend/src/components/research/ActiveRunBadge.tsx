import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, ChevronDown } from 'lucide-react';
import { getResearchRuns, type ResearchRun } from '../../utils/api';
import { getAdaptiveRefetchIntervalMs } from '../../utils/apiRateLimit';
import { isInFlightRunStatus } from '../../utils/researchRuns';
import { liveResearchUrl } from '../../utils/researchRunRoutes';
import { runDisplayTitle } from '../../utils/runDisplayTitle';

/**
 * What is running right now, and a way into each of it.
 *
 * TWO THINGS CHANGED HERE.
 *
 * 1. Where it points. It linked to `liveResearchUrl`, which used to build
 *    `/app/research?runId=…`; `ResearchPage` then redirected that to
 *    `/app/run/…` unless the link carried `#plan`. So the one control that
 *    existed for getting back to a run took two hops and landed somewhere that
 *    depended on the run's state. `liveResearchUrl` now names the workspace
 *    directly, so this component did not need to change to be fixed — which is
 *    the point of having a canonical builder.
 *
 * 2. How many runs it can represent. It read `activeRun` from the store, which
 *    is SINGULAR: `Layout` computed the full in-flight list, sorted it by
 *    priority, kept the top one and discarded the rest. With two runs going,
 *    one of them did not exist as far as the header was concerned. It now reads
 *    the same `['research-runs']` query Layout polls and filters that itself,
 *    so N runs are N rows and nothing is thrown away.
 *
 * The store's `activeRun` is still written — `Layout` uses it to tag bug
 * reports with a run id — but the header no longer depends on it, so the
 * singular assumption is out of the path that concurrency actually stresses.
 */
const EMPTY_RUNS: ResearchRun[] = [];

function stageLabel(run: ResearchRun): string {
  if (run.status === 'plan_pending_confirmation') return 'plan review';
  const stage = run.progress_stage || run.status || 'running';
  return stage.replace(/_/g, ' ');
}

function percentLabel(run: ResearchRun): string {
  return `${Math.max(0, Math.round(run.progress_percent ?? 0))}%`;
}

function isWarning(run: ResearchRun): boolean {
  return run.status === 'failed' || run.progress_stage === 'failed';
}

function isPlanReview(run: ResearchRun): boolean {
  return run.status === 'plan_pending_confirmation';
}

function hrefFor(run: ResearchRun): string {
  return liveResearchUrl(run.id, { focusPlan: isPlanReview(run) });
}

/** Plan review first — it is the only state that is BLOCKED on the user. */
function byUrgency(a: ResearchRun, b: ResearchRun): number {
  const rank = (r: ResearchRun) => (isPlanReview(r) ? 0 : r.status === 'running' ? 1 : 2);
  return rank(a) - rank(b);
}

function pillClasses(tone: 'warning' | 'plan' | 'normal'): string {
  const base = 'flex items-center gap-2 rounded-full border px-3 py-1 transition-colors';
  if (tone === 'warning') return `${base} border-amber-700/40 bg-amber-900/20 hover:border-amber-600/60`;
  if (tone === 'plan') return `${base} border-amber-700/35 bg-amber-950/30 hover:border-amber-600/50`;
  return `${base} border-accent/30 bg-accent/10 hover:border-accent/50`;
}

function toneFor(runs: ResearchRun[]): 'warning' | 'plan' | 'normal' {
  if (runs.some(isWarning)) return 'warning';
  if (runs.some(isPlanReview)) return 'plan';
  return 'normal';
}

function textClasses(tone: 'warning' | 'plan' | 'normal'): string {
  if (tone === 'warning') return 'text-xs font-medium text-amber-300';
  if (tone === 'plan') return 'text-xs font-medium text-amber-200';
  return 'text-xs font-medium text-accent';
}

export default function ActiveRunBadge() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: runs = EMPTY_RUNS } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    staleTime: 5_000,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(8_000),
  });

  const inFlight = runs.filter((r) => isInFlightRunStatus(r.status)).sort(byUrgency);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A run that finishes while the list is open should not leave a menu of
  // nothing hanging in the header.
  useEffect(() => {
    if (inFlight.length === 0) setOpen(false);
  }, [inFlight.length]);

  if (inFlight.length === 0) return null;

  const tone = toneFor(inFlight);

  if (inFlight.length === 1) {
    const only = inFlight[0];
    return (
      <Link to={hrefFor(only)} className={pillClasses(tone)} title="Open this run">
        {isWarning(only) ? (
          <AlertTriangle size={12} className="text-amber-400" aria-hidden />
        ) : (
          <Activity
            size={12}
            className={isPlanReview(only) ? 'text-amber-300' : 'text-accent animate-pulse'}
            aria-hidden
          />
        )}
        <span className={`${textClasses(tone)} max-w-48 truncate`}>
          {stageLabel(only)}: {percentLabel(only)}
        </span>
      </Link>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={pillClasses(tone)}
        title={`${inFlight.length} runs in progress`}
      >
        <Activity size={12} className="text-accent animate-pulse" aria-hidden />
        <span className={textClasses(tone)}>{inFlight.length} runs</span>
        <ChevronDown size={12} className="text-slate-400" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Runs in progress"
          className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-indigo-900/30 bg-surface-300 shadow-xl"
        >
          <ul className="max-h-80 overflow-y-auto py-1">
            {inFlight.map((run) => (
              <li key={run.id}>
                <Link
                  role="menuitem"
                  to={hrefFor(run)}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 hover:bg-surface-200/60"
                >
                  <div className="truncate text-xs font-medium text-slate-200">
                    {runDisplayTitle(run)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                    <span
                      className={
                        isPlanReview(run)
                          ? 'text-amber-300'
                          : isWarning(run)
                            ? 'text-amber-400'
                            : 'text-accent'
                      }
                    >
                      {stageLabel(run)}
                    </span>
                    <span>{percentLabel(run)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t border-indigo-900/30">
            <Link
              role="menuitem"
              to="/app/research"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-xs text-slate-300 hover:bg-surface-200/60"
            >
              New request
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
