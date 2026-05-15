import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { ClipboardCheck, Loader2, MessageSquareText, XCircle } from 'lucide-react';
import { INTENT_DISPLAY_LABELS, INTENT_SHORT_DESCRIPTIONS } from '../../lib/intents';
import {
  cancelRunPlanAtGate,
  confirmRunPlanAtGate,
  extractApiError,
  refineRunPlanAtGate,
} from '../../utils/api';

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

export default function PlanConfirmationPanel({
  snapshot,
  busy,
  onBusy,
  onAfterConfirm,
  onAfterCancel,
  onNotify,
  onGatePlanMutated,
}: {
  snapshot: PlanGateSnapshot;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onAfterConfirm: () => void;
  onAfterCancel: () => void;
  /** `onNotify('error'|'info', msg)` — severity matches notification channel. */
  onNotify: (kind: 'error' | 'info' | 'success', message: string) => void;
  /** Optional: invalidate runs / dossier queries after a successful refinement. */
  onGatePlanMutated?: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [localPayload, setLocalPayload] = useState(snapshot.planPayload);
  const [localPlanId, setLocalPlanId] = useState(snapshot.planId);
  const [rounds, setRounds] = useState(snapshot.refinementRounds);

  useEffect(() => {
    setLocalPayload(snapshot.planPayload);
    setLocalPlanId(snapshot.planId);
    setRounds(snapshot.refinementRounds);
  }, [snapshot.planId, snapshot.refinementRounds, snapshot.planPayload]);

  const intentKey = readIntentId(localPayload);
  const intentLabel = INTENT_DISPLAY_LABELS[intentKey] ?? intentKey.replace(/_/g, ' ');
  const intentDesc = INTENT_SHORT_DESCRIPTIONS[intentKey] ?? '';

  const topic = (localPayload.topicAnalysis as Record<string, unknown> | undefined)?.summary;
  const topicStr = typeof topic === 'string' ? topic : '';

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

  const handleConfirm = async () => {
    onBusy(true);
    try {
      await confirmRunPlanAtGate(snapshot.runId, localPlanId);
      onAfterConfirm();
      onNotify('success', 'Plan confirmed — resuming the research pipeline.');
    } catch (e) {
      onNotify('error', extractApiError(e));
    } finally {
      onBusy(false);
    }
  };

  const handleCancel = async () => {
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

  return (
    <div className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-4 space-y-4">
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

      <div className="rounded-lg border border-surface-100 bg-surface-200/40 p-3 space-y-2 text-xs">
        <div>
          <span className="text-slate-500 uppercase tracking-wide">Intent</span>
          <p className="text-slate-200 font-medium">{intentLabel}</p>
          {intentDesc ? <p className="text-slate-400 mt-1">{intentDesc}</p> : null}
        </div>
        {topicStr ? (
          <div>
            <span className="text-slate-500 uppercase tracking-wide">Topic read</span>
            <p className="text-slate-300 mt-1 whitespace-pre-wrap">{topicStr}</p>
          </div>
        ) : null}
        <p className="text-slate-500">Refinement rounds: {rounds}</p>
      </div>

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

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={busy}
          className="btn-primary inline-flex items-center gap-2 text-xs"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
          Confirm &amp; run
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
