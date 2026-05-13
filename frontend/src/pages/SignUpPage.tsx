import { SignUp } from '@clerk/react';
import { useSearchParams } from 'react-router-dom';
import { onboardingRedirectFromSignupTierParam } from '../utils/signupTier';

export default function SignUpPage() {
  const [searchParams] = useSearchParams();
  const fallbackRedirectUrl = onboardingRedirectFromSignupTierParam(searchParams.get('tier'));

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-r1-bg px-4 py-12">
      <h1 className="sr-only">Create your evidence chain.</h1>
      <SignUp fallbackRedirectUrl={fallbackRedirectUrl} signInUrl="/sign-in" />
    </div>
  );
}
