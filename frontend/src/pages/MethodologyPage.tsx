import LandingHeader from '../components/landing/LandingHeader';
import LandingFooter from '../components/landing/LandingFooter';
import PipelineDiagram from '../components/landing/PipelineDiagram';

export default function MethodologyPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-5xl">How ResearchOne works</h1>
        <p className="mt-4 text-r1-text-muted">
          Every report follows the same disciplined 10-stage pipeline with planner, discovery, retriever, reasoner,
          skeptic, synthesizer, verifier, and persistence layers.
        </p>
        <section className="mt-10">
          <PipelineDiagram />
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
