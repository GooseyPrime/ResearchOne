import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';

export default function OnboardingPage() {
  const { user } = useUser();
  const navigate = useNavigate();

  const complete = async () => {
    await user?.update({
      publicMetadata: {
        ...(user.publicMetadata ?? {}),
        onboardingComplete: true,
      },
    });
    navigate('/app/research', { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-12 text-r1-text">
      <h1 className="font-serif text-4xl">Welcome to ResearchOne</h1>
      <p className="mt-4 text-r1-text-muted">
        Your account is ready. Complete onboarding to enter the research workbench.
      </p>
      <button
        type="button"
        className="mt-8 inline-flex w-fit rounded-lg bg-r1-accent px-5 py-3 font-semibold text-r1-bg"
        onClick={() => void complete()}
      >
        Continue to research workspace
      </button>
    </div>
  );
}
