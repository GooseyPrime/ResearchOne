import { Link } from 'react-router-dom';
import {
  HelpCircle,
  FlaskConical,
  BookOpen,
  Search,
  FileCode2,
  Lightbulb,
  GitBranch,
  ShieldOff,
  Brain,
  AlertCircle,
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
      'The default Deep research type. Conducts rigorous, reasoning-first research on any topic by analyzing claims, extracting citations, and compiling a balanced report without assuming active, coordinated suppression.',
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
      'A meta-analytical type designed to find underlying frameworks connecting disparate fields of high strangeness or fringe physics (e.g., correlating consciousness studies with quantum entanglement or UAP observables).',
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
          Deep Research — research types
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Each type changes orchestrator focus, skeptic criteria, and report structure on{' '}
          <Link to="/app/research?engine=v2" className="text-accent hover:underline">
            Deep Research
          </Link>
          . General console guidance:{' '}
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

      <h2 className="text-lg font-semibold text-white">Under the hood</h2>
      <p className="text-sm text-slate-400">
        Deep Research runs the V2 model ensemble. Research type enum keys and backend overlays are unchanged — this page
        explains what each display name does at runtime.
      </p>

      <div className="card p-4 flex items-start gap-3 border border-indigo-900/30">
        <HelpCircle className="text-slate-500 flex-shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-slate-400 leading-relaxed">
          Deep Research uses a reasoning-first policy (see <span className="font-mono">ResearchOne PolicyOne</span>):
          the platform shifts agent configurations and models by research type to support literature rigor, investigative
          tracing, patent whitespace, applied feasibility, or cross-domain correlation — without assuming a single
          narrative by default. Pages you need in the corpus must be listed under{' '}
          <span className="text-slate-200">Attach supporting files / URLs</span> on the research form; URLs mentioned
          only in the query are not auto-fetched.
        </p>
      </div>

      <div className="card p-5 space-y-4 border border-indigo-900/30">
        <div className="flex items-center gap-2">
          <ShieldOff className="text-amber-300" size={18} />
          <h2 className="text-base font-semibold text-white">V2 model selection criteria</h2>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">
          V2 default primaries are chosen by <span className="text-slate-100">inference-time behavior</span> under
          ResearchOne's reasoning-first system prompt — not by training labels alone. Defaults must pass live routing
          checks: preserve anomalous claims literally, avoid debunk-by-recall, and keep chain-of-thought intact on
          reasoner roles. That typically means open-weights thinking models with light RLHF, abliterated weights, or
          steerable low-refusal instruct lines with verified multi-upstream redundancy on critical paths. RLHF
          refusal-aligned closed pipelines and unabliterated instruct bases are{' '}
          <span className="text-amber-200">user-opt-in fallbacks only</span> — they must not run silently as V2
          defaults.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-green-800/30 bg-green-950/20 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <Brain className="text-green-400" size={14} />
              <span className="text-xs font-semibold text-green-300">What V2 primaries MUST do</span>
            </div>
            <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
              <li>Follow the operator system prompt as authority</li>
              <li>Preserve anomalous claims literally — no auto-correct, no debunking</li>
              <li>Keep R1-style chain-of-thought reasoning intact (reasoner role)</li>
              <li>Produce structured JSON / markdown without alignment filtering</li>
              <li>Allow skeptic / internal challenger roles to stress-test mainstream consensus</li>
            </ul>
          </div>
          <div className="rounded-md border border-red-800/40 bg-red-950/20 p-3 space-y-1">
            <div className="flex items-center gap-2">
              <AlertCircle className="text-red-400" size={14} />
              <span className="text-xs font-semibold text-red-300">What V2 primaries MUST NOT do</span>
            </div>
            <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
              <li>Refuse anomalous queries (no live RLHF refusal head)</li>
              <li>Silently sanitize, omit, or debunk suppressed-knowledge claims</li>
              <li>Inject mainstream-consensus counter-sources not in the corpus</li>
              <li>Route through a closed-source moderation pipeline we do not control</li>
              <li>Be an aligned-base Llama / Qwen / DeepSeek instruct slug without abliteration</li>
            </ul>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          RLHF-aligned models (e.g. <span className="text-slate-200">meta-llama/Llama-3.3-70B-Instruct</span>,
          <span className="text-slate-200"> Qwen/Qwen2.5-72B-Instruct</span>,
          <span className="text-slate-200"> deepseek-ai/DeepSeek-R1-Distill-Llama-70B</span>) remain allowlisted but
          are <span className="text-amber-200">user-opt-in fallbacks only</span>. They never fire silently. If you
          enable a per-role fallback in the Deep Research page, the live trace will record{' '}
          <span className="font-mono">usedFallback=true</span> with the actual model so you can tell whether the report
          was generated through a refusal-aligned model.
        </p>

        <p className="text-xs text-slate-500">
          Full criteria: see <span className="font-mono">docs/V2_MODEL_SELECTION_CRITERIA.md</span> in the repository.
          Policy: <span className="font-mono">ResearchOne PolicyOne</span>.
        </p>
      </div>

      {MODES.map((mode) => (
        <div key={mode.objective} className="card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <mode.icon size={18} className={mode.color} />
            <h2 className="text-base font-semibold text-white">{researchObjectiveLabel(mode.objective)}</h2>
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
