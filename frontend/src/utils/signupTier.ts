/** Values persisted to Clerk `unsafeMetadata.initialTier` from marketing funnel query params. */
export type SignupInitialTier = 'free_demo' | 'student' | 'pro';

export function parseSignupTierFromSearch(search: string): SignupInitialTier {
  const q = search.startsWith('?') ? search.slice(1) : search;
  const tier = new URLSearchParams(q).get('tier');
  if (tier === 'student' || tier === 'pro') return tier;
  return 'free_demo';
}

export function signupTierLabel(tier: SignupInitialTier): string {
  switch (tier) {
    case 'student':
      return 'Student';
    case 'pro':
      return 'Pro';
    default:
      return 'Free Demo';
  }
}

/** Redirect target after Clerk sign-up so onboarding can read `tier`. */
export function onboardingRedirectFromSignupTierParam(tierParam: string | null): string {
  if (tierParam === 'student' || tierParam === 'pro') {
    return `/onboarding?tier=${encodeURIComponent(tierParam)}`;
  }
  return '/onboarding';
}
