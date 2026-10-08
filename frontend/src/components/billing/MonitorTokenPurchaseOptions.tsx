import { Link } from 'react-router-dom';
import NotYetAvailable from './NotYetAvailable';

export type TokenPackage = { id: string; label: string };

type MonitorTokenPurchaseOptionsProps = {
  packages: TokenPackage[];
  isLoading: boolean;
  /** Pro, BYOK, Team or Sovereign (or admin). The server enforces the same rule at checkout. */
  eligible: boolean;
  onBuy: (packageId: string) => void;
};

/**
 * Buy buttons for Living Report tokens ($10 for 1, $25 for 5, $40 for 10).
 *
 *  - no pack priced on the server → "Not yet available"
 *  - plan does not include add-ons → what plan is needed, and a link to it
 *  - otherwise                    → one button per pack that can be bought
 */
export default function MonitorTokenPurchaseOptions({
  packages,
  isLoading,
  eligible,
  onBuy,
}: MonitorTokenPurchaseOptionsProps) {
  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading packages…</p>;
  }

  if (packages.length === 0) {
    return (
      <div className="rounded-md border border-white/5 bg-slate-800/30 px-3 py-3">
        <NotYetAvailable />
        <p className="mt-1 text-sm text-slate-400">
          Token packs cannot be bought here yet. Tokens you already hold and monitors that are running
          are unaffected.
        </p>
      </div>
    );
  }

  if (!eligible) {
    return (
      <div className="rounded-md border border-white/5 bg-slate-800/30 px-3 py-3">
        <p className="text-sm text-slate-400">
          Add-ons require an active Pro, BYOK, Team, or Sovereign subscription.{' '}
          <Link to="/app/billing?intent=pro" className="text-indigo-400 hover:text-indigo-300">
            Choose a plan above to buy tokens.
          </Link>
        </p>
      </div>
    );
  }

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
    </>
  );
}
