import { Link } from 'react-router-dom';
import LandingFooter from '../components/landing/LandingFooter';
import LandingHeader from '../components/landing/LandingHeader';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-r1-bg text-r1-text">
      <LandingHeader />
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-16 sm:px-6">
        <h1 className="font-serif text-4xl">Security & privacy</h1>
        <ul className="list-disc space-y-2 pl-5 text-r1-text-muted">
          <li>Server-side model calls. API keys never reach your browser.</li>
          <li>Per-user isolation with row-level security on shared infrastructure.</li>
          <li>BYOK secrets encrypted at rest and never logged.</li>
          <li>Export and delete controls available from account settings.</li>
        </ul>
        <Link to="/privacy" className="text-r1-accent hover:underline">Read privacy policy →</Link>
      </main>
      <LandingFooter />
    </div>
  );
}
