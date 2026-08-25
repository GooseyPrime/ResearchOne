import { Link } from 'react-router-dom';
import {
  HelpCircle,
  FlaskConical,
  BookOpen,
  Search,
  FileCode2,
  Lightbulb,
  GitBranch,
} from 'lucide-react';
import { researchObjectiveLabel } from '@/constants/researchObjectives';
import type { ResearchObjective } from '@/utils/api';
import {
  HOW_YOUR_REPORT_IS_MADE_HEADING,
  HOW_YOUR_REPORT_IS_MADE_STEPS,
} from '@/content/howYourReportIsMade';

const MODES: Array<{
  objective: ResearchObjective;
  icon: typeof Search;
  color: string;
  definition: string;
  capabilities: string[];
  reportOutput: string[];
}> = [
  {
    objective: 'GENERAL_EPISTEMIC_RESEARCH',
    icon: Search,
    color: 'text-accent',
    definition:
      'The default. Rigorous, reasoning-first research on any topic: it analyses the claims, extracts citations, and compiles a balanced report without assuming anything is being deliberately hidden.',
    capabilities: [
      'Exhaustive literature review',
      'Multi-step query generation',
      'Precise claim extraction',
      'Contradiction mapping',
      'Strict citation integrity checking',
    ],
    reportOutput: [
      'A comprehensive, heavily cited, and balanced report detailing the factual landscape, core claims, and logical structure of the requested topic.',
    ],
  },
  {
    objective: 'INVESTIGATIVE_SYNTHESIS',
    icon: BookOpen,
    color: 'text-research-purple',
    definition:
      'A deep-dive historical and investigative type designed to trace origins, institutional gaps, and fragmentation of contested data or overlooked technologies.',
    capabilities: [
      'Maps historical claims',
      'Identifies contradictory public narratives',
      'Highlights systemic biases in mainstream data',
      'Surfaces coordinated information gaps',
    ],
    reportOutput: [
      'A chronological, narrative-driven intelligence report detailing actors, timelines, and source disagreements, culminating in an assessment of the current state of the record.',
    ],
  },
  {
    objective: 'PATENT_GAP_ANALYSIS',
    icon: FileCode2,
    color: 'text-research-teal',
    definition:
      'A highly rigid, technical type that cross-references physical mechanisms against public patent databases to find unpatented technological whitespace.',
    capabilities: [
      'Analyzes prior art',
      'Identifies overlooked or under-cited physical mechanisms',
      'Maps the boundaries of current industrial intellectual property',
    ],
    reportOutput: [
      'A structured technical gap analysis with sections on Current Prior Art, Mechanisms Identified, Whitespace Vectors, and proposed structural boundaries for new patent claims.',
    ],
  },
  {
    objective: 'NOVEL_APPLICATION_DISCOVERY',
    icon: Lightbulb,
    color: 'text-amber-400',
    definition:
      'A lateral-thinking engineering type. It takes contested or under-explored physics and asks: "If this data holds up, how can it address current engineering bottlenecks?"',
    capabilities: [
      'Cross-disciplinary integration',
      'Theoretical engineering feasibility',
      'Associative reasoning',
      'Proposes buildable applications without defaulting to consensus dismissal',
    ],
    reportOutput: [
      'A theoretical feasibility study or applied engineering proposal with Conventional Limitations, Contested Mechanisms, and Proposed Cross-Disciplinary Applications.',
    ],
  },
  {
    objective: 'ANOMALY_CORRELATION',
    icon: GitBranch,
    color: 'text-research-blue',
    definition:
      'A meta-analytical type designed to find underlying frameworks across sparse, heterogeneous, or weakly connected evidence sets.',
    capabilities: [
      'Large-scale pattern recognition',
      'Statistical correlation of margin data',
      'Unified theory generation',
    ],
    reportOutput: [
      'A unified theoretical framework report with Disparate Phenomena Analyzed, Identified Overlaps, and Proposed Unified Mechanisms.',
    ],
  },
];

export default function ResearchV2GuidePage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <FlaskConical className="text-accent" size={24} />
          What happens to a research request
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Every request is answered the same way. What changes is the kind of question you asked —
          the types below decide what the report is built to show you. Getting around the app:{' '}
          <Link to="/app/guide" className="text-accent hover:underline">
            How to Use ResearchOne
          </Link>
          .
        </p>
      </div>

      <div className="card p-6 space-y-4 border border-accent/20">
        <h2 className="text-base font-semibold text-white">{HOW_YOUR_REPORT_IS_MADE_HEADING}</h2>
        <ol className="space-y-2 list-decimal list-inside text-sm text-slate-300 leading-relaxed">
          {HOW_YOUR_REPORT_IS_MADE_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="card p-4 flex items-start gap-3 border border-indigo-900/30">
        <HelpCircle className="text-slate-500 flex-shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-slate-400 leading-relaxed">
          One thing worth knowing before you submit: a link you only mention inside your question is
          not fetched. If a page has to be read, attach it under{' '}
          <span className="text-slate-200">Documents and links</span> on the request form.
        </p>
      </div>

      <h2 className="text-lg font-semibold text-white">Types of research</h2>
      <p className="text-sm text-slate-400">
        Leave this on automatic and we pick from your request. Choose one yourself when you already
        know what shape the answer needs to take.
      </p>

      {MODES.map((mode) => (
        <div key={mode.objective} className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <mode.icon size={18} className={mode.color} />
            <h2 className="text-base font-semibold text-white">{researchObjectiveLabel(mode.objective)}</h2>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">What it is</div>
            <p className="text-sm text-slate-300 leading-relaxed">{mode.definition}</p>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">What it does</div>
            <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
              {mode.capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">What you get</div>
            <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
              {mode.reportOutput.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
