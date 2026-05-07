import LandingHeader from '../components/landing/LandingHeader';
import LandingFooter from '../components/landing/LandingFooter';

export default function SovereignPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Sovereign deployment</h1>
        <p className="mt-4 text-r1-text-muted">
          For defense-adjacent contractors, sensitive legal discovery, sovereign wealth research arms, and regulated
          investigation work, ResearchOne deploys as a single-tenant stack on dedicated infrastructure with contractually
          enforced isolation.
        </p>

        <ul className="mt-10 space-y-8">
          <li>
            <h2 className="font-serif text-2xl text-r1-text">Single-tenant deployment</h2>
            <p className="mt-2 text-r1-text-muted">
              Dedicated Postgres, Redis, and runtime — no shared compute or storage. Your workloads stay inside the
              perimeter you approve.
            </p>
          </li>
          <li>
            <h2 className="font-serif text-2xl text-r1-text">Custom retention</h2>
            <p className="mt-2 text-r1-text-muted">
              You define how long anything is stored, and where. Policies can follow legal hold, jurisdictional, or program
              requirements without sharing retention logic with other tenants.
            </p>
          </li>
          <li>
            <h2 className="font-serif text-2xl text-r1-text">Opt-out of global ingestion</h2>
            <p className="mt-2 text-r1-text-muted">
              Your research never enters the cross-customer intelligence layer. Contractually guaranteed — critical for
              sensitive litigation, national-security-adjacent analysis, and regulated industries.
            </p>
          </li>
        </ul>

        <p className="mt-12 text-r1-text-muted">
          Talk to sales:{' '}
          <a href="mailto:sales@intellme.com" className="text-r1-accent hover:underline">
            sales@intellme.com
          </a>
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
