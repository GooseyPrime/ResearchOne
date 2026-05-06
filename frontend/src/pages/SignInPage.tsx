import { SignIn } from '@clerk/clerk-react';
import { useSearchParams } from 'react-router-dom';

export default function SignInPage() {
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/app/research';

  return (
    <div className="flex min-h-screen items-center justify-center bg-r1-bg px-4 py-12">
      <SignIn fallbackRedirectUrl={redirect} signUpUrl="/sign-up" />
    </div>
  );
}
