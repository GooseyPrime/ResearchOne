import { Link } from 'react-router-dom';

type GuideSection = {
  id: string;
  title: string;
  body?: string;
  bullets?: string[];
  links?: Array<{ to: string; label: string }>;
};

const QUICK_START_CHECKLIST = [
  'Open Research and stay in EZ Research.',
  'Describe what you want to know, decide, verify, find, or produce.',
  'Add files or web pages that ResearchOne must read.',
  'Answer clarifying questions or skip them.',
  'Review scope, assumptions, sources, deliverables, and expected charge.',
  'Confirm the plan, follow progress, then read the report with sources and limitations.',
] as const;

const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: 'ez-vs-lab',
    title: 'EZ Research versus Research Lab',
    body:
      'EZ Research is the guided path: describe the outcome and ResearchOne proposes the approach. Research Lab is for advanced control over methods, specialist roles, sources, model choices, and report settings.',
    links: [{ to: '/app/research', label: 'Open Research' }],
  },
  {
    id: 'write-request',
    title: 'How to write a useful request',
    body:
      'State the result you need and key constraints. Include audience, timeframe, region, required sources, and output format when they matter. You do not need to force every request into a falsifiable hypothesis.',
  },
  {
    id: 'request-examples',
    title: 'Example requests by outcome',
    bullets: [
      'Explain: Explain municipal bond insurance for finance leaders and summarize the current market.',
      'Compare: Compare three EHR products for a 40-person clinic with a 12-month budget horizon.',
      'Verify: Evaluate key factual claims in this article and separate confirmed, contradicted, unsupported, and unresolved claims.',
      'Opportunity: Identify underserved problems in residential heat-pump installation in the US Northeast.',
      'Implementation: Create an evidence-based SOC 2 readiness implementation plan for a seed-stage SaaS startup.',
      'Quantitative: Extract reported metrics from these studies and compare outcomes on a normalized basis.',
    ],
  },
  {
    id: 'files-pages-corpus',
    title: 'Files, web pages, and the reusable Corpus',
    bullets: [
      'Attachments are for this run unless you explicitly ingest them into your Corpus.',
      'Use Supplemental URLs / pages-to-read controls when a page must be fetched for the run.',
      'A single URL reads a single page unless you explicitly enable site crawl where available.',
      'JavaScript-heavy, paywalled, authenticated, or bot-blocked pages may not be readable end-to-end.',
    ],
    links: [
      { to: '/app/ingest', label: 'Open Ingest' },
      { to: '/app/corpus', label: 'Open Corpus' },
    ],
  },
  {
    id: 'plan-review',
    title: 'How to review the plan',
    body:
      'Check what the report will deliver, scope, sources, and expected depth/cost before confirmation. Requirements are your explicit instructions. Assumptions are system interpretations you can edit or reject.',
  },
  {
    id: 'standard-vs-deep',
    title: 'Standard versus Deep',
    body:
      'Standard is faster for focused questions. Deep supports broader source work and heavier specialist analysis for complex or high-stakes research. Your available depth depends on entitlement and is shown before submission.',
  },
  {
    id: 'run-progress',
    title: 'Following a run',
    body:
      'Progress answers what is happening now, what is complete, whether ResearchOne needs input from you, and what happens next. You can leave and return to a run from Dossiers or the run URL.',
  },
  {
    id: 'reading-results',
    title: 'Reading evidence, citations, uncertainty, and contradictions',
    bullets: [
      'Citations support nearby statements but do not guarantee source correctness.',
      'ResearchOne separates evidence, interpretation, uncertainty, and contradiction when available.',
      'Conflicting sources are surfaced so you can review tradeoffs directly.',
    ],
  },
  {
    id: 'revision-spinoff',
    title: 'Revision versus follow-up research',
    bullets: [
      'Revise this report updates selected sections using the existing report plus any new material you provide.',
      'Start follow-up research creates a new full run using the report as context; normal plan and billing rules apply.',
    ],
  },
  {
    id: 'dossiers',
    title: 'Dossiers',
    body:
      'A Dossier keeps one research project together: request, confirmed plan, run history, report, sources, revisions, and related follow-up research.',
    links: [{ to: '/app/dossiers', label: 'Open Dossiers' }],
  },
  {
    id: 'monitoring',
    title: 'Living Reports and Reverse-Citation Watch',
    body:
      'Living Reports monitor finalized reports for relevant updates during an active period. Reverse-Citation Watch tracks later citation activity for supported report/source sets.',
    links: [{ to: '/app/add-ons', label: 'Open Add-ons & monitoring' }],
  },
  {
    id: 'data-tools',
    title: 'Corpus, Ingest, Embedding Viz, Atlas, and Knowledge Graph',
    bullets: [
      'Use Ingest when material should be reusable across future projects.',
      'Use Embedding Viz and Knowledge Graph to explore patterns in available material.',
      'Atlas export is a third-party export path and should be treated as external data transfer.',
    ],
    links: [
      { to: '/app/embedding-viz', label: 'Open Embedding Viz' },
      { to: '/app/knowledge-graph', label: 'Open Knowledge Graph' },
      { to: '/app/atlas', label: 'Open Atlas' },
    ],
  },
  {
    id: 'billing',
    title: 'Billing, wallet, and monitor tokens',
    body:
      'Billing & usage covers three separate systems: subscription quota, wallet credits, and monitor tokens. Check expected charge at plan review before starting work.',
    links: [{ to: '/app/billing', label: 'Open Billing & usage' }],
  },
  {
    id: 'privacy-byok',
    title: 'Privacy, data contribution, and BYOK',
    body:
      'Data contribution consent is optional and can be changed later. BYOK routes supported provider calls through your configured keys, while platform subscription terms still apply.',
    links: [
      { to: '/account', label: 'Open Account settings' },
      { to: '/app/byok', label: 'Open BYOK settings' },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    bullets: [
      'If a run fails, check whether inputs were preserved and retry from the run detail.',
      'If a page was not readable, add a direct URL or a readable document extract.',
      'If a billing action fails, use Billing & usage and then contact support with the request id.',
    ],
  },
  {
    id: 'under-hood',
    title: 'Under the hood for advanced users',
    body:
      'Advanced diagnostics include specialist routing, technical traces, and model/provider details. These are useful for debugging and repeatability, but they are optional for first-run success.',
    links: [{ to: '/app/guide/research-v2', label: 'Open Deep research capabilities' }],
  },
];

export default function GuidePage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-white">ResearchOne guide</h1>
        <p className="text-sm text-slate-400">
          Task-focused guidance for asking better questions, reviewing plans, and interpreting reports.
        </p>
      </div>

      <section className="card p-6 space-y-4 border border-accent/20 bg-accent/5">
        <h2 className="text-base font-semibold text-white">Quick start checklist</h2>
        <ol className="space-y-2 list-decimal list-inside text-sm text-slate-300 leading-relaxed">
          {QUICK_START_CHECKLIST.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      {GUIDE_SECTIONS.map((section) => (
        <section key={section.id} className="card p-6 space-y-3">
          <h2 className="text-base font-semibold text-white">{section.title}</h2>
          {section.body ? <p className="text-sm text-slate-300 leading-relaxed">{section.body}</p> : null}
          {section.bullets ? (
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-300 leading-relaxed">
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          {section.links?.length ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {section.links.map((link) => (
                <Link key={`${section.id}-${link.to}`} to={link.to} className="text-accent hover:underline">
                  {link.label}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
