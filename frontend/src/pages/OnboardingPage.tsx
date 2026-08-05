import { useUser } from '@clerk/react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { parseSignupTierFromSearch, signupTierLabel, type SignupInitialTier } from '../utils/signupTier';
import api from '../utils/api';
import { ONBOARDING_HOW_IT_THINKS_TEASER } from '../content/howResearchOneThinks';

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
      await api.post('/ingestion/consent', { pipeline_b_consent: pipelineBConsent });
      const afterOnboarding =
        initialTier === 'free_demo' ? '/app/research' : `/app/billing?intent=${initialTier}`;
      navigate(afterOnboarding, { replace: true });
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
        Before you enter the research workspace, choose whether eligible sanitized excerpts can help improve shared
        research intelligence, then confirm your starting tier.
      </p>

      <section className="mt-10 space-y-4 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
        <h2 className="font-serif text-xl text-r1-text">Help improve shared research intelligence</h2>
        <p className="text-sm leading-relaxed text-r1-text-muted">
          If you opt in, sanitized excerpts from eligible research may contribute to cross-customer intelligence under our{' '}
          <Link to="/acceptable-use" className="text-r1-accent underline-offset-2 hover:underline">
            Acceptable Use
          </Link>{' '}
          policy. You can update this choice later from Account. Opting out does not reduce your access to ResearchOne.
        </p>
        <p className="text-xs text-r1-text-muted">
          Technical name: Pipeline B (shown for advanced and operations documentation only).
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
              <span className="font-medium text-r1-text">Yes, contribute</span> — I opt in where eligible,
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
              shared-intelligence layer.
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
            : ' — continue to Billing & usage to complete Stripe checkout for this plan.'}{' '}
          You can change plans anytime from Billing & usage.
        </p>
      </section>

      <section className="mt-8 rounded-xl border border-white/10 bg-r1-bg-deep p-6 space-y-3">
        <h2 className="font-serif text-xl text-r1-text">How ResearchOne thinks</h2>
        <p className="text-sm leading-relaxed text-r1-text-muted">{ONBOARDING_HOW_IT_THINKS_TEASER}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link to="/methodology" className="text-r1-accent underline-offset-2 hover:underline">
            Full methodology
          </Link>
          <Link to="/app/guide" className="text-r1-accent underline-offset-2 hover:underline">
            Guide
          </Link>
        </div>
      </section>

      {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

      <button
        type="button"
        disabled={!isLoaded || !user || !canContinue}
        className="mt-8 inline-flex w-fit rounded-lg bg-r1-accent px-5 py-3 font-semibold text-r1-bg disabled:opacity-50"
        onClick={() => void complete()}
      >
        {saving
          ? 'Saving…'
          : initialTier === 'free_demo'
            ? 'Continue to research workspace'
            : 'Continue to checkout'}
      </button>
    </div>
  );
}
