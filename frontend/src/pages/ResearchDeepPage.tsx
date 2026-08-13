import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
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
  RotateCcw,
  CheckSquare,
  Square,
} from 'lucide-react';
import RunSummaryReport, { type RunSummaryData } from '../components/research/RunSummaryReport';
import LiveResearchTraceLog from '../components/research/LiveResearchTraceLog';
import LiveStatusBanner from '../components/research/LiveStatusBanner';
import ResearchRunFailureCard from '../components/research/ResearchRunFailureCard';
import PlanConfirmationPanel, { type PlanGateSnapshot } from '../components/research/PlanConfirmationPanel';
import AttachmentDropZone from '../components/research/AttachmentDropZone';
import SkepticPersonaSelector from '../components/research/SkepticPersonaSelector';
import {
  startResearch,
  getResearchRuns,
  getResearchRun,
  listSavedOrchestrationProfiles,
  getResearchV2EnsemblePresets,
  ResearchRun,
  ResearchProgressEvent,
  type ResearchObjective,
  CITATION_STYLE_OPTIONS,
  type CitationStyleSlug,
} from '../utils/api';
import {
  defaultObjectiveForTier,
  objectivesForTier,
  RESEARCH_OBJECTIVE_OPTIONS,
  type EntitlementTierKey,
} from '@/constants/researchObjectives';
import { getAdaptiveRefetchIntervalMs } from '../utils/apiRateLimit';
import FreeLifetimeQuotaBanner from '../components/billing/FreeLifetimeQuotaBanner';
import RunAddonToggles from '../components/research/RunAddonToggles';
import { useResearchRunAddons } from '../hooks/useResearchRunAddons';
import { RESEARCH_RUN_ADDON_CATALOG_KEYS } from '../utils/researchRunAddons';
import { BILLING_SUBSCRIPTION_QUERY_KEY, effectiveEntitlementTier, useBillingSubscriptionQuery } from '../hooks/useBillingSubscription';
import { PLAN_PREFERENCES_QUERY_KEY, usePlanPreferencesQuery } from '../hooks/usePlanPreferences';
import { formatFailureReason } from '../utils/researchFailureFormat';
import { classifyLiveStatus, deriveRunState } from '../utils/researchLiveStatus';
import { appendKeepingNewestAtBottom } from '../utils/traceEventWindow';
import { applySupplementalIngestNotifications } from '../utils/supplementalIngestNotifications';
import { dossierReportUrlForRun } from '../utils/researchRunRoutes';
import { supplementalUrlCrawlPayload } from '../utils/supplementalUrlCrawl';
import ResearchRunRow from '../components/research/ResearchRunRow';
import { useResearchRunTracking } from '../hooks/useResearchRunTracking';
import { useResearchShellOpenRun } from '../hooks/useResearchShellOpenRun';
import { deepResearchRequestFromRun, isLiveAttachedResearchRun } from '../utils/researchOpenRun';
import {
  mergeSupplementalWithSkepticPersona,
  splitSupplementalAndSkepticPersona,
} from '../utils/skepticPersonaSupplemental';
import { useResearchPageShell } from './ResearchPageContext';
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
  /** True when the run is in terminal `aborted` state — no further retries are possible. */
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


export default function ResearchDeepPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification, setActiveRun, activeRun } = useStore();
  const {
    embeddedInShell,
    shellMode,
    syncEngineForRun,
    queueRunHandoff,
    consumeRunHandoff,
  } = useResearchPageShell();
  const { data: subscriptionData, isLoading: subLoading, isError: subError, authReady } =
    useBillingSubscriptionQuery();

  const tierResolved =
    authReady && !subLoading && (!subError || Boolean(subscriptionData));
  const userTier: EntitlementTierKey | null = tierResolved
    ? ((effectiveEntitlementTier(subscriptionData) ?? 'free_demo') as EntitlementTierKey)
    : null;
  const planPrefsQuery = usePlanPreferencesQuery({ enabled: authReady && tierResolved });
  const tierAllowsSavedProfiles = Boolean(userTier && userTier !== 'free_demo');
  const filteredObjectiveOptions = objectivesForTier(userTier);

  const [query, setQuery] = useState('');
  const [supplemental, setSupplemental] = useState('');
  const [showSupplemental, setShowSupplemental] = useState(false);
  const [filterTags, setFilterTags] = useState('');
  // Supplemental files + URLs are ingested into the corpus on submit so the
  // models can review them as sources alongside the corpus search results.
  const [supplementalFiles, setSupplementalFiles] = useState<File[]>([]);
  const [supplementalUrls, setSupplementalUrls] = useState<string[]>([]);
  const [supplementalSiteCrawlEnabled, setSupplementalSiteCrawlEnabled] = useState(false);
  const [supplementalCrawlLayers, setSupplementalCrawlLayers] = useState(2);
  const [skepticPersona, setSkepticPersona] = useState('');
  const [researchObjective, setResearchObjective] = useState<ResearchObjective>('GENERAL_EPISTEMIC_RESEARCH');
  const [citationStyle, setCitationStyle] = useState<CitationStyleSlug>('apa');
  const [savedOrchestrationProfileId, setSavedOrchestrationProfileId] = useState('');
  // Target report length (words). Standard preset; user can switch to "Custom" to
  // enter an arbitrary value. The backend clamps to a safe range either way.
  const [reportLengthPreset, setReportLengthPreset] = useState<'short' | 'standard' | 'long' | 'extra_long' | 'custom'>('standard');
  // Stored as a string so a temporarily empty input (user clearing the field)
  // does not coerce to NaN inside a controlled <input type="number">. Parsed
  // and clamped only when computing `resolvedTargetWordCount`.
  const [reportLengthCustom, setReportLengthCustom] = useState<string>('2200');
  const [trackingRunId, setTrackingRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ResearchProgressEvent | null>(null);
  // Ref that always mirrors the most recently tracked run ID, including after
  // trackingRunId/progress are cleared on cancellation/completion. The
  // run:summary Socket.IO event may arrive after those state clears, so the
  // socket handler reads from this ref instead of the (potentially null) state.
  const lastKnownRunIdRef = useRef<string | null>(null);
  // Tracks whether a run:summary has been received so the REST fallback
  // (fired 800ms after failure) knows whether to build one from the DB row.
  const runSummaryReceivedRef = useRef(false);
  const [failure, setFailure] = useState<ResearchFailureEvent | null>(null);
  const [traceEvents, setTraceEvents] = useState<ResearchProgressEvent[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummaryData | null>(null);
  const traceScrollRef = useRef<HTMLDivElement>(null);
  /** Wave 5.1 — draft plan at the confirmation gate (socket + GET `/runs/:id/plan` refresh path). */
  const [planGateLocal, setPlanGateLocal] = useState<PlanGateSnapshot | null>(null);
  const [planGateBusy, setPlanGateBusy] = useState(false);
  const planGateRef = useRef<HTMLDivElement>(null);

  const { selectedAddons, selectedAddonsForSubmit, toggleAddon, syncAddonsToUrl } =
    useResearchRunAddons(RESEARCH_RUN_ADDON_CATALOG_KEYS);

  const [showModels, setShowModels] = useState(false);
  const [modelRows, setModelRows] = useState<
    Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }>
  >({});

  useEffect(() => {
    if (!tierResolved || !userTier) return;
    if (!filteredObjectiveOptions.some((o) => o.value === researchObjective)) {
      setResearchObjective(defaultObjectiveForTier(userTier));
    }
  }, [tierResolved, userTier, researchObjective, filteredObjectiveOptions]);

  const { data: ensembleData } = useQuery({
    queryKey: ['research-v2-ensemble-presets'],
    queryFn: getResearchV2EnsemblePresets,
    staleTime: 60000,
  });

  const { data: savedProfiles = [] } = useQuery({
    queryKey: ['saved-orchestration-profiles'],
    queryFn: () => listSavedOrchestrationProfiles().then((r) => r.profiles),
    enabled: tierAllowsSavedProfiles,
  });

  const { data: runs = [] } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    refetchInterval: () => getAdaptiveRefetchIntervalMs(8_000),
  });

  const trackedRun = runs.find((r) => r.id === trackingRunId);
  const trackedStatus = trackedRun?.status;
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

  const applyRequestFormFromRun = useCallback(
    (run: ResearchRun) => {
      setSkepticPersona('');
      const slice = deepResearchRequestFromRun(run);
      const { supplemental: supplementalBody, skepticPersona: personaFromRun } =
        splitSupplementalAndSkepticPersona(slice.supplemental);
      setQuery(slice.query);
      setSupplemental(supplementalBody);
      setSkepticPersona(personaFromRun);
      setSupplementalUrls(slice.supplementalUrlLines);
      setSupplementalSiteCrawlEnabled(false);
      setSupplementalCrawlLayers(2);
      setSupplementalFiles([]);
      setShowSupplemental(
        Boolean(supplementalBody.trim()) ||
          Boolean(personaFromRun.trim()) ||
          slice.supplementalUrlLines.length > 0
      );
      if (slice.researchObjective) setResearchObjective(slice.researchObjective);
      if (slice.citationStyle) setCitationStyle(slice.citationStyle);
      setFilterTags(slice.filterTags);

      const overrides = run.model_overrides as
        | Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }>
        | undefined;
      if (overrides && typeof overrides === 'object') {
        const rows: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> =
          {};
        for (const [role, row] of Object.entries(overrides)) {
          if (!row || typeof row !== 'object') continue;
          rows[role] = {
            primary: typeof row.primary === 'string' ? row.primary : undefined,
            fallback: typeof row.fallback === 'string' ? row.fallback : undefined,
            fallbackEnabled: row.fallbackEnabled === true,
          };
        }
        if (Object.keys(rows).length > 0) {
          setModelRows(rows);
          return;
        }
      }

      const objective = slice.researchObjective ?? researchObjective;
      const preset = ensembleData?.presets?.[objective];
      if (preset) {
        const rows: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> =
          {};
        for (const role of Object.keys(preset)) {
          const p = preset[role];
          rows[role] = { primary: p.primary, fallback: p.fallback, fallbackEnabled: false };
        }
        setModelRows(rows);
        return;
      }
      setModelRows({});
    },
    [ensembleData, researchObjective]
  );

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

  const { handleOpenRun } = useResearchShellOpenRun({
    embeddedInShell,
    shellMode,
    syncEngineForRun,
    queueRunHandoff,
    consumeRunHandoff,
    attachRun,
    detachTracking,
    applyRequestFormFromRun,
    addNotification,
  });

  const mutation = useMutation({
    mutationFn: startResearch,
    onSuccess: (data) => {
      setPlanGateLocal(null);
      const queuedEvt: ResearchProgressEvent = {
        runId: data.runId,
        stage: 'planning',
        percent: 0,
        message: 'Deep Research queued...',
        timestamp: new Date().toISOString(),
      };
      setProgress(queuedEvt);
      setActiveRun(queuedEvt);
      setTraceEvents([queuedEvt]);
      void attachRun({ runId: data.runId });
      applySupplementalIngestNotifications(data.supplementalIngest, addNotification, {
        researchLabel: 'Deep Research',
        defaultStartedMessage: 'Deep Research started — tracking detailed progress...',
      });
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      void qc.invalidateQueries({ queryKey: BILLING_SUBSCRIPTION_QUERY_KEY }, { cancelRefetch: false });
    },
    onError: (error) => {
      addNotification('error', extractStartResearchErrorMessage(error));
    },
  });

  // Mirror runSummary into a ref so async callbacks can read the current value
  // without being in the dependency array (avoids closure stale-capture).
  useEffect(() => {
    runSummaryReceivedRef.current = runSummary !== null;
  }, [runSummary]);

  // REST fallback: if a run fails but the run:summary socket event does not
  // arrive within 800 ms (e.g. tab was backgrounded, socket briefly disconnected),
  // fetch the run from the API and synthesise a summary from the DB row.
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
        // non-fatal: the run card already shows failure state
      }
    }, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [failure, trackingRunId]);

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
      setTraceEvents(sortEventsChronological(sorted.slice(-500)));
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
      setTraceEvents((prev) => sortEventsChronological(appendKeepingNewestAtBottom(prev, polledEvt, 500)));
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
      setPlanGateLocal(null);
      setPlanGateBusy(false);
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
        setTraceEvents((prev) => sortEventsChronological(appendKeepingNewestAtBottom(prev, update, 500)));
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
        setPlanGateLocal(null);
        setPlanGateBusy(false);
        setTrackingRunId(null);
        addNotification('success', 'Deep Research complete — report generated!');
        qc.invalidateQueries({ queryKey: ['reports'] });
        setTimeout(() => navigate(dossierReportUrlForRun(result.runId)), 1200);
      }
    });

    socket.on('research:failed', (failed: ResearchFailureEvent) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (failed.runId === trackingRunId) {
        const failureReason = formatFailureReason(failed.error || failed.message, failed.failureMeta);
        setPlanGateLocal(null);
        setPlanGateBusy(false);
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
        addNotification('error', failureReason || 'Deep Research failed.');
      }
    });

    socket.on('research:aborted', (failed: ResearchFailureEvent) => {
      qc.invalidateQueries({ queryKey: ['research-runs'] });
      if (failed.runId === trackingRunId) {
        const failureReason = formatFailureReason(failed.error || failed.message, failed.failureMeta);
        setPlanGateLocal(null);
        setPlanGateBusy(false);
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
        setPlanGateLocal(null);
        setPlanGateBusy(false);
        addNotification('info', 'Deep Research run cancelled — request loaded for editing.');
      }
    });

    socket.on('run:summary', (summary: RunSummaryData) => {
      // Use the ref rather than the closed-over state: trackingRunId and
      // progress may already be null (cleared on cancellation/completion)
      // by the time this event arrives. Set the ref synchronously before
      // setState so the REST fallback timer sees it immediately.
      if (summary.runId === lastKnownRunIdRef.current) {
        runSummaryReceivedRef.current = true;
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
  }, [trackingRunId, navigate, addNotification, setActiveRun, qc, runs, applyRequestFormFromRun, detachTracking]);

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

  const resolvedTargetWordCount = useMemo(() => {
    switch (reportLengthPreset) {
      case 'short': return 1200;
      case 'standard': return 2200;
      case 'long': return 4000;
      case 'extra_long': return 7000;
      case 'custom': {
        const parsed = Number(reportLengthCustom);
        const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : 2200;
        // Floor 800 matches backend (10 sections × 80-word per-section floor).
        return Math.max(800, Math.min(12000, Math.round(safe)));
      }
    }
  }, [reportLengthPreset, reportLengthCustom]);

  const runStatusForGate = trackedRun?.status ?? polledRun?.status;
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

  useEffect(() => {
    if (!showPlanGatePanel || !planGateRef.current) return;
    const hash = window.location.hash;
    if (hash === '#plan' || runStatusForGate === 'plan_pending_confirmation') {
      planGateRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showPlanGatePanel, runStatusForGate, planGateLocal?.planId]);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    syncAddonsToUrl();
    mutation.mutate({
      query: query.trim(),
      supplemental: mergeSupplementalWithSkepticPersona(supplemental, skepticPersona),
      filterTags: filterTags ? filterTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      modelOverrides: Object.keys(runtimeOverridesPayload).length > 0 ? runtimeOverridesPayload : undefined,
      engineVersion: 'v2',
      researchObjective,
      targetWordCount: resolvedTargetWordCount,
      supplementalFiles: supplementalFiles.length > 0 ? supplementalFiles : undefined,
      supplementalUrls: supplementalUrls.length > 0 ? supplementalUrls : undefined,
      supplementalUrlCrawl: supplementalUrlCrawlPayload(
        supplementalSiteCrawlEnabled,
        supplementalCrawlLayers
      ),
      citationStyle,
      ...(savedOrchestrationProfileId.trim()
        ? { savedOrchestrationProfileId: savedOrchestrationProfileId.trim() }
        : {}),
      addons: selectedAddonsForSubmit.length > 0 ? selectedAddonsForSubmit : undefined,
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

  // Expand to a wider container while a run is active so the dedicated trace
  // column has room to breathe. Reverts to the standard width once the run
  // settles into completed / failed / aborted state.
  const isActiveRun =
    Boolean(trackingRunId) ||
    Boolean(planGateLocal) ||
    (current?.percent != null && current.percent > 0 && current.percent < 100);

  return (
    <div
      className={clsx(
        'space-y-8 transition-[max-width] duration-300',
        embeddedInShell ? 'w-full' : clsx('mx-auto px-6 py-8', isActiveRun ? 'max-w-[1500px]' : 'max-w-5xl')
      )}
    >
      {!embeddedInShell && (
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <FlaskConical className="text-accent" size={28} />
            <span className="text-gradient">Deep Research</span>
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Frontier ensemble (V2 engine): source-corroboration-tiered reporting with full-stage telemetry.{' '}
            <Link to="/app/guide/research-v2" className="text-accent hover:underline">
              Research modes and capabilities
            </Link>
          </p>
        </div>
      )}

      <FreeLifetimeQuotaBanner variant="deep-research" />

      <div className="card-glow p-6 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="section-title block mb-2">Your research question or task</label>
            <textarea
              className="textarea min-h-28 text-base"
              placeholder="What is the relationship between mitochondrial dysfunction and cancer metabolism?"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={mutation.isPending || formLocked}
            />
            <p className="text-xs text-slate-500 mt-1">Describe what you need to know, find, or produce.</p>
          </div>

          <SkepticPersonaSelector
            value={skepticPersona}
            onChange={setSkepticPersona}
            disabled={mutation.isPending || formLocked}
          />

          <div>
            <label className="section-title block mb-2">Research objective</label>
            <select
              className="input w-full md:max-w-md"
              value={researchObjective}
              onChange={(e) => setResearchObjective(e.target.value as ResearchObjective)}
              disabled={mutation.isPending || formLocked}
            >
              {filteredObjectiveOptions.map((o) => (
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

          <div>
            <label className="section-title block mb-2">Report length</label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input md:max-w-xs"
                value={reportLengthPreset}
                onChange={(e) => setReportLengthPreset(e.target.value as typeof reportLengthPreset)}
                disabled={mutation.isPending || formLocked}
              >
                <option value="short">Short brief (~1,200 words)</option>
                <option value="standard">Standard report (~2,200 words)</option>
                <option value="long">Long-form (~4,000 words)</option>
                <option value="extra_long">Extra long (~7,000 words)</option>
                <option value="custom">Custom word count…</option>
              </select>
              {reportLengthPreset === 'custom' && (
                <input
                  type="number"
                  min={800}
                  max={12000}
                  step={100}
                  className="input w-32"
                  value={reportLengthCustom}
                  onChange={(e) => setReportLengthCustom(e.target.value)}
                  disabled={mutation.isPending || formLocked}
                />
              )}
              <span className="text-xs text-slate-500">
                Target: <span className="text-slate-300 font-mono">{resolvedTargetWordCount.toLocaleString()}</span> words
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              The synthesizer distributes this budget across sections (heavier weight on Reasoning and Retrieval). It is steered to use the budget on substance — citing specific sources — and to stop early rather than pad with filler.
            </p>
          </div>

          <div>
            <label className="section-title block mb-2">Citation style</label>
            <select
              className="input w-full md:max-w-md"
              value={citationStyle}
              onChange={(e) => setCitationStyle(e.target.value as CitationStyleSlug)}
              disabled={mutation.isPending || formLocked}
            >
              {CITATION_STYLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Preferred bibliography format for this run (used when generating academic exports).
            </p>
          </div>

          {tierResolved && tierAllowsSavedProfiles && (
            <div>
              <label className="section-title block mb-2" htmlFor="saved-orch-profile">
                Saved orchestration profile (optional)
              </label>
              <select
                id="saved-orch-profile"
                className="input w-full md:max-w-md"
                value={savedOrchestrationProfileId}
                onChange={(e) => setSavedOrchestrationProfileId(e.target.value)}
                disabled={mutation.isPending || formLocked}
              >
                <option value="">None — use query-only defaults</option>
                {savedProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isShared ? ' (shared)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Seeds the planner with your saved orchestration customizations; the confirmation gate still appears
                before retrieval runs.
              </p>
            </div>
          )}

          {tierResolved && userTier === 'free_demo' && (
            <p className="text-xs text-slate-500 rounded-lg border border-slate-800/80 bg-slate-900/30 px-3 py-2">
              Saved orchestration profiles are available on paid tiers. Free tier runs still use the same plan gate
              and frontier planner; upgrade to save and reuse profiles.
            </p>
          )}

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
              <AttachmentDropZone
                files={supplementalFiles}
                urls={supplementalUrls}
                onChange={({ files, urls }) => {
                  setSupplementalFiles(files);
                  setSupplementalUrls(urls);
                }}
                siteCrawlEnabled={supplementalSiteCrawlEnabled}
                crawlLayers={supplementalCrawlLayers}
                onSiteCrawlChange={({ enabled, crawlLayers }) => {
                  setSupplementalSiteCrawlEnabled(enabled);
                  setSupplementalCrawlLayers(crawlLayers);
                }}
                disabled={mutation.isPending || formLocked}
                label="Supplemental files and URLs (ingested into corpus)"
                description="Drop research papers, dossiers, or links the models should review. Each item is queued onto the same ingestion pipeline as manual corpus uploads, so the discovery + retrieval stages can pull from them."
              />
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
            {showModels ? 'Hide model ensemble' : 'Show model ensemble'}
          </button>

          {showModels && ensembleData?.presets?.[researchObjective] && (
            <div className="rounded-lg border border-indigo-900/30 bg-surface-200 p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  Defaults for <span className="text-slate-300">{RESEARCH_OBJECTIVE_OPTIONS.find((o) => o.value === researchObjective)?.label ?? researchObjective}</span>. Edits apply to this run only.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost text-xs flex items-center gap-1 border border-accent/30 text-accent px-2 py-1 rounded-lg"
                    disabled={mutation.isPending || formLocked}
                    title="Turn on the per-role fallback opt-in for every role at once."
                    onClick={() => {
                      const preset = ensembleData.presets[researchObjective];
                      setModelRows((prev) => {
                        const next: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> = { ...prev };
                        for (const role of Object.keys(preset)) {
                          const p = preset[role];
                          // Preserve any user-edited primary/fallback strings;
                          // only flip the per-role fallbackEnabled flag.
                          // Populate fallback from the preset if the field is
                          // currently empty so the run actually has a fallback
                          // model id to use.
                          next[role] = {
                            ...next[role],
                            primary: next[role]?.primary ?? p.primary,
                            fallback: next[role]?.fallback?.trim() ? next[role].fallback : p.fallback,
                            fallbackEnabled: true,
                          };
                        }
                        return next;
                      });
                    }}
                  >
                    <CheckSquare size={14} />
                    Select all fallbacks
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs flex items-center gap-1"
                    disabled={mutation.isPending || formLocked}
                    title="Turn off the per-role fallback opt-in for every role at once."
                    onClick={() => {
                      setModelRows((prev) => {
                        const next: Record<string, { primary?: string; fallback?: string; fallbackEnabled?: boolean }> = {};
                        for (const role of Object.keys(prev)) {
                          next[role] = { ...prev[role], fallbackEnabled: false };
                        }
                        return next;
                      });
                    }}
                  >
                    <Square size={14} />
                    Clear all
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs flex items-center gap-1"
                    disabled={mutation.isPending || formLocked}
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
                        disabled={mutation.isPending || formLocked}
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
                          disabled={mutation.isPending || formLocked}
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
                            disabled={mutation.isPending || formLocked}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <RunAddonToggles
            selected={selectedAddons}
            onToggle={toggleAddon}
            disabled={mutation.isPending || formLocked}
          />

          <button type="submit" className="btn-primary w-full py-3 text-base justify-center" disabled={!query.trim() || mutation.isPending || formLocked}>
            <Send size={16} />
            {mutation.isPending
              ? 'Queuing...'
              : trackingRunId
                ? trackedRunLiveStatus === 'plan_pending_confirmation'
                  ? 'Review plan below…'
                  : 'Deep Research running...'
                : 'Run Deep Research'}
          </button>
        </form>

        {(progress || activeRun || trackingRunId) && (
          <div className="border-t border-indigo-900/20 pt-5 animate-in lg:grid lg:grid-cols-5 lg:gap-6 space-y-4 lg:space-y-0">
            <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <span className="section-title">Deep Research pipeline</span>
              <span className={hasWarning ? 'text-xs text-amber-300 font-medium' : 'text-xs text-accent font-medium'}>
                {current?.percent ?? 0}%
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
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
              planGateAwaiting={planGateAwaitingForBanner}
            />
            {showPlanGatePanel && (
              <div ref={planGateRef} id="plan">
                {planGateLocal && planGateLocal.runId === trackingRunId ? (
                  <PlanConfirmationPanel
                    snapshot={planGateLocal}
                    busy={planGateBusy}
                    onBusy={setPlanGateBusy}
                    planPrefs={planPrefsQuery.data}
                    tierAllowsSavedProfiles={tierAllowsSavedProfiles}
                    onInvalidatePlanPrefs={() =>
                      void qc.invalidateQueries({ queryKey: PLAN_PREFERENCES_QUERY_KEY })
                    }
                    onInvalidateSavedProfiles={() =>
                      void qc.invalidateQueries({ queryKey: ['saved-orchestration-profiles'] })
                    }
                    onAfterConfirm={() => {
                      setPlanGateLocal(null);
                      setPlanGateBusy(false);
                      void qc.invalidateQueries({ queryKey: ['research-runs'] });
                      void qc.invalidateQueries(
                        { queryKey: ['research-run', trackingRunId] },
                        { cancelRefetch: false }
                      );
                      void qc.invalidateQueries(
                        { queryKey: PLAN_PREFERENCES_QUERY_KEY },
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
          <RunSummaryReport
            summary={runSummary}
            run={trackedRun ?? null}
            plan={(polledRun?.plan as Record<string, unknown> | null | undefined) ?? null}
            traceEvents={traceEvents}
            failure={failure}
          />
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Deep Research governance model</h2>
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
