import {
  HelpCircle,
  FlaskConical,
  Database,
  Layers,
  BookOpen,
  AlertTriangle,
  Shield,
  Zap,
  Brain,
  Target,
  ArrowRight,
} from 'lucide-react';

const SECTIONS = [
  {
    icon: FlaskConical,
    color: 'text-accent',
    title: 'What is ResearchOne?',
    content: `ResearchOne is a disciplined anomaly research platform. It is not a chatbot. It is not a hallucination machine. It is a structured evidence-gathering and reasoning system designed to investigate where mainstream corpora may be incomplete, filtered, distorted, or consensus-bound.

The system enforces strict epistemic discipline: every claim is tagged with an evidence tier, contradictions are first-class data, and reports are designed to attack their own conclusions before finalizing them.`,
  },
  {
    icon: Brain,
    color: 'text-research-purple',
    title: 'The 6-Role Research Pipeline',
    content: null,
    roles: [
      { icon: Brain, label: 'Planner', desc: 'Decomposes your query into sub-questions, retrieval targets, and a falsifiable hypothesis. Sets the investigation scope.' },
      { icon: Database, label: 'Retriever', desc: 'Searches the corpus with hybrid vector + full-text search. Evaluates each chunk by evidence tier. Flags outliers and bridges.' },
      { icon: Zap, label: 'Reasoner', desc: 'Builds structured argument chains from the evidence. Tags every claim. Reasons backward from anomalies to mechanisms.' },
      { icon: Shield, label: 'Skeptic', desc: 'Attacks the conclusions. Finds alternative explanations. Asks what a careful critic would say.' },
      { icon: BookOpen, label: 'Synthesizer', desc: 'Writes the full long-form report with all required sections. Never exceeds the evidence. Uses academic rigor.' },
      { icon: Target, label: 'Verifier', desc: 'Quality gate. Checks that all claims are tiered, contradictions are acknowledged, and inferences are not presented as facts.' },
    ],
  },
  {
    icon: Database,
    color: 'text-research-teal',
    title: 'Evidence Tiers — Critical Distinction',
    content: null,
    tiers: [
      { tier: 'established_fact', label: 'Established Fact', color: 'text-green-400', desc: 'Replicated findings, strong consensus, high evidentiary burden met.' },
      { tier: 'strong_evidence', label: 'Strong Evidence', color: 'text-blue-400', desc: 'Good experimental or empirical support, not yet at consensus level.' },
      { tier: 'testimony', label: 'Testimony', color: 'text-amber-400', desc: 'Eyewitness, expert, or whistleblower accounts. Valuable but unverified.' },
      { tier: 'inference', label: 'Inference', color: 'text-purple-400', desc: 'Logical conclusions drawn from evidence. Marked clearly as not empirically direct.' },
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

The correct workflow: find interesting points in Atlas → bring those topics back to ResearchOne → run targeted research queries → generate disciplined reports.`,
  },
  {
    icon: AlertTriangle,
    color: 'text-amber-400',
    title: 'What This System Will NOT Do',
    content: `ResearchOne is designed with hard constraints against epistemic failure modes:

• It will NOT present inferences as established facts
• It will NOT suppress contradictions — they are stored and surfaced
• It will NOT treat consensus density as a proxy for truth
• It will NOT treat outliers as automatically correct
• It will NOT generate reports without falsification criteria
• It will NOT allow the synthesizer to exceed the evidence base

The Skeptic and Verifier roles exist specifically to prevent the system from becoming a sophisticated hallucination engine.`,
  },
  {
    icon: ArrowRight,
    color: 'text-research-teal',
    title: 'Recommended First Steps',
    content: null,
    steps: [
      'Go to Ingest → add 5–10 relevant sources (papers, articles, URLs) for your research topic.',
      'Wait for ingestion and embedding to complete (watch the Corpus stats update).',
      'Go to Research → write a specific, testable research query about your topic.',
      'In the query, include what you suspect may be neglected or suppressed.',
      'Let the 6-role pipeline run — this takes several minutes for complex queries.',
      'Review the report — especially the Contradiction Analysis and Falsification Criteria sections.',
      'Export to Atlas to visualize the evidence space and find investigation leads.',
      'Run follow-up research on the most interesting outliers and unresolved questions.',
    ],
  },
];

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
      </div>

      {SECTIONS.map((section, i) => (
        <div key={i} className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <section.icon size={18} className={section.color} />
            <h2 className="text-base font-semibold text-white">{section.title}</h2>
          </div>

          {section.content && (
            <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
              {section.content}
            </div>
          )}

          {section.roles && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {section.roles.map(role => (
                <div key={role.label} className="bg-surface-200 rounded-lg p-3 flex items-start gap-3">
                  <role.icon size={14} className="text-accent mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-semibold text-white">{role.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{role.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {section.tiers && (
            <div className="space-y-2">
              {section.tiers.map(tier => (
                <div key={tier.tier} className="flex items-start gap-3 p-3 bg-surface-200 rounded-lg">
                  <div className={`badge badge-${tier.tier} flex-shrink-0`}>{tier.label}</div>
                  <p className="text-xs text-slate-400 leading-relaxed">{tier.desc}</p>
                </div>
              ))}
            </div>
          )}

          {section.steps && (
            <ol className="space-y-2">
              {section.steps.map((step, j) => (
                <li key={j} className="flex items-start gap-3 text-sm text-slate-300">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/20 text-accent text-xs flex items-center justify-center font-bold">
                    {j + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
