import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { extractApiError, getPlanPreferences } from '../../utils/api';
import { usePatchPlanPreferencesMutation, usePlanPreferencesQuery } from '../../hooks/usePlanPreferences';
import { PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT } from '../../utils/planAutoConfirm';

export default function PlanConfirmationSettingsCard() {
  const { data, isLoading, isError, error, refetch } = usePlanPreferencesQuery();
  const patch = usePatchPlanPreferencesMutation();
  const [slider, setSlider] = useState(0.85);
  const [preview, setPreview] = useState<{ sampleSize: number; hitRate: number | null } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.autoConfirmThreshold != null) setSlider(data.autoConfirmThreshold);
  }, [data?.autoConfirmThreshold]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const p = await getPlanPreferences(slider);
        if (!cancelled) setPreview({ sampleSize: p.previewSampleSize, hitRate: p.previewHitRate });
      } catch {
        if (!cancelled) setPreview(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [slider]);

  const previewText =
    preview == null
      ? 'Move the threshold slider to preview how often similar plans would have auto-confirmed.'
      : preview.sampleSize === 0
        ? 'No confirmed plans in the last 30 days yet — preview will populate after you confirm plans.'
        : preview.hitRate == null
          ? 'Could not estimate from recent plans.'
          : `With a ${(slider * 100).toFixed(0)}% confidence bar, your last 30 days of confirmed plans would have auto-confirmed about ${(preview.hitRate * 100).toFixed(0)}% of the time (${preview.sampleSize} plan${preview.sampleSize === 1 ? '' : 's'} in sample).`;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 text-left space-y-4 max-w-xl w-full">
      <div className="flex items-start gap-2">
        <ClipboardCheck className="text-amber-300 flex-shrink-0 mt-0.5" size={20} />
        <div>
          <h2 className="text-sm font-semibold text-white">Plan confirmation</h2>
          <p className="text-xs text-slate-400 mt-1 leading-snug">
            After five straight confirmations without refinements, you can enable auto-confirm so high-confidence plans proceed
            automatically (with a short countdown on the research page). Refining or cancelling resets the streak.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={14} className="animate-spin" />
          Loading preferences…
        </div>
      )}
      {isError && <p className="text-xs text-red-300">{extractApiError(error)}</p>}

      {data && (
        <>
          <div className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
            Current streak (clean confirms):{' '}
            <span className="text-slate-100 font-mono">{data.confirmedStreak}</span>
            {data.confirmedStreak < PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT ? (
              <span className="text-slate-500"> — enable auto-confirm after {PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT}.</span>
            ) : (
              <span className="text-emerald-400/90"> — eligible to enable auto-confirm.</span>
            )}
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-900"
              checked={data.autoConfirmEnabled}
              disabled={patch.isPending || data.confirmedStreak < PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT}
              onChange={(e) => {
                setActionError(null);
                patch.mutate(
                  { autoConfirmEnabled: e.target.checked },
                  {
                    onError: (err) => {
                      void refetch();
                      setActionError(extractApiError(err));
                    },
                  }
                );
              }}
            />
            <span className={clsx('text-sm', data.confirmedStreak < PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT ? 'text-slate-500' : 'text-slate-200')}>
              Auto-confirm high-confidence plans
            </span>
          </label>
          {data.confirmedStreak < PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT ? (
            <p className="text-[11px] text-slate-500">
              Confirm plans from the{' '}
              <Link to="/app/research-v2" className="text-accent hover:underline">
                Deep Research
              </Link>{' '}
              page without using &quot;Apply refinement&quot; {PLAN_AUTO_CONFIRM_STREAK_FOR_UI_HINT} times in a row to unlock this toggle.
            </p>
          ) : null}

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span id="plan-auto-confirm-threshold-label">Confidence threshold</span>
              <span className="font-mono text-slate-200" aria-hidden>
                {(slider * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min={0.7}
              max={0.95}
              step={0.01}
              value={slider}
              disabled={patch.isPending}
              onChange={(e) => setSlider(Number(e.target.value))}
              className="w-full accent-amber-500"
              aria-labelledby="plan-auto-confirm-threshold-label"
              aria-valuemin={0.7}
              aria-valuemax={0.95}
              aria-valuenow={slider}
            />
            <div className="flex justify-between text-[10px] text-slate-600 uppercase tracking-wide">
              <span>0.70</span>
              <span>0.95</span>
            </div>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={patch.isPending || Math.abs(slider - data.autoConfirmThreshold) < 0.001}
              onClick={() => {
                setActionError(null);
                patch.mutate(
                  { autoConfirmThreshold: slider },
                  {
                    onError: (err) => {
                      void refetch();
                      setActionError(extractApiError(err));
                    },
                  }
                );
              }}
            >
              {patch.isPending ? 'Saving…' : 'Save threshold'}
            </button>
          </div>

          <p className="text-xs text-slate-400 leading-snug" role="status">
            {previewText}
          </p>
          {actionError ? <p className="text-xs text-red-300">{actionError}</p> : null}
        </>
      )}
    </section>
  );
}
