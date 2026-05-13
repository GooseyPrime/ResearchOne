import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Compare</h1>
        <p className="mt-3 text-r1-text-muted">
          The full capability matrix (Capability · ResearchOne · General-purpose deep research) lives on the homepage under
          &quot;Built for defensible decisions&quot; — same row labels as the site audit §2.10 brief.
        </p>
        <p className="mt-6 text-r1-text-muted">
          For a side-by-side you can share, use the landing comparison table or open the{' '}
          <Link to="/faq" className="text-r1-accent hover:underline">
            FAQ
          </Link>
          .
        </p>
        <p className="mt-8">
          <Link to="/" className="rounded-md bg-r1-accent px-5 py-3 font-semibold text-r1-bg hover:bg-r1-accent-deep">
            View comparison on homepage
          </Link>
        </p>
      </main>
      <LandingFooter />
    </div>
  );
}
