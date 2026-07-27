import { UserProfile } from '@clerk/react';
import { Link } from 'react-router-dom';
import PlanConfirmationSettingsCard from '../components/account/PlanConfirmationSettingsCard';
import SavedOrchestrationProfilesCard from '../components/account/SavedOrchestrationProfilesCard';
import IngestionConsentToggle from '../components/account/IngestionConsentToggle';
import { useBillingSubscriptionQuery, effectiveEntitlementTier } from '../hooks/useBillingSubscription';

export default function AccountPage() {
  const { data: subscriptionData, isLoading: subLoading, isError: subError, authReady } = useBillingSubscriptionQuery();
  const tierResolved = authReady && !subLoading && (!subError || Boolean(subscriptionData));
  const userTier = tierResolved ? effectiveEntitlementTier(subscriptionData) ?? 'free_demo' : null;
  const tierAllowsSavedProfiles = Boolean(userTier && userTier !== 'free_demo');

  return (
    <div className="min-h-screen bg-r1-bg px-4 py-10">
      <div className="mx-auto mb-4 max-w-5xl rounded-lg border border-white/10 bg-slate-900/50 px-4 py-3 text-sm text-slate-300">
        Need subscription, wallet, tokens, or invoices? Open{' '}
        <Link to="/app/billing" className="text-indigo-400 hover:text-indigo-300">
          Billing &amp; usage
        </Link>
        .
      </div>
      <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-8 items-start justify-center">
        <div className="w-full flex justify-center">
          <UserProfile path="/account" routing="path" />
        </div>
        <div className="w-full lg:max-w-md flex flex-col gap-6 shrink-0">
          <IngestionConsentToggle />
          <PlanConfirmationSettingsCard />
          <SavedOrchestrationProfilesCard tierAllowsProfiles={tierAllowsSavedProfiles} />
        </div>
      </div>
    </div>
  );
}
