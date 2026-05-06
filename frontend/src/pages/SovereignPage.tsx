import LandingHeader from '../components/landing/LandingHeader';
import LandingFooter from '../components/landing/LandingFooter';

export default function SovereignPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Sovereign deployment</h1>
        <p className="mt-4 text-r1-text-muted">
          For sensitive legal discovery, regulated investigations, and defense-adjacent research, ResearchOne supports
          single-tenant deployments with dedicated infrastructure and contractual isolation.
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
