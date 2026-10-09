import { DOUBLE_CHECK } from './customerOptions';
/** Shared FAQ for landing inline section — questions avoid third-party product names (marketing hardening). */
export const MARKETING_FAQ_ITEMS = [
  {
    question: 'How is ResearchOne different from mainstream deep research assistants?',
    answer:
      'Mainstream assistants optimize for fast cited answers. ResearchOne builds a plan first, gathers and reads sources, then applies specialist analysis based on your requested outcome. It keeps evidence, interpretation, uncertainty, and contradictions visible in one cited report.',
  },
  {
    question: 'What does Double-check actually do?',
    answer: `${DOUBLE_CHECK.description} Example: ${DOUBLE_CHECK.example}`,
  },
  {
    question: 'What happens when two high-tier sources disagree?',
    answer:
      'Both lines of argument remain visible with tier labels. The report names the disagreement, cites each side, and leaves the judgment work to the reader — we do not silently pick a winner.',
  },
  {
    question: 'Can ResearchOne forge or hallucinate a citation?',
    answer:
      'Every finding is bound to a source passage in the Verifier and Citation Bind stages. If a span cannot be verified, the finding is blocked or downgraded — we do not ship uncited assertions as cited.',
  },
  {
    question: 'How do Living updates work — will my old report change under me?',
    answer:
      'Living Reports create new discrete versions when sources meaningfully shift. You keep prior versions for audit, citation, or rollback; nothing silently rewrites the version your team already agreed on.',
  },
  {
    question: 'Can I export a report and cite it like a static PDF?',
    answer:
      'Yes. Exports carry the citation map and version metadata so a static snapshot remains defensible; Living mode is optional when you need ongoing monitoring.',
  },
] as const satisfies ReadonlyArray<{ question: string; answer: string }>;

/** FAQ questions verbatim — used on `/faq` only. */
export const FAQ_PAGE_AUDIT_VERBATIM_ITEMS = [
  {
    question: 'How is this different from ChatGPT Deep Research or Claude Research?',
    answer:
      'ResearchOne is plan-first and outcome-adaptive: it can run different specialist methods for explanation, comparison, verification, implementation research, or quantitative analysis. The comparison is structural auditability and explicit uncertainty handling versus a single chat-shaped pass.',
  },
  {
    question: 'What does Double-check actually do?',
    answer: `${DOUBLE_CHECK.description} Example: ${DOUBLE_CHECK.example}`,
  },
  {
    question: 'What happens when two high-tier sources disagree?',
    answer:
      'Both survive into the report with tier tags and a named contradiction block — no silent consensus rewrite.',
  },
  {
    question: 'Can ResearchOne forge or hallucinate a citation?',
    answer:
      'Findings without a verified source passage do not ship as cited. The Verifier gate blocks or downgrades them first.',
  },
  {
    question: 'How do Living updates work — will my old report change under me?',
    answer:
      'Each update is a new version with a diff trail. You pin, compare, or roll back; prior agreed versions remain addressable.',
  },
  {
    question: 'Can I export a report and cite it like a static PDF?',
    answer:
      'Exports include citations and version identifiers so a frozen PDF remains traceable to the corroboration state at export time.',
  },
] as const satisfies ReadonlyArray<{ question: string; answer: string }>;
