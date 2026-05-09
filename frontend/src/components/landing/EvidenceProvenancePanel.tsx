const CLAIMS = [
  { id: 'claim-1', text: 'Multi-modal LLMs trained on synthetic data show measurable performance gains on reasoning benchmarks' },
  { id: 'claim-2', text: 'three independent evaluations report contradictory findings on out-of-distribution generalization' },
  { id: 'claim-3', text: 'The mechanism remains under-characterized' },
] as const;

const EVIDENCE_CARDS = [
  {
    claimId: 'claim-1',
    tier: 'Strong evidence',
    tierColor: 'bg-tier-strong_evidence',
    sourceType: 'Peer-reviewed',
    reason: 'Largest sample (n=12,400) with reproducible methodology',
    confidence: 3,
  },
  {
    claimId: 'claim-2',
    tier: 'Contradiction',
    tierColor: 'bg-tier-testimony',
    sourceType: 'Multi-source',
    reason: 'Three independent evals; protocol-level differences material',
    confidence: 2,
  },
  {
    claimId: 'claim-3',
    tier: 'Speculation',
    tierColor: 'bg-tier-speculation',
    sourceType: 'Mechanism',
    reason: 'Mechanism unconfirmed; included as falsification target',
    confidence: 1,
  },
] as const;

function ConfidenceDots({ filled }: { filled: number }) {
  return (
    <div className="flex gap-1" aria-label={`Confidence: ${filled} of 4`}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={`inline-block h-2 w-2 rounded-full ${
            n <= filled ? 'bg-r1-accent' : 'bg-r1-text-muted/30'
          }`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export default function EvidenceProvenancePanel() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="font-serif text-3xl">Every claim has a source. Every source has a reason.</h2>
      <p className="mt-3 text-r1-text-muted">
        Citation integrity isn&apos;t a feature — it&apos;s the contract. Each claim maps to an evidence card.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {/* Left: sample excerpt */}
        <div className="rounded-xl border border-white/10 bg-r1-bg-deep p-5 text-sm leading-relaxed text-r1-text-muted">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wide text-r1-accent">Sample excerpt</p>
          <p>
            <button
              className="peer/claim1 group/claim1 inline cursor-default rounded bg-tier-strong_evidence/10 px-1 text-r1-text underline decoration-tier-strong_evidence/40 transition hover:bg-tier-strong_evidence/20 focus:bg-tier-strong_evidence/20 focus:outline-none focus:ring-1 focus:ring-tier-strong_evidence"
              aria-label="Claim 1: performance gains on reasoning benchmarks — Strong evidence"
              type="button"
            >
              {CLAIMS[0].text}
            </button>
            {', though '}
            <button
              className="peer/claim2 group/claim2 inline cursor-default rounded bg-tier-testimony/10 px-1 text-r1-text underline decoration-tier-testimony/40 transition hover:bg-tier-testimony/20 focus:bg-tier-testimony/20 focus:outline-none focus:ring-1 focus:ring-tier-testimony"
              aria-label="Claim 2: contradictory findings on generalization — Contradiction"
              type="button"
            >
              {CLAIMS[1].text}
            </button>
            {'. '}
            <button
              className="peer/claim3 group/claim3 inline cursor-default rounded bg-tier-speculation/10 px-1 text-r1-text underline decoration-tier-speculation/40 transition hover:bg-tier-speculation/20 focus:bg-tier-speculation/20 focus:outline-none focus:ring-1 focus:ring-tier-speculation"
              aria-label="Claim 3: mechanism under-characterized — Speculation"
              type="button"
            >
              {CLAIMS[2].text}
            </button>
            .
          </p>
        </div>

        {/* Right: evidence cards */}
        <div className="flex flex-col gap-3">
          {EVIDENCE_CARDS.map((card) => (
            <div
              key={card.claimId}
              className="rounded-lg border border-white/10 bg-r1-bg-deep p-4 transition"
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold text-r1-bg ${card.tierColor}`}>
                  {card.tier}
                </span>
                <span className="text-xs text-r1-text-muted">{card.sourceType}</span>
              </div>
              <p className="mt-2 text-xs text-r1-text-muted">{card.reason}</p>
              <div className="mt-2">
                <ConfidenceDots filled={card.confidence} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-6 text-sm text-r1-text-muted">
        Every source is selected for a role — supporting, contrasting, primary, regulatory — not just retrieved.
        We optimize for source diversity, not source volume.
      </p>
    </section>
  );
}
