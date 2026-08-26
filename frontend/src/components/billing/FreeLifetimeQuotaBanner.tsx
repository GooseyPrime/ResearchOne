import { Link } from 'react-router-dom';
import {
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
} from '../../hooks/useBillingSubscription';

/**
 * Lifetime free-tier allowance.
 *
 * This used to take a `variant` naming which of the two request pages it was
 * sitting on, and it explained that the two shared one pool. There is one page
 * and one kind of run now, so the variant would only have been a way to say
 * something untrue in two places.
 */
export default function FreeLifetimeQuotaBanner() {
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
      <p className="font-medium text-slate-200">Free tier</p>
      <p className="mt-1 text-slate-400">
        {showQuota && remaining !== null ? (
          <>
            You have <span className="text-slate-200 font-medium">{remaining}</span> of{' '}
            <span className="text-slate-200 font-medium">{cap}</span> lifetime research runs left.
            Completed runs update this count.
          </>
        ) : (
          <>Free-tier runs use the General Research objective. </>
        )}{' '}
        <Link to="/pricing" className="text-indigo-400 hover:text-indigo-300">
          Upgrade for more objectives and higher limits.
        </Link>
      </p>
    </div>
  );
}
