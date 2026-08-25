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
import { isDeepResearchEngine } from '../../utils/researchRunRoutes';
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
 * TWO DELIBERATE ENGINE GATES (Rule 44 T4 — what did the old props protect?)
 *
 * `ResearchStandardPage` passed `tierAllowsSavedProfiles={false}` and no
 * `planPrefs`; `ResearchDeepPage` passed both. Consolidating naively would have
 * silently GRANTED saved profiles and the auto-confirm countdown to v1 runs,
 * neither of which they had. Both are therefore gated on the engine, which
 * reproduces the previous behaviour exactly for both kinds of run.
 *
 * Whether v1 runs *should* honour a user's auto-confirm preference is a real
 * product question — it looks more like an oversight than a decision — but it
 * is not this work order's to answer, and changing it here would be a
 * behaviour change disguised as a refactor.
 */
export interface RunPlanGateProps {
  runId: string;
  runStatus: string | undefined;
  engineVersion?: string | null;
}

export default function RunPlanGate({ runId, runStatus, engineVersion }: RunPlanGateProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [snapshot, setSnapshot] = useState<PlanGateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const isDeep = isDeepResearchEngine(engineVersion);

  const { data: subscriptionData, isLoading: subLoading, isError: subError, authReady } =
    useBillingSubscriptionQuery();
  const tierResolved = authReady && !subLoading && (!subError || Boolean(subscriptionData));
  const tier = tierResolved ? effectiveEntitlementTier(subscriptionData) : null;
  const planPrefsQuery = usePlanPreferencesQuery({ enabled: authReady && tierResolved && isDeep });

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
        planPrefs={isDeep ? planPrefsQuery.data : undefined}
        tierAllowsSavedProfiles={isDeep && Boolean(tier && tier !== 'free_demo')}
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
          if (isDeep) {
            void qc.invalidateQueries({ queryKey: PLAN_PREFERENCES_QUERY_KEY }, { cancelRefetch: false });
          }
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
