import { Link } from 'react-router-dom';
import { HelpCircle, FlaskConical, BookOpen, Search, FileCode2, Lightbulb, GitBranch } from 'lucide-react';

const MODES = [
  {
    icon: Search,
    color: 'text-accent',
    title: 'General Epistemic Research (V1 baseline)',
    definition:
      'The standard, foundational reasoning loop of the platform. It conducts rigorous, reasoning-first research on any given topic by objectively analyzing claims, extracting citations, and synthesizing a highly accurate report without inherently assuming active, coordinated suppression.',
    capabilities: [
      'Exhaustive literature review',
      'Multi-step query generation',
      'Precise claim extraction',
      'Contradiction mapping',
      'Strict citation integrity checking',
    ],
    reportOutput: [
      'A comprehensive, heavily cited, and balanced synthesis report detailing the factual landscape, core claims, and logical structure of the requested topic.',
    ],
  },
  {
    icon: BookOpen,
    color: 'text-research-purple',
    title: 'Investigative Synthesis (Suppression & Historical Tracing)',
    definition:
      'A deep-dive historical and investigative mode designed specifically to trace the origins, active suppression, and fragmentation of anomalous data or suppressed technologies (e.g., zero-point energy suppression, UAP disclosure).',
    capabilities: [
      'Maps historical claims',
      'Identifies contradictory public narratives',
      'Highlights systemic biases in mainstream data',
      'Exposes coordinated architectures of secrecy',
    ],
    reportOutput: [
      'A chronological, narrative-driven intelligence report detailing the "who, what, and why" of information suppression, culminating in an assessment of the current state of truth.',
    ],
  },
  {
    icon: FileCode2,
    color: 'text-research-teal',
    title: 'Patent Gap Analysis',
    definition:
      'A highly rigid, technical mode that cross-references suppressed physical mechanisms against current public patent databases to find unpatented technological whitespace.',
    capabilities: [
      'Analyzes prior art',
      'Identifies ignored or suppressed physical mechanisms',
      'Maps the boundaries of current industrial intellectual property',
    ],
    reportOutput: [
      'A highly structured, technical gap analysis with sections on Current Prior Art, Suppressed Mechanisms Identified, Whitespace Vectors, and proposed structural boundaries for new patent claims.',
    ],
  },
  {
    icon: Lightbulb,
    color: 'text-amber-400',
    title: 'Novel Application Discovery',
    definition:
      'A lateral-thinking engineering mode. It takes anomalous or suppressed physics and asks: "If this data is true, how can it be applied to solve current engineering bottlenecks?"',
    capabilities: [
      'Cross-disciplinary integration',
      'Theoretical engineering feasibility',
      'Associative reasoning',
      'Bypasses the "this violates thermodynamics" block to propose actual, buildable applications',
    ],
    reportOutput: [
      'A theoretical feasibility study or applied engineering proposal with Conventional Limitations, Anomalous Mechanisms, and Proposed Cross-Disciplinary Applications.',
    ],
  },
  {
    icon: GitBranch,
    color: 'text-research-blue',
    title: 'Anomaly Correlation',
    definition:
      'A meta-analytical mode designed to find the underlying theoretical frameworks connecting disparate fields of high strangeness or fringe physics (e.g., correlating consciousness studies with quantum entanglement or UAP observables).',
    capabilities: [
      'Massive pattern recognition',
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
          Research One 2 — Research modes
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Each mode changes orchestrator focus, red-team criteria, and report structure. Open-weights ensemble defaults are tuned per mode on{' '}
          <Link to="/research-v2" className="text-accent hover:underline">
            Research One 2
          </Link>
          .
        </p>
      </div>

      <div className="card p-4 flex items-start gap-3 border border-indigo-900/30">
        <HelpCircle className="text-slate-500 flex-shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-slate-400 leading-relaxed">
          Research One 2 uses a reasoning-first epistemic policy: the platform shifts agent configurations and models by research mode to support literature rigor, investigative tracing, patent whitespace, applied feasibility, or cross-domain correlation—without assuming a single narrative by default.
        </p>
      </div>

      {MODES.map((mode) => (
        <div key={mode.title} className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <mode.icon size={18} className={mode.color} />
            <h2 className="text-base font-semibold text-white">{mode.title}</h2>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Definition</div>
            <p className="text-sm text-slate-300 leading-relaxed">{mode.definition}</p>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Capabilities</div>
            <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
              {mode.capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Report output</div>
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
