/**
 * The run workspace — one research run, everything about it, at its own URL.
 *
 * Every request that is submitted leaves the entry page and proceeds here, so
 * `/app/research` is only ever a place to compose a new request and N
 * concurrent runs are N of these with no shared state.
 *
 * What this replaces, and why each piece went:
 *
 *  - `<h1>{run.query}</h1>` — the raw prompt as the page heading. Now
 *    `runDisplayTitle`, with the request itself in a collapsed disclosure.
 *  - its own `activities` state, an inline flat list, and
 *    `[progressToActivity(raw), ...prev].slice(0, 12)` — no hydration, no
 *    dedup, no ordering, no scroll container. Now `useRunTraceStream` plus
 *    `LiveResearchTraceLog`, which is what the request page always used.
 *    Both halves were needed: the renderer never deduped, so swapping only the
 *    renderer would have changed nothing.
 *  - `key={`${timestamp}-${stage}`}` inside `<AnimatePresence>` — not unique,
 *    so a collision left ghost children mounted that no state update could
 *    remove. Three duplicate emits rendered FIVE rows, and the DOM grew past
 *    the 12-item state cap. The whole list is gone.
 *  - `setTimeout(() => navigate('/app/dossiers'), 1500)` on completion — it
 *    yanked the reader off the page mid-sentence. Now a banner and a button.
 *    What the redirect protected was reachability of the report; the button
 *    preserves that without taking the page (Rule 44 T4).
 *  - `mapApiRunToVaultRun`, which hardcodes `sourcesRetrieved: 0`,
 *    `contradictionsDetected: 0` and `evidenceTier: 'supported'`. This page
 *    rendered that last one as a live "Source corroboration tier: SUPPORTED"
 *    badge — observed in production on a QUEUED run at 0% with zero sources
 *    retrieved. A confident claim about evidence quality that no evidence
 *    produced. This page now reads the API row directly and shows only facts
 *    the row actually carries.
 */
import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertCircle, Clock, FileText, Plus, XCircle } from 'lucide-react';
import { pipelineStages } from '@/content/researchoneUiData';
import LiveResearchTraceLog from '@/components/research/LiveResearchTraceLog';
import RunRequestDisclosure from '@/components/research/RunRequestDisclosure';
import RunPlanGate from '@/components/research/RunPlanGate';
import { useRunTraceStream } from '@/hooks/useRunTraceStream';
import { getResearchRuns, type ResearchRun } from '@/utils/api';
import { getAdaptiveRefetchIntervalMs } from '@/utils/apiRateLimit';
import { getSocket } from '@/utils/socket';
import { mapApiRunStage } from '@/lib/researchone/runMappers';
import { isReferenceTitle, runDisplayTitle } from '@/utils/runDisplayTitle';
import { RUN_TONE_CLASSES, resolveRunDisplayState } from '@/utils/runStatusDisplay';
import { isInFlightRunStatus } from '@/utils/researchRuns';
import {
  RESEARCH_PAGE_PATH,
  dossierReportUrlForRun,
  failedRunReportUrl,
} from '@/utils/researchRunRoutes';

const EMPTY_RUNS: ResearchRun[] = [];

function formatStarted(run: ResearchRun): string | null {
  const stamp = run.started_at || run.created_at;
  if (!stamp) return null;
  const d = new Date(stamp);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

export function LiveRunPanel() {
  const { runId } = useParams<{ runId: string }>();
  const queryClient = useQueryClient();

  const { run, traceEvents, latest, isLoading, isError } = useRunTraceStream(runId);

  // Other runs in flight, for the rail. The same query key Layout already
  // polls, so this shares its cache rather than adding a second poll.
  const { data: allRuns = EMPTY_RUNS } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    staleTime: 5_000,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(8_000),
  });

  const otherActiveRuns = useMemo(
    () => allRuns.filter((r) => r.id !== runId && isInFlightRunStatus(r.status)),
    [allRuns, runId]
  );

  // Completion refreshes the row in place. It does NOT navigate: the reader
  // stays wherever they are and reaches the report through the banner below.
  useEffect(() => {
    if (!runId) return;
    const socket = getSocket();
    const onCompleted = (result: { runId: string }) => {
      if (result?.runId !== runId) return;
      void queryClient.invalidateQueries({ queryKey: ['research-run', runId] });
      void queryClient.invalidateQueries({ queryKey: ['research-runs'] });
    };
    socket.on('research:completed', onCompleted);
    return () => {
      socket.off('research:completed', onCompleted);
    };
  }, [runId, queryClient]);

  if (!runId) {
    return (
      <div className="r1-panel p-8 text-center">
        <p className="text-r1-muted">No run selected.</p>
      </div>
    );
  }

  if (isError && !run) {
    return (
      <div className="r1-panel p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-r1-skeptic" />
        <p className="text-r1-muted">Unable to load this run.</p>
        <Link to={RESEARCH_PAGE_PATH} className="mt-4 inline-block text-sm text-r1-cyan hover:underline">
          Start a new request
        </Link>
      </div>
    );
  }

  if (isLoading || !run) {
    return (
      <div className="r1-panel p-8 text-center">
        <Clock className="mx-auto h-6 w-6 animate-spin text-r1-cyan" />
      </div>
    );
  }

  const display = resolveRunDisplayState({
    status: run.status,
    gateStatus: (run.failure_meta as Record<string, unknown> | undefined)?.gate_status as string | null,
  });
  const tone = RUN_TONE_CLASSES[display.tone];
  const title = runDisplayTitle(run);
  const titleIsReference = isReferenceTitle(run);
  const percent = Math.max(0, Math.min(100, Math.round(latest?.percent ?? run.progress_percent ?? 0)));
  const currentStage = mapApiRunStage(latest?.stage ?? run.progress_stage);
  const currentStageIndex = pipelineStages.findIndex((s) => s.id === currentStage);
  const isTerminal = !isInFlightRunStatus(run.status);
  const startedAt = formatStarted(run);

  return (
    <div className="bg-r1-canvas pb-12">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
        <RunWorkspaceRail runId={runId} otherActiveRuns={otherActiveRuns} />

        <div className="mb-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className={`r1-tag ${tone.chip}`}>
              {!isTerminal && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
              {display.label}
            </span>
            {run.run_ref && !titleIsReference && (
              <span className="r1-mono-label text-[10px] text-r1-dim">{run.run_ref}</span>
            )}
          </div>

          <h1
            className={
              titleIsReference
                ? 'r1-mono-label text-lg text-r1-heading'
                : 'text-lg font-semibold text-r1-heading sm:text-xl'
            }
          >
            {title}
          </h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <RunRequestDisclosure
              request={run.query}
              supplemental={run.supplemental}
              defaultOpen={run.status === 'queued'}
            />

            <RunPlanGate runId={runId} runStatus={run.status} engineVersion={run.engine_version} />

            {!isTerminal && run.status !== 'plan_pending_confirmation' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="r1-panel p-6"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="r1-mono-label text-[10px]">PIPELINE_PROGRESS</span>
                  <span className="text-lg font-semibold text-r1-cyan">{percent}%</span>
                </div>

                <div className="mb-6 h-2 overflow-hidden rounded-full bg-r1-panel-lift">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-r1-cyan to-r1-cyan/70"
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.5, ease: [0.25, 1, 0.5, 1] }}
                  />
                </div>

                <div className="grid grid-cols-5 gap-3 sm:grid-cols-10">
                  {pipelineStages.map((stage, index) => (
                    <div key={stage.id} className="text-center">
                      <div
                        className={`mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full font-mono text-[10px] ${
                          index < currentStageIndex
                            ? 'border border-r1-green/40 bg-r1-green/20 text-r1-green'
                            : index === currentStageIndex
                              ? 'r1-glow-cyan border border-r1-cyan/50 bg-r1-cyan/20 text-r1-cyan'
                              : 'border border-r1-border bg-r1-panel-lift text-r1-dim'
                        }`}
                      >
                        {index + 1}
                      </div>
                      <span className="r1-mono-label hidden text-[8px] sm:block">
                        {stage.name.split(' ')[0]}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            <div className="r1-panel p-4">
              <LiveResearchTraceLog
                traceEvents={traceEvents}
                scrollClassName="max-h-[32rem]"
                emptyMessage={
                  run.status === 'queued'
                    ? 'Queued. The trace starts as soon as a worker picks this run up.'
                    : 'Waiting for events…'
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="r1-panel p-6">
              <span className="r1-mono-label mb-4 block text-[10px]">RUN_STATUS</span>
              <dl className="space-y-3 text-sm">
                <Fact label="Status" value={<span className={tone.text}>{display.label}</span>} />
                <Fact label="Stage" value={currentStage.replace(/_/g, ' ')} />
                {!isTerminal && <Fact label="Progress" value={`${percent}%`} />}
                {startedAt && <Fact label="Started" value={startedAt} />}
                {run.run_ref && (
                  <Fact
                    label="Reference"
                    value={<span className="r1-mono-label text-[10px]">{run.run_ref}</span>}
                  />
                )}
              </dl>
            </div>

            <RunOutcomePanel run={run} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-r1-muted">{label}</dt>
      <dd className="text-right text-r1-text">{value}</dd>
    </div>
  );
}

/**
 * Moving between runs without going through Dossiers.
 *
 * The old page had no navigation at all: the header pill landed the user here
 * and there was no link back to the request page, to another run, or to the
 * report. Dossiers was the only way out, and only by using the sidebar.
 */
function RunWorkspaceRail({
  runId,
  otherActiveRuns,
}: {
  runId: string;
  otherActiveRuns: ResearchRun[];
}) {
  return (
    <nav aria-label="Run navigation" className="flex flex-wrap items-center gap-2 py-4">
      <Link
        to={RESEARCH_PAGE_PATH}
        className="inline-flex items-center gap-1.5 rounded border border-r1-border px-3 py-1.5 text-xs text-r1-muted transition-colors hover:border-r1-cyan/50 hover:text-r1-cyan r1-focus-ring"
      >
        <Plus className="h-3 w-3" aria-hidden />
        New request
      </Link>

      {otherActiveRuns.length > 0 && (
        <>
          <span className="r1-mono-label text-[10px] text-r1-dim">ALSO RUNNING</span>
          {otherActiveRuns.map((other) => (
            <Link
              key={other.id}
              to={`/app/run/${other.id}`}
              className="inline-flex max-w-[16rem] items-center gap-1.5 truncate rounded border border-r1-border px-3 py-1.5 text-xs text-r1-muted transition-colors hover:border-r1-cyan/50 hover:text-r1-cyan r1-focus-ring"
              title={runDisplayTitle(other)}
            >
              <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-r1-cyan" />
              <span className="truncate">{runDisplayTitle(other)}</span>
            </Link>
          ))}
        </>
      )}

      <span className="r1-mono-label ml-auto text-[10px] text-r1-dim">
        RUN {runId.slice(0, 8)}
      </span>
    </nav>
  );
}

/** What to do next, per terminal state. Never a bare spinner, never a redirect. */
function RunOutcomePanel({ run }: { run: ResearchRun }) {
  if (run.status === 'completed') {
    return (
      <div className="r1-panel border-emerald-500/30 p-4">
        <p className="mb-3 text-sm text-emerald-300">Report ready.</p>
        <Link
          to={dossierReportUrlForRun(run.id)}
          className="r1-focus-ring inline-flex w-full items-center justify-center gap-2 rounded bg-r1-cyan px-4 py-3 text-sm font-semibold text-r1-canvas transition-colors hover:bg-r1-cyan/90"
        >
          <FileText className="h-4 w-4" aria-hidden />
          Open report
        </Link>
      </div>
    );
  }

  if (run.status === 'failed' || run.status === 'aborted') {
    return (
      <div className="r1-panel border-r1-skeptic/30 p-4">
        <div className="flex items-start gap-2">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-r1-skeptic" aria-hidden />
          <p className="text-sm text-r1-skeptic">
            {run.error_message || 'This run did not finish.'}
          </p>
        </div>
        <Link
          to={failedRunReportUrl(run.id)}
          className="mt-3 inline-block text-sm text-r1-cyan hover:underline"
        >
          Open diagnostics
        </Link>
      </div>
    );
  }

  if (run.status === 'cancelled') {
    return (
      <div className="r1-panel p-4">
        <p className="text-sm text-r1-muted">This run was cancelled.</p>
        <Link
          to={RESEARCH_PAGE_PATH}
          className="mt-3 inline-block text-sm text-r1-cyan hover:underline"
        >
          Start a new request
        </Link>
      </div>
    );
  }

  return null;
}

export default LiveRunPanel;
