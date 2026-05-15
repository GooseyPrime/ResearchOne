import { UserProfile } from '@clerk/react';
import PlanConfirmationSettingsCard from '../components/account/PlanConfirmationSettingsCard';
import SavedOrchestrationProfilesCard from '../components/account/SavedOrchestrationProfilesCard';
import { useBillingSubscriptionQuery, effectiveEntitlementTier } from '../hooks/useBillingSubscription';

export default function AccountPage() {
  const { data: subscriptionData, isLoading: subLoading, isError: subError, authReady } = useBillingSubscriptionQuery();
  const tierResolved = authReady && !subLoading && (!subError || Boolean(subscriptionData));
  const userTier = tierResolved ? effectiveEntitlementTier(subscriptionData) ?? 'free_demo' : null;
  const tierAllowsSavedProfiles = Boolean(userTier && userTier !== 'free_demo');

  return (
    <div className="min-h-screen bg-r1-bg px-4 py-10">
      <div className="max-w-5xl mx-auto flex flex-col lg:flex-row gap-8 items-start justify-center">
        <div className="w-full flex justify-center">
          <UserProfile path="/account" routing="path" />
        </div>
        <div className="w-full lg:max-w-md flex flex-col gap-6 shrink-0">
          <PlanConfirmationSettingsCard />
          <SavedOrchestrationProfilesCard tierAllowsProfiles={tierAllowsSavedProfiles} />
        </div>
      </div>
    </div>
  );
}
