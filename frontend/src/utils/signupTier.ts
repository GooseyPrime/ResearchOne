/** Values persisted to Clerk `unsafeMetadata.initialTier` from marketing funnel query params. */
export type SignupInitialTier = 'free_demo' | 'pro' | 'byok';

export function parseSignupTierFromSearch(search: string): SignupInitialTier {
  const q = search.startsWith('?') ? search.slice(1) : search;
  const tier = new URLSearchParams(q).get('tier');
  if (tier === 'pro' || tier === 'byok') return tier;
  return 'free_demo';
}

export function signupTierLabel(tier: SignupInitialTier): string {
  switch (tier) {
    case 'pro':
      return 'Pro';
    case 'byok':
      return 'BYOK';
    default:
      return 'Free Demo';
  }
}

/** Redirect target after Clerk sign-up so onboarding can read `tier`. */
export function onboardingRedirectFromSignupTierParam(tierParam: string | null): string {
  if (tierParam === 'pro' || tierParam === 'byok') {
    return `/onboarding?tier=${encodeURIComponent(tierParam)}`;
  }
  return '/onboarding';
}
