import { Link } from 'react-router-dom';
import {
  HelpCircle,
  FlaskConical,
  Database,
  Layers,
  AlertTriangle,
  Shield,
  Zap,
  Brain,
  Target,
  ArrowRight,
  FileSearch,
  PenLine,
  Link2,
  ListChecks,
  GitBranch,
  RefreshCw,
} from 'lucide-react';

type GuideSection = {
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  color: string;
  title: string;
  content?: string;
  roles?: { icon: React.ComponentType<{ size?: string | number; className?: string }>; label: string; desc: string }[];
  tiers?: { tier: string; label: string; color: string; desc: string }[];
  steps?: string[];
  bullets?: string[];
};

const PIPELINE_STAGES = [
  { icon: Brain, label: 'Planning', desc: 'Decomposes your query, proposes sub-questions, and may pause for plan confirmation before expensive retrieval.' },
  { icon: FileSearch, label: 'Discovery', desc: 'Bounded open-web search finds candidate pages; top hits are ingested into your run corpus (not a full-site crawler).' },
  { icon: Database, label: 'Retrieval', desc: 'Hybrid vector + full-text search over corpus chunks (your uploads, supplemental URLs, and discovery ingest).' },
  { icon: Zap, label: 'Reasoning', desc: 'Builds structured argument chains from retrieved sources; tags claims by corroboration tier.' },
  { icon: Shield, label: 'Challenge', desc: 'Skeptic and adversarial roles pressure-test conclusions (strongest on Deep Adversarial Synthesis).' },
  { icon: PenLine, label: 'Synthesis', desc: 'Drafts the long-form report and plain-language summary from what the corpus actually supports.' },
  { icon: Target, label: 'Verification', desc: 'Checks tier discipline, contradictions, and persistence before the report is saved.' },
];

const SECTIONS: GuideSection[] = [
  {
    icon: FlaskConical,
    color: 'text-accent',
    title: 'What is ResearchOne?',
    content: `ResearchOne is a disciplined anomaly research platform. It is not a chatbot. It is a structured source-gathering and reasoning system designed to investigate where mainstream corpora may be incomplete, filtered, distorted, or consensus-bound.

The system enforces strict epistemic discipline: every claim is tagged with a source-corroboration tier, contradictions are first-class data, and reports are designed to attack their own conclusions before finalizing them.`,
  },
  {
    icon: ListChecks,
    color: 'text-research-teal',
    title: 'Research console — two methods',
    content: `All new investigations start on Research (/app/research). Use the method toggle at the top of the page:

• Standard Retrieval — fast multi-source retrieval and synthesis. Best for general inquiries, historical context, and when you already have a seeded corpus. Does not use the Deep (V2) engine.

• Deep Adversarial Synthesis — full multi-stage pipeline with reasoning models, file uploads, research objective modes, skeptic persona, citation style, and red-team adversarial roles. Requires a Pro-tier plan (or admin access). URL: /app/research?engine=v2 switches the toggle to Deep.

Both methods share the same live trace, plan review panel when applicable, and ?runId= deep-linking for in-progress runs.`,
  },
  {
    icon: Brain,
    color: 'text-research-purple',
    title: 'Pipeline stages (what the trace shows)',
    content: `The progress trace on Research maps to these stages. Deep runs use the same stage names; Challenge and adversarial roles are heavier on Deep Adversarial Synthesis.`,
    roles: PIPELINE_STAGES,
  },
  {
    icon: ListChecks,
    color: 'text-indigo-400',
    title: 'Plan confirmation gate',
    content: `After planning, many runs pause at plan_pending_confirmation before Discovery and Retrieval consume full pipeline cost.

• Review the proposed plan inline on Research — confirm, refine with feedback, or cancel.
• Account → plan preferences can change default behavior (e.g. auto-confirm when you trust the planner).
• Until you confirm, the worker does not continue past the gate. Cancel releases billing holds where applicable.

If you leave the page, use the plan review banner or return via ?runId= to finish confirmation.`,
  },
  {
    icon: Link2,
    color: 'text-amber-400',
    title: 'URLs, files, discovery — what actually gets into the corpus',
    bullets: [
      'URLs in the research question text are instructions to the model only. They are not automatically fetched. To force-fetch a page, add it under Supplemental URLs (Standard) or Attach supporting files / URLs (Deep).',
      'Each supplemental URL is HTTP-fetched, text-extracted, and ingested for that run. PDF/TXT/MD uploads follow the same path.',
      'Discovery runs bounded web search (e.g. Tavily/Brave) and ingests a limited set of top candidates — it does not crawl every link on a domain or mirror an entire site.',
      'Fetch uses server-side HTTP + HTML text extraction, not a headless browser. Heavy JavaScript sites may return thin text; SPAs may look empty after strip. Add key inner pages as separate supplemental URLs if the homepage is not enough.',
      'Filter by Tags (optional) scopes retrieval to sources you tagged during Ingest — useful when you pre-seeded a corpus.',
      'If a report says it could not access a site, check the trace Discovery / supplemental ingest lines first: often the domain never entered the corpus (URL only in the query), discovery did not rank it, or fetch returned little extractable text.',
    ],
  },
  {
    icon: FlaskConical,
    color: 'text-research-purple',
    title: 'Deep Adversarial Synthesis — options beyond Standard',
    content: `On Deep Adversarial Synthesis, additional controls shape orchestration and report structure. Full definitions for each research objective are on the companion page.`,
    bullets: [
      'Research objective — switches ensemble focus and report template (General, Investigative Synthesis, Patent Gap, Novel Application, Anomaly Correlation). Tier may limit which objectives appear.',
      'Citation style — academic export formatting (APA, Chicago, etc.).',
      'Report length — preset or custom word target (backend clamps to safe bounds).',
      'Skeptic persona — optional tone/constraints merged into supplemental context for the Challenge stage.',
      'Saved orchestration profiles — reuse model + objective presets (paid tiers).',
      'Per-role model overrides — advanced; live trace records usedFallback when a non-default model runs.',
    ],
  },
  {
    icon: RefreshCw,
    color: 'text-research-blue',
    title: 'After a report — revision vs spinoff',
    bullets: [
      'In-place revision (same run, same report) — section rewrites with optional supplemental URLs/files for that revision only. Does not re-run the full research pipeline.',
      'Research spinoff — new full run with lineage from a prior report (from report → Start new research / spinoff prefill). Same tier and billing rules as starting Deep research; submit lands on /app/research?runId= with the new run.',
      'Reopen request on a finished run reloads the form from that run — reset your supplemental URLs/files if you change topics before resubmitting.',
    ],
  },
  {
    icon: Database,
    color: 'text-research-teal',
    title: 'Source-corroboration tiers — critical distinction',
    tiers: [
      { tier: 'established_fact', label: 'Established Fact', color: 'text-green-400', desc: 'Replicated findings, strong consensus, high evidentiary burden met.' },
      { tier: 'strong_evidence', label: 'Strong corroboration', color: 'text-blue-400', desc: 'Good experimental or empirical support, not yet at consensus level.' },
      { tier: 'testimony', label: 'Testimony', color: 'text-amber-400', desc: 'Eyewitness, expert, or whistleblower accounts. Valuable but unverified.' },
      { tier: 'inference', label: 'Inference', color: 'text-purple-400', desc: 'Logical conclusions drawn from sources. Marked clearly as not empirically direct.' },
      { tier: 'speculation', label: 'Speculation', color: 'text-red-400', desc: 'Hypothesis, conjecture. Investigation target, not conclusion.' },
    ],
  },
  {
    icon: Layers,
    color: 'text-research-blue',
    title: 'Using Embedding Atlas',
    content: `Embedding Atlas is your investigation map, not your oracle. After building corpus embeddings, export them and explore in Nomic Atlas.

Dense clusters = mainstream consensus. Investigate these for completeness, but don't treat density as truth.

Isolated outliers = neglected or anomalous information. These are investigation leads, not verdicts.

Sparse bridges = overlooked connections between conceptual regions. High-value targets for deeper research.

The correct workflow: find interesting points in Atlas → bring those topics back to Research → run targeted research queries → generate disciplined reports.`,
  },
  {
    icon: AlertTriangle,
    color: 'text-amber-400',
    title: 'What this system will NOT do',
    content: `ResearchOne is designed with hard constraints against epistemic failure modes:

• It will NOT present inferences as established facts
• It will NOT suppress contradictions — they are stored and surfaced
• It will NOT treat consensus density as a proxy for truth
• It will NOT treat outliers as automatically correct
• It will NOT generate reports without falsification criteria
• It will NOT allow the synthesizer to exceed the source base
• It will NOT automatically crawl every page on a website you mention in the query

The Challenge and Verification stages exist specifically to prevent the system from becoming a sophisticated hallucination engine.`,
  },
  {
    icon: GitBranch,
    color: 'text-red-400',
    title: 'Troubleshooting common situations',
    bullets: [
      '"Review this entire website" — list each important URL under Supplemental URLs (homepage + About + key articles). Discovery alone may miss deep routes. State in the query that attached URLs are authoritative for this run.',
      'Report says a site could not be loaded but you can open it in a browser — the server may have fetched little text (SPA/JS), discovery never ingested that host, or the synthesizer had zero chunks from that domain. Check trace ingest messages; re-run with explicit supplemental URLs.',
      '403 / bot blocking from the origin — production fetch IPs differ from your laptop. Try Wayback or paste critical text into Supplemental Context.',
      'Plan gate stuck — confirm or cancel on Research; refresh with ?runId= if you navigated away.',
      'Deep toggle locked — upgrade to Pro or use Standard Retrieval for non–deep-report quota.',
      'Thin corpus — add Ingest sources beforehand, supplemental files, and explicit URLs; narrow filter tags if you over-scoped retrieval.',
    ],
  },
  {
    icon: ArrowRight,
    color: 'text-research-teal',
    title: 'Recommended first steps',
    steps: [
      'Open Research → choose Standard Retrieval or Deep Adversarial Synthesis.',
      'Write a specific, testable query. State what might be neglected and what would falsify your angle.',
      'If specific pages must be read, add them under Supplemental URLs (not only inside the query). Optional: seed corpus via Ingest and use filter tags.',
      'Submit and watch the trace — confirm the plan when prompted.',
      'Review the report — Contradiction Analysis and Falsification Criteria first.',
      'For Deep objective-specific behavior, read Research modes and capabilities.',
      'Export to Atlas for follow-up leads; use revision or spinoff for the next iteration.',
    ],
  },
];

function SectionBody({ section }: { section: GuideSection }) {
  return (
    <>
      {section.content ? (
        <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{section.content}</div>
      ) : null}

      {section.roles ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {section.roles.map((role) => (
            <div key={role.label} className="bg-surface-200 rounded-lg p-3 flex items-start gap-3">
              <role.icon size={14} className="text-accent mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold text-white">{role.label}</div>
                <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{role.desc}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {section.tiers ? (
        <div className="space-y-2">
          {section.tiers.map((tier) => (
            <div key={tier.tier} className="flex items-start gap-3 p-3 bg-surface-200 rounded-lg">
              <div className={`badge badge-${tier.tier} flex-shrink-0`}>{tier.label}</div>
              <p className="text-xs text-slate-400 leading-relaxed">{tier.desc}</p>
            </div>
          ))}
        </div>
      ) : null}

      {section.bullets ? (
        <ul className="list-disc list-inside space-y-2 text-sm text-slate-300 leading-relaxed">
          {section.bullets.map((item) => (
            <li key={item.slice(0, 48)}>{item}</li>
          ))}
        </ul>
      ) : null}

      {section.steps ? (
        <ol className="space-y-2">
          {section.steps.map((step, j) => (
            <li key={step.slice(0, 40)} className="flex items-start gap-3 text-sm text-slate-300">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">
                {j + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

export default function GuidePage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <HelpCircle className="text-accent" size={24} />
          How to Use ResearchOne
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Disciplined anomaly research. Read this before running your first investigation.
        </p>
        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <Link to="/app/research" className="text-accent hover:underline">
            Research
          </Link>
          <Link to="/app/guide/research-v2" className="text-accent hover:underline">
            Deep research modes
          </Link>
          <Link to="/app/ingest" className="text-accent hover:underline">
            Ingest
          </Link>
        </nav>
      </div>

      <div className="card p-4 border border-accent/20 bg-accent/5">
        <p className="text-sm text-slate-300 leading-relaxed">
          <span className="text-white font-medium">Quick rule:</span> anything you need the system to{' '}
          <span className="text-white">read from the web</span> must be attached as a{' '}
          <span className="text-white">Supplemental URL</span> or file — not only pasted into the research
          question. Discovery supplements with search hits; it does not replace per-page attachments for sites
          you care about.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title} className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <section.icon size={18} className={section.color} />
            <h2 className="text-base font-semibold text-white">{section.title}</h2>
          </div>
          <SectionBody section={section} />
          {section.title === 'Deep Adversarial Synthesis — options beyond Standard' ? (
            <p className="text-sm text-slate-400">
              <Link to="/app/guide/research-v2" className="text-accent hover:underline">
                Research modes and capabilities →
              </Link>
            </p>
          ) : null}
          {section.title === 'Recommended first steps' ? (
            <p className="text-sm text-slate-400">
              Deep objective reference:{' '}
              <Link to="/app/guide/research-v2" className="text-accent hover:underline">
                /app/guide/research-v2
              </Link>
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
