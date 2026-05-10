const CARDS = [
  {
    title: 'Reasoning, not recall.',
    body: "Most AI tools collapse a question into top-k retrieval and a single-model summary. ResearchOne plans the investigation, retrieves evidence, reasons through it, and routes a dedicated skeptic agent to attack its own conclusions before signing off. The reasoning trace is auditable end-to-end.",
  },
  {
    title: 'Contradictions stay visible.',
    body: 'When sources disagree, polished summaries hide it. ResearchOne tags every claim by evidence tier — established fact, strong evidence, testimony, inference, speculation — and surfaces contradictions as first-class outputs rather than smoothing them into consensus.',
  },
  {
    title: 'The report is the product.',
    body: "Chat threads are ephemeral. ResearchOne reports are durable artifacts: citation-graded, version-controlled, and — with Living Reports — kept current as the world changes. Pin a version, roll back, export the audit trail. The agent is auditable, not just the answer.",
  },
] as const;

export default function WhyResearchOne() {
  return (
    <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 md:grid-cols-3 sm:px-6">
      {CARDS.map((card) => (
        <article key={card.title} className="rounded-xl border border-white/10 bg-r1-bg-deep p-5">
          <h3 className="font-serif text-2xl">{card.title}</h3>
          <p className="mt-3 text-sm leading-relaxed text-r1-text-muted">{card.body}</p>
        </article>
      ))}
    </section>
  );
}
