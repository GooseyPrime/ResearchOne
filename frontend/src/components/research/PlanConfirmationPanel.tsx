import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { BookmarkPlus, ChevronDown, ChevronUp, ClipboardCheck, HelpCircle, Loader2, MessageSquareText, XCircle } from 'lucide-react';
import { INTENT_DISPLAY_LABELS, INTENT_EXAMPLES, INTENT_SHORT_DESCRIPTIONS } from '../../lib/intents';
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
  DOUBLE_CHECK,
  customerOptionHelp,
  customerOptionName,
  customerOptionsIn,
  findCustomerOption,
  type CustomerOption,
} from '../../content/customerOptions';
import {
  cancelRunPlanAtGate,
  confirmRunPlanAtGate,
  createSavedOrchestrationProfile,
  extractApiError,
  refineRunPlanAtGate,
} from '../../utils/api';
import { PLAN_ALREADY_CONFIRMED_MESSAGE, PLAN_CONFIRM_IN_FLIGHT_MESSAGE, confirmPlanOnce } from '../../utils/planConfirm';
import {
  PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT,
  plainPlanNote,
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

/** The plan screen's own fields, named and described from the registry of customer-facing names. */
const FIELD = Object.fromEntries(customerOptionsIn('plan_field').map((option) => [option.id, option]));

/** How this plan checks its findings, in the registry's words. */
function readEpistemicPosture(payload: Record<string, unknown>): {
  doubleCheckLabel: string;
  strongestFormLabel: string;
  /** When Double-check runs, with what that means and an example; absent for a mode the registry has no words for. */
  doubleCheckWords: CustomerOption | undefined;
  /** How findings are restated before they are tested. */
  strongestFormWords: CustomerOption | undefined;
  profileName: string | null;
  doubleCheckMode: string;
  strongestFormMode: string;
} {
  const profile =
    (payload.orchestrationProfile as Record<string, unknown> | undefined) ??
    (payload.orchestration_profile as Record<string, unknown> | undefined) ??
    {};

  const doubleCheckRaw = (profile.doubleCheckMode ?? profile.double_check_mode ?? 'off') as string;
  const strongestFormRaw = (profile.strongestFormMode ?? profile.strongest_form_mode ?? 'off') as string;
  // An add-on used to upgrade a run whose profile had the check switched off.
  // Every run runs it now and nothing is bought, so the raw mode from the plan
  // is the mode (WO-AH).
  const effectiveDoubleCheckRaw = doubleCheckRaw;
  const displayName =
   typeof profile.name === 'string'
     ? profile.name
     : typeof profile.displayName === 'string'
       ? profile.displayName
       : typeof profile.display_name === 'string'
         ? profile.display_name
         : null;

  const doubleCheckWords = findCustomerOption('check_timing', effectiveDoubleCheckRaw);
  const strongestFormWords = findCustomerOption('restatement_style', strongestFormRaw);

  return {
    // A mode the registry has no words for is not shown as its id.
    doubleCheckLabel: doubleCheckWords?.name ?? DOUBLE_CHECK.name,
    strongestFormLabel: strongestFormWords?.name ?? '',
    doubleCheckWords,
    strongestFormWords,
    profileName: displayName,
    doubleCheckMode: effectiveDoubleCheckRaw,
    strongestFormMode: strongestFormRaw,
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
  /** One confirmation per plan, shared by the button and the countdown. */
  const confirmSentRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
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

  // A plan that was changed is a new plan: it has not been confirmed.
  useEffect(() => {
    confirmSentRef.current = false;
  }, [localPlanId]);

  const intentKey = readIntentId(localPayload);
  // A report type the registry does not know is read as its words, never shown as its id.
  const intentLabel = INTENT_DISPLAY_LABELS[intentKey] ?? customerOptionName('report_type', intentKey);
  const intentDesc = INTENT_SHORT_DESCRIPTIONS[intentKey] ?? '';
  const intentExample = INTENT_EXAMPLES[intentKey] ?? '';
  const intentHelpText = INTENT_HELP_TEXT[intentKey] ?? '';
  const intentConfidence = readPlanIntentConfidence(localPayload);
  // A note written in the planning model's own vocabulary is not printed (RJ-018).
  const competenceText = plainPlanNote(readTopicCompetenceAssessment(localPayload));
  const posture = readEpistemicPosture(localPayload);
  const postureFamily = resolvePostureFamily({
    doubleCheckMode: posture.doubleCheckMode,
    strongestFormMode: posture.strongestFormMode,
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
                const result = await confirmPlanOnce(confirmSentRef, () => confirmRunPlanAtGate(c.runId, c.planId));
                if (result.outcome === 'in_flight') return;
                c.onInvalidatePlanPrefs?.();
                c.onAfterConfirm();
                if (result.outcome === 'already_confirmed') c.onNotify('info', result.message ?? PLAN_ALREADY_CONFIRMED_MESSAGE);
                else c.onNotify('success', 'Plan confirmed automatically. The research is starting.');
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
    // A second press before the first has been answered sends nothing.
    if (confirmSentRef.current) {
      onNotify('info', PLAN_CONFIRM_IN_FLIGHT_MESSAGE);
      return;
    }
    setConfirming(true);
    onBusy(true);
    try {
      const result = await confirmPlanOnce(confirmSentRef, () => confirmRunPlanAtGate(snapshot.runId, localPlanId));
      if (result.outcome === 'in_flight') {
        onNotify('info', result.message ?? PLAN_CONFIRM_IN_FLIGHT_MESSAGE);
        return;
      }
      onInvalidatePlanPrefs?.();
      onAfterConfirm();
      if (result.outcome === 'already_confirmed') onNotify('info', result.message ?? PLAN_ALREADY_CONFIRMED_MESSAGE);
      else onNotify('success', 'Plan confirmed. The research is starting.');
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      setConfirming(false);
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
      onNotify('info', 'Enter a name for these settings.');
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
      onNotify('success', 'Settings saved — choose them on your next request.');
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const topic = (localPayload.topicAnalysis as Record<string, unknown> | undefined)?.summary;
  const topicStr = plainPlanNote(typeof topic === 'string' ? topic : '');

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
            Check the report type and the plan below. Confirm to start the research, tell us what to change, or
            cancel to go back and edit your request. Nothing runs until you confirm.
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
          <span className="text-slate-500 uppercase tracking-wide" title={FIELD.report_type.description}>
            {FIELD.report_type.name}
          </span>
          <span
            className={clsx('rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide', confidenceBadge.cls)}
            title={customerOptionHelp(FIELD.confidence)}
          >
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
        {intentExample ? (
          <p className="text-slate-500 text-[11px] leading-snug">Example: {intentExample}</p>
        ) : null}
        <p className="text-slate-500 text-[11px] leading-snug">{FIELD.report_type.description}</p>

        {/* How this report's findings are checked: Double-check, described where it is named. */}
        <div className="pt-2 mt-2 border-t border-surface-100/60 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 uppercase tracking-wide" title={FIELD.check_approach.description}>
              {FIELD.check_approach.name}
            </span>
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
          <div className="space-y-1 text-slate-300" data-testid="plan-double-check">
            <p className="font-medium text-slate-200">{DOUBLE_CHECK.name}</p>
            <p className="text-slate-400 text-[11px] leading-snug">{DOUBLE_CHECK.description}</p>
            <p className="text-slate-500 text-[11px] leading-snug">Example: {DOUBLE_CHECK.example}</p>
            <p>
              <span className="text-slate-500">For this report:</span> {posture.doubleCheckLabel}
            </p>
            {posture.doubleCheckWords ? (
              <p className="text-slate-500 text-[11px] leading-snug">{customerOptionHelp(posture.doubleCheckWords)}</p>
            ) : null}
            {posture.strongestFormWords ? (
              <>
                <p>{posture.strongestFormLabel}</p>
                <p className="text-slate-500 text-[11px] leading-snug">{customerOptionHelp(posture.strongestFormWords)}</p>
              </>
            ) : null}
          </div>
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
            <span className="text-slate-500 uppercase tracking-wide" title={FIELD.topic_read.description}>
              {FIELD.topic_read.name}
            </span>
            <p className="text-slate-300 mt-1 whitespace-pre-wrap">{topicStr}</p>
          </div>
        ) : null}
        {competenceText ? (
          <div>
            <span className="text-slate-500 uppercase tracking-wide" title={FIELD.research_fit.description}>
              {FIELD.research_fit.name}
            </span>
            <p className="text-slate-400 mt-1 whitespace-pre-wrap">{competenceText}</p>
          </div>
        ) : null}
        <p className="text-slate-500" title={FIELD.plan_changes.description}>
          {FIELD.plan_changes.name}: {rounds}
        </p>
      </div>

      {/* Intent override control */}
      <div className="rounded-lg border border-surface-100 bg-surface-200/20 p-3 space-y-2 text-xs">
        <p className="text-slate-400 font-medium">{FIELD.change_report_type.name}…</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={intentOverrideId}
            onChange={(e) => setIntentOverrideId(e.target.value)}
            disabled={busy || intentOverrideBusy}
            className="rounded border border-surface-100 bg-[#0b0d14] px-2 py-1 text-xs text-slate-200 disabled:opacity-50 flex-1 min-w-0"
            aria-label={FIELD.change_report_type.name}
          >
            <option value="">Choose a report type…</option>
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
        {intentOverrideId && INTENT_HELP_TEXT[intentOverrideId] ? (
          <p className="text-slate-500 text-[11px]" data-testid="report-type-choice-help">
            {INTENT_HELP_TEXT[intentOverrideId]}
          </p>
        ) : null}
        <p className="text-slate-600 text-[11px]">
          {FIELD.change_report_type.description} You see the new plan here before anything runs.
        </p>
      </div>


      <ResearchBriefPreview
        planPayload={localPayload}
        disabled={busy}
        onAssumptionEditsReady={(nextInstruction) => setInstruction(nextInstruction)}
      />

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-400" htmlFor="plan-refine-input">
          {FIELD.refine_plan.name}
        </label>
        <p className="text-[11px] text-slate-500">{customerOptionHelp(FIELD.refine_plan)}</p>
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
          Change the plan
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
              {FIELD.save_settings.name}
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-surface-100 bg-[#0b0d14]/80 p-3">
              <label className="block text-xs text-slate-400" htmlFor="save-profile-name">
                Name for these settings
              </label>
              <p className="text-[11px] text-slate-500">{customerOptionHelp(FIELD.save_settings)}</p>
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
                  Save settings
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
          aria-busy={confirming}
          title={customerOptionHelp(FIELD.confirm)}
          className="btn-primary inline-flex items-center gap-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
          {confirming ? 'Starting the research…' : FIELD.confirm.name}
        </button>
        <button
          type="button"
          onClick={() => void handleCancel()}
          disabled={busy}
          className="btn-secondary inline-flex items-center gap-2 text-xs text-slate-300"
        >
          <XCircle size={14} />
          {FIELD.cancel.name}
        </button>
      </div>
    </div>
  );
}
