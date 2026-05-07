import { useUser } from '@clerk/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { parseSignupTierFromSearch, signupTierLabel, type SignupInitialTier } from '../utils/signupTier';

type PipelineChoice = 'yes' | 'no' | null;

export default function OnboardingPage() {
  const { user, isLoaded } = useUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tierSearchString = searchParams.toString();
  const initialTier: SignupInitialTier = useMemo(
    () => parseSignupTierFromSearch(tierSearchString ? `?${tierSearchString}` : ''),
    [tierSearchString],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pipelineChoice, setPipelineChoice] = useState<PipelineChoice>(null);

  const canContinue = pipelineChoice !== null && !saving;

  const complete = async () => {
    setError(null);
    if (!user || pipelineChoice === null) return;
    const now = new Date().toISOString();
    const pipelineBConsent = pipelineChoice === 'yes';
    setSaving(true);
    try {
      await user.update({
        unsafeMetadata: {
          ...(user.unsafeMetadata ?? {}),
          onboardingComplete: true,
          onboardingCompletedAt: now,
          pipelineBConsent,
          pipelineBConsentAt: pipelineBConsent ? now : null,
          initialTier,
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
        Before you enter the research workspace, acknowledge how optional participation in the sanitized global ingestion
        layer (Pipeline B) works — and confirm your starting tier.
      </p>

      <section className="mt-10 space-y-4 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
        <h2 className="font-serif text-xl text-r1-text">Pipeline B — global ingestion</h2>
        <p className="text-sm leading-relaxed text-r1-text-muted">
          If you opt in, sanitized excerpts from eligible research may contribute to cross-customer intelligence under our{' '}
          <Link to="/acceptable-use" className="text-r1-accent underline-offset-2 hover:underline">
            Acceptable Use
          </Link>{' '}
          policy. Opting out does not limit your access to the research workbench; it only declines this layer.
        </p>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-r1-text">Choose one</legend>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-r1-text-muted">
            <input
              type="radio"
              name="pipeline-b"
              className="mt-1"
              checked={pipelineChoice === 'yes'}
              onChange={() => setPipelineChoice('yes')}
            />
            <span>
              <span className="font-medium text-r1-text">Yes, contribute</span> — I opt in to Pipeline B where eligible,
              subject to the acceptable-use terms.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-r1-text-muted">
            <input
              type="radio"
              name="pipeline-b"
              className="mt-1"
              checked={pipelineChoice === 'no'}
              onChange={() => setPipelineChoice('no')}
            />
            <span>
              <span className="font-medium text-r1-text">No, opt out</span> — Do not use my eligible content for the global
              ingestion layer.
            </span>
          </label>
        </fieldset>
      </section>

      <section className="mt-8 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
        <h2 className="font-serif text-xl text-r1-text">Starting tier</h2>
        <p className="mt-2 text-sm text-r1-text-muted">
          Your signup intent is{' '}
          <span className="font-medium text-r1-text">{signupTierLabel(initialTier)}</span>
          {initialTier === 'free_demo'
            ? ' — no checkout on this screen.'
            : ' — pricing intent is recorded for billing; checkout happens from Billing when you are ready.'}{' '}
          Upgrade paths unlock from billing later.
        </p>
      </section>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <button
        type="button"
        disabled={!isLoaded || !user || !canContinue}
        className="mt-8 inline-flex w-fit rounded-lg bg-r1-accent px-5 py-3 font-semibold text-r1-bg disabled:opacity-50"
        onClick={() => void complete()}
      >
        {saving ? 'Saving…' : 'Continue to research workspace'}
      </button>
    </div>
  );
}
