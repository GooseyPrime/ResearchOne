import { Link } from 'react-router-dom';
import LandingHeader from '../components/landing/LandingHeader';
import LandingFooter from '../components/landing/LandingFooter';
import PipelineDiagram from '../components/landing/PipelineDiagram';

const PIPELINE_STAGES: Array<{ n: number; agent: string; role: string }> = [
  { n: 1, agent: 'Planner', role: 'Decomposes your question into sub-questions, retrieval targets, falsification criteria' },
  { n: 2, agent: 'Discovery', role: 'Autonomously locates and ingests external sources when corpus is sparse' },
  { n: 3, agent: 'Retriever', role: 'Pulls evidence from corpus and sources via hybrid vector + full-text search' },
  { n: 4, agent: 'Retriever Analysis', role: 'Evaluates evidence by tier, flags outliers and bridges between concepts' },
  { n: 5, agent: 'Reasoner', role: 'Builds structured argument chains, tags every claim by evidence tier' },
  { n: 6, agent: 'Skeptic', role: "Attacks the reasoner's conclusions, surfaces alternatives, prevents confirmation bias" },
  { n: 7, agent: 'Synthesizer', role: 'Writes the long-form report, integrating reasoning and skeptical critique' },
  { n: 8, agent: 'Verifier', role: 'Quality gate — checks citation integrity, evidence-tier consistency, contradiction completeness' },
  { n: 9, agent: 'Report Save', role: 'Persists the report, sections, and verification metadata' },
  { n: 10, agent: 'Epistemic Persistence', role: 'Extracts and stores claims, contradictions, and citations into the knowledge graph' },
];

const REVISION_AGENTS = [
  'Revision Intake Agent',
  'Report Locator / Impact Mapper',
  'Change Planner',
  'Section Rewriter',
  'Citation Integrity Checker',
  'Diff / Patch Assembler',
  'Final Revision Verifier',
];

export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-5xl">How ResearchOne works</h1>
        <p className="mt-4 max-w-3xl text-r1-text-muted">
          Every report follows the same disciplined 10-stage pipeline with planner, discovery, retriever, reasoner,
          skeptic, synthesizer, verifier, and persistence layers.
        </p>

        <section className="mt-12">
          <h2 className="font-serif text-3xl">Ten stages. Seven specialized agents.</h2>
          <p className="mt-3 text-r1-text-muted">
            Every report follows the same disciplined pipeline. You see it run live as it happens.
          </p>
          <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-r1-bg-deep">
                  <th className="px-4 py-3 font-mono text-xs uppercase text-r1-accent">#</th>
                  <th className="px-4 py-3 font-semibold">Agent</th>
                  <th className="px-4 py-3 font-semibold">What it does</th>
                </tr>
              </thead>
              <tbody>
                {PIPELINE_STAGES.map((row) => (
                  <tr key={row.n} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-mono text-r1-text-muted">{row.n}</td>
                    <td className="px-4 py-3 text-r1-text">{row.agent}</td>
                    <td className="px-4 py-3 text-r1-text-muted">{row.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <PipelineDiagram />
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-3xl">What &quot;contradictions preserved&quot; looks like</h2>
          <p className="mt-3 text-r1-text-muted">
            Most tools sand contested findings into a clean narrative. ResearchOne names them.
          </p>
          <pre className="mt-6 overflow-auto rounded-xl border border-white/10 bg-r1-bg-deep p-4 text-xs text-r1-text-muted">{`--- Excerpt: "Effects of Intermittent Fasting on Insulin Sensitivity" ---

[strong_evidence]  Multiple RCTs show improved fasting insulin
                   in metabolically unhealthy adults [3, 7, 12].

[contradiction]    Three trials reaching opposite conclusions on
                   women under 40 [9, 14, 22] — protocol differences
                   in fasting window length appear material.

[testimony]        Self-reported energy and sleep quality benefits
                   appear consistently in observational studies but
                   are not isolated from selection effects.

[speculation]      Mechanism via autophagy upregulation is plausible
                   but human-trial evidence is preliminary.`}</pre>
        </section>

        <section className="mt-16">
          <h2 className="font-serif text-3xl">Post-publication revision workflow</h2>
          <p className="mt-4 text-r1-text-muted">
            Published reports can be revised through a dedicated seven-agent pipeline (documented in the repository README):
            structured intake, impact mapping, change planning, section rewrites, citation integrity checks, diff assembly,
            and a final verifier.
          </p>
          <ol className="mt-6 list-decimal space-y-2 pl-6 text-r1-text-muted">
            {REVISION_AGENTS.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-r1-text-muted">
            Each stage emits progress over the live socket so operators can trace revisions end-to-end.
          </p>
        </section>

        <p className="mt-12">
          <Link to="/pricing" className="text-r1-accent hover:underline">
            View pricing →
          </Link>
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
