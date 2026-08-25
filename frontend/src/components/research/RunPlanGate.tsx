import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PlanConfirmationPanel, { type PlanGateSnapshot } from './PlanConfirmationPanel';
import { usePlanGateHydration } from '../../hooks/usePlanGateHydration';
import { PLAN_PREFERENCES_QUERY_KEY, usePlanPreferencesQuery } from '../../hooks/usePlanPreferences';
import {
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
} from '../../hooks/useBillingSubscription';
import { useStore } from '../../store/useStore';
import { requestPrefillUrl } from '../../utils/researchRunRoutes';

/**
 * The plan confirmation gate, wherever a run lives.
 *
 * It used to be wired up twice, once inside `ResearchStandardPage` and once
 * inside `ResearchDeepPage`, which is why the header pill had to deep-link back
 * to `/app/research?runId=…#plan` to reach it — the one case where the request
 * page was not a request page. A run now proceeds in its own workspace, so the
 * gate has to be there too, and it is defined once.
 *
 * NO ENGINE GATE (deliberately, on the operator's instruction).
 *
 * `ResearchStandardPage` passed `tierAllowsSavedProfiles={false}` and no
 * `planPrefs`; `ResearchDeepPage` passed both. My first pass reproduced that
 * split by gating on `engine_version`, on the T4 reasoning that consolidating
 * two call sites must not silently grant one of them capabilities it never had.
 *
 * That was the wrong question. The operator's answer: there is no v1 and v2 —
 * every report is orchestrated by the same agents, which decide what a request
 * needs from the request itself. A gate on `engine_version` encodes a
 * distinction the system no longer makes, so preserving it faithfully would
 * have been preserving a bug. Auto-confirm and saved profiles are account
 * capabilities, gated on the account's tier and nothing else.
 *
 * `engine_version` still exists on the row and still gates a separate DEEP
 * report quota in `checkTierAccess` / `incrementReportCount`. Removing that is
 * a pricing decision, not a refactor, and is tracked separately.
 */
export interface RunPlanGateProps {
  runId: string;
  runStatus: string | undefined;
}

export default function RunPlanGate({ runId, runStatus }: RunPlanGateProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [snapshot, setSnapshot] = useState<PlanGateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: subscriptionData, isLoading: subLoading, isError: subError, authReady } =
    useBillingSubscriptionQuery();
  const tierResolved = authReady && !subLoading && (!subError || Boolean(subscriptionData));
  const tier = tierResolved ? effectiveEntitlementTier(subscriptionData) : null;
  const planPrefsQuery = usePlanPreferencesQuery({ enabled: authReady && tierResolved });

  usePlanGateHydration({ trackingRunId: runId, runStatus, setPlanGateLocal: setSnapshot });

  if (runStatus !== 'plan_pending_confirmation') return null;

  if (!snapshot || snapshot.runId !== runId) {
    return (
      <div
        id="plan"
        className="rounded-xl border border-amber-700/35 bg-amber-950/20 p-4 text-sm text-amber-100/90"
      >
        Loading research plan…
      </div>
    );
  }

  return (
    <div id="plan">
      <PlanConfirmationPanel
        snapshot={snapshot}
        busy={busy}
        onBusy={setBusy}
        planPrefs={planPrefsQuery.data}
        tierAllowsSavedProfiles={Boolean(tier && tier !== 'free_demo')}
        onInvalidatePlanPrefs={() =>
          void qc.invalidateQueries({ queryKey: PLAN_PREFERENCES_QUERY_KEY })
        }
        onInvalidateSavedProfiles={() =>
          void qc.invalidateQueries({ queryKey: ['saved-orchestration-profiles'] })
        }
        onAfterConfirm={() => {
          setSnapshot(null);
          setBusy(false);
          void qc.invalidateQueries({ queryKey: ['research-runs'] });
          void qc.invalidateQueries({ queryKey: ['research-run', runId] }, { cancelRefetch: false });
          void qc.invalidateQueries({ queryKey: PLAN_PREFERENCES_QUERY_KEY }, { cancelRefetch: false });
        }}
        onAfterCancel={() => {
          // What the old handler did here was `applyRequestFormFromRun(row)` —
          // it put the user's request back into the form they were looking at,
          // because cancelling a plan means "not like that, let me edit it".
          // The workspace has no form, so the equivalent is to send them to the
          // one place that does, with the request restored (Rule 44 T4).
          void qc.invalidateQueries({ queryKey: ['research-runs'] });
          navigate(requestPrefillUrl(runId), { replace: true });
        }}
        onNotify={(kind, message) => addNotification(kind, message)}
        onGatePlanMutated={() => {
          void qc.invalidateQueries({ queryKey: ['research-runs'] });
          void qc.invalidateQueries({ queryKey: ['run-plan-gate', runId] }, { cancelRefetch: false });
        }}
      />
    </div>
  );
}
