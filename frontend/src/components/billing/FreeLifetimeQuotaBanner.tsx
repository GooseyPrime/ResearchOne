import { Link } from 'react-router-dom';
import {
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
} from '../../hooks/useBillingSubscription';

export type FreeLifetimeQuotaBannerVariant = 'research' | 'deep-research';

const VARIANT_HEADING: Record<FreeLifetimeQuotaBannerVariant, string> = {
  research: 'Free tier — Research',
  'deep-research': 'Free tier — Deep Research',
};

type Props = {
  variant: FreeLifetimeQuotaBannerVariant;
};

/**
 * Shared lifetime free-demo quota for V1 Research and V2 Deep Research (single pool).
 */
export default function FreeLifetimeQuotaBanner({ variant }: Props) {
  const { authReady, isLoading, isError, data } = useBillingSubscriptionQuery();
  const tierResolved = authReady && !isLoading && (!isError || Boolean(data));
  const userTier = tierResolved ? effectiveEntitlementTier(data) ?? 'free_demo' : null;

  if (!tierResolved || userTier !== 'free_demo' || !data) {
    return null;
  }

  const cap = data.lifetimeReportCap;
  const used = data.lifetimeReportsUsed ?? 0;
  const showQuota = typeof cap === 'number';
  const remaining = showQuota ? Math.max(0, cap - used) : null;

  return (
    <div className="rounded-lg border border-indigo-700/30 bg-indigo-950/20 p-4 text-sm text-slate-300">
      <p className="font-medium text-slate-200">{VARIANT_HEADING[variant]}</p>
      <p className="mt-1 text-slate-400">
        {showQuota && remaining !== null ? (
          <>
            You have <span className="text-slate-200 font-medium">{remaining}</span> of{' '}
            <span className="text-slate-200 font-medium">{cap}</span> lifetime research runs remaining
            (General Epistemic Research), shared across Research and Deep Research modes. Completed runs
            update this count.
          </>
        ) : (
          <>
            Lifetime research runs on the free tier use the General Epistemic Research objective only,
            shared across Research and Deep Research modes.{' '}
          </>
        )}
        {variant === 'deep-research' ? (
          <>Deep Research uses the V2 multi-model ensemble for richer analysis. </>
        ) : null}
        <Link to="/pricing" className="text-indigo-400 hover:text-indigo-300">
          Upgrade for more objectives and higher limits.
        </Link>
      </p>
    </div>
  );
}
