import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import LegalDraftBanner from '../components/LegalDraftBanner';

export default function AcceptableUsePage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <LegalDraftBanner />
        <h1 className="font-serif text-4xl">Acceptable Use</h1>
        <p className="mt-6 text-r1-text-muted">
          You agree not to use ResearchOne for unlawful activity, harassment, malware distribution, credential theft,
          or attempts to compromise systems and data you do not own or have permission to test.
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
