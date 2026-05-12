import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

export default function MarketingDocsPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Docs</h1>
        <p className="mt-3 text-r1-text-muted">
          Public documentation stub. Deep technical references live alongside the methodology and security pages; authenticated
          in-app guides cover day-to-day usage.
        </p>
        <ul className="mt-8 list-disc space-y-3 pl-5 text-r1-text-muted">
          <li>
            <Link to="/methodology" className="text-r1-accent hover:underline">
              Methodology — ten stages, modes, skeptic pass
            </Link>
          </li>
          <li>
            <Link to="/security" className="text-r1-accent hover:underline">
              Security &amp; trust posture
            </Link>
          </li>
          <li>
            <Link to="/app/guide" className="text-r1-accent hover:underline">
              In-app guide (sign in)
            </Link>
          </li>
        </ul>
      </main>
      <LandingFooter />
    </div>
  );
}
