import FAQ from '../components/landing/FAQ';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';
import { FAQ_PAGE_AUDIT_VERBATIM_ITEMS } from '../content/marketingFaqItems';

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Frequently asked questions</h1>
        <p className="mt-3 text-r1-text-muted">
          Straight answers on pipeline depth, retention, BYOK, and how we treat citations and contradictions.
        </p>
        <div className="mt-10">
          <FAQ items={FAQ_PAGE_AUDIT_VERBATIM_ITEMS} />
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
