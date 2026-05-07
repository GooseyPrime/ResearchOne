import { Link } from 'react-router-dom';
import LandingHeader from '../components/landing/LandingHeader';
import LandingFooter from '../components/landing/LandingFooter';

const PROVIDERS = ['OpenRouter (multi-model routing)', 'Anthropic direct', 'OpenAI direct', 'Google direct'];

export default function BYOKPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Bring your own keys.</h1>
        <p className="mt-4 text-r1-text-muted">
          If you already have OpenRouter or direct provider keys — Anthropic, OpenAI, Google — you can run ResearchOne on
          your own inference budget. The platform handles orchestration, corpus, knowledge graph, and reports; you control
          the model layer end-to-end.
        </p>

        <section className="mt-10 rounded-xl border border-white/10 bg-r1-bg-deep p-6">
          <h2 className="font-serif text-2xl">Supported routing targets</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-r1-text-muted">
            {PROVIDERS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-r1-text-muted">
            Keys stay server-side — the browser never sees raw secrets. Configure credentials after you create an account.
          </p>
        </section>

        <Link
          to="/sign-up"
          className="mt-10 inline-flex rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep"
        >
          Configure BYOK →
        </Link>
      </main>
      <LandingFooter />
    </div>
  );
}
