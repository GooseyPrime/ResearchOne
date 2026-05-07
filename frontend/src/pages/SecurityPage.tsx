import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-4xl space-y-10 px-4 py-16 sm:px-6">
        <div>
          <h1 className="font-serif text-4xl">Your research, your data.</h1>
          <p className="mt-4 text-r1-text-muted">
            Security primitives mirror the commitments on the landing page — with explicit notes on how BYOK and shared
            infrastructure interact.
          </p>
        </div>

        <section>
          <h2 className="font-serif text-2xl">Server-side model calls</h2>
          <p className="mt-2 text-r1-text-muted">
            API keys never reach your browser. Every model call is mediated by ResearchOne&apos;s backend, so prompts,
            attachments, and retrieval context stay inside the API trust boundary rather than leaking to client-side
            bundles or extensions.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl">Per-user isolation</h2>
          <p className="mt-2 text-r1-text-muted">
            Row-level security enforces strict access boundaries between accounts on shared infrastructure. Queries respect
            tenant context so one user cannot read another&apos;s corpus, runs, or exports — even when workloads share the same
            cluster.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl">Encrypted secrets</h2>
          <p className="mt-2 text-r1-text-muted">
            BYOK keys are encrypted at rest with per-user keys. They are never logged and never displayed back in plaintext
            after capture — operators rotate through the vault UI instead of copying secrets into tickets.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-2xl">Export and delete</h2>
          <p className="mt-2 text-r1-text-muted">
            Your reports, corpus, and revisions can be exported or deleted from account settings. Deletion flows cascade to
            dependent artifacts where the schema allows, and audit logs record administrative actions for enterprise tiers.
          </p>
        </section>

        <nav className="flex flex-wrap gap-4 border-t border-white/10 pt-8 text-sm">
          <Link to="/privacy" className="text-r1-accent hover:underline">
            Privacy Policy
          </Link>
          <Link to="/terms" className="text-r1-accent hover:underline">
            Terms of Service
          </Link>
          <Link to="/acceptable-use" className="text-r1-accent hover:underline">
            Acceptable Use
          </Link>
        </nav>
      </main>
      <LandingFooter />
    </div>
  );
}
