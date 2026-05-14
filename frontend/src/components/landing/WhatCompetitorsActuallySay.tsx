import { Link } from 'react-router-dom';

type QuoteCard = {
  quote: string;
  attribution: string;
  url: string;
  counterLine: string;
};

const QUOTES: readonly QuoteCard[] = [
  {
    quote: 'the evidence is peer-reviewed medical literature.',
    attribution: 'Daniel Nadler, OpenEvidence CEO, on the Sequoia Capital podcast.',
    url: 'https://sequoiacap.com/podcast/training-data-daniel-nadler/',
    counterLine:
      'Peer-reviewed medical literature is a source. The patients, the trials, the instruments — those are the evidence.',
  },
  {
    quote: 'Verifiable Evidence — Every answer is grounded in real papers, never generated or hallucinated.',
    attribution: 'Consensus, product homepage.',
    url: 'https://consensus.app/',
    counterLine:
      'Real papers can still be wrong, retracted, or contradicted by other real papers. Grounding in papers is grounding in sources, not in evidence.',
  },
  {
    quote: 'where evidence must be fast and rigorous enough to inform high-stakes decisions.',
    attribution: 'Elicit, blog post "Elicit Systematic Review: Now Built for PRISMA 2020."',
    url: 'https://elicit.com/blog/systematic-review-for-prisma-2020',
    counterLine:
      'Systematic review is the disciplined synthesis of sources. The output is a tiered source summary, not new evidence.',
  },
  {
    quote:
      'may struggle with distinguishing authoritative information from rumors, and currently shows weakness in confidence calibration.',
    attribution: 'OpenAI, Deep Research System Card (Feb 25, 2025).',
    url: 'https://openai.com/index/deep-research-system-card/',
    counterLine:
      'A Skeptic agent on every claim is how we make the distinction explicit — not a hope, a stage.',
  },
  {
    quote: 'source bias transfer and over-association of unrelated facts.',
    attribution: 'Stanford STORM project team, methodology page.',
    url: 'https://storm-project.stanford.edu/research/storm/',
    counterLine:
      'Honest self-criticism, and a known failure mode for any retrieval-only system. Contradiction preservation and a skeptic pass are how we counter it.',
  },
];

/** Wave 4 — verbatim competitor quotes + ResearchOne counter-lines (Rule 31). */
export default function WhatCompetitorsActuallySay() {
  return (
    <section id="what-competitors-say" className="mt-16 scroll-mt-24">
      <h2 className="font-serif text-3xl">What Competitors Actually Say</h2>
      <p className="mt-4 max-w-3xl text-r1-text-muted">
        Most AI research tools call retrieved papers &quot;evidence.&quot; Papers are not evidence. Evidence is what the
        papers are about — FOIA returns, raw data, sensor data, recordings, primary documents. Everything else is a
        source: a documented interpretation of an event. ResearchOne&apos;s reasoning preamble has always distinguished
        the two. We refuse to flatten the distinction on the surface, either.
      </p>
      <div className="mt-10 space-y-10">
        {QUOTES.map((q) => (
          <figure key={q.url} className="rounded-xl border border-white/10 bg-r1-bg-deep p-6">
            <blockquote cite={q.url} className="border-l-2 border-r1-accent pl-4 text-r1-text">
              <p className="font-serif text-lg leading-relaxed">&ldquo;{q.quote}&rdquo;</p>
            </blockquote>
            <figcaption className="mt-3 text-sm text-r1-text-muted">{q.attribution}</figcaption>
            <p className="mt-4 text-sm font-medium text-r1-text">
              <span className="text-r1-accent">ResearchOne response:</span> {q.counterLine}
            </p>
            <p className="mt-4">
              <a
                href={q.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-r1-accent hover:underline"
              >
                Verify at source
              </a>
            </p>
          </figure>
        ))}
      </div>
      <p className="mt-10 text-sm text-r1-text-muted">
        See also{' '}
        <Link to="/guide" className="text-r1-accent hover:underline">
          Guide — source-corroboration tiers
        </Link>
        .
      </p>
    </section>
  );
}
