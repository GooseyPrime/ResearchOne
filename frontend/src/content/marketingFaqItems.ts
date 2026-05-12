/** Shared FAQ entries for landing and `/faq` — single source of truth. */
export const MARKETING_FAQ_ITEMS = [
  {
    question: "What's the difference between ResearchOne and chat-style AI research?",
    answer:
      'Chat-style tools optimize for fast cited answers. ResearchOne uses a ten-stage multi-agent pipeline with a dedicated skeptic agent and explicit evidence tiering, optimized for defensible long-form reports where contradictions matter and the output needs to outlive the conversation.',
  },
  {
    question: 'Which deep research mode should I use?',
    answer:
      'General Epistemic for contested questions. Investigative for tracking incentives or narrative drift. Patent / Technical Gap for prior-art mapping. Novel Application Discovery for mechanism-to-application paths. Anomaly Correlation for weak-signal hypothesis testing.',
  },
  {
    question: 'How long does a report take?',
    answer: 'Standard runs: 2–5 minutes. Deep runs: 8–20 minutes depending on mode, evidence-set size, and discovery scope.',
  },
  {
    question: 'What happens to my report after 120 days?',
    answer:
      'Final reports are retained for 120 days by default. Export anytime, or attach a Living Report to keep the source set and monitoring config alive indefinitely. Sovereign Enterprise customers set custom retention by contract.',
  },
  {
    question: 'How does ResearchOne handle citations and source verification?',
    answer:
      'Every claim is tagged by evidence tier (established fact, strong evidence, testimony, inference, speculation). Every source is selected for a role — supporting, contrasting, primary, or regulatory — and recorded with inclusion reasoning. The Verifier agent gates publication on citation integrity.',
  },
  {
    question: 'Can I edit a published report?',
    answer:
      'Yes. Every report supports a seven-agent revision workflow with structured intake, impact mapping, change planning, section rewriting, citation integrity checks, diff assembly, and a final verifier.',
  },
  {
    question: 'Can I bring my own model keys?',
    answer:
      'Yes. The BYOK tier lets you run all five modes on your own OpenRouter or direct-provider keys. Compute is billed to your provider; ResearchOne bills only for orchestration.',
  },
  {
    question: 'Is my data used to train any models?',
    answer:
      'No. ResearchOne does not train on customer research data. BYOK and Sovereign Enterprise tiers add additional contractual data-use guarantees.',
  },
] as const satisfies ReadonlyArray<{ question: string; answer: string }>;
