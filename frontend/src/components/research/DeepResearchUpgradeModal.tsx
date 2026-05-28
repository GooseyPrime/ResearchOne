import { Link } from 'react-router-dom';
import SubscribeCTA from '../billing/SubscribeCTA';

/**
 * Shown when a user without a Pro+ plan attempts to switch into Deep Adversarial Synthesis.
 * (ReportSubscribeModal is for per-report monitor add-ons — not subscription upgrades.)
 */
export default function DeepResearchUpgradeModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deep-research-upgrade-title"
    >
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="deep-research-upgrade-title" className="text-lg font-medium text-slate-100">
            Deep Adversarial Synthesis
          </h2>
          <button type="button" className="btn-ghost text-xs shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Deep runs use the V2 multi-model ensemble, file uploads, objective-specific presets, and red-team
          adversarial agents. Upgrade to Pro (or above) for full access and higher monthly deep-report limits.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <SubscribeCTA tier="pro" cta="Upgrade to Pro" className="btn-primary text-sm" />
          <Link to="/pricing" className="text-sm text-accent hover:underline" onClick={onClose}>
            View pricing
          </Link>
          <Link to="/app/billing" className="text-sm text-slate-400 hover:text-slate-200" onClick={onClose}>
            Account &amp; billing
          </Link>
        </div>
      </div>
    </div>
  );
}
