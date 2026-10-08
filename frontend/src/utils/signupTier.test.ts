import { describe, expect, it } from 'vitest';
import { onboardingRedirectFromSignupTierParam, parseSignupTierFromSearch } from './signupTier';

describe('signup tier availability', () => {
  it('does not route a deferred Student plan into checkout onboarding', () => {
    expect(parseSignupTierFromSearch('?tier=student')).toBe('free_demo');
    expect(onboardingRedirectFromSignupTierParam('student')).toBe('/onboarding');
  });

  it('preserves the available Pro signup path', () => {
    expect(parseSignupTierFromSearch('?tier=pro')).toBe('pro');
    expect(onboardingRedirectFromSignupTierParam('pro')).toBe('/onboarding?tier=pro');
  });

  it('carries a BYOK sign-up through onboarding to checkout', () => {
    expect(parseSignupTierFromSearch('?tier=byok')).toBe('byok');
    expect(onboardingRedirectFromSignupTierParam('byok')).toBe('/onboarding?tier=byok');
  });
});
