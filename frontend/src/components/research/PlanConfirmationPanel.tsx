import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { BookmarkPlus, ChevronDown, ChevronUp, ClipboardCheck, HelpCircle, Loader2, MessageSquareText, XCircle } from 'lucide-react';
import { INTENT_DISPLAY_LABELS, INTENT_SHORT_DESCRIPTIONS } from '../../lib/intents';
import {
  buildIntentOverrideRefineInstruction,
  HOW_RESEARCHONE_THINKS_SHORT,
  INTENT_HELP_TEXT,
  INTENT_OVERRIDE_OPTIONS,
  POSTURE_FAMILIES,
  resolvePostureFamily,
} from '../../content/howResearchOneThinks';
import ResearchBriefPreview from './ResearchBriefPreview';
import {
  cancelRunPlanAtGate,
  confirmRunPlanAtGate,
  createSavedOrchestrationProfile,
  extractApiError,
  refineRunPlanAtGate,
} from '../../utils/api';
import {
  PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT,
  readPlanIntentConfidence,
  readTopicCompetenceAssessment,
  shouldStartPlanAutoConfirmCountdown,
  type PlanAutoConfirmPrefsSlice,
} from '../../utils/planAutoConfirm';

export interface PlanGateSnapshot {
  runId: string;
  planId: string;
  planPayload: Record<string, unknown>;
  refinementRounds: number;
}

function readIntentId(payload: Record<string, unknown>): string {
  const intent = payload.intent as Record<string, unknown> | undefined;
  const id = intent?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : 'legacy';
}

/** Human labels for skeptic / steelman modes from orchestration profile. */
function readEpistemicPosture(payload: Record<string, unknown>): {
  skepticLabel: string;
  steelmanLabel: string;
  profileName: string | null;
  skepticMode: string;
  steelmanMode: string;
} {
  const profile =
    (payload.orchestrationProfile as Record<string, unknown> | undefined) ??
    (payload.orchestration_profile as Record<string, unknown> | undefined) ??
    {};

  const skepticRaw = (profile.skepticMode ?? profile.skeptic_mode ?? 'off') as string;
  const steelmanRaw = (profile.steelmanMode ?? profile.steelman_mode ?? 'off') as string;
  const addons = Array.isArray(payload.addons) ? payload.addons : [];
  const hasAdversarialTwin = addons.includes('adversarial_twin');
  const effectiveSkepticRaw = skepticRaw === 'off' && hasAdversarialTwin ? 'gate' : skepticRaw;
  const displayName =
   typeof profile.name === 'string'
     ? profile.name
     : typeof profile.displayName === 'string'
       ? profile.displayName
       : typeof profile.display_name === 'string'
         ? profile.display_name
         : null;

  const skepticMap: Record<string, string> = {
    off: 'Off (no dedicated challenge pass)',
    annotate: 'Annotate (sidebar challenges)',
    gate: 'Gate (challenge before synthesis)',
  };
  const steelmanMap: Record<string, string> = {
    off: 'Off',
    standard: 'Standard',
    per_option: 'Per-option',
    as_product: 'As product (position brief)',
    symmetric: 'Symmetric (strongest case + counter)',
  };

  return {
    skepticLabel: skepticMap[effectiveSkepticRaw] ?? effectiveSkepticRaw,
    steelmanLabel: steelmanMap[steelmanRaw] ?? steelmanRaw,
    profileName: displayName,
    skepticMode: effectiveSkepticRaw,
    steelmanMode: steelmanRaw,
  };
}

const AUTO_CONFIRM_SECONDS = 5;

export default function PlanConfirmationPanel({
  snapshot,
  busy,
  onBusy,
  onAfterConfirm,
  onAfterCancel,
  onNotify,
  onGatePlanMutated,
  planPrefs,
  tierAllowsSavedProfiles,
  onInvalidateSavedProfiles,
  onInvalidatePlanPrefs,
}: {
  snapshot: PlanGateSnapshot;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onAfterConfirm: () => void;
  onAfterCancel: () => void;
  /** `onNotify('error'|'info'|'success', msg)` — severity matches notification channel. */
  onNotify: (kind: 'error' | 'info' | 'success', message: string) => void;
  /** Optional: invalidate runs / dossier queries after a successful refinement. */
  onGatePlanMutated?: () => void;
  /** Resolved account prefs; `undefined` while loading disables auto-confirm countdown. */
  planPrefs?: PlanAutoConfirmPrefsSlice | null;
  tierAllowsSavedProfiles?: boolean;
  onInvalidateSavedProfiles?: () => void;
  onInvalidatePlanPrefs?: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [localPayload, setLocalPayload] = useState(snapshot.planPayload);
  const [localPlanId, setLocalPlanId] = useState(snapshot.planId);
  const [rounds, setRounds] = useState(snapshot.refinementRounds);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [secLeft, setSecLeft] = useState<number | null>(null);
  const [countdownPaused, setCountdownPaused] = useState(false);
  const [howItThinksOpen, setHowItThinksOpen] = useState(false);
  const [intentOverrideId, setIntentOverrideId] = useState('');
  const [intentOverrideBusy, setIntentOverrideBusy] = useState(false);
  const pauseRef = useRef(false);
  const firedRef = useRef(false);
  const countdownCbRef = useRef({
    onBusy,
    onAfterConfirm,
    onInvalidatePlanPrefs,
    onNotify,
    runId: snapshot.runId,
    planId: localPlanId,
  });

  useEffect(() => {
    pauseRef.current = countdownPaused;
  }, [countdownPaused]);

  useEffect(() => {
    setLocalPayload(snapshot.planPayload);
    setLocalPlanId(snapshot.planId);
    setRounds(snapshot.refinementRounds);
  }, [snapshot.planId, snapshot.refinementRounds, snapshot.planPayload]);

  const intentKey = readIntentId(localPayload);
  const intentLabel = INTENT_DISPLAY_LABELS[intentKey] ?? intentKey.replace(/_/g, ' ');
  const intentDesc = INTENT_SHORT_DESCRIPTIONS[intentKey] ?? '';
  const intentHelpText = INTENT_HELP_TEXT[intentKey] ?? '';
  const intentConfidence = readPlanIntentConfidence(localPayload);
  const competenceText = readTopicCompetenceAssessment(localPayload);
  const posture = readEpistemicPosture(localPayload);
  const postureFamily = resolvePostureFamily({
    skepticMode: posture.skepticMode,
    steelmanMode: posture.steelmanMode,
    intentId: intentKey,
  });
  const postureFamilyDef = POSTURE_FAMILIES.find((p) => p.id === postureFamily.id) ?? postureFamily;

  const autoConfirmActive =
    planPrefs != null && shouldStartPlanAutoConfirmCountdown(planPrefs, localPayload, rounds);

  countdownCbRef.current = {
    onBusy,
    onAfterConfirm,
    onInvalidatePlanPrefs,
    onNotify,
    runId: snapshot.runId,
    planId: localPlanId,
  };

  useEffect(() => {
    pauseRef.current = false;
    setCountdownPaused(false);
  }, [autoConfirmActive, snapshot.planId]);

  useEffect(() => {
    firedRef.current = false;
    if (!autoConfirmActive || busy) {
      setSecLeft(null);
      return;
    }
    setSecLeft(AUTO_CONFIRM_SECONDS);
    const id = window.setInterval(() => {
      if (pauseRef.current || firedRef.current) return;
      setSecLeft((s) => {
        if (s == null || s <= 0) return s;
        if (s <= 1) {
          if (!firedRef.current) {
            firedRef.current = true;
            const c = countdownCbRef.current;
            void (async () => {
              c.onBusy(true);
              try {
                await confirmRunPlanAtGate(c.runId, c.planId);
                c.onInvalidatePlanPrefs?.();
                c.onAfterConfirm();
                c.onNotify('success', 'Plan auto-confirmed — resuming the research pipeline.');
              } catch (e) {
                c.onNotify('error', extractApiError(e));
              } finally {
                c.onBusy(false);
              }
            })();
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [autoConfirmActive, busy, snapshot.planId, localPlanId]);

  const markInteraction = () => {
    if (autoConfirmActive && secLeft != null && secLeft > 0) {
      pauseRef.current = true;
      setCountdownPaused(true);
    }
  };

  const handleRefine = async () => {
    const text = instruction.trim();
    if (!text) {
      onNotify('info', 'Describe how you want the plan to change before refining.');
      return;
    }
    onBusy(true);
    try {
      const res = await refineRunPlanAtGate(snapshot.runId, text);
      setLocalPayload(res.revisedPlan);
      setLocalPlanId(res.planId);
      setRounds(res.refinementRounds);
      setInstruction('');
      onGatePlanMutated?.();
      onNotify('success', 'Plan updated from your refinement.');
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      onBusy(false);
    }
  };

  const handleIntentOverride = async () => {
    const targetId = intentOverrideId.trim();
    if (!targetId) return;
    const option = INTENT_OVERRIDE_OPTIONS.find((o) => o.id === targetId);
    if (!option) return;
    setIntentOverrideBusy(true);
    onBusy(true);
    try {
      const refineText = buildIntentOverrideRefineInstruction(option.id, option.label);
      const res = await refineRunPlanAtGate(snapshot.runId, refineText);
      const returnedIntentId = readIntentId(res.revisedPlan);
      setLocalPayload(res.revisedPlan);
      setLocalPlanId(res.planId);
      setRounds(res.refinementRounds);
      if (returnedIntentId === option.id) {
        setIntentOverrideId('');
        onGatePlanMutated?.();
        onNotify('success', `Plan re-routed to "${option.label}".`);
      } else {
        // Keep select populated so the user can retry; do not fire gate-mutated.
        onNotify('error', 'The plan could not be re-routed to the selected goal. Please review the updated plan and try again.');
      }
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      setIntentOverrideBusy(false);
      onBusy(false);
    }
  };

  const handleConfirm = async () => {
    firedRef.current = true;
    onBusy(true);
    try {
      await confirmRunPlanAtGate(snapshot.runId, localPlanId);
      onInvalidatePlanPrefs?.();
      onAfterConfirm();
      onNotify('success', 'Plan confirmed — resuming the research pipeline.');
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      onBusy(false);
    }
  };

  const handleCancel = async () => {
    firedRef.current = true;
    onBusy(true);
    try {
      await cancelRunPlanAtGate(snapshot.runId);
      onAfterCancel();
      onNotify('info', 'Research run cancelled at the plan gate.');
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      onBusy(false);
    }
  };

  const handleSaveProfile = async () => {
    const name = saveName.trim();
    if (!name) {
      onNotify('info', 'Enter a name for this profile.');
      return;
    }
    setSaveBusy(true);
    try {
      await createSavedOrchestrationProfile({
        name,
        baseIntent: intentKey,
        customizations: {
          intent: localPayload.intent,
          orchestrationProfile: localPayload.orchestrationProfile,
          sourceStrategy: localPayload.sourceStrategy,
          outputShape: localPayload.outputShape,
          topicAnalysis: localPayload.topicAnalysis,
        },
      });
      setSaveOpen(false);
      setSaveName('');
      onInvalidateSavedProfiles?.();
      onNotify('success', 'Profile saved — select it before your next run on Deep Research.');
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const topic = (localPayload.topicAnalysis as Record<string, unknown> | undefined)?.summary;
  const topicStr = typeof topic === 'string' ? topic : '';

  const showStreakHint =
    planPrefs &&
    !planPrefs.autoConfirmEnabled &&
    planPrefs.confirmedStreak >= PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT;

  const confidenceBadge =
    intentConfidence == null
      ? { label: 'Confidence unknown', cls: 'text-slate-400 border-slate-600' }
      : intentConfidence >= 0.85
        ? { label: 'High confidence', cls: 'text-emerald-300 border-emerald-700/50' }
        : intentConfidence >= 0.65
          ? { label: 'Medium confidence', cls: 'text-amber-200 border-amber-700/50' }
          : { label: 'Low confidence', cls: 'text-amber-100 border-amber-600/60' };

  return (
    <div
      className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-4 space-y-4"
      onPointerDownCapture={markInteraction}
      onKeyDownCapture={markInteraction}
    >
      <div aria-live="polite" className="sr-only">
        {autoConfirmActive && secLeft != null && secLeft > 0 && !countdownPaused
          ? `Auto-confirming in ${secLeft} seconds. Activate any control to pause.`
          : ''}
      </div>

      <div className="flex items-start gap-3">
        <ClipboardCheck className="text-amber-300 flex-shrink-0 mt-0.5" size={22} />
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-amber-100">Confirm research plan</h3>
          <p className="text-xs text-slate-400 leading-snug">
            Review the detected intent and draft plan. Confirm to start retrieval and reasoning with the full pipeline,
            refine the plan in plain language, or cancel to release the run.
          </p>
        </div>
      </div>

      {autoConfirmActive && secLeft != null && secLeft > 0 && (
        <div
          className={clsx(
            'rounded-lg border px-3 py-2 text-xs',
            countdownPaused ? 'border-slate-600 bg-slate-900/50 text-slate-300' : 'border-amber-600/50 bg-amber-950/40 text-amber-100'
          )}
        >
          {countdownPaused ? (
            <span>Auto-confirm paused — choose Confirm, Refine, or Cancel.</span>
          ) : (
            <span>
              Auto-confirming in <span className="font-mono font-semibold">{secLeft}</span>s — click anywhere on this
              panel to pause.
            </span>
          )}
        </div>
      )}

      {showStreakHint ? (
        <div className="rounded-lg border border-sky-800/50 bg-sky-950/25 px-3 py-2 text-xs text-sky-100 leading-snug">
          You have {planPrefs.confirmedStreak} clean confirmations in a row. You can enable automatic confirmation for
          high-confidence plans under{' '}
          <Link to="/account" className="text-accent underline-offset-2 hover:underline">
            Account → Plan confirmation
          </Link>
          .
        </div>
      ) : null}

      <div className="rounded-lg border border-surface-100 bg-surface-200/40 p-3 space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500 uppercase tracking-wide">Intent</span>
          <span className={clsx('rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide', confidenceBadge.cls)}>
            {confidenceBadge.label}
            {intentConfidence != null ? ` (${(intentConfidence * 100).toFixed(0)}%)` : ''}
          </span>
        </div>
        <div className="flex items-start gap-1.5">
          <p className="text-slate-200 font-medium">{intentLabel}</p>
          {intentHelpText ? (
            <span title={intentHelpText}>
              <HelpCircle size={13} className="text-slate-500 mt-0.5 flex-shrink-0 cursor-help" aria-label={intentHelpText} />
            </span>
          ) : null}
        </div>
        {intentDesc ? <p className="text-slate-400 mt-1">{intentDesc}</p> : null}
        {intentHelpText ? (
          <p className="text-slate-500 text-[11px] leading-snug">{intentHelpText}</p>
        ) : null}

        {/* Epistemic posture — Phase 1 visibility + Phase 2 posture family badge */}
        <div className="pt-2 mt-2 border-t border-surface-100/60 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 uppercase tracking-wide">Epistemic posture</span>
            <span
              className={clsx(
                'rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide',
                postureFamilyDef.badgeClass,
              )}
              title={postureFamilyDef.shortDescription}
            >
              {postureFamilyDef.label}
            </span>
          </div>
          {posture.profileName ? (
            <p className="text-slate-300 text-[11px]">Profile: {posture.profileName}</p>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
            <span>
              <span className="text-slate-500">Skeptic:</span> {posture.skepticLabel}
            </span>
            <span>
              <span className="text-slate-500">Steelman:</span> {posture.steelmanLabel}
            </span>
          </div>
          <p className="text-slate-500 text-[11px] leading-snug">
            When the selected intent calls for investigation or adjudication, ResearchOne gathers supporting and
            opposing evidence and keeps genuine source disagreements visible.
          </p>
        </div>

        {/* "How ResearchOne thinks" expandable */}
        <div className="pt-2 mt-2 border-t border-surface-100/60">
          <button
            type="button"
            className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            onClick={() => setHowItThinksOpen((v) => !v)}
            aria-expanded={howItThinksOpen}
          >
            {howItThinksOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            How ResearchOne thinks
          </button>
          {howItThinksOpen ? (
            <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">{HOW_RESEARCHONE_THINKS_SHORT}</p>
          ) : null}
        </div>

        {topicStr ? (
          <div>
            <span className="text-slate-500 uppercase tracking-wide">Topic read</span>
            <p className="text-slate-300 mt-1 whitespace-pre-wrap">{topicStr}</p>
          </div>
        ) : null}
        {competenceText ? (
          <div>
            <span className="text-slate-500 uppercase tracking-wide">Competence check</span>
            <p className="text-slate-400 mt-1 whitespace-pre-wrap">{competenceText}</p>
          </div>
        ) : null}
        <p className="text-slate-500">Refinement rounds: {rounds}</p>
      </div>

      {/* Intent override control */}
      <div className="rounded-lg border border-surface-100 bg-surface-200/20 p-3 space-y-2 text-xs">
        <p className="text-slate-400 font-medium">I meant a different research goal…</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={intentOverrideId}
            onChange={(e) => setIntentOverrideId(e.target.value)}
            disabled={busy || intentOverrideBusy}
            className="rounded border border-surface-100 bg-[#0b0d14] px-2 py-1 text-xs text-slate-200 disabled:opacity-50 flex-1 min-w-0"
            aria-label="Select a different research intent"
          >
            <option value="">Select intent…</option>
            {INTENT_OVERRIDE_OPTIONS.filter((o) => o.id !== intentKey).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} — {o.shortDescription}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleIntentOverride()}
            disabled={busy || intentOverrideBusy || !intentOverrideId}
            className="btn-secondary inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            {intentOverrideBusy ? <Loader2 size={12} className="animate-spin" /> : null}
            Apply
          </button>
        </div>
        <p className="text-slate-600 text-[11px]">
          Sends a refinement instruction to re-route this plan. The plan gate stays open for your review.
        </p>
      </div>


      <ResearchBriefPreview
        planPayload={localPayload}
        disabled={busy}
        onAssumptionEditsReady={(nextInstruction) => setInstruction(nextInstruction)}
      />

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-400" htmlFor="plan-refine-input">
          Refine plan (optional)
        </label>
        <textarea
          id="plan-refine-input"
          rows={3}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          disabled={busy}
          placeholder="e.g. Emphasize primary sources over news; narrow to EU regulatory scope…"
          className="w-full rounded-lg border border-surface-100 bg-[#0b0d14] px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void handleRefine()}
          disabled={busy}
          className={clsx(
            'btn-secondary inline-flex items-center gap-2 text-xs',
            busy && 'opacity-60 pointer-events-none'
          )}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <MessageSquareText size={14} />}
          Apply refinement
        </button>
      </div>

      {tierAllowsSavedProfiles ? (
        <div className="space-y-2 border-t border-amber-800/20 pt-3">
          {!saveOpen ? (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-xs"
              disabled={busy}
              onClick={() => setSaveOpen(true)}
            >
              <BookmarkPlus size={14} />
              Save this plan as a profile
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-surface-100 bg-[#0b0d14]/80 p-3">
              <label className="block text-xs text-slate-400" htmlFor="save-profile-name">
                Profile name
              </label>
              <input
                id="save-profile-name"
                className="input text-xs w-full"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="e.g. EU regulatory — survey defaults"
                disabled={saveBusy}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={saveBusy}
                  onClick={() => void handleSaveProfile()}
                >
                  {saveBusy ? <Loader2 size={14} className="animate-spin inline" /> : null}
                  Save profile
                </button>
                <button type="button" className="btn-secondary text-xs" disabled={saveBusy} onClick={() => setSaveOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-2 text-xs"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
          Confirm & run
        </button>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={busy}
          className="btn-secondary inline-flex items-center gap-2 text-xs text-slate-300"
        >
          <XCircle size={14} />
          Cancel run
        </button>
      </div>
    </div>
  );
}
