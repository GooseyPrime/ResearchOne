import { Link } from 'react-router-dom';

export default function BYOKPage() {
  return (
    <main className="min-h-screen bg-r1-bg px-4 py-16 text-r1-text sm:px-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-serif text-4xl">Bring your own keys.</h1>
        <p className="mt-4 text-r1-text-muted">
          Run ResearchOne on your own inference budget using OpenRouter or direct provider keys. ResearchOne handles
          orchestration, corpus, knowledge graph, and reports while you control routing.
        </p>
        <Link to="/" className="mt-8 inline-block text-r1-accent">
          ← Back to landing
        </Link>
      </div>
    </main>
  );
}
