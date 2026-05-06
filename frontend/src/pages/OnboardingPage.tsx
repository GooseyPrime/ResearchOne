import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';

export default function OnboardingPage() {
  const { user, isLoaded } = useUser();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const complete = async () => {
    setError(null);
    if (!user) return;
    setSaving(true);
    try {
      await user.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata ?? {}),
          onboardingComplete: true,
        },
      });
      navigate('/app/research', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete onboarding');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-12 text-r1-text">
      <h1 className="font-serif text-4xl">Welcome to ResearchOne</h1>
      <p className="mt-4 text-r1-text-muted">
        Your account is ready. Complete onboarding to enter the research workbench.
      </p>
      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
      <button
        type="button"
        disabled={!isLoaded || !user || saving}
        className="mt-8 inline-flex w-fit rounded-lg bg-r1-accent px-5 py-3 font-semibold text-r1-bg disabled:opacity-50"
        onClick={() => void complete()}
      >
        {saving ? 'Saving…' : 'Continue to research workspace'}
      </button>
    </div>
  );
}
