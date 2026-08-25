/** Shared FAQ for landing inline section — questions avoid third-party product names (marketing hardening). */
export const MARKETING_FAQ_ITEMS = [
  {
    question: 'How is ResearchOne different from mainstream deep research assistants?',
    answer:
      'Mainstream assistants optimize for fast cited answers. ResearchOne builds a plan first, gathers and reads sources, then applies specialist analysis based on your requested outcome. It keeps evidence, interpretation, uncertainty, and contradictions visible in one cited report.',
  },
  {
    question: 'What does the challenge pass actually do?',
    answer:
      'The challenge pass argues against the draft: it surfaces counter-sources, stress-tests claims, and preserves contradictions as named outputs rather than smoothing them away.',
  },
  {
    question: 'What happens when two high-tier sources disagree?',
    answer:
      'Both lines of argument remain visible with tier labels. The report names the disagreement, cites each side, and leaves the judgment work to the reader — we do not silently pick a winner.',
  },
  {
    question: 'Can ResearchOne forge or hallucinate a citation?',
    answer:
      'Every claim is bound to a source span in the Verifier and Citation Bind stages. If a span cannot be verified, the claim is blocked or downgraded — we do not ship uncited assertions as cited.',
  },
  {
    question: 'How do Living updates work — will my old report change under me?',
    answer:
      'Living Reports create new discrete versions when sources meaningfully shift. You keep prior versions for audit, citation, or rollback; nothing silently rewrites the version your team already agreed on.',
  },
  {
    question: "What's the difference between BYOK and the Sovereign tier?",
    answer:
      'BYOK runs ResearchOne on your own model and search keys with orchestration billed here. Sovereign adds single-tenant deployment, contract isolation, and retention controls for workloads that cannot leave your perimeter.',
  },
  {
    question: 'Can I export a report and cite it like a static PDF?',
    answer:
      'Yes. Exports carry the citation map and version metadata so a static snapshot remains defensible; Living mode is optional when you need ongoing monitoring.',
  },
] as const satisfies ReadonlyArray<{ question: string; answer: string }>;

/** Site audit §2.10 FAQ questions verbatim — used on `/faq` only (Wave 2). */
export const FAQ_PAGE_AUDIT_VERBATIM_ITEMS = [
  {
    question: 'How is this different from ChatGPT Deep Research or Claude Research?',
    answer:
      'ResearchOne is plan-first and outcome-adaptive: it can run different specialist methods for explanation, comparison, verification, implementation research, or quantitative analysis. The comparison is structural auditability and explicit uncertainty handling versus a single chat-shaped pass.',
  },
  {
    question: 'What does the challenge pass actually do?',
    answer:
      'It receives the draft report and argues against it: searches for counter-sources, stress-tests claims, and returns counter-claims with contradictions preserved for the Citation Bind stage.',
  },
  {
    question: 'What happens when two high-tier sources disagree?',
    answer:
      'Both survive into the report with tier tags and a named contradiction block — no silent consensus rewrite.',
  },
  {
    question: 'Can ResearchOne forge or hallucinate a citation?',
    answer:
      'Claims without a verified source span do not ship as cited. The Verifier gate blocks or downgrades them first.',
  },
  {
    question: 'How do Living updates work — will my old report change under me?',
    answer:
      'Each update is a new version with a diff trail. You pin, compare, or roll back; prior agreed versions remain addressable.',
  },
  {
    question: "What's the difference between BYOK and the Sovereign tier?",
    answer:
      'BYOK brings your keys into our orchestration plane. Sovereign runs the stack in your tenancy with contract isolation and custom retention.',
  },
  {
    question: 'Can I export a report and cite it like a static PDF?',
    answer:
      'Exports include citations and version identifiers so a frozen PDF remains traceable to the corroboration state at export time.',
  },
] as const satisfies ReadonlyArray<{ question: string; answer: string }>;
