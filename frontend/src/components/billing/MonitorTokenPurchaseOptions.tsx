import { Link } from 'react-router-dom';
import NotYetAvailable from './NotYetAvailable';

export type TokenPackage = { id: string; label: string };

/**
 * Whether this user's plan includes add-ons.
 * `unknown` means the plan could not be read (the subscription request
 * failed). It is its own state on purpose: guessing "eligible" would show
 * buttons the server then refuses.
 */
export type AddonEligibilityState = 'eligible' | 'ineligible' | 'unknown';

type MonitorTokenPurchaseOptionsProps = {
  packages: TokenPackage[];
  /** Every pack the pricing page lists, so a pack with no price is named rather than silently missing. */
  advertised: ReadonlyArray<TokenPackage>;
  isLoading: boolean;
  /** Set when the pack list could not be loaded; that is a failure to retry, not "not yet available". */
  errorMessage: string | null;
  onRetry: () => void;
  eligibility: AddonEligibilityState;
  onRetryEligibility: () => void;
  onBuy: (packageId: string) => void;
};

const BOX = 'w-full rounded-md border border-white/5 bg-slate-800/30 px-3 py-3';
const RETRY =
  'mt-2 rounded bg-amber-700/40 px-3 py-1 text-xs text-amber-200 hover:bg-amber-700/60 transition-colors';

/**
 * Buy buttons for Living Report tokens ($10 for 1, $25 for 5, $40 for 10).
 *
 *  - pack list failed to load       → the error and a retry
 *  - no pack priced on the server   → "Not yet available"
 *  - plan could not be read         → says so, with a retry
 *  - plan does not include add-ons  → what plan is needed, and a link to it
 *  - otherwise                      → one button per pack that can be bought,
 *                                     and a note for each listed pack that cannot
 */
export default function MonitorTokenPurchaseOptions({
  packages,
  advertised,
  isLoading,
  errorMessage,
  onRetry,
  eligibility,
  onRetryEligibility,
  onBuy,
}: MonitorTokenPurchaseOptionsProps) {
  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading packages…</p>;
  }

  if (errorMessage) {
    return (
      <div className="w-full rounded-md border border-amber-700/30 bg-amber-950/20 p-3">
        <p className="text-sm text-amber-400">Could not load token packs. {errorMessage}</p>
        <button type="button" className={RETRY} onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className={BOX}>
        <NotYetAvailable />
        <p className="mt-1 text-sm text-slate-400">
          Token packs cannot be bought here yet. Tokens you already hold and monitors that are running
          are unaffected.
        </p>
      </div>
    );
  }

  if (eligibility === 'unknown') {
    return (
      <div className="w-full rounded-md border border-amber-700/30 bg-amber-950/20 p-3">
        <p className="text-sm text-amber-400">
          Could not confirm your plan, so token packs are not offered right now.
        </p>
        <button type="button" className={RETRY} onClick={onRetryEligibility}>
          Retry
        </button>
      </div>
    );
  }

  if (eligibility === 'ineligible') {
    return (
      <div className={BOX}>
        <p className="text-sm text-slate-400">
          Add-ons require an active Pro, BYOK, Team, or Sovereign subscription.{' '}
          <Link to="/app/billing?intent=pro" className="text-indigo-400 hover:text-indigo-300">
            Choose a plan above to buy tokens.
          </Link>
        </p>
      </div>
    );
  }

  const purchasable = new Set(packages.map((pkg) => pkg.id));
  const missing = advertised.filter((pkg) => !purchasable.has(pkg.id));

  return (
    <>
      {packages.map((pkg) => (
        <button
          key={pkg.id}
          type="button"
          className="rounded bg-indigo-600 px-3 py-2 text-sm hover:bg-indigo-500 transition-colors"
          onClick={() => onBuy(pkg.id)}
        >
          {pkg.label}
        </button>
      ))}
      {missing.length > 0 ? (
        <div className="w-full">
          {missing.map((pkg) => (
            <NotYetAvailable key={pkg.id} subject={pkg.label} className="mt-1" />
          ))}
        </div>
      ) : null}
    </>
  );
}
