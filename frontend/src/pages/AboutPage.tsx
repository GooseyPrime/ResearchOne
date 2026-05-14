import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Built by people who refuse to sanitize the sources.</h1>
        <p className="mt-4 text-r1-text-muted">
          ResearchOne is engineered for analysts, decision desks, and researchers whose work has to survive scrutiny.
        </p>
        <p className="mt-4 text-r1-text-muted">
          Read the full methodology for stage-by-stage detail, or open a sample report to see the output shape.
        </p>
        <p className="mt-8 text-sm">
          <Link to="/methodology" className="text-r1-accent hover:underline">
            Methodology →
          </Link>
          {' · '}
          <Link to="/sample-report" className="text-r1-accent hover:underline">
            Sample report →
          </Link>
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
